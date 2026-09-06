import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/fraunces/wght-italic.css'
import { App } from './App.tsx'
import './style.css'
import './game.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
