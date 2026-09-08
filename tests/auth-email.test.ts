import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const template = readFileSync(new URL('../emails/auth-code.html', import.meta.url), 'utf8')
const instructions = readFileSync(new URL('../docs/accounts.md', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

describe('Roomlings account email template', () => {
  it('includes one Supabase email code without any confirmation links or callback tokens', () => {
    assert.equal(template.match(/\{\{\s*\.Token\s*\}\}/g)?.length, 1)
    assert.doesNotMatch(template, /\.ConfirmationURL|\.TokenHash|\.RedirectTo|\.SiteURL|\bhref\s*=/i)
    assert.match(template, /There is no confirmation link to click/)
  })

  it('uses existing Roomlings branding without remote assets, tracking or executable content', () => {
    assert.match(template, /roomlings<span/)
    assert.match(template, /#f8f7f2/)
    assert.match(template, /#c75338/)
    assert.match(template, /#71846b/)
    assert.doesNotMatch(template, /<(?:script|iframe|img|form|link)\b|\bsrc\s*=|\bon\w+\s*=|url\s*\(/i)
    assert.match(template, /<html lang="en">/)
    assert.match(template, /role="presentation"/)
  })

  it('does not promise a fixed expiry that might disagree with the provider settings', () => {
    assert.match(template, /If it expires, request a new one/)
    assert.doesNotMatch(template, /\d+\s*(?:minutes?|hours?)/i)
  })

  it('documents the shared code template for both first-time signup and returning sign-in', () => {
    assert.match(instructions, /\*\*Confirm signup\*\* and \*\*Magic Link/)
    assert.match(instructions, /emails\/auth-code\.html/)
    assert.match(instructions, /Your Roomlings sign-in code/)
    assert.match(readme, /\(docs\/accounts\.md\)/)
  })
})
