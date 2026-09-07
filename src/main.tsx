import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { SceneLoading } from './Branding.tsx'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/fraunces/wght-italic.css'
import './style.css'
import './game.css'

const Entry = /^\/welcome\/?$/.test(location.pathname)
  ? lazy(() => import('./landing/Welcome.tsx'))
  : lazy(() => import('./App.tsx').then(({ App }) => ({ default: App })))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Suspense fallback={<SceneLoading />}><Entry /></Suspense></React.StrictMode>,
)
