import { useEffect, useRef, useState } from 'react'
import './companion.css'

const greetingLength = 1600

// A flat cartoon kettle in the corner. CSS handles its blink, hop and steam, so it costs no WebGL.
export function CompanionKettle({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const [greeting, setGreeting] = useState(0)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const greet = () => {
    window.clearTimeout(timer.current)
    setGreeting((count) => count + 1)
    timer.current = window.setTimeout(() => setGreeting(0), greetingLength)
  }
  return <button type="button" className="companion-kettle" aria-label="Ask the kettle a question" title="Ask the kettle"
    aria-pressed={active} data-greeting={greeting > 0} onClick={() => { greet(); onOpen() }}>
    <span className="companion-kettle-bubble" aria-hidden="true">Ask me</span>
    <KettleCartoon key={greeting} />
  </button>
}

function KettleCartoon() {
  return <svg className="companion-kettle-art" viewBox="0 0 120 112" aria-hidden="true" focusable="false">
    <ellipse cx="60" cy="104" rx="36" ry="5" fill="#a9b194" opacity=".3" />
    <g className="companion-kettle-steam" fill="#c3c7d3">
      <circle cx="110" cy="30" r="4" />
      <circle cx="104" cy="20" r="5" />
      <circle cx="112" cy="10" r="6" />
    </g>
    <g className="companion-kettle-body">
      <path d="M38 48C15 46 12 84 34 88" stroke="#527861" strokeWidth="8" strokeLinecap="round" fill="none" />
      <path d="M84 66C96 60 101 50 106 40C108 36 113 37 112 42C110 55 102 72 90 82Z" fill="#81b29a" />
      <ellipse cx="109.5" cy="39" rx="3" ry="2" fill="#527861" />
      <ellipse cx="46" cy="99" rx="9" ry="5" fill="#3d405b" />
      <ellipse cx="74" cy="99" rx="9" ry="5" fill="#3d405b" />
      <path d="M60 34C86 34 100 52 100 72C100 90 86 100 60 100C34 100 20 90 20 72C20 52 34 34 60 34Z" fill="#81b29a" />
      <path d="M22 78C26 94 40 100 60 100C80 100 94 94 98 78C90 90 76 94 60 94C44 94 30 90 22 78Z" fill="#6c9d85" />
      <ellipse cx="38" cy="52" rx="8" ry="3.5" transform="rotate(-32 38 52)" fill="#b0d0bd" />
      <path d="M36 37C38 29 82 29 84 37Z" fill="#527861" />
      <ellipse cx="60" cy="37" rx="25" ry="4" fill="#527861" />
      <rect x="57.5" y="25" width="5" height="6" rx="1.5" fill="#527861" />
      <circle cx="60" cy="23" r="6" fill="#e07a5f" />
      <circle cx="58" cy="21" r="1.6" fill="#faece7" />
      <g className="companion-kettle-eyes" fill="#3d405b">
        <ellipse cx="49" cy="64" rx="3.6" ry="4.6" />
        <ellipse cx="71" cy="64" rx="3.6" ry="4.6" />
        <circle cx="50.2" cy="62.4" r="1.2" fill="#ffffff" />
        <circle cx="72.2" cy="62.4" r="1.2" fill="#ffffff" />
      </g>
      <ellipse cx="41" cy="73" rx="5" ry="3" fill="#e07a5f" opacity=".55" />
      <ellipse cx="79" cy="73" rx="5" ry="3" fill="#e07a5f" opacity=".55" />
      <path d="M54 74Q60 80 66 74" stroke="#3d405b" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    </g>
  </svg>
}
