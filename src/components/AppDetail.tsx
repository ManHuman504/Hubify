import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { App } from '../hooks/useApps'
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

  // Poll immediately on mount so we don't have to wait for the first interval tick
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
      // 0. Kill the process if it's running
      if (metrics?.running) {
        await invoke('kill_app', { path: app.path })
      }

      // 1. Get uninstall string from registry (targeted search using app name as hint)
      const list = await invoke<any[]>('list_uninstallable_apps', { hints: [app.name] })
      const target = list.find(a => a.name.toLowerCase().includes(app.name.toLowerCase()) || app.path.toLowerCase().includes(a.install_location?.toLowerCase()))
      
      if (!target) {
        alert("Could not find official uninstall information for this app in Registry.")
        setUninstalling(false)
        return
      }

      // 2. Run official uninstaller
      await invoke('run_uninstall_string', { command: target.uninstall_string })
      
      // 3. Scan for leftovers
      const found = await invoke<any[]>('find_leftovers', { name: app.name, publisher: target.publisher })
      setLeftovers(found)
      setShowCleanup(true)
    } catch (e) {
      alert(`Uninstall failed: ${e}`)
    } finally {
      setUninstalling(false)
    }
  }

  const handleCleanLeftovers = async () => {
    for (const item of leftovers) {
      try { await invoke('delete_leftover', { leftover: item }) } catch (e) { console.error(e) }
    }
    alert('Deep cleaning complete!')
    setShowCleanup(false)
    onRemove() // Remove from hub after uninstall
  }

  return (
    <div className="detail">
      {/* Cleanup Modal */}
      {showCleanup && (
        <div className="lib-picker-backdrop">
           <div className="lib-picker uninstaller-modal" style={{ width: 500 }}>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>Deep Clean Leftovers</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                The uninstaller finished. Hubify found {leftovers.length} residual items.
              </p>
              
              <div className="leftover-list" style={{ width: '100%', maxHeight: 300, overflowY: 'auto', background: 'var(--bg-surface)', borderRadius: 8, padding: 12, border: '1px solid var(--border)', marginBottom: 20 }}>
                 {leftovers.length === 0 ? <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No leftovers found. Your system is clean!</p> : (
                    leftovers.map((l, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, fontSize: 11, marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
                         <span style={{ color: l.kind === 'folder' ? '#febc2e' : '#accent', fontWeight: 'bold' }}>[{l.kind[0].toUpperCase()}]</span>
                         <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{l.path}</span>
                      </div>
                    ))
                 )}
              </div>

              <div className="lib-picker-footer">
                 <button className="btn-secondary" onClick={() => { setShowCleanup(false); onRemove(); }}>Skip</button>
                 {leftovers.length > 0 && (
                    <button className="btn-danger" onClick={handleCleanLeftovers}>Clean Everything</button>
                 )}
                 {leftovers.length === 0 && (
                    <button className="btn-add" onClick={() => { setShowCleanup(false); onRemove(); }}>Finish</button>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* Top bar */}
      <div className="detail-topbar">
        <button className="detail-back" onClick={onBack}>← Back</button>
        <div className="detail-status">
          {metrics && (
            <span className={`detail-status-badge ${metrics.running ? 'running' : 'stopped'}`}>
              {metrics.running ? '● Running' : '○ Stopped'}
            </span>
          )}
        </div>
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
              ? <button className="btn-kill" onClick={onKill}>⬛ Kill Process</button>
              : <button className="btn-launch" onClick={onLaunch}>▶ Launch App</button>
            }
            <button className="btn-shortcut" onClick={handleCreateShortcut} title="Create Desktop Shortcut">➦ Shortcut</button>
          </div>
        </div>
      </div>

      {/* Metric cards */}
      {metrics && (
        <div className="detail-metrics">
          <MetricCard
            label="PID"
            value={metrics.pid ? `${metrics.pid}` : '—'}
            running={metrics.running}
          />
          <MetricCard
            label="TCP"
            value={`${metrics.connections}`}
            sub="connections"
            running={metrics.running}
          />
        </div>
      )}

      {/* CPU + RAM charts */}
      {(metrics?.running && history.length > 0) && (
        <div className="detail-charts">
          <MiniChart
            label="CPU Usage"
            points={history.map(h => h.cpu)}
            max={maxCpu}
            color="var(--accent)"
            unit="%"
          />
          <MiniChart
            label="Memory Usage"
            points={history.map(h => h.mem)}
            max={maxMem}
            color="#28c840"
            unit=" MB"
          />
        </div>
      )}

      {/* Settings & Dangerous Area */}
      <div className="detail-settings-area">
         <h3 className="section-title">App Settings</h3>
         <div className="settings-panel">
            <div className="settings-panel-row">
               <div className="settings-panel-info">
                  <p className="settings-panel-label">Start with Windows</p>
                  <p className="settings-panel-desc">Launch this app automatically when you log in.</p>
               </div>
               <button 
                  className={`toggle-btn ${metrics?.is_autostart ? 'active' : ''}`}
                  onClick={handleToggleAutostart}
               >
                  <div className="toggle-thumb" />
               </button>
            </div>
         </div>

         <h3 className="section-title danger">Dangerous Area</h3>
         <div className="settings-panel danger">
            <div className="settings-panel-row">
               <div className="settings-panel-info">
                  <p className="settings-panel-label">Remove from Hub</p>
                  <p className="settings-panel-desc">Keep the app installed, but hide it from Hubify.</p>
               </div>
               <button className="btn-secondary" onClick={onRemove}>Remove</button>
            </div>
            <div className="settings-panel-row">
               <div className="settings-panel-info">
                  <p className="settings-panel-label">Uninstall Completely</p>
                  <p className="settings-panel-desc">Run uninstaller and perform a deep clean of residual files.</p>
               </div>
               <button 
                  className="btn-danger" 
                  onClick={handleDeepUninstall}
                  disabled={uninstalling}
               >
                  {uninstalling ? 'Running…' : 'Uninstall'}
               </button>
            </div>
         </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, accent, running,
}: {
  label: string; value: string; sub?: string; accent?: boolean; running: boolean
}) {
  return (
    <div className={`metric-card ${running ? '' : 'inactive'} ${accent ? 'accent' : ''}`}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {sub && <p className="metric-sub">{sub}</p>}
    </div>
  )
}

function MiniChart({ label, points, max, color, unit }: {
  label: string; points: number[]; max: number; color: string; unit: string
}) {
  const w = 300
  const h = 56
  const n = points.length

  if (n < 2) return null

  const pts = points.map((v, i) => {
    const x = (i / (n - 1)) * w
    const y = h - Math.max(0, (v / max) * h * 0.95)
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
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
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
