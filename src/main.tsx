import React, { lazy, Suspense, useSyncExternalStore } from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/fraunces/wght-italic.css'
import './style.css'
import './game.css'
import { resolveEntry } from './roomNavigation.ts'

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
  return <Suspense fallback={<div className="scene-loading" role="status">Putting the kettle on...</div>}>
    {entry.kind === 'home' ? <Welcome /> : entry.kind === 'unavailable'
      ? <Welcome accessNotice={<p className="form-error" role="alert">That room is not available. Choose the kitchen to continue.</p>} />
      : <App />}
  </Suspense>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Entry /></React.StrictMode>,
)
