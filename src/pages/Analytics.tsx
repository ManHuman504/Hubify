import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './Analytics.css'
import './Page.css'

interface DailyActivity {
  date: string
  total_minutes: number
  total_sessions: number
}

interface AppStat {
  name: string
  path: string
  total_minutes: number
  avg_cpu: number
  avg_mem_mb: number
}

interface TodaySummary {
  total_minutes: number
  active_apps: number
  top_app: string
}

interface AppDailyDetail {
  date: string
  total_minutes: number
  avg_cpu: number
  avg_mem_mb: number
}

interface NetworkRecord {
  timestamp: string
  remote_ip: string
  remote_port: number
  local_port: number
  state: string
}

function formatHours(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function ContributionGraph({ data }: { data: DailyActivity[] }) {
  if (!data.length) return null
  const max = Math.max(...data.map(d => d.total_minutes), 1)

  return (
    <div className="contribution-grid">
      {data.map(d => {
        const ratio = d.total_minutes / max
        const level = ratio < 0.01 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : ratio < 1 ? 4 : 5
        return (
          <div
            key={d.date}
            className="contribution-cell"
            data-level={level}
            title={`${d.date}: ${formatHours(d.total_minutes)} across ${d.total_sessions} sessions`}
          />
        )
      })}
    </div>
  )
}

function DetailView({ appPath, appName, onBack }: { appPath: string; appName: string; onBack: () => void }) {
  const [daily, setDaily] = useState<AppDailyDetail[]>([])
  const [net, setNet] = useState<NetworkRecord[]>([])
  const [hourly, setHourly] = useState<[string, number][]>([])
  const [days, setDays] = useState(30)

  const load = useCallback(() => {
    invoke<AppDailyDetail[]>('get_app_daily_detail', { appPath, days }).then(setDaily).catch(console.error)
    invoke<NetworkRecord[]>('get_app_network_activity', { appPath, limit: 50 }).then(setNet).catch(console.error)
    invoke<[string, number][]>('get_app_hourly', { appPath }).then(setHourly).catch(console.error)
  }, [appPath, days])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 15s
  useEffect(() => {
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  const totalMins = daily.reduce((s, d) => s + d.total_minutes, 0)
  const avgCpu = daily.length ? daily.reduce((s, d) => s + d.avg_cpu, 0) / daily.length : 0
  const avgMem = daily.length ? daily.reduce((s, d) => s + d.avg_mem_mb, 0) / daily.length : 0

  const maxHourly = Math.max(...hourly.map(h => h[1]), 1)

  return (
    <div className="analytics-detail">
      <div className="analytics-detail-header">
        <button className="analytics-back-btn" onClick={onBack}>
          ← Back
        </button>
        <h2 className="analytics-detail-title">{appName}</h2>
      </div>

      <div className="analytics-cards">
        <div className="analytics-card">
          <span className="analytics-card-value">{formatHours(totalMins)}</span>
          <span className="analytics-card-label">Total ({days}d)</span>
        </div>
        <div className="analytics-card">
          <span className="analytics-card-value">{avgCpu.toFixed(1)}%</span>
          <span className="analytics-card-label">Avg CPU</span>
        </div>
        <div className="analytics-card">
          <span className="analytics-card-value">{avgMem.toFixed(0)} MB</span>
          <span className="analytics-card-label">Avg Memory</span>
        </div>
        <div className="analytics-card">
          <span className="analytics-card-value">{net.length}</span>
          <span className="analytics-card-label">Net Connections</span>
        </div>
      </div>

      {/* Hourly sparkline (today) */}
      {hourly.length > 0 && (
        <div className="analytics-section">
          <h2>Today — Hourly Activity</h2>
          <div className="hourly-bar-chart">
            {hourly.map(([hour, mins]) => (
              <div key={hour} className="hourly-bar-wrap">
                <div
                  className="hourly-bar"
                  style={{ height: `${(mins / maxHourly) * 80}px` }}
                  title={`${hour} — ${mins.toFixed(1)} min`}
                />
                <span className="hourly-label">{hour.replace(':00', '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily breakdown */}
      <div className="analytics-section">
        <div className="analytics-section-header">
          <h2>Daily Breakdown</h2>
          <select className="analytics-select" value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        {daily.length === 0 ? (
          <p className="analytics-empty">No data recorded yet.</p>
        ) : (
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>CPU</th>
                  <th>Memory</th>
                </tr>
              </thead>
              <tbody>
                {daily.map(d => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{formatHours(d.total_minutes)}</td>
                    <td>{d.avg_cpu}%</td>
                    <td>{d.avg_mem_mb.toFixed(0)} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Network connections */}
      <div className="analytics-section">
        <h2>Network Connections</h2>
        {net.length === 0 ? (
          <p className="analytics-empty">No network connections recorded.</p>
        ) : (
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Remote IP</th>
                  <th>Port</th>
                  <th>Local Port</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {net.map((n, i) => (
                  <tr key={i}>
                    <td className="analytics-ts">{n.timestamp}</td>
                    <td className="analytics-ip">{n.remote_ip}</td>
                    <td>{n.remote_port}</td>
                    <td>{n.local_port}</td>
                    <td><span className={`net-state net-state-${n.state.toLowerCase()}`}>{n.state}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Analytics() {
  const [daily, setDaily] = useState<DailyActivity[]>([])
  const [stats, setStats] = useState<AppStat[]>([])
  const [summary, setSummary] = useState<TodaySummary | null>(null)
  const [days, setDays] = useState(30)
  const [detailApp, setDetailApp] = useState<{ path: string; name: string } | null>(null)

  const load = useCallback(() => {
    invoke<DailyActivity[]>('get_daily_activity', { days }).then(setDaily).catch(console.error)
    invoke<AppStat[]>('get_app_stats').then(setStats).catch(console.error)
    invoke<TodaySummary>('get_today_summary').then(setSummary).catch(console.error)
  }, [days])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 15s
  useEffect(() => {
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  if (detailApp) {
    return (
      <div className="page">
        <DetailView appPath={detailApp.path} appName={detailApp.name} onBack={() => setDetailApp(null)} />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
        <p className="page-subtitle">Usage tracking refreshes every 15 seconds</p>
      </div>

      <div className="analytics-content">
        {summary && (
          <div className="analytics-cards">
            <div className="analytics-card">
              <span className="analytics-card-value">{formatHours(summary.total_minutes)}</span>
              <span className="analytics-card-label">Today</span>
            </div>
            <div className="analytics-card">
              <span className="analytics-card-value">{summary.active_apps}</span>
              <span className="analytics-card-label">Active Apps</span>
            </div>
            <div className="analytics-card">
              <span className="analytics-card-value">{summary.top_app.split('\\').pop()?.replace('.exe', '') || '-'}</span>
              <span className="analytics-card-label">Top App</span>
            </div>
            <div className="analytics-card">
              <span className="analytics-card-value">{formatHours(daily.reduce((s, d) => s + d.total_minutes, 0))}</span>
              <span className="analytics-card-label">Total</span>
            </div>
          </div>
        )}

        <div className="analytics-section">
          <div className="analytics-section-header">
            <h2>Activity</h2>
            <select className="analytics-select" value={days} onChange={e => setDays(Number(e.target.value))}>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
            </select>
          </div>
          <ContributionGraph data={daily} />
          {daily.length === 0 && <p className="analytics-empty">No data yet. Usage is recorded every 15s while apps are running.</p>}
        </div>

        <div className="analytics-section">
          <h2>Per-App Statistics</h2>
          {stats.length === 0 ? (
            <p className="analytics-empty">No app usage recorded yet.</p>
          ) : (
            <div className="analytics-table-wrap">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>App</th>
                    <th>Total Time</th>
                    <th>Avg CPU</th>
                    <th>Avg Memory</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map(s => (
                    <tr key={s.path} className="analytics-row-clickable" onClick={() => setDetailApp({ path: s.path, name: s.name })}>
                      <td className="analytics-app-name">{s.name}</td>
                      <td>{formatHours(s.total_minutes)}</td>
                      <td>{s.avg_cpu}%</td>
                      <td>{s.avg_mem_mb.toFixed(0)} MB</td>
                      <td className="analytics-detail-arrow">→</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
