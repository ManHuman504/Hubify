import './Page.css'

export default function Tray() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Tray & Background</h1>
        <p className="page-subtitle">Configure background behavior</p>
      </div>

      <div className="page-empty" style={{ maxWidth: 600, margin: '0 auto', textAlign: 'left', marginTop: 40, border: 'none', background: 'transparent' }}>
        <h2 style={{ fontSize: 16, marginBottom: 12, color: 'var(--text-primary)' }}>Unified Tray Concept</h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
          Hubify implements a <strong>Unified Tray</strong>. Instead of having dozens of overlapping icons in your system taskbar, Hubify provides a single master icon. 
        </p>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
          Right-click the Hubify icon in your system tray to instantly see a list of all your currently running applications, and launch or manage them from one place.
        </p>
        <div style={{ padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <h3 style={{ fontSize: 13, marginBottom: 8, color: 'var(--text-primary)' }}>💡 Pro Tip: Clean up your Taskbar</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            To get the full Hubify experience, drag the native tray icons of your apps (like Discord, Telegram, or Steam) into the hidden overflow menu (the <b>^</b> arrow on Windows). Leave only Hubify visible!
          </p>
        </div>
      </div>
    </div>
  )
}
