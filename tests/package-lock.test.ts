import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const lock = z.object({
  packages: z.record(z.string(), z.object({
    name: z.string().optional(),
    version: z.string().optional(),
    resolved: z.string().optional(),
    integrity: z.string().optional(),
  })),
}).parse(JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')))

it('locks public package tarballs to their recorded package names and versions', () => {
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!entry.resolved) continue
    const name = entry.name ?? path.split('node_modules/').at(-1)
    assert.ok(name, `Missing package name for ${path}`)
    assert.ok(entry.version, `Missing version for ${path}`)
    const basename = name.split('/').at(-1)
    const url = new URL(entry.resolved)
    assert.equal(url.origin, 'https://registry.npmjs.org', `Nonportable registry URL for ${path}`)
    assert.equal(decodeURIComponent(url.pathname), `/${name}/-/${basename}-${entry.version}.tgz`, `Tarball version does not match ${path}`)
    assert.match(entry.integrity ?? '', /^sha(?:1|256|384|512)-[A-Za-z0-9+/]+=*$/, `Missing integrity for ${path}`)
  }
})
