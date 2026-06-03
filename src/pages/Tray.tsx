import './Page.css'

export default function Tray() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Tray</h1>
        <p className="page-subtitle">System tray management · coming soon</p>
      </div>
      <div className="page-empty">
        <span className="empty-icon">⬆</span>
        <p>Tray control</p>
        <p className="empty-hint">Replace all tray icons with a single Hubify icon</p>
      </div>
    </div>
  )
}
