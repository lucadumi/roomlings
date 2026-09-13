import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const template = readFileSync(new URL('../emails/auth-code.html', import.meta.url), 'utf8')
const instructions = readFileSync(new URL('../docs/accounts.md', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

function paletteColor(token: string) {
  const color = styles.match(new RegExp(`--palette-${token}:\\s*(#[0-9a-f]{6})`))?.[1]
  assert.ok(color, `The app palette no longer defines --palette-${token}.`)
  return color
}

describe('Roomlings account email template', () => {
  it('includes one Supabase email code without any confirmation links or callback tokens', () => {
    assert.equal(template.match(/\{\{\s*\.Token\s*\}\}/g)?.length, 1)
    assert.doesNotMatch(template, /\.ConfirmationURL|\.TokenHash|\.RedirectTo|\.SiteURL|\bhref\s*=/i)
    assert.match(template, /There is no confirmation link to click/)
  })

  it('uses existing Roomlings branding with one remote mark and no tracking or executable content', () => {
    assert.match(template, /roomlings<span/)
    for (const token of ['ink', 'sage', 'clay']) {
      assert.ok(template.includes(paletteColor(token)), `The email has drifted from --palette-${token}.`)
    }
    const images = template.match(/<img\b[^>]*>/g) ?? []
    assert.equal(images.length, 1)
    assert.equal(template.match(/\bsrc\s*=/g)?.length, 1)
    assert.match(images[0], /src="https:\/\/[^"]+\/storage\/v1\/object\/public\/brand\/roomlings-icon-flat-256\.png"/)
    assert.match(images[0], /alt=""/)
    assert.ok(existsSync(new URL('../design/roomlings-logo/exports/roomlings-icon-flat-256.png', import.meta.url)))
    assert.doesNotMatch(template, /<(?:script|iframe|form|link)\b|\bon\w+\s*=|url\s*\(/i)
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
    assert.match(instructions, /public Storage bucket named `brand`/)
    assert.match(instructions, /YOUR-PROJECT-REF/)
    assert.match(readme, /\(docs\/accounts\.md\)/)
  })
})
