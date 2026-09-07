import express from 'express'
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  balances, billCreateInputSchema, billEditInputSchema, billPaymentInputSchema, billingDate,
  centsSchema, currencies, expenseInputSchema, memberColors, nameSchema, roomStyleSchema,
  shoppingCheckoutSchema, shoppingClaimSchema, shoppingItemEditSchema, shoppingItemInputSchema,
  shoppingItemLimit, shoppingItemVersionSchema, shoppingPickSchema, shoppingRunLimit,
} from '../shared/domain.ts'
import type { Bill, Expense, Household, ShoppingItem } from '../shared/domain.ts'
import { billOccurrence, reviseBill, setBillPaused } from '../shared/bills.ts'
import { canEditShoppingItem, checkoutItems } from '../shared/shopping.ts'
import { deviceNameInputSchema, recoverInputSchema, recoveryRotationInputSchema } from '../shared/access.ts'
import type { Store } from './store.ts'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const createSchema = z.object({ name: nameSchema, memberName: nameSchema, currency: z.enum(currencies), budget: centsSchema })
const joinSchema = z.object({ inviteCode: z.string().min(8).max(80), name: nameSchema })
const versionSchema = z.object({ version: z.number().int().nonnegative() })
const expiredSession = 'This browser session has expired or was revoked. Recover access or join again with your invitation.'

function rateLimit(maximum: number, window: number, message: string): RequestHandler {
  const attempts = new Map<string, { count: number; expires: number }>()
  return (req, _res, next) => {
    if (req.method === 'GET') return next()
    const key = req.ip ?? 'local'
    const now = Date.now()
    for (const [ip, limit] of attempts) if (limit.expires <= now) attempts.delete(ip)
    const limit = attempts.get(key) ?? { count: 0, expires: now + window }
    limit.count++
    attempts.set(key, limit)
    if (limit.count > maximum) return next(new ApiError(429, message))
    next()
  }
}

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
  app.use('/api', rateLimit(120, 60_000, 'A lot is happening in this kitchen. Wait a minute and try again.'))

  const authenticated = (req: Request) => {
    const header = req.get('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
    const session = token ? store.authenticate(token) : null
    if (!session) throw new ApiError(401, expiredSession)
    return session
  }
  const availableAccess = <T>(result: T | null): T => {
    if (result === null) throw new ApiError(401, expiredSession)
    return result
  }
  const mutate = (req: Request, res: Response, change: (household: Household, memberId: string) => void) => {
    const { household, memberId } = authenticated(req)
    const { version } = versionSchema.parse(req.body)
    if (version !== household.version) throw new ApiError(409, 'A roommate just changed the kitchen. It has been refreshed; please try again.')
    change(household, memberId)
    household.version++
    store.save(household)
    res.json({ household })
  }
  const requireRoommates = (household: Household, participants: string[], paidBy?: string) => {
    const members = new Set(household.members.map((member) => member.id))
    if (participants.some((id) => !members.has(id)) || (paidBy !== undefined && !members.has(paidBy))) {
      throw new ApiError(400, 'Choose roommates who belong to this kitchen.')
    }
  }
  const addExpense = (household: Household, expense: Omit<Expense, 'id' | 'createdAt'>) => {
    if (household.expenses.length >= 20_000) throw new ApiError(409, 'This kitchen has reached its expense limit. Export the ledger and start a new kitchen.')
    const saved = { ...expense, id: randomUUID(), createdAt: new Date().toISOString() }
    household.expenses.unshift(saved)
    return saved
  }
  const findBill = (household: Household, id: string): Bill => {
    const bill = household.bills.find((bill) => bill.id === id)
    if (!bill) throw new ApiError(404, 'That monthly bill was not found in this kitchen.')
    return bill
  }
  const findShoppingItem = (household: Household, id: string, version: number): ShoppingItem => {
    const item = household.shopping.items.find((item) => item.id === id)
    if (!item) throw new ApiError(404, 'That item is no longer on this kitchen list.')
    if (item.version !== version) throw new ApiError(409, 'This shopping item changed. Review the latest details and try again.')
    return item
  }
  const changeShoppingItem = (item: ShoppingItem) => {
    item.version++
    item.updatedAt = new Date().toISOString()
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
  app.post('/api/recover', rateLimit(20, 60_000, 'Too many recovery attempts. Wait a minute and try again.'), (req, res) => {
    const input = recoverInputSchema.parse(req.body)
    const restored = store.recover(input.code, input.label)
    if (!restored) throw new ApiError(401, 'That recovery code is invalid or has been replaced. Check the complete code and try again.')
    res.status(201).json(restored)
  })
  app.get('/api/access', (req, res) => {
    res.json(availableAccess(store.accessState(authenticated(req))))
  })
  app.patch('/api/access/device', (req, res) => {
    const session = authenticated(req)
    const { label } = deviceNameInputSchema.parse(req.body)
    res.json(availableAccess(store.renameCurrentDevice(session, label)))
  })
  app.post('/api/access/recovery', (req, res) => {
    const session = authenticated(req)
    const input = recoveryRotationInputSchema.parse(req.body)
    const result = availableAccess(store.rotateRecovery(session, input))
    if (result === 'conflict') throw new ApiError(409, 'Recovery settings changed in another browser. Refresh them and try again.')
    res.json(result)
  })
  app.delete('/api/access/devices/:id', (req, res) => {
    const session = authenticated(req)
    const id = z.string().uuid().parse(req.params.id)
    const result = availableAccess(store.revokeDevice(session, id))
    if (result === 'current') throw new ApiError(409, 'Use another signed-in browser to revoke this session.')
    if (result === 'missing') throw new ApiError(404, 'That browser session was not found for your roommate identity.')
    res.json(result)
  })
  app.get('/api/household', (req, res) => {
    const { household, memberId } = authenticated(req)
    res.json({ household, memberId })
  })
  app.post('/api/expenses', (req, res) => mutate(req, res, (household) => {
    const expense = expenseInputSchema.parse(req.body)
    requireRoommates(household, expense.participants, expense.paidBy)
    addExpense(household, expense)
  }))
  app.delete('/api/expenses/:id', (req, res) => mutate(req, res, (household) => {
    const index = household.expenses.findIndex((expense) => expense.id === req.params.id)
    if (index === -1) throw new ApiError(404, 'That expense is no longer in the ledger.')
    household.expenses.splice(index, 1)
  }))
  app.post('/api/shopping/items', (req, res) => mutate(req, res, (household, memberId) => {
    const input = shoppingItemInputSchema.parse(req.body)
    if (household.shopping.items.length >= shoppingItemLimit) throw new ApiError(409, 'The shopping list is full. Finish a run or remove unused items first.')
    const now = new Date().toISOString()
    household.shopping.items.push({
      ...input, id: randomUUID(), createdBy: memberId, createdAt: now, updatedAt: now,
      version: 0, claimedBy: null, pickedUp: false,
    })
  }))
  app.patch('/api/shopping/items/:id', (req, res) => mutate(req, res, (household, memberId) => {
    const input = shoppingItemEditSchema.parse(req.body)
    const item = findShoppingItem(household, req.params.id, input.itemVersion)
    if (!canEditShoppingItem(item, memberId)) throw new ApiError(409, 'Return this item to the list and release another shopper\'s claim before editing it.')
    Object.assign(item, { name: input.name, quantity: input.quantity, notes: input.notes })
    changeShoppingItem(item)
  }))
  app.delete('/api/shopping/items/:id', (req, res) => mutate(req, res, (household, memberId) => {
    const { itemVersion } = shoppingItemVersionSchema.parse(req.body)
    const item = findShoppingItem(household, req.params.id, itemVersion)
    if (!canEditShoppingItem(item, memberId)) throw new ApiError(409, 'Return this item to the list and release another shopper\'s claim before removing it.')
    household.shopping.items = household.shopping.items.filter((entry) => entry.id !== item.id)
  }))
  app.post('/api/shopping/items/:id/claim', (req, res) => mutate(req, res, (household, memberId) => {
    const input = shoppingClaimSchema.parse(req.body)
    const item = findShoppingItem(household, req.params.id, input.itemVersion)
    if (input.claimed) {
      if (item.claimedBy !== null) throw new ApiError(409, 'This item is already claimed. Review who is buying it before taking over.')
      item.claimedBy = memberId
    } else {
      if (item.claimedBy === null) throw new ApiError(409, 'This item is already available to everyone.')
      item.claimedBy = null
      item.pickedUp = false
    }
    changeShoppingItem(item)
  }))
  app.post('/api/shopping/items/:id/pick', (req, res) => mutate(req, res, (household, memberId) => {
    const input = shoppingPickSchema.parse(req.body)
    const item = findShoppingItem(household, req.params.id, input.itemVersion)
    if (item.claimedBy !== null && item.claimedBy !== memberId) throw new ApiError(409, 'Another roommate is buying this item. Release their claim before taking over.')
    if (item.pickedUp === input.pickedUp) throw new ApiError(409, 'This item already has that basket status. Refresh the list.')
    if (input.pickedUp) item.claimedBy = memberId
    item.pickedUp = input.pickedUp
    changeShoppingItem(item)
  }))
  app.post('/api/shopping/checkout', (req, res) => mutate(req, res, (household, memberId) => {
    const input = shoppingCheckoutSchema.parse(req.body)
    if (household.shopping.runs.some((run) => run.id === input.checkoutId)) throw new ApiError(409, 'This shopping run has already been recorded. Refresh the list to see its receipt.')
    if (household.shopping.runs.length >= shoppingRunLimit) throw new ApiError(409, 'This kitchen has reached its shopping history limit. Export the ledger and start a new kitchen.')
    requireRoommates(household, input.participants, input.paidBy)
    const selected = checkoutItems(household, memberId, input.items)
    if (!selected) throw new ApiError(409, 'Your basket changed. Review the items and their quantities before recording this run.')
    const expense = addExpense(household, {
      description: input.description, amount: input.amount, paidBy: input.paidBy,
      participants: input.participants, category: input.category, date: input.date, shoppingRunId: input.checkoutId,
    })
    const selectedIds = new Set(selected.map((item) => item.id))
    household.shopping.items = household.shopping.items.filter((item) => !selectedIds.has(item.id))
    household.shopping.runs.unshift({
      id: input.checkoutId, expenseId: expense.id, name: expense.description,
      completedBy: memberId, completedAt: expense.createdAt,
      items: selected.map(({ id, name, quantity, notes, createdBy, createdAt }) => ({ id, name, quantity, notes, createdBy, createdAt })),
    })
  }))
  app.post('/api/bills', (req, res) => mutate(req, res, (household) => {
    const input = billCreateInputSchema.parse(req.body)
    requireRoommates(household, input.participants)
    if (household.bills.length >= 100) throw new ApiError(409, 'This kitchen already has 100 monthly bills.')
    if (!household.bills.length) household.billingTimeZone = input.timeZone
    const startMonth = input.firstDueDate.slice(0, 7)
    household.bills.unshift({
      id: randomUUID(), createdAt: new Date().toISOString(), startMonth, pauses: [],
      revisions: [{
        fromMonth: startMonth, name: input.name, amount: input.amount,
        dueDay: Number(input.firstDueDate.slice(8)), participants: input.participants,
      }],
    })
  }))
  app.patch('/api/bills/:id', (req, res) => mutate(req, res, (household) => {
    const bill = findBill(household, req.params.id)
    const input = billEditInputSchema.parse(req.body)
    requireRoommates(household, input.participants)
    const updated = reviseBill(bill, input, billingDate(household.billingTimeZone).slice(0, 7))
    household.bills = household.bills.map((entry) => entry.id === bill.id ? updated : entry)
  }))
  app.post('/api/bills/:id/pause', (req, res) => mutate(req, res, (household) => {
    const bill = findBill(household, req.params.id)
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body)
    const alreadyPaused = bill.pauses.some((pause) => pause.untilMonth === null)
    if (paused === alreadyPaused) throw new ApiError(409, paused ? 'This monthly bill is already paused.' : 'This monthly bill is already active.')
    const updated = setBillPaused(bill, paused, billingDate(household.billingTimeZone).slice(0, 7))
    household.bills = household.bills.map((entry) => entry.id === bill.id ? updated : entry)
  }))
  app.post('/api/bills/:id/payments', (req, res) => mutate(req, res, (household) => {
    const bill = findBill(household, req.params.id)
    const input = billPaymentInputSchema.parse(req.body)
    requireRoommates(household, input.participants, input.paidBy)
    const item = billOccurrence(household, bill, input.month)
    if (!item) throw new ApiError(409, 'This bill is not scheduled for that month. Refresh the bill and choose an active month.')
    if (item.payment) throw new ApiError(409, 'A payment is already recorded for this bill and month.')
    addExpense(household, {
      description: item.name, amount: input.amount, paidBy: input.paidBy, participants: input.participants,
      category: 'other', date: input.date, bill: { billId: bill.id, month: input.month, dueDate: item.dueDate },
    })
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
  app.patch('/api/household/room-style', (req, res) => mutate(req, res, (household) => {
    const { roomStyle } = z.object({ roomStyle: roomStyleSchema }).parse(req.body)
    household.roomStyle = roomStyle
  }))
  app.patch('/api/household', (req, res) => mutate(req, res, (household) => {
    const input = z.object({ name: nameSchema, budget: centsSchema, currency: z.enum(currencies) }).parse(req.body)
    if (input.currency !== household.currency && (household.expenses.length || household.settlements.length || household.bills.length)) {
      throw new ApiError(400, 'Currency cannot change after adding expenses or monthly bills. Create a new kitchen for a different currency.')
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
