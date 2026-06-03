import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useApps } from '../hooks/useApps'
import './Page.css'
import './Tools.css'

interface StartupItem {
  name: string
  cmd: string
  enabled: boolean
}

interface UninstallableApp {
  name: string
  id: string
  uninstall_string: string
  publisher?: string
}

type ToolView = 'dashboard' | 'startup' | 'uninstaller'

export default function Tools() {
  const [view, setView] = useState<ToolView>('dashboard')
  const [startupItems, setStartupItems] = useState<StartupItem[]>([])
  const [uninstallApps, setUninstallApps] = useState<UninstallableApp[]>([])
  const [loading, setLoading] = useState(false)
  
  const [uninstalling, setUninstalling] = useState<string | null>(null)
  const [leftovers, setLeftovers] = useState<any[]>([])
  const [showCleanup, setShowCleanup] = useState<UninstallableApp | null>(null)
  const [search, setSearch] = useState('')

  const { apps, removeApp, refresh } = useApps()

  const refreshStartup = async () => {
    setLoading(true)
    try {
      const items = await invoke<any[]>('get_startup_items')
      setStartupItems(items.map(i => ({ ...i, enabled: true })))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const refreshUninstallApps = async () => {
    setLoading(true)
    try {
      // Show ALL apps by default to behave like a real uninstaller (e.g. Geek Uninstaller)
      const list = await invoke<UninstallableApp[]>('list_uninstallable_apps', { hints: null })
      setUninstallApps(list)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (view === 'startup') refreshStartup()
    if (view === 'uninstaller') refreshUninstallApps()
  }, [view])

  const handleToggleStartup = async (item: StartupItem) => {
    const newState = !item.enabled
    try {
      await invoke('toggle_autostart', { name: item.name, path: item.cmd, enable: newState })
      refreshStartup()
    } catch (e) {
      alert(e)
    }
  }

  const handleDeepUninstall = async (app: UninstallableApp) => {
    if (!window.confirm(`Are you sure you want to uninstall ${app.name}?\n\nThis will run the standard uninstaller, followed by a deep scan for residual files and registry keys.`)) return
    
    setUninstalling(app.id)
    console.log(`Starting uninstall for: ${app.name}`)
    
    try {
      // 1. Run standard uninstaller
      try {
        await invoke('run_uninstall_string', { command: app.uninstall_string })
      } catch (e) {
        console.warn('Standard uninstaller error:', e)
      }

      // 2. Wait for system to settle
      console.log('Waiting for system to settle...')
      await new Promise(r => setTimeout(r, 4000))
      
      // 3. Find leftovers
      console.log('Scanning for leftovers...')
      const found = await invoke<any[]>('find_leftovers', { name: app.name, publisher: app.publisher })
      console.log(`Found ${found.length} leftovers`)
      
      setLeftovers(found)
      setShowCleanup(app)

      // 4. Remove from Hubify store
      const hubifyApp = apps.find(a => a.name.toLowerCase() === app.name.toLowerCase())
      if (hubifyApp) {
        console.log('Removing from Hubify store...')
        await removeApp(hubifyApp.id)
      }
      
      await refresh()
    } catch (e) {
      console.error('Uninstall flow failed:', e)
      alert(`Uninstall failed: ${e}`)
    } finally {
      setUninstalling(null)
    }
  }

  const renderProcessingOverlay = () => {
    if (!uninstalling) return null
    const app = uninstallApps.find(a => a.id === uninstalling)
    return (
      <div className="lib-picker-backdrop" style={{ zIndex: 300 }}>
        <div className="lib-picker" style={{ gap: 20 }}>
          <div className="tool-loading" style={{ padding: 0 }}>
             <div className="spinner" style={{ margin: '0 auto 15px' }}></div>
             <p style={{ fontWeight: 600, fontSize: 16 }}>Uninstalling {app?.name}...</p>
             <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Please follow the standard uninstaller instructions if it appears.</p>
          </div>
          <button className="btn-secondary" onClick={() => {
            setUninstalling(null)
            if (app) {
              const runScan = async () => {
                 const found = await invoke<any[]>('find_leftovers', { name: app.name, publisher: app.publisher })
                 setLeftovers(found)
                 setShowCleanup(app)
                 const hubifyApp = apps.find(a => a.name.toLowerCase() === app.name.toLowerCase())
                 if (hubifyApp) await removeApp(hubifyApp.id)
                 await refresh()
              }
              runScan()
            }
          }}>
            Proceed to Deep Scan →
          </button>
        </div>
      </div>
    )
  }

  const handleCleanLeftovers = async () => {
    setLoading(true)
    try {
      for (const item of leftovers) {
        try { await invoke('delete_leftover', { leftover: item }) } catch (e) { console.error(e) }
      }
      alert('Deep cleaning complete! All residual data has been removed.')
      setLeftovers([])
      setShowCleanup(null)
      await refreshUninstallApps()
      await refresh()
    } catch (e) {
      alert(`Cleanup error: ${e}`)
    } finally {
      setLoading(false)
    }
  }


  // ── Dashboard View ────────────────────────────────────────────────────────
  if (view === 'dashboard') {
    return (
      <div className="page tools-page">
        {renderProcessingOverlay()}
        <div className="page-header">
          <h1 className="page-title">System Tools</h1>
          <p className="page-subtitle">Native utilities for Windows control</p>
        </div>

        <div className="tools-dashboard-grid hub-grid">
          <button className="tool-tile hub-card-base" onClick={() => setView('startup')}>
            <span className="tool-tile-icon">🚀</span>
            <div className="tool-tile-info">
              <p className="tool-tile-name">Startup Manager</p>
              <p className="tool-tile-desc">Manage apps that start with Windows</p>
            </div>
          </button>

          <button className="tool-tile hub-card-base" onClick={() => setView('uninstaller')}>
            <span className="tool-tile-icon">🗑️</span>
            <div className="tool-tile-info">
              <p className="tool-tile-name">Deep Uninstaller</p>
              <p className="tool-tile-desc">Remove apps with all residual data</p>
            </div>
          </button>

          <button className="tool-tile hub-card-base disabled" title="Coming Soon">
            <span className="tool-tile-icon">🔍</span>
            <div className="tool-tile-info">
              <p className="tool-tile-name">Disk Space Map</p>
              <p className="tool-tile-desc">Visualize what eats your disk</p>
            </div>
            <span className="tool-tile-badge">Soon</span>
          </button>
        </div>
      </div>
    )
  }

  // ── Startup Manager View ──────────────────────────────────────────────────
  if (view === 'startup') {
    return (
      <div className="page tools-page">
        {renderProcessingOverlay()}
        <div className="page-header">
          <div className="header-row">
            <button className="btn-back-tools" onClick={() => setView('dashboard')}>← Back to Tools</button>
            <button className="btn-refresh-small" onClick={refreshStartup} title="Refresh list">⟳ Refresh</button>
          </div>
          <h1 className="page-title">Startup Manager</h1>
          <p className="page-subtitle">Currently registered Windows startup items (Run Registry)</p>
        </div>

        <div className="startup-list">
          {loading ? (
            <div className="tool-loading">Loading registry…</div>
          ) : startupItems.length === 0 ? (
            <div className="tool-empty">No startup items found</div>
          ) : (
            startupItems.map(item => (
              <div key={item.name} className="startup-row">
                <div className="startup-info">
                  <span className="startup-name">{item.name}</span>
                  <span className="startup-cmd" title={item.cmd}>{item.cmd}</span>
                </div>
                <button 
                  className={`toggle-btn ${item.enabled ? 'active' : ''}`}
                  onClick={() => handleToggleStartup(item)}
                >
                  <div className="toggle-thumb" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  // ── Uninstaller View ──────────────────────────────────────────────────────
  const filtered = uninstallApps.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))


  return (
    <div className="page tools-page">
      {renderProcessingOverlay()}
      {showCleanup && (
        <div className="lib-picker-backdrop">
           <div className="lib-picker uninstaller-modal" style={{ width: 500 }}>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>Deep Clean Leftovers: {showCleanup.name}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>Found {leftovers.length} residual items.</p>
              <div className="leftover-list" style={{ width: '100%', maxHeight: 300, overflowY: 'auto', background: 'var(--bg-surface)', borderRadius: 8, padding: 12, border: '1px solid var(--border)', marginBottom: 20 }}>
                 {leftovers.length === 0 ? <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No leftovers found.</p> : (
                    leftovers.map((l, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, fontSize: 11, marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
                         <span style={{ color: l.kind === 'folder' ? '#febc2e' : 'var(--accent)', fontWeight: 'bold' }}>[{l.kind[0].toUpperCase()}]</span>
                         <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{l.path}</span>
                      </div>
                    ))
                 )}
              </div>
              <div className="lib-picker-footer">
                 <button className="btn-secondary" onClick={() => setShowCleanup(null)}>Skip</button>
                 {leftovers.length > 0 ? (
                    <button className="btn-danger" onClick={handleCleanLeftovers}>Clean Everything</button>
                 ) : (
                    <button className="btn-add" onClick={() => setShowCleanup(null)}>Finish</button>
                 )}
              </div>
           </div>
        </div>
      )}

      <div className="page-header">
        <div className="header-row">
          <button className="btn-back-tools" onClick={() => setView('dashboard')}>← Back to Tools</button>
          <div className="tools-search-wrap">
             <input 
                className="tools-search" 
                placeholder="Search apps to uninstall…" 
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
             />
          </div>
        </div>
        <h1 className="page-title">Deep Uninstaller</h1>
        <p className="page-subtitle">Standard uninstall followed by deep system scan for residual "roots".</p>
      </div>

      <div className="startup-list">
        {loading ? (
          <div className="tool-loading">Scanning system apps…</div>
        ) : filtered.length === 0 ? (
          <div className="tool-empty">{search ? 'No matching apps found' : 'No apps found'}</div>
        ) : (
          filtered.map(app => (
            <div key={app.id} className="startup-row">
              <div className="startup-info">
                <span className="startup-name">{app.name}</span>
                <span className="startup-cmd">{app.publisher || 'Unknown Publisher'}</span>
              </div>
              <button 
                className="btn-danger-small" 
                onClick={() => handleDeepUninstall(app)}
                disabled={!!uninstalling}
              >
                {uninstalling === app.id ? 'Uninstalling…' : 'Uninstall'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
