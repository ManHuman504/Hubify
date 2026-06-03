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
  const [netExpanded, setNetExpanded] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = async () => {
    try {
      const m = await invoke<Metrics>('get_app_metrics', { path: app.path })
      setMetrics(m)
      setHistory(prev => [...prev, { cpu: m.cpu, mem: m.mem_mb }].slice(-40))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    poll()
    intervalRef.current = setInterval(poll, 2000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [app.id])

  const maxCpu = Math.max(...history.map(h => h.cpu), 0.1)
  const maxMem = Math.max(...history.map(h => h.mem), 1)

  return (
    <div className="detail">
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
              ? <button className="btn-kill" onClick={onKill}>⬛ Kill</button>
              : <button className="btn-launch" onClick={onLaunch}>▶ Launch</button>
            }
            <button className="btn-remove" onClick={onRemove}>Remove</button>
          </div>
        </div>
      </div>

      {/* Metric cards */}
      {metrics && (
        <div className="detail-metrics">
          <MetricCard
            label="CPU"
            value={metrics.running ? `${metrics.cpu.toFixed(1)}%` : '—'}
            sub={metrics.running ? 'usage' : undefined}
            accent={metrics.running && metrics.cpu > 50}
            running={metrics.running}
          />
          <MetricCard
            label="Memory"
            value={metrics.running ? `${metrics.mem_mb.toFixed(0)}` : '—'}
            sub={metrics.running ? 'MB' : undefined}
            running={metrics.running}
          />
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
      {history.length > 1 && (
        <div className="detail-charts">
          <MiniChart
            label="CPU"
            points={history.map(h => h.cpu)}
            max={maxCpu}
            color="var(--accent)"
            unit="%"
          />
          <MiniChart
            label="RAM"
            points={history.map(h => h.mem)}
            max={maxMem}
            color="#28c840"
            unit=" MB"
          />
        </div>
      )}

      {/* Network block — collapsible */}
      {metrics && (
        <div className="detail-net-block">
          <button
            className="detail-net-header"
            onClick={() => setNetExpanded(v => !v)}
          >
            <span className="detail-net-title">Network</span>
            <div className="detail-net-summary">
              <span className="net-badge">↓ {(metrics.recv_kb / 1024).toFixed(1)} MB</span>
              <span className="net-badge">↑ {(metrics.sent_kb / 1024).toFixed(1)} MB</span>
              {metrics.connections > 0 && (
                <span className="net-badge accent">{metrics.connections} conn</span>
              )}
            </div>
            <span className="detail-net-arrow">{netExpanded ? '▲' : '▼'}</span>
          </button>

          {netExpanded && (
            <div className="detail-net-table-wrap">
              {metrics.connections_detail.length === 0 ? (
                <p className="net-empty">No active TCP connections</p>
              ) : (
                <table className="net-table">
                  <thead>
                    <tr>
                      <th>Remote IP</th>
                      <th>Port</th>
                      <th>Local Port</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.connections_detail.map((c, i) => (
                      <tr key={i} className={`net-row state-${c.state.toLowerCase()}`}>
                        <td className="net-ip">{c.remote_ip}</td>
                        <td>{c.remote_port}</td>
                        <td className="net-muted">{c.local_port}</td>
                        <td>
                          <span className={`net-state-tag ${c.state === 'ESTABLISHED' ? 'established' : ''}`}>
                            {c.state}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
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
