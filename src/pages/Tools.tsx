import { useState, useEffect, useRef, useCallback } from 'react'
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

type ToolView = 'dashboard' | 'startup' | 'uninstaller' | 'everything' | 'journal'

interface ActivityDay {
  date: string
  apps: { name: string; path: string; minutes: number; cpu: number; mem: number }[]
  totalMinutes: number
}

function ActivityJournal({ onBack }: { onBack: () => void }) {
  const [days, setDays] = useState<ActivityDay[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const stats: any[] = await invoke('get_app_stats')
      const daily: any[] = await invoke('get_daily_activity', { days: 30 })

      // Build per-day per-app detail from the backend
      const result: ActivityDay[] = []
      for (const d of daily) {
        const dayApps: ActivityDay['apps'] = []
        for (const s of stats) {
          try {
            const detail: any[] = await invoke('get_app_daily_detail', { appPath: s.path, days: 1 })
            const dayDetail = detail.find((dd: any) => dd.date === d.date)
            if (dayDetail && dayDetail.total_minutes > 0) {
              dayApps.push({
                name: s.name,
                path: s.path,
                minutes: dayDetail.total_minutes,
                cpu: dayDetail.avg_cpu,
                mem: dayDetail.avg_mem_mb,
              })
            }
          } catch (_) {}
        }
        if (dayApps.length > 0) {
          result.push({ date: d.date, apps: dayApps, totalMinutes: d.total_minutes })
        }
      }
      result.sort((a, b) => b.date.localeCompare(a.date))
      setDays(result)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const formatH = (m: number) => {
    const h = Math.floor(m / 60)
    const min = Math.round(m % 60)
    return h > 0 ? `${h}h ${min}m` : `${min}m`
  }

  return (
    <div className="page tools-page">
      <div className="page-header">
        <div className="header-row">
          <button className="btn-back-tools" onClick={onBack}>← Back to Tools</button>
        </div>
        <h1 className="page-title">Activity Journal</h1>
        <p className="page-subtitle">Complete timeline of app usage — launches, runtime, and resource consumption</p>
      </div>

      <div className="journal-timeline">
        {loading ? (
          <div className="tool-loading">Loading journal…</div>
        ) : days.length === 0 ? (
          <div className="tool-empty">No activity recorded yet. Usage is logged every 15 seconds while apps run.</div>
        ) : (
          days.map(day => (
            <div key={day.date} className="journal-day">
              <div className="journal-day-header" onClick={() => setExpandedDay(expandedDay === day.date ? null : day.date)}>
                <div className="journal-day-info">
                  <span className="journal-day-date">{day.date}</span>
                  <span className="journal-day-summary">{day.apps.length} apps · {formatH(day.totalMinutes)}</span>
                </div>
                <span className="journal-chevron">{expandedDay === day.date ? '▼' : '▶'}</span>
              </div>
              {expandedDay === day.date && (
                <div className="journal-day-apps">
                  {day.apps.map(app => (
                    <div key={app.path} className="journal-app-row">
                      <div className="journal-app-info">
                        <span className="journal-app-name">{app.name}</span>
                        <span className="journal-app-meta">{formatH(app.minutes)} · CPU {app.cpu}% · {app.mem.toFixed(0)} MB</span>
                      </div>
                      <div className="journal-app-bar-wrap">
                        <div className="journal-app-bar" style={{ width: `${(app.minutes / day.totalMinutes) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default function Tools() {
  const [view, setView] = useState<ToolView>('dashboard')
  const [startupItems, setStartupItems] = useState<StartupItem[]>([])
  const [uninstallApps, setUninstallApps] = useState<UninstallableApp[]>([])
  const [loading, setLoading] = useState(false)
  
  const [uninstalling, setUninstalling] = useState<string | null>(null)
  const [leftovers, setLeftovers] = useState<any[]>([])
  const [showCleanup, setShowCleanup] = useState<UninstallableApp | null>(null)
  const [search, setSearch] = useState('')

  // Everything state
  const [evQuery, setEvQuery] = useState('')
  const [evResults, setEvResults] = useState<any[]>([])
  const [evLoading, setEvLoading] = useState(false)
  const [evError, setEvError] = useState<string | null>(null)
  const [evReady, setEvReady] = useState(true)
  const [evCategory, setEvCategory] = useState('all')

  const categories = [
    { id: 'all',     label: 'All',        ext: null },
    { id: 'docs',    label: 'Documents',  ext: '.txt,.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.csv,.rtf,.md' },
    { id: 'images',  label: 'Images',     ext: '.jpg,.jpeg,.png,.gif,.bmp,.svg,.webp,.ico,.tiff' },
    { id: 'audio',   label: 'Audio',      ext: '.mp3,.wav,.flac,.aac,.ogg,.wma,.m4a' },
    { id: 'video',   label: 'Video',      ext: '.mp4,.avi,.mkv,.mov,.wmv,.flv,.webm' },
    { id: 'archives',label: 'Archives',   ext: '.zip,.rar,.7z,.tar,.gz,.bz2,.xz' },
    { id: 'exe',     label: 'Executables',ext: '.exe,.msi,.lnk,.bat,.cmd,.ps1' },
    { id: 'code',    label: 'Code',       ext: '.js,.ts,.py,.rs,.xml,.json,.css,.html,.hbs,.php,.java,.cpp,.c,.h' },
  ]

  const { apps, removeApp, refresh, launchApp } = useApps()
  const evQueryRef = useRef(evQuery)
  evQueryRef.current = evQuery

  const runEverythingSearch = useCallback(async (q: string, catId: string) => {
    if (q.length < 2) {
      setEvResults([])
      return
    }
    setEvLoading(true)
    setEvError(null)
    try {
      const ready = await invoke<boolean>('is_indexer_ready')
      setEvReady(ready)
      const cat = categories.find(c => c.id === catId)
      const extFilter = cat?.ext ?? null
      const res = await invoke<any[]>('everything_search', { query: q, limit: 100, extFilter })
      setEvResults(res)
    } catch (e: any) {
      setEvError(e.toString())
    } finally {
      setEvLoading(false)
    }
  }, [])

  const handleEverythingSearch = (q: string) => {
    setEvQuery(q)
    runEverythingSearch(q, evCategory)
  }

  const handleEvCategoryChange = (catId: string) => {
    setEvCategory(catId)
    runEverythingSearch(evQueryRef.current, catId)
  }

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

          <button className="tool-tile hub-card-base" onClick={() => setView('journal')}>
            <span className="tool-tile-icon">📋</span>
            <div className="tool-tile-info">
              <p className="tool-tile-name">Activity Journal</p>
              <p className="tool-tile-desc">Timeline of app launches and usage history</p>
            </div>
          </button>

          <button className="tool-tile hub-card-base" onClick={() => setView('everything')}>
            <span className="tool-tile-icon">🔍</span>
            <div className="tool-tile-info">
              <p className="tool-tile-name">reEverything Search</p>
              <p className="tool-tile-desc">Instant system-wide file search</p>
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

  // ── Activity Journal View ──────────────────────────────────────────────────
  if (view === 'journal') {
    return <ActivityJournal onBack={() => setView('dashboard')} />
  }

  // ── Everything View ──────────────────────────────────────────────────────
  if (view === 'everything') {
    return (
      <div className="page tools-page">
        <div className="page-header">
          <div className="header-row">
            <button className="btn-back-tools" onClick={() => setView('dashboard')}>← Back to Tools</button>
            <div className="tools-search-wrap">
               <input 
                  className="tools-search" 
                  placeholder="Search files and folders on PC…" 
                  value={evQuery}
                  onChange={e => handleEverythingSearch(e.target.value)}
                  autoFocus
               />
            </div>
          </div>
          <h1 className="page-title">reEverything Search</h1>
          <p className="page-subtitle">Powered by native reEverything engine. Instant results for files on your disks.</p>

          <div className="ev-categories">
            {categories.map(cat => (
              <button
                key={cat.id}
                className={`ev-cat-btn ${evCategory === cat.id ? 'active' : ''}`}
                onClick={() => handleEvCategoryChange(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="startup-list">
          {!evReady && <div className="tool-loading" style={{ color: 'var(--accent)' }}>reEverything is building index. Results may be incomplete…</div>}
          {evLoading && <div className="tool-loading">Searching…</div>}
          {evError && <div className="tool-error" style={{ color: '#ff4444', padding: 20 }}>{evError}</div>}
          {!evLoading && !evError && evResults.length === 0 && evQuery.length >= 2 && (
            <div className="tool-empty">No results found for "{evQuery}"</div>
          )}
          {!evLoading && !evError && evResults.length === 0 && evQuery.length < 2 && (
            <div className="tool-empty">Type at least 2 characters to start searching</div>
          )}
          
          {evResults.map((res, i) => (
            <div key={i} className="startup-row everything-row" onClick={() => launchApp(res.path)} style={{ cursor: 'pointer' }}>
              <div className="startup-info">
                <span className="startup-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {res.is_dir ? '📁' : '📄'} {res.name}
                </span>
                <span className="startup-cmd" title={res.path}>{res.path}</span>
              </div>
              <button className="btn-add-small" onClick={(e) => { e.stopPropagation(); launchApp(res.path) }}>Open</button>
            </div>
          ))}
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
