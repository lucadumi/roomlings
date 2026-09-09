import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { PostgresDatabase } from '../server/database.ts'

test('a checked-out PostgreSQL disconnect rejects its transaction without an unhandled error event', async (context) => {
  const released: (boolean | Error | undefined)[] = []
  const queries: string[] = []
  const client = Object.assign(new pg.Client(), { release: (error?: boolean | Error) => { released.push(error) } })
  context.mock.method(pg.Pool.prototype, 'connect', async () => client)
  context.mock.method(client, 'query', async (query: string) => {
    queries.push(query)
    return { command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [] }
  })
  const db = new PostgresDatabase({ url: 'postgresql://test:test@localhost/test', schema: 'roomlings_connection_test', tls: 'disable' })
  context.after(() => db.close())
  const failure = new Error('Simulated connection termination')
  await assert.rejects(db.transaction(async () => {
    assert.equal(client.listenerCount('error'), 1)
    client.emit('error', failure)
    return 'This must not be reported as committed'
  }), (error) => error === failure)
  assert.ok(queries.includes('ROLLBACK'))
  assert.ok(!queries.includes('COMMIT'))
  assert.deepEqual(released, [true])
  assert.equal(client.listenerCount('error'), 0)
})

test('a later PostgreSQL transaction still succeeds after an earlier connection was dropped', async (context) => {
  const released: (boolean | Error | undefined)[] = []
  const first = Object.assign(new pg.Client(), { release: (error?: boolean | Error) => { released.push(error) } })
  const second = Object.assign(new pg.Client(), { release: (error?: boolean | Error) => { released.push(error) } })
  const clients = [first, second]
  context.mock.method(pg.Pool.prototype, 'connect', async () => {
    const client = clients.shift()
    assert.ok(client)
    return client
  })
  for (const client of [first, second]) context.mock.method(client, 'query', async () => ({
    command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [],
  }))
  const db = new PostgresDatabase({ url: 'postgresql://test:test@localhost/test', schema: 'roomlings_connection_test', tls: 'disable' })
  context.after(() => db.close())
  await assert.rejects(db.transaction(async () => { first.emit('error', new Error('Connection lost')) }), /Connection lost/)
  assert.equal(await db.transaction(async () => 'saved'), 'saved')
  assert.deepEqual(released, [true, false])
  assert.equal(first.listenerCount('error'), 0)
  assert.equal(second.listenerCount('error'), 0)
})
