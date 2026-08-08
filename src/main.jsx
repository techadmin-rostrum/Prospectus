import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

/** Stands the watchdog in index.html down once something has actually painted. */
function MountSignal() {
  useEffect(() => {
    window.__flipbookAppMounted?.()
  }, [])
  return null
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <MountSignal />
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
