import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider, AuthGate } from './auth.tsx'

// Apply the persisted theme before first paint so both the login page and the
// app render with the correct palette (defaults to dark, like the app itself).
;(() => {
  const saved = localStorage.getItem('speedrun_theme')
  const theme = saved === 'dark' || saved !== 'light' ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#131314' : '#ffffff')
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
)
