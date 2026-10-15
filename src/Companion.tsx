import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronRight, MessageCircleQuestion } from 'lucide-react'
import type { RoomId } from '../shared/rooms.ts'
import { companionActionLabels, companionEntries } from './companionAnswers.ts'
import type { CompanionAction, CompanionEntry } from './companionAnswers.ts'
import { companionStarterEntries, searchCompanion } from './companionSearch.ts'
import { Feedback } from './Feedback.tsx'
import './companion.css'

export function CompanionPanel({ roomId, available, onAction }: {
  roomId: RoomId
  available: ReadonlySet<CompanionAction>
  onAction: (action: CompanionAction) => void
}) {
  const [query, setQuery] = useState('')
  const [answerId, setAnswerId] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAnswer = useRef(false)
  const typed = query.trim()
  const starters = useMemo(() => companionStarterEntries(roomId), [roomId])
  const matches = useMemo(() => typed ? searchCompanion(typed, roomId).map((match) => match.entry) : [], [typed, roomId])
  const answer = companionEntries.find((entry) => entry.id === answerId) ?? null
  const suggestions = (typed && matches.length ? matches : starters).filter((entry) => entry.id !== answerId)

  useEffect(() => {
    if (!focusAnswer.current) return
    focusAnswer.current = false
    heading.current?.focus()
  }, [answerId])

  const show = (entry: CompanionEntry) => {
    focusAnswer.current = true
    setAnswerId(entry.id)
    setUnanswered('')
  }
  const ask = () => {
    if (!typed) return
    const [best] = searchCompanion(typed, roomId, undefined, 1)
    if (best) show(best.entry)
    else {
      setAnswerId(null)
      setUnanswered(typed)
    }
  }
  const action = answer?.action && available.has(answer.action) ? answer.action : null

  return <div className="companion">
    <form className="companion-ask" role="search" aria-label="Ask the kettle" onSubmit={(event) => { event.preventDefault(); ask() }}>
      <label className="companion-field">
        <MessageCircleQuestion size="1.125rem" aria-hidden="true" />
        <input value={query} onChange={(event) => { setQuery(event.target.value); setUnanswered('') }} aria-label="Ask a question"
          placeholder="Ask about groceries, bills or chores" autoComplete="off" spellCheck />
      </label>
      <button type="submit" className="button primary" disabled={!typed}>Ask</button>
    </form>
    <p className="sr-only" role="status" aria-live="polite">
      {typed ? matches.length ? `${matches.length} suggested ${matches.length === 1 ? 'question' : 'questions'}` : 'No suggested questions' : ''}
    </p>
    {answer && <article className="companion-answer" aria-labelledby="companion-answer-title">
      <h3 id="companion-answer-title" ref={heading} tabIndex={-1}>{answer.question}</h3>
      <p>{answer.answer}</p>
      {action && <button type="button" className="button secondary small-button" onClick={() => onAction(action)}>
        {companionActionLabels[action]}<ArrowRight size="0.9375rem" aria-hidden="true" />
      </button>}
    </article>}
    {unanswered && <Feedback tone="info">I do not know that one yet. Try asking about groceries, bills, chores or rooms, or pick a question below.</Feedback>}
    <section className="companion-suggestions" aria-labelledby="companion-suggestions-title">
      <h3 className="companion-group" id="companion-suggestions-title">{typed && matches.length ? 'Did you mean' : answer ? 'More questions' : 'Popular in this room'}</h3>
      <ul>{suggestions.map((entry) => <li key={entry.id}>
        <button type="button" className="companion-suggestion" onClick={() => show(entry)}>
          <span>{entry.question}</span><ChevronRight size="1rem" aria-hidden="true" />
        </button>
      </li>)}</ul>
    </section>
    <p className="field-hint">Answers come from the Roomlings guide in your browser. What you type is not sent anywhere.</p>
  </div>
}
