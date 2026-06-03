import './Page.css'

interface Props {
  theme: 'dark' | 'light'
  onThemeChange: (t: 'dark' | 'light') => void
}

export default function Settings({ theme, onThemeChange }: Props) {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Preferences and configuration</p>
      </div>

      <div className="settings-section">
        <p className="settings-label">Appearance</p>
        <div className="settings-row">
          <span>Theme</span>
          <div className="theme-toggle">
            <button
              className={theme === 'dark' ? 'active' : ''}
              onClick={() => onThemeChange('dark')}
            >Dark</button>
            <button
              className={theme === 'light' ? 'active' : ''}
              onClick={() => onThemeChange('light')}
            >Light</button>
          </div>
        </div>
      </div>
    </div>
  )
}
