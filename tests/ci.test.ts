import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8')
const lock: { packages: Record<string, { version?: string }> } = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'))

test('browser jobs use the locked Playwright image without runtime system-package installation', () => {
  const version = lock.packages['node_modules/@playwright/test'].version
  assert.ok(version)
  const images = [...workflow.matchAll(/image:\s*mcr\.microsoft\.com\/playwright:v([^\s]+)-noble/g)].map((match) => match[1])
  assert.equal(images.length, 2)
  for (const image of images) assert.equal(image, version)
  assert.doesNotMatch(workflow, /playwright install|apt-get/)
  assert.match(workflow, /TEST_DATABASE_URL: postgres:\/\/roomlings:roomlings@postgres:5432\/roomlings_test/)
  const triggers = workflow.split('permissions:')[0]
  assert.match(triggers, /pull_request:/)
  assert.match(triggers, /workflow_dispatch:/)
  assert.match(triggers, /branches: \[main\]/)
  assert.doesNotMatch(triggers, /feat\//)
})

type ListedSuite = { suites?: ListedSuite[]; specs?: { id: string; tests: { projectId: string }[] }[] }

function listedTests(args: readonly string[]): Set<string> {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('node_modules/@playwright/test/cli.js', root)),
    'test', '--list', '--reporter=json', ...args,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'Playwright could not list the browser tests.')
  const report: { suites: ListedSuite[] } = JSON.parse(result.stdout)
  const ids = new Set<string>()
  const visit = (suite: ListedSuite) => {
    for (const spec of suite.specs ?? []) for (const project of spec.tests) {
      const id = `${spec.id}:${project.projectId}`
      assert.equal(ids.has(id), false, `Duplicate listed test: ${id}`)
      ids.add(id)
    }
    suite.suites?.forEach(visit)
  }
  report.suites.forEach(visit)
  return ids
}

test('the four browser shards run every existing browser scenario exactly once', () => {
  const selectors = [...workflow.matchAll(/^\s+args: (.+)$/gm)].map((match) => match[1].trim().split(/\s+/))
  assert.equal(selectors.length, 4)
  const all = listedTests([])
  assert.ok(all.size > 0)
  const covered = new Set<string>()
  for (const selector of selectors) {
    assert.ok(selector.includes('--fully-parallel'))
    const shard = listedTests(selector)
    assert.ok(shard.size > 0)
    for (const id of shard) {
      assert.equal(covered.has(id), false, `A browser test appears in multiple shards: ${id}`)
      covered.add(id)
    }
  }
  assert.deepEqual([...covered].sort(), [...all].sort())
})
