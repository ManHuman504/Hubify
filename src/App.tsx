import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import Titlebar from './components/Titlebar'
import Sidebar from './components/Sidebar'
import Home from './pages/Home'
import Library from './pages/Library'
import Store from './pages/Store'
import Tools from './pages/Tools'
import Tray from './pages/Tray'
import Settings from './pages/Settings'
import FirstRun from './pages/FirstRun'
import { AppsProvider } from './hooks/useApps'

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

  // null = still loading, false = needs setup, true = ready
  const [setupDone, setSetupDone] = useState<boolean | null>(null)

  useEffect(() => {
    invoke<SetupStatus>('get_setup_status')
      .then(s => {
        console.log('Setup status:', s);
        setSetupDone(s.completed);
      })
      .catch((err) => {
        console.error('Failed to get setup status:', err);
        setSetupDone(true);
      })
      
    // Listen for wake up events from other instances
    const unlisten = listen('show_window', async () => {
      const win = getCurrentWindow()
      await win.show()
      await win.setFocus()
    })
    
    return () => {
      unlisten.then(f => f())
    }
  }, [])

  const handleSetupComplete = () => {
    setSetupDone(true)
  }

  // ── Loading splash ─────────────────────────────────────────────────────────
  if (setupDone === null) {
    return (
      <div className="app" data-theme={theme} style={{ background: '#121214', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="app-splash">
          <span className="app-splash-mark" style={{ fontSize: '48px', color: '#7c6fff', fontWeight: 'bold' }}>H</span>
          <p style={{ color: 'white', marginTop: '10px' }}>Loading Hubify...</p>
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
    <AppsProvider>
      <div className="app" data-theme={theme}>
        <Titlebar />
        <div className="app-body">
          <Sidebar active={page} onNavigate={setPage} />
          <main className="main-content">
            {/* 
               IMPORTANT: Use simple conditional rendering for main views first 
               to ensure they work, before optimizing with display: none.
            */}
            {page === 'home' && <Home />}
            {page === 'library' && <Library />}
            {page === 'store' && <Store />}
            {page === 'tools' && <Tools />}
            {page === 'tray' && <Tray />}
            {page === 'settings' && <Settings theme={theme} onThemeChange={setTheme} />}
          </main>
        </div>
      </div>
    </AppsProvider>
  )
}
