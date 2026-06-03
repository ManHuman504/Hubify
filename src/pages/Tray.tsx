import { invoke } from '@tauri-apps/api/core'
import { useApps } from '../hooks/useApps'
import './Page.css'
import './Tray.css'

export default function Tray() {
  const { apps, processInfo, launchApp } = useApps()

  const activeApps = apps
    .map(a => ({ ...a, info: processInfo[a.id] }))
    .filter(a => a.info?.running)

  const handleFocus = (path: string) => {
    invoke('focus_or_launch_app', { path }).catch(() => launchApp(path))
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Tray & Background</h1>
        <p className="page-subtitle">
          {activeApps.length} active app{activeApps.length !== 1 ? 's' : ''} currently running
        </p>
      </div>

      {activeApps.length === 0 ? (
        <div className="page-empty">
          <span className="empty-icon">⊡</span>
          <p>No apps are currently running</p>
          <p className="empty-hint">Launch apps from Home or Store to see them here</p>
        </div>
      ) : (
        <div className="tray-list">
          {activeApps.map(app => (
            <div key={app.id} className="tray-row" onClick={() => handleFocus(app.path)}>
              <div className="tray-row-icon">
                {app.icon
                  ? <img src={app.icon} alt={app.name} draggable={false} />
                  : <span className="tray-row-fallback">{app.name[0]}</span>
                }
              </div>
              <div className="tray-row-info">
                <p className="tray-row-name">{app.name}</p>
                {app.info && (
                  <p className="tray-row-meta">
                    PID {app.info.pid} · CPU {app.info.cpu.toFixed(1)}% · {app.info.mem_mb.toFixed(0)} MB
                  </p>
                )}
              </div>
              <button className="tray-row-btn" onClick={e => { e.stopPropagation(); handleFocus(app.path) }}>
                ⊞ Focus
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
