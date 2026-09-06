import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { householdSchema, localDate, memberColors } from '../shared/domain.ts'
import type { Household, Session } from '../shared/domain.ts'

export class Store {
  private db: DatabaseSync

  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY, invite TEXT UNIQUE NOT NULL, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL
      );
    `)
  }

  close() { this.db.close() }

  get(id: string): Household | null {
    const row = this.db.prepare('SELECT state FROM households WHERE id = ?').get(id)
    return row ? householdSchema.parse(JSON.parse(String(row.state))) : null
  }

  byInvite(invite: string): Household | null {
    const row = this.db.prepare('SELECT state FROM households WHERE invite = ?').get(invite)
    return row ? householdSchema.parse(JSON.parse(String(row.state))) : null
  }

  save(household: Household) {
    const checked = householdSchema.parse(household)
    this.db.prepare('INSERT INTO households (id, invite, state) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET invite = excluded.invite, state = excluded.state')
      .run(checked.id, checked.inviteCode, JSON.stringify(checked))
  }

  private tokenHash(token: string) { return createHash('sha256').update(token).digest('hex') }

  authenticate(token: string): { household: Household; memberId: string } | null {
    const row = this.db.prepare('SELECT household_id, member_id FROM sessions WHERE hash = ?').get(this.tokenHash(token))
    if (!row) return null
    const household = this.get(String(row.household_id))
    return household ? { household, memberId: String(row.member_id) } : null
  }

  session(household: Household, memberId: string): Session {
    const token = randomBytes(32).toString('base64url')
    this.db.prepare('INSERT INTO sessions (hash, household_id, member_id) VALUES (?, ?, ?)')
      .run(this.tokenHash(token), household.id, memberId)
    return { token, memberId, household }
  }

  create(name: string, memberName: string, currency: Household['currency'], budget: number, demo = false): Session {
    const memberId = randomUUID()
    const household: Household = {
      id: randomUUID(), name, currency, budget, demo, version: 0,
      inviteCode: randomBytes(12).toString('base64url'),
      members: [{ id: memberId, name: memberName, color: memberColors[0] }],
      expenses: [], settlements: [], bills: [], billingTimeZone: 'UTC',
    }
    if (demo) {
      household.members.push(...['Jules', 'Sam', 'Alex'].map((name, index) => ({
        id: randomUUID(), name, color: memberColors[index + 1],
      })))
      const entries = [
        { description: 'The big weekly shop', amount: 8632, paidBy: 0, category: 'pantry', days: 0 },
        { description: 'Farmers market finds', amount: 2840, paidBy: 1, category: 'produce', days: 1 },
        { description: 'Milk, eggs & a little cheese', amount: 1875, paidBy: 2, category: 'dairy', days: 2 },
        { description: 'Coffee for the whole house', amount: 2490, paidBy: 0, category: 'drinks', days: 3 },
        { description: 'Pasta night essentials', amount: 3620, paidBy: 3, category: 'pantry', days: 4 },
        { description: 'Something green', amount: 1260, paidBy: 1, category: 'produce', days: 5 },
      ] as const
      household.expenses = entries.map((entry) => {
        const date = new Date()
        date.setDate(Math.max(1, date.getDate() - entry.days))
        return {
          id: randomUUID(), description: entry.description, amount: entry.amount,
          paidBy: household.members[entry.paidBy].id,
          participants: household.members.map((member) => member.id),
          category: entry.category, date: localDate(date), createdAt: new Date().toISOString(),
        }
      })
    }
    this.save(household)
    return this.session(household, memberId)
  }
}
