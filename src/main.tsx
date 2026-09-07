import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/fraunces/wght-italic.css'
import './style.css'
import './game.css'

const Entry = /^\/welcome\/?$/.test(location.pathname)
  ? lazy(() => import('./landing/Welcome.tsx'))
  : lazy(() => import('./App.tsx').then(({ App }) => ({ default: App })))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Suspense fallback={<div className="scene-loading" role="status">Putting the kettle on...</div>}><Entry /></Suspense></React.StrictMode>,
)
