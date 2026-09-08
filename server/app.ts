import express from 'express'
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  activeMemberLimit, balances, billCreateInputSchema, billEditInputSchema, billPaymentInputSchema, billingDate,
  centsSchema, choreArchiveSchema, choreCompletionLimit, choreEditInputSchema, choreInputSchema, choreLimit, choreVersionSchema,
  currencies, expenseInputSchema, memberColors, mutationInputSchema, mutationReceiptLimit, nameSchema, roomStyleSchema, settlementSchema,
  shoppingCheckoutSchema, shoppingClaimSchema, shoppingItemEditSchema, shoppingItemInputSchema,
  retainedMemberLimit, shoppingItemLimit, shoppingItemVersionSchema, shoppingPickSchema, shoppingRunLimit,
} from '../shared/domain.ts'
import type { Bill, Chore, Expense, Household, ShoppingItem } from '../shared/domain.ts'
import { billOccurrence, reviseBill, setBillPaused } from '../shared/bills.ts'
import { ChoreError, completeChore, undoChoreCompletion } from '../shared/chores.ts'
import { canEditShoppingItem, checkoutItems } from '../shared/shopping.ts'
import { deviceNameInputSchema, recoverInputSchema, recoveryRotationInputSchema } from '../shared/access.ts'
import type { Store } from './store.ts'
import { ApiError } from './errors.ts'
import { accountCookieName, installAccounts } from './accounts-api.ts'
import type { AccountOptions } from './accounts-api.ts'

const createSchema = z.object({ name: nameSchema, memberName: nameSchema, currency: z.enum(currencies), budget: centsSchema })
const joinSchema = z.object({ inviteCode: z.string().min(8).max(80), name: nameSchema })
const versionSchema = z.object({ version: z.number().int().nonnegative() })
const expiredSession = 'This browser session has expired or was revoked. Recover access or join again with your invitation.'

function canonicalPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPayload)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalPayload(entry)]))
  }
  return value
}

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

export function createApp(store: Store, options: AccountOptions = {}) {
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

  const accounts = installAccounts(app, store, options)
  const legacyAuthenticated = async (req: Request) => {
    const header = req.get('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
    const session = token ? (await store.authenticate(token)) : null
    if (!session) throw new ApiError(401, expiredSession)
    return session
  }
  const authenticated = async (req: Request, res: Response) => req.get('authorization') !== undefined
    || !req.headers.cookie?.split(';').some((entry) => entry.trim().startsWith(`${accountCookieName}=`))
    ? (await legacyAuthenticated(req))
    : (await accounts.kitchen(req, res))
  const availableAccess = <T>(result: T | null): T => {
    if (result === null) throw new ApiError(401, expiredSession)
    return result
  }
  const mutate = async (req: Request, res: Response, change: (household: Household, memberId: string) => void | Promise<void>) => {
    const result = await store.transaction(async () => {
      const { household, memberId } = await authenticated(req, res)
      const { version } = versionSchema.parse(req.body)
      const mutation = req.body.mutationId === undefined && req.body.mutationVersion === undefined
        ? null : mutationInputSchema.parse(req.body)
      if (mutation && mutation.mutationVersion > version) throw new ApiError(400, 'The change cannot precede its original kitchen version.')
      const payload = Object.fromEntries(Object.entries(req.body)
        .filter(([key]) => !['version', 'mutationId', 'mutationVersion'].includes(key)))
      const fingerprint = createHash('sha256').update(JSON.stringify([req.method, req.path, canonicalPayload(payload)])).digest('hex')
      const receipts = household.mutationReceipts ?? []
      if (mutation) {
        const recorded = receipts.find((receipt) => receipt.id === mutation.mutationId)
        if (recorded) {
          if (recorded.memberId !== memberId) throw new ApiError(409, 'This change identifier belongs to another roommate. Start a new action.', 'MUTATION_ID_CONFLICT')
          if (recorded.fingerprint !== fingerprint) {
            throw new ApiError(409, 'Your earlier change was already saved with different details. Review the latest kitchen before making a new change.', 'MUTATION_PAYLOAD_CHANGED')
          }
          return { household, replayed: true }
        }
        // An old unconfirmed request must not become a new mutation after its receipt is pruned.
        if (receipts.length === mutationReceiptLimit && mutation.mutationVersion < receipts[0].version - 1) {
          throw new ApiError(409, 'This old change can no longer be confirmed. Review the latest kitchen, then reopen the form to make a new change.', 'MUTATION_TOO_OLD')
        }
      }
      if (version !== household.version) throw new ApiError(409, 'A roommate just changed the kitchen. It has been refreshed; please try again.')
      await change(household, memberId)
      household.version++
      if (mutation) household.mutationReceipts = [
        ...receipts.slice(-(mutationReceiptLimit - 1)),
        { id: mutation.mutationId, memberId, version: household.version, fingerprint },
      ]
      await store.save(household)
      return { household }
    })
    res.json(result)
  }
  const requireRoommates = (household: Household, participants: string[], paidBy?: string) => {
    const members = new Set(household.members.filter((member) => !member.inactive).map((member) => member.id))
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
  const findChore = (household: Household, id: string, version: number): Chore => {
    const choreId = z.string().uuid().parse(id)
    const chore = household.chores.items.find((chore) => chore.id === choreId)
    if (!chore) throw new ApiError(404, 'That chore was not found in this home.')
    if (chore.version !== version) throw new ApiError(409, 'This chore changed. Review its latest details and try again.')
    return chore
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
  app.post('/api/households', async (req, res) => {
    if (accounts.configured) {
      await accounts.authenticated(req, res)
      throw new ApiError(409, 'Create a kitchen from your account using the account household action.')
    }
    const input = createSchema.parse(req.body)
    res.status(201).json((await store.create(input.name, input.memberName, input.currency, input.budget)))
  })
  app.post('/api/join', async (req, res) => {
    if (accounts.configured) {
      await accounts.authenticated(req, res)
      throw new ApiError(403, 'Use an account invitation from the kitchen owner and accept it from your account.')
    }
    const input = joinSchema.parse(req.body)
    const session = await store.transaction(async () => {
      const household = await store.byInvite(input.inviteCode)
      if (!household) throw new ApiError(404, 'That invitation was not found. Ask your roommate for a fresh link.')
      if (await store.accounts.isManaged(household.id)) throw new ApiError(403, 'This kitchen uses account invitations. Ask its owner for a new account invitation.')
      if (household.members.filter((member) => !member.inactive).length >= activeMemberLimit) {
        throw new ApiError(409, 'This kitchen already has 12 active roommates.')
      }
      if (household.members.length >= retainedMemberLimit) {
        throw new ApiError(409, 'This kitchen has reached its 200-identity history limit. Export the ledger and create a new kitchen to add a new roommate.')
      }
      if (household.members.some((member) => member.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
        throw new ApiError(409, 'A roommate already uses that name. Choose a different name to keep the ledger clear.')
      }
      const member = { id: randomUUID(), name: input.name, color: memberColors[household.members.length % memberColors.length] }
      household.members.push(member)
      household.version++
      await store.save(household)
      return store.session(household, member.id)
    })
    res.status(201).json(session)
  })
  app.post('/api/recover', rateLimit(20, 60_000, 'Too many recovery attempts. Wait a minute and try again.'), async (req, res) => {
    const input = recoverInputSchema.parse(req.body)
    const restored = (await store.recover(input.code, input.label))
    if (!restored) throw new ApiError(401, 'That recovery code is invalid or has been replaced. Check the complete code and try again.')
    res.status(201).json(restored)
  })
  app.get('/api/access', async (req, res) => {
    res.json(availableAccess((await store.accessState((await legacyAuthenticated(req))))))
  })
  app.patch('/api/access/device', async (req, res) => {
    const session = (await legacyAuthenticated(req))
    const { label } = deviceNameInputSchema.parse(req.body)
    res.json(availableAccess((await store.renameCurrentDevice(session, label))))
  })
  app.post('/api/access/recovery', async (req, res) => {
    const session = (await legacyAuthenticated(req))
    const input = recoveryRotationInputSchema.parse(req.body)
    const result = availableAccess((await store.rotateRecovery(session, input)))
    if (result === 'conflict') throw new ApiError(409, 'Recovery settings changed in another browser. Refresh them and try again.')
    res.json(result)
  })
  app.delete('/api/access/devices/:id', async (req, res) => {
    const session = (await legacyAuthenticated(req))
    const id = z.string().uuid().parse(req.params.id)
    const result = availableAccess((await store.revokeDevice(session, id)))
    if (result === 'current') throw new ApiError(409, 'Use another signed-in browser to revoke this session.')
    if (result === 'missing') throw new ApiError(404, 'That browser session was not found for your roommate identity.')
    res.json(result)
  })
  app.get('/api/household', async (req, res) => {
    const { household, memberId } = (await authenticated(req, res))
    res.json({ household, memberId })
  })
  app.post('/api/expenses', async (req, res) => (await mutate(req, res, (household) => {
    const expense = expenseInputSchema.parse(req.body)
    requireRoommates(household, expense.participants, expense.paidBy)
    addExpense(household, expense)
  })))
  app.delete('/api/expenses/:id', async (req, res) => (await mutate(req, res, (household) => {
    const index = household.expenses.findIndex((expense) => expense.id === req.params.id)
    if (index === -1) throw new ApiError(404, 'That expense is no longer in the ledger.')
    household.expenses.splice(index, 1)
  })))
  app.post('/api/shopping/items', async (req, res) => (await mutate(req, res, (household, memberId) => {
    const input = shoppingItemInputSchema.parse(req.body)
    if (household.shopping.items.length >= shoppingItemLimit) throw new ApiError(409, 'The shopping list is full. Finish a run or remove unused items first.')
    const now = new Date().toISOString()
    household.shopping.items.push({
      ...input, id: randomUUID(), createdBy: memberId, createdAt: now, updatedAt: now,
      version: 0, claimedBy: null, pickedUp: false,
    })
  })))
  app.patch('/api/shopping/items/:id', async (req, res) => (await mutate(req, res, (household, memberId) => {
    const input = shoppingItemEditSchema.parse(req.body)
    const item = findShoppingItem(household, req.params.id, input.itemVersion)
    if (!canEditShoppingItem(item, memberId)) throw new ApiError(409, 'Return this item to the list and release another shopper\'s claim before editing it.')
    Object.assign(item, { name: input.name, quantity: input.quantity, notes: input.notes })
    changeShoppingItem(item)
  })))
  app.delete('/api/shopping/items/:id', async (req, res) => (await mutate(req, res, (household, memberId) => {
    const { itemVersion } = shoppingItemVersionSchema.parse(req.body)
    const item = findShoppingItem(household, req.params.id, itemVersion)
    if (!canEditShoppingItem(item, memberId)) throw new ApiError(409, 'Return this item to the list and release another shopper\'s claim before removing it.')
    household.shopping.items = household.shopping.items.filter((entry) => entry.id !== item.id)
  })))
  app.post('/api/shopping/items/:id/claim', async (req, res) => (await mutate(req, res, (household, memberId) => {
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
  })))
  app.post('/api/shopping/items/:id/pick', async (req, res) => (await mutate(req, res, (household, memberId) => {
    const input = shoppingPickSchema.parse(req.body)
    const item = findShoppingItem(household, req.params.id, input.itemVersion)
    if (item.claimedBy !== null && item.claimedBy !== memberId) throw new ApiError(409, 'Another roommate is buying this item. Release their claim before taking over.')
    if (item.pickedUp === input.pickedUp) throw new ApiError(409, 'This item already has that basket status. Refresh the list.')
    if (input.pickedUp) item.claimedBy = memberId
    item.pickedUp = input.pickedUp
    changeShoppingItem(item)
  })))
  app.post('/api/shopping/checkout', async (req, res) => (await mutate(req, res, (household, memberId) => {
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
  })))
  app.post('/api/chores', async (req, res) => (await mutate(req, res, (household, memberId) => {
    const input = choreInputSchema.parse(req.body)
    requireRoommates(household, input.rotation)
    if (household.chores.items.length >= choreLimit) {
      throw new ApiError(409, 'This home has reached its limit of 200 chores. Edit an existing chore instead; archived chores and history are retained.')
    }
    const now = new Date().toISOString()
    household.chores.items.push({
      ...input, id: randomUUID(), createdBy: memberId, createdAt: now, updatedAt: now,
      version: 0, occurrence: 0, archived: false,
    })
  })))
  app.patch('/api/chores/:id', async (req, res) => (await mutate(req, res, (household) => {
    const { choreVersion, ...input } = choreEditInputSchema.parse(req.body)
    const chore = findChore(household, req.params.id, choreVersion)
    if (chore.archived) throw new ApiError(409, 'Restore this archived chore before editing it.')
    requireRoommates(household, input.rotation)
    Object.assign(chore, input, { version: chore.version + 1, updatedAt: new Date().toISOString() })
  })))
  app.patch('/api/chores/:id/archive', async (req, res) => (await mutate(req, res, (household) => {
    const input = choreArchiveSchema.parse(req.body)
    const chore = findChore(household, req.params.id, input.choreVersion)
    if (chore.archived === input.archived) {
      throw new ApiError(409, input.archived ? 'This chore is already archived.' : 'This chore is already active.')
    }
    chore.archived = input.archived
    chore.version++
    chore.updatedAt = new Date().toISOString()
  })))
  app.post('/api/chores/:id/complete', async (req, res) => (await mutate(req, res, (household, memberId) => {
    const { choreVersion } = choreVersionSchema.parse(req.body)
    const chore = findChore(household, req.params.id, choreVersion)
    if (household.chores.history.length >= choreCompletionLimit) {
      throw new ApiError(409, 'This home has reached its 20,000-completion history limit. Existing history has been kept.')
    }
    if (household.chores.history.some((completion) => completion.choreId === chore.id
      && completion.occurrence === chore.occurrence && completion.undoneAt === null)) {
      throw new ApiError(409, 'This chore occurrence has already been completed. Refresh its history.')
    }
    const now = new Date()
    const result = completeChore(chore, household.members, memberId, randomUUID(), now.toISOString(), billingDate(household.billingTimeZone, now))
    household.chores.items = household.chores.items.map((entry) => entry.id === chore.id ? result.chore : entry)
    household.chores.history.unshift(result.completion)
  })))
  app.post('/api/chores/completions/:id/undo', async (req, res) => (await mutate(req, res, (household, memberId) => {
    const id = z.string().uuid().parse(req.params.id)
    const { choreVersion } = choreVersionSchema.parse(req.body)
    const completion = household.chores.history.find((entry) => entry.id === id)
    if (!completion) throw new ApiError(404, 'That chore completion was not found in this home.')
    const chore = findChore(household, completion.choreId, choreVersion)
    const result = undoChoreCompletion(chore, completion, household.members, memberId, new Date().toISOString())
    household.chores.items = household.chores.items.map((entry) => entry.id === chore.id ? result.chore : entry)
    household.chores.history = household.chores.history.map((entry) => entry.id === id ? result.completion : entry)
  })))
  app.post('/api/bills', async (req, res) => (await mutate(req, res, (household) => {
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
  })))
  app.patch('/api/bills/:id', async (req, res) => (await mutate(req, res, (household) => {
    const bill = findBill(household, req.params.id)
    const input = billEditInputSchema.parse(req.body)
    requireRoommates(household, input.participants)
    const updated = reviseBill(bill, input, billingDate(household.billingTimeZone).slice(0, 7))
    household.bills = household.bills.map((entry) => entry.id === bill.id ? updated : entry)
  })))
  app.post('/api/bills/:id/pause', async (req, res) => (await mutate(req, res, (household) => {
    const bill = findBill(household, req.params.id)
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body)
    const alreadyPaused = bill.pauses.some((pause) => pause.untilMonth === null)
    if (paused === alreadyPaused) throw new ApiError(409, paused ? 'This monthly bill is already paused.' : 'This monthly bill is already active.')
    const updated = setBillPaused(bill, paused, billingDate(household.billingTimeZone).slice(0, 7))
    household.bills = household.bills.map((entry) => entry.id === bill.id ? updated : entry)
  })))
  app.post('/api/bills/:id/payments', async (req, res) => (await mutate(req, res, (household) => {
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
  })))
  app.post('/api/settlements', async (req, res) => (await mutate(req, res, (household) => {
    const transfer = settlementSchema.pick({ from: true, to: true, amount: true }).parse(req.body)
    const current = balances(household)
    if (transfer.from === transfer.to || !current.has(transfer.from) || !current.has(transfer.to)
      || (current.get(transfer.from) ?? 0) >= 0 || (current.get(transfer.to) ?? 0) <= 0
      || transfer.amount > -(current.get(transfer.from) ?? 0) || transfer.amount > (current.get(transfer.to) ?? 0)) {
      throw new ApiError(409, 'These balances have changed. Use the updated repayment suggestion.')
    }
    household.settlements.unshift({ ...transfer, id: randomUUID(), createdAt: new Date().toISOString() })
  })))
  app.delete('/api/settlements/:id', async (req, res) => (await mutate(req, res, (household) => {
    const index = household.settlements.findIndex((settlement) => settlement.id === req.params.id)
    if (index === -1) throw new ApiError(404, 'That repayment is no longer in the ledger.')
    household.settlements.splice(index, 1)
  })))
  app.patch('/api/household/room-style', async (req, res) => (await mutate(req, res, (household) => {
    const { roomStyle } = z.object({ roomStyle: roomStyleSchema }).parse(req.body)
    household.roomStyle = roomStyle
  })))
  app.patch('/api/household', async (req, res) => (await mutate(req, res, (household) => {
    const input = z.object({ name: nameSchema, budget: centsSchema, currency: z.enum(currencies) }).parse(req.body)
    if (input.currency !== household.currency && (household.expenses.length || household.settlements.length || household.bills.length)) {
      throw new ApiError(400, 'Currency cannot change after adding expenses or monthly bills. Create a new kitchen for a different currency.')
    }
    Object.assign(household, input)
  })))
  app.post('/api/invite/rotate', async (req, res) => (await mutate(req, res, async (household) => {
    if ((await store.accounts.isManaged(household.id))) throw new ApiError(403, 'Only the kitchen owner can create or revoke invitations from account settings.')
    household.inviteCode = randomBytes(12).toString('base64url')
  })))
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'This kitchen action could not be found.')))
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues[0]?.message ?? 'Please check the form fields.' })
    } else if (error instanceof ChoreError) {
      res.status(error.status).json({ error: error.message })
    } else if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) })
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
