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
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import FirstRun from './pages/FirstRun'
import ThemeEngine from './components/ThemeEngine'
import { AppsProvider } from './hooks/useApps'

export type Page = 'home' | 'library' | 'store' | 'tools' | 'tray' | 'analytics' | 'settings'

interface SetupStatus {
  completed: boolean
  winget_ok: boolean
  initial_scan_done: boolean
}

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [visited, setVisited] = useState<Set<Page>>(new Set(['home']))

  const navigate = (p: Page) => {
    setPage(p)
    setVisited(prev => new Set(prev).add(p))
  }

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
      <div className="app" style={{ background: '#121214', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="app-splash">
          <span className="app-splash-mark">
            <svg width="48" height="48" viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="500" height="500" rx="52" fill="#7c6fff"/>
              <path d="M391.372 185C423.404 185 449.372 210.968 449.372 243C449.372 275.032 423.404 301 391.372 301C376.174 301 362.342 295.154 352 285.589C359.023 272.98 363.026 258.458 363.026 243C363.026 227.542 359.023 213.02 352 200.41C362.342 190.845 376.174 185 391.372 185Z" fill="white"/>
              <path d="M107.999 185C75.9667 185 49.999 210.968 49.999 243C49.999 275.032 75.9667 301 107.999 301C123.197 301 137.029 295.154 147.371 285.589C140.348 272.98 136.345 258.458 136.345 243C136.345 227.542 140.348 213.02 147.371 200.41C137.029 190.845 123.197 185 107.999 185Z" fill="white"/>
              <circle cx="250" cy="243" r="93" fill="white"/>
              <circle cx="137.5" cy="412.5" r="58.5" fill="white"/>
              <circle cx="360.5" cy="87.5" r="58.5" fill="white"/>
              <line x1="359.079" y1="92.0326" x2="136.079" y2="417.033" stroke="white" strokeWidth="39"/>
            </svg>
          </span>
          <p style={{ color: 'white', marginTop: '10px' }}>Loading Hubify...</p>
        </div>
      </div>
    )
  }

  // ── First run ──────────────────────────────────────────────────────────────
  if (!setupDone) {
    return (
      <div className="app">
        <Titlebar />
        <FirstRun onComplete={handleSetupComplete} />
      </div>
    )
  }

  // ── Main app ───────────────────────────────────────────────────────────────
  return (
    <AppsProvider>
      <ThemeEngine />
      <div className="app">
        <Titlebar />
        <div className="app-body">
          <Sidebar active={page} onNavigate={navigate} />
          <main className="main-content">
            {visited.has('home') && <div className={`page-wrap${page !== 'home' ? ' hidden' : ''}`}><Home /></div>}
            {visited.has('library') && <div className={`page-wrap${page !== 'library' ? ' hidden' : ''}`}><Library /></div>}
            {visited.has('store') && <div className={`page-wrap${page !== 'store' ? ' hidden' : ''}`}><Store /></div>}
            {visited.has('tools') && <div className={`page-wrap${page !== 'tools' ? ' hidden' : ''}`}><Tools /></div>}
            {visited.has('tray') && <div className={`page-wrap${page !== 'tray' ? ' hidden' : ''}`}><Tray /></div>}
            {visited.has('analytics') && <div className={`page-wrap${page !== 'analytics' ? ' hidden' : ''}`}><Analytics /></div>}
            {visited.has('settings') && <div className={`page-wrap${page !== 'settings' ? ' hidden' : ''}`}><Settings /></div>}
          </main>
        </div>
      </div>
    </AppsProvider>
  )
}
