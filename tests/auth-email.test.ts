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
    assert.match(template, /There is no confirmation link to click|No link to click/)
  })

  it('draws every email colour from the app theme and loads only the brand mark', () => {
    assert.match(template, /id="roomlings-wordmark"[^>]*>roomlings</)
    const ink = paletteColor('ink')
    assert.ok(template.includes(ink), 'The email has drifted from --palette-ink.')
    const channels = [1, 3, 5].map((start) => parseInt(ink.slice(start, start + 2), 16))
    assert.ok(template.includes(`radial-gradient(rgba(${channels.join(',')},`), 'The paper texture no longer follows the app ink.')
    for (const color of new Set(template.match(/#[0-9a-f]{6,8}\b/g) ?? [])) {
      assert.ok(styles.includes(color), `${color} is not one of the app theme colours.`)
    }
    const images = template.match(/<img\b[^>]*>/g) ?? []
    assert.equal(images.length, 1)
    assert.equal(template.match(/\bsrc\s*=/g)?.length, 1)
    assert.match(images[0], /src="https:\/\/[^"]+\/storage\/v1\/object\/public\/brand\/roomlings-icon-flat-256\.png"/)
    assert.match(images[0], /alt=""/)
    assert.ok(existsSync(new URL('../public/brand/roomlings-icon-flat-256.png', import.meta.url)))
    assert.doesNotMatch(template, /<(?:script|iframe|form|link)\b|\bon\w+\s*=|url\s*\(/i)
    assert.match(template, /<html lang="en">/)
    assert.match(template, /role="presentation"/)
  })

  it('does not promise a fixed expiry that might disagree with the provider settings', () => {
    assert.match(template, /request a new one if it expires/)
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
