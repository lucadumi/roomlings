import React, { lazy, Suspense, useSyncExternalStore } from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/fraunces/wght-italic.css'
import { SceneLoading } from './Branding.tsx'
import './style.css'
import './game.css'
import { resolveEntry } from './roomNavigation.ts'
import { Feedback } from './Feedback.tsx'

const Welcome = lazy(() => import('./landing/Welcome.tsx'))
const App = lazy(() => import('./App.tsx').then(({ App }) => ({ default: App })))
function subscribeLocation(change: () => void) {
  window.addEventListener('hashchange', change)
  window.addEventListener('popstate', change)
  return () => {
    window.removeEventListener('hashchange', change)
    window.removeEventListener('popstate', change)
  }
}

function Entry() {
  const url = new URL(useSyncExternalStore(subscribeLocation, () => location.href))
  const entry = resolveEntry(url.pathname, url.hash)
  return <Suspense fallback={<SceneLoading label="Opening Roomlings..." />}>
    {entry.kind === 'home' ? <Welcome /> : entry.kind === 'unavailable'
      ? <Welcome accessNotice={<Feedback>Room unavailable. Sign in to open your home.</Feedback>} />
      : <App roomId={entry.roomId} />}
  </Suspense>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Entry /></React.StrictMode>,
)
