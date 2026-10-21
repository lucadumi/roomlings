import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Store } from '../server/store.ts'
import { createApp, trustedProxyHops } from '../server/app.ts'
import { recoveryCodePrefix } from '../shared/access.ts'

describe('reverse proxy client addresses', () => {
  const withServer = async (hops: number, run: (recover: (client: string) => Promise<number>) => Promise<void>) => {
    const store = new Store(':memory:')
    const server = createApp(store, { trustedProxyHops: hops }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const code = `${recoveryCodePrefix}${randomBytes(32).toString('base64url')}`
    try {
      await run(async (client) => (await fetch(`${origin}/api/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client },
        body: JSON.stringify({ code, label: 'A browser' }),
      })).status)
    } finally {
      server.close()
      await once(server, 'close')
      await store.close()
    }
  }

  it('rate-limits each forwarded client separately behind a trusted proxy', async () => {
    await withServer(1, async (recover) => {
      for (let attempt = 0; attempt < 20; attempt++) assert.equal(await recover('203.0.113.1'), 401)
      assert.equal(await recover('203.0.113.1'), 429)
      assert.equal(await recover('203.0.113.2'), 401)
    })
  })

  it('ignores forwarded addresses unless a proxy is trusted', async () => {
    await withServer(0, async (recover) => {
      for (let attempt = 0; attempt < 20; attempt++) assert.equal(await recover(`203.0.113.${attempt}`), 401)
      assert.equal(await recover('203.0.113.200'), 429)
    })
  })

  it('accepts only a small whole number of proxy hops', () => {
    assert.equal(trustedProxyHops(undefined), 0)
    assert.equal(trustedProxyHops(''), 0)
    assert.equal(trustedProxyHops('1'), 1)
    for (const invalid of ['-1', '1.5', 'true', '11', ' 1']) {
      assert.throws(() => trustedProxyHops(invalid), /TRUSTED_PROXY_HOPS/)
    }
  })
})
