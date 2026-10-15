import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { roomIds } from '../shared/rooms.ts'
import { companionActionLabels, companionEntries, companionStarters } from '../src/companionAnswers.ts'
import { companionStarterEntries, normalizeQuestion, searchCompanion, stem, terms } from '../src/companionSearch.ts'

const top = (question: string, roomId: Parameters<typeof searchCompanion>[1] = 'kitchen') => searchCompanion(question, roomId)[0]?.entry.id

describe('companion questions', () => {
  it('normalizes and stems everyday wording', () => {
    assert.equal(normalizeQuestion('Who’s paying BACK Ben?'), 'whos repay ben')
    assert.equal(stem('settling'), stem('settle'))
    assert.equal(stem('settled'), stem('settle'))
    assert.equal(stem('groceries'), stem('grocery'))
    assert.deepEqual(terms('How do I add a chore?'), ['add', stem('chores')])
  })

  it('answers common questions in many phrasings', () => {
    const cases: Record<string, string> = {
      'how much do i owe': 'who-owes',
      'I paid Ben back': 'repayment',
      'add rent': 'bills',
      'invite my flatmate': 'invite',
      'we ran out of toilet paper': 'restock',
      'why is the sink filthy': 'dirty',
      'whose turn is it to clean': 'rotation',
      'delete expense': 'remove-expense',
      'can I pay with paypal': 'transfer-money',
      'move the sofa': 'edit-room',
      'paint the walls': 'room-colors',
      'did it save': 'unconfirmed',
    }
    for (const [question, expected] of Object.entries(cases)) assert.equal(top(question), expected, question)
  })

  it('tolerates typos and completes the word being typed', () => {
    assert.equal(top('notifcations'), 'notifications')
    assert.equal(top('setle up'), 'repayment')
    assert.equal(top('rot'), 'rotation')
    assert.equal(top('inv'), 'invite')
  })

  it('returns nothing rather than guessing at unrelated text', () => {
    assert.deepEqual(searchCompanion('banana', 'kitchen'), [])
    assert.deepEqual(searchCompanion('asdf qwer', 'kitchen'), [])
    assert.deepEqual(searchCompanion('   ', 'kitchen'), [])
    for (const question of ['what is the meaning of life', 'tell me a joke', 'banana bread recipe', 'weather tomorrow']) {
      assert.deepEqual(searchCompanion(question, 'kitchen'), [], question)
    }
  })

  it('limits suggestions and keeps every entry reachable by its own question', () => {
    assert.ok(searchCompanion('chore', 'bathroom').length <= 4)
    for (const entry of companionEntries) assert.equal(top(entry.question), entry.id, entry.question)
  })

  it('keeps entries unique, short and linked to labelled actions', () => {
    assert.equal(new Set(companionEntries.map((entry) => entry.id)).size, companionEntries.length)
    for (const entry of companionEntries) {
      assert.ok(entry.answer.length <= 260, entry.id)
      assert.ok(!/—/.test(entry.answer + entry.question), entry.id)
      if (entry.action) assert.ok(companionActionLabels[entry.action], entry.id)
    }
  })

  it('starts every room with four of its own questions', () => {
    for (const roomId of roomIds) {
      assert.equal(companionStarters[roomId].length, 4)
      assert.equal(companionStarterEntries(roomId).length, 4)
    }
  })
})
