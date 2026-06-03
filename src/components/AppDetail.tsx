import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { App } from '../hooks/useApps'
import { useApps } from '../hooks/useApps'
import './AppDetail.css'

interface ConnectionInfo {
  local_port: number
  remote_ip: string
  remote_port: number
  state: string
}

interface Metrics {
  running: boolean
  pid: number | null
  cpu: number
  mem_mb: number
  connections: number
  recv_kb: number
  sent_kb: number
  connections_detail: ConnectionInfo[]
  is_autostart: boolean
}

interface Props {
  app: App
  onBack: () => void
  onLaunch: () => void
  onKill: () => void
  onRemove: () => void
}

export default function AppDetail({ app, onBack, onLaunch, onKill, onRemove }: Props) {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [history, setHistory] = useState<{ cpu: number; mem: number }[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { removeApp, refresh } = useApps()

  const [uninstalling, setUninstalling] = useState(false)
  const [leftovers, setLeftovers] = useState<any[]>([])
  const [showCleanup, setShowCleanup] = useState(false)

  const poll = async () => {
    try {
      const m = await invoke<Metrics>('get_app_metrics', { path: app.path, name: app.name })
      setMetrics(m)
      setHistory(prev => [...prev, { cpu: m.cpu, mem: m.mem_mb }].slice(-40))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    poll()
    intervalRef.current = setInterval(poll, 500)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [app.path])

  const maxCpu = Math.max(...history.map(h => h.cpu), 0.1)
  const maxMem = Math.max(...history.map(h => h.mem), 1)

  const handleCreateShortcut = async () => {
    try {
      await invoke('create_shortcut', { name: app.name, targetPath: app.path })
      alert('Shortcut created on Desktop!')
    } catch (e) {
      alert(`Failed to create shortcut: ${e}`)
    }
  }

  const handleToggleAutostart = async () => {
    if (!metrics) return
    const newState = !metrics.is_autostart
    try {
      await invoke('toggle_autostart', { name: app.name, path: app.path, enable: newState })
      setMetrics({ ...metrics, is_autostart: newState })
    } catch (e) {
      alert(`Failed to toggle autostart: ${e}`)
    }
  }

  const handleDeepUninstall = async () => {
    if (!window.confirm(`Are you sure you want to completely uninstall ${app.name}? This will run the official uninstaller and then scan for residual files.`)) return
    
    setUninstalling(true)
    try {
      if (metrics?.running) {
        await invoke('kill_app', { path: app.path })
      }

      // Find in registry (full list like Deep Uninstaller in Tools)
      const allApps = await invoke<any[]>('list_uninstallable_apps', { hints: null })
      const target = allApps.find(a =>
        a.name.toLowerCase().includes(app.name.toLowerCase()) ||
        (a.install_location && app.path.toLowerCase().includes(a.install_location.toLowerCase()))
      )

      if (target) {
        // Run official uninstaller
        try {
          await invoke('run_uninstall_string', { command: target.uninstall_string })
        } catch (e) {
          console.warn('Uninstaller process error:', e)
        }
        await new Promise(r => setTimeout(r, 4000))

        // Scan for leftovers
        const found = await invoke<any[]>('find_leftovers', { name: app.name, publisher: target.publisher })
        setLeftovers(found)
        setShowCleanup(true) // modal is shown — function returns, user interacts with modal
        return
      }

      // No registry entry — just remove from hub and navigate back
      console.warn('No registry entry found — removing from hub only')
      await removeApp(app.id)
      await refresh()
      onBack()
    } catch (e) {
      alert(`Uninstall failed: ${e}`)
    } finally {
      setUninstalling(false)
    }
  }

  const finishUninstall = async () => {
    setShowCleanup(false)
    await removeApp(app.id)
    await refresh()
    onBack()
  }

  const handleCleanLeftovers = async () => {
    for (const item of leftovers) {
      try { await invoke('delete_leftover', { leftover: item }) } catch (e) { console.error(e) }
    }
    alert('Deep cleaning complete!')
    await finishUninstall()
  }

  return (
    <div className="detail">
      {/* Cleanup Modal */}
      {showCleanup && (
        <div className="lib-picker-backdrop">
           <div className="lib-picker" style={{ width: 440, padding: 20 }}>
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>Deep Clean Leftovers</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
                The uninstaller finished. Found {leftovers.length} residual items.
              </p>
              
              <div style={{ width: '100%', maxHeight: 250, overflowY: 'auto', background: 'var(--bg-surface)', borderRadius: 6, padding: 10, border: '1px solid var(--border)', marginBottom: 16, fontSize: 11 }}>
                 {leftovers.length === 0 ? (
                   <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No leftovers found.</p>
                 ) : (
                   leftovers.map((l, i) => (
                     <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{ color: l.kind === 'folder' ? '#febc2e' : 'var(--accent)', fontWeight: 'bold' }}>[{l.kind[0].toUpperCase()}]</span>
                        <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{l.path}</span>
                     </div>
                   ))
                 )}
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="detail-btn" onClick={finishUninstall}>Skip → Home</button>
                  {leftovers.length > 0 && (
                    <button className="detail-btn danger" onClick={handleCleanLeftovers}>Clean Everything</button>
                  )}
                  {leftovers.length === 0 && (
                    <button className="detail-btn primary" onClick={finishUninstall}>Finish → Home</button>
                  )}
              </div>
           </div>
        </div>
      )}

      {/* Top bar */}
      <div className="detail-topbar">
        <button className="detail-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Back
        </button>
        {metrics && (
          <span className={`detail-status-badge ${metrics.running ? 'running' : 'stopped'}`}>
            {metrics.running ? '● Running' : '○ Stopped'}
          </span>
        )}
      </div>

      {/* Hero */}
      <div className="detail-hero">
        <div className="detail-icon">
          {app.icon
            ? <img src={app.icon} alt={app.name} draggable={false} />
            : <span className="detail-icon-fallback">{app.name[0]}</span>
          }
        </div>
        <div className="detail-info">
          <h1 className="detail-name">{app.name}</h1>
          <p className="detail-path">{app.path}</p>
          <div className="detail-actions">
            {metrics?.running
              ? <button className="detail-btn danger" onClick={onKill}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
                  Kill
                </button>
              : <button className="detail-btn primary" onClick={onLaunch}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  Launch
                </button>
            }
            <button className="detail-btn" onClick={handleCreateShortcut}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
              Shortcut
            </button>
          </div>
        </div>
      </div>

      {/* Metrics */}
      {metrics && (
        <div className="detail-metrics">
          <div className="metric-chip">
            <span className="metric-chip-label">PID</span>
            <span className="metric-chip-value">{metrics.pid ?? '—'}</span>
          </div>
          <div className="metric-chip">
            <span className="metric-chip-label">TCP</span>
            <span className="metric-chip-value">{metrics.connections}</span>
          </div>
          {metrics.running && (
            <>
              <div className="metric-chip">
                <span className="metric-chip-label">↓</span>
                <span className="metric-chip-value">{metrics.recv_kb.toFixed(0)} KB</span>
              </div>
              <div className="metric-chip">
                <span className="metric-chip-label">↑</span>
                <span className="metric-chip-value">{metrics.sent_kb.toFixed(0)} KB</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Charts */}
      {(metrics?.running && history.length > 0) && (
        <div className="detail-charts">
          <MiniChart
            label="CPU"
            points={history.map(h => h.cpu)}
            max={maxCpu}
            color="var(--accent)"
            unit="%"
          />
          <MiniChart
            label="Memory"
            points={history.map(h => h.mem)}
            max={maxMem}
            color="#28c840"
            unit=" MB"
          />
        </div>
      )}

      {/* Settings */}
      <div className="detail-settings">
         <div>
           <p className="settings-section-title">App Settings</p>
           <div className="settings-card">
             <div className="settings-row">
               <div className="settings-row-info">
                 <p className="settings-row-label">Start with Windows</p>
                 <p className="settings-row-desc">Launch automatically on login.</p>
               </div>
               <button 
                 className={`toggle-btn ${metrics?.is_autostart ? 'active' : ''}`}
                 onClick={handleToggleAutostart}
               >
                 <div className="toggle-thumb" />
               </button>
             </div>
           </div>
         </div>

         <div>
           <p className="settings-section-title danger">Dangerous Area</p>
           <div className="settings-card danger">
             <div className="settings-row">
               <div className="settings-row-info">
                 <p className="settings-row-label">Remove from Hub</p>
                 <p className="settings-row-desc">Keep installed, hide from Hubify.</p>
               </div>
               <button className="detail-btn" onClick={onRemove}>Remove</button>
             </div>
             <div className="settings-row">
               <div className="settings-row-info">
                 <p className="settings-row-label">Uninstall Completely</p>
                 <p className="settings-row-desc">Run uninstaller and remove residuals.</p>
               </div>
               <button 
                 className="detail-btn danger" 
                 onClick={handleDeepUninstall}
                 disabled={uninstalling}
               >
                 {uninstalling ? 'Running…' : 'Uninstall'}
               </button>
             </div>
           </div>
         </div>
      </div>
    </div>
  )
}

// ── Mini Chart ────────────────────────────────────────────────────────────────

function MiniChart({ label, points, max, color, unit }: {
  label: string; points: number[]; max: number; color: string; unit: string
}) {
  const w = 300
  const h = 40
  const n = points.length

  if (n < 2) return null

  const pts = points.map((v, i) => {
    const x = (i / (n - 1)) * w
    const y = h - Math.max(0, (v / max) * h * 0.9)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const last = points[n - 1]

  return (
    <div className="mini-chart">
      <div className="chart-header">
        <span className="chart-label">{label}</span>
        <span className="chart-last" style={{ color }}>{last.toFixed(1)}{unit}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polyline
          points={`0,${h} ${pts} ${w},${h}`}
          fill={`url(#grad-${label})`}
          strokeWidth="0"
        />
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}
