import express from 'express'
import type { ErrorRequestHandler, Request, Response } from 'express'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { balances, centsSchema, currencies, expenseInputSchema, memberColors, nameSchema } from '../shared/domain.ts'
import type { Household } from '../shared/domain.ts'
import type { Store } from './store.ts'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const createSchema = z.object({ name: nameSchema, memberName: nameSchema, currency: z.enum(currencies), budget: centsSchema })
const joinSchema = z.object({ inviteCode: z.string().min(8).max(80), name: nameSchema })
const versionSchema = z.object({ version: z.number().int().nonnegative() })

export function createApp(store: Store) {
  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  app.use('/api', express.json({ limit: '32kb' }))
  const attempts = new Map<string, { count: number; expires: number }>()
  app.use('/api', (req, _res, next) => {
    if (req.method === 'GET') return next()
    const key = req.ip ?? 'local'
    const now = Date.now()
    for (const [ip, limit] of attempts) if (limit.expires < now) attempts.delete(ip)
    const limit = attempts.get(key) ?? { count: 0, expires: now + 60_000 }
    limit.count++
    attempts.set(key, limit)
    if (limit.count > 120) return next(new ApiError(429, 'A lot is happening in this kitchen. Wait a minute and try again.'))
    next()
  })

  const authenticated = (req: Request) => {
    const header = req.get('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
    const session = token ? store.authenticate(token) : null
    if (!session) throw new ApiError(401, 'This kitchen session has expired. Join again with your invitation.')
    return session
  }
  const mutate = (req: Request, res: Response, change: (household: Household) => void) => {
    const { household } = authenticated(req)
    const { version } = versionSchema.parse(req.body)
    if (version !== household.version) throw new ApiError(409, 'A roommate just changed the kitchen. It has been refreshed; please try again.')
    change(household)
    household.version++
    store.save(household)
    res.json({ household })
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
  app.post('/api/demo', (_req, res) => res.status(201).json(store.create('The Sunday House', 'You', 'EUR', 45000, true)))
  app.post('/api/households', (req, res) => {
    const input = createSchema.parse(req.body)
    res.status(201).json(store.create(input.name, input.memberName, input.currency, input.budget))
  })
  app.post('/api/join', (req, res) => {
    const input = joinSchema.parse(req.body)
    const household = store.byInvite(input.inviteCode)
    if (!household || household.demo) throw new ApiError(404, 'That invitation was not found. Ask your roommate for a fresh link.')
    if (household.members.length >= 12) throw new ApiError(409, 'This kitchen already has 12 roommates.')
    if (household.members.some((member) => member.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
      throw new ApiError(409, 'A roommate already uses that name. Choose a different name to keep the ledger clear.')
    }
    const member = { id: randomUUID(), name: input.name, color: memberColors[household.members.length % memberColors.length] }
    household.members.push(member)
    household.version++
    store.save(household)
    res.status(201).json(store.session(household, member.id))
  })
  app.get('/api/household', (req, res) => res.json(authenticated(req)))
  app.post('/api/expenses', (req, res) => mutate(req, res, (household) => {
    const expense = expenseInputSchema.parse(req.body)
    if (!household.members.some((member) => member.id === expense.paidBy)
      || expense.participants.some((id) => !household.members.some((member) => member.id === id))) {
      throw new ApiError(400, 'Choose roommates who belong to this kitchen.')
    }
    if (household.expenses.length >= 20_000) throw new ApiError(409, 'This kitchen has reached its expense limit. Export the ledger and start a new kitchen.')
    household.expenses.unshift({ ...expense, id: randomUUID(), createdAt: new Date().toISOString() })
  }))
  app.delete('/api/expenses/:id', (req, res) => mutate(req, res, (household) => {
    const index = household.expenses.findIndex((expense) => expense.id === req.params.id)
    if (index === -1) throw new ApiError(404, 'That grocery run is no longer in the ledger.')
    household.expenses.splice(index, 1)
  }))
  app.post('/api/settlements', (req, res) => mutate(req, res, (household) => {
    const transfer = z.object({ from: z.string().uuid(), to: z.string().uuid(), amount: centsSchema }).parse(req.body)
    const current = balances(household)
    if (transfer.from === transfer.to || !current.has(transfer.from) || !current.has(transfer.to)
      || (current.get(transfer.from) ?? 0) >= 0 || (current.get(transfer.to) ?? 0) <= 0
      || transfer.amount > -(current.get(transfer.from) ?? 0) || transfer.amount > (current.get(transfer.to) ?? 0)) {
      throw new ApiError(409, 'These balances have changed. Use the updated repayment suggestion.')
    }
    household.settlements.unshift({ ...transfer, id: randomUUID(), createdAt: new Date().toISOString() })
  }))
  app.delete('/api/settlements/:id', (req, res) => mutate(req, res, (household) => {
    const index = household.settlements.findIndex((settlement) => settlement.id === req.params.id)
    if (index === -1) throw new ApiError(404, 'That repayment is no longer in the ledger.')
    household.settlements.splice(index, 1)
  }))
  app.patch('/api/household', (req, res) => mutate(req, res, (household) => {
    const input = z.object({ name: nameSchema, budget: centsSchema, currency: z.enum(currencies) }).parse(req.body)
    if (input.currency !== household.currency && (household.expenses.length || household.settlements.length)) {
      throw new ApiError(400, 'Currency cannot change after the first expense. Create a new kitchen for a different currency.')
    }
    Object.assign(household, input)
  }))
  app.post('/api/invite/rotate', (req, res) => mutate(req, res, (household) => {
    household.inviteCode = randomBytes(12).toString('base64url')
  }))
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'This kitchen action could not be found.')))
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues[0]?.message ?? 'Please check the form fields.' })
    } else if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message })
    } else if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      res.status(400).json({ error: 'The request could not be read. Please try again.' })
    } else if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ error: 'That request is too large.' })
    } else {
      console.error('Kitchen request failed:', error instanceof Error ? error.message : 'Unknown error')
      res.status(500).json({ error: 'The kitchen could not save that change. Please try again.' })
    }
  }
  app.use(errors)
  return app
}
