import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import Titlebar from './components/Titlebar'
import Sidebar from './components/Sidebar'
import Home from './pages/Home'
import Library from './pages/Library'
import Store from './pages/Store'
import Tools from './pages/Tools'
import Tray from './pages/Tray'
import Settings from './pages/Settings'
import FirstRun from './pages/FirstRun'
import type { DetectedApp } from './hooks/useApps'

export type Page = 'home' | 'library' | 'store' | 'tools' | 'tray' | 'settings'
export type Theme = 'dark' | 'light'

interface SetupStatus {
  completed: boolean
  winget_ok: boolean
  initial_scan_done: boolean
}

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [theme, setTheme] = useState<Theme>('dark')
  const [scanned, setScanned] = useState<DetectedApp[]>(() => {
    try {
      const s = localStorage.getItem('hubify_scanned')
      return s ? JSON.parse(s) : []
    } catch { return [] }
  })

  // null = still loading, false = needs setup, true = ready
  const [setupDone, setSetupDone] = useState<boolean | null>(null)

  useEffect(() => {
    invoke<SetupStatus>('get_setup_status')
      .then(s => setSetupDone(s.completed))
      .catch(() => setSetupDone(true)) // If command fails, don't block the app
  }, [])

  const handleSetupComplete = () => {
    // After setup, refresh the scanned list from localStorage (scan_installed_apps ran)
    try {
      const s = localStorage.getItem('hubify_scanned')
      if (s) setScanned(JSON.parse(s))
    } catch {}
    setSetupDone(true)
  }

  // ── Loading splash ─────────────────────────────────────────────────────────
  if (setupDone === null) {
    return (
      <div className="app" data-theme={theme}>
        <div className="app-splash">
          <span className="app-splash-mark">H</span>
        </div>
      </div>
    )
  }

  // ── First run ──────────────────────────────────────────────────────────────
  if (!setupDone) {
    return (
      <div className="app" data-theme={theme}>
        <Titlebar />
        <FirstRun onComplete={handleSetupComplete} />
      </div>
    )
  }

  // ── Main app ───────────────────────────────────────────────────────────────
  return (
    <div className="app" data-theme={theme}>
      <Titlebar />
      <div className="app-body">
        <Sidebar active={page} onNavigate={setPage} />
        <main className="main-content">
          {page === 'home'     && <Home scanned={scanned} />}
          {page === 'library'  && <Library onScannedChange={setScanned} />}
          {page === 'store'    && <Store />}
          {page === 'tools'    && <Tools />}
          {page === 'tray'     && <Tray />}
          {page === 'settings' && <Settings theme={theme} onThemeChange={setTheme} />}
        </main>
      </div>
    </div>
  )
}
