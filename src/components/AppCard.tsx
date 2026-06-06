import type { App, ProcessInfo } from '../hooks/useApps'
import './AppCard.css'

interface Props {
  app: App
  info?: ProcessInfo
  onSelect: () => void
  onLaunch: () => void
  onKill: () => void
  onRemove: () => void
  isExternal?: boolean
}

export default function AppCard({ app, info, onSelect, onLaunch, isExternal }: Props) {
  const running = info?.running ?? false

  return (
    <div
      className={`app-card ${running ? 'running' : ''} ${isExternal ? 'external' : ''}`}
      onClick={onLaunch}
      onContextMenu={(e) => { e.preventDefault(); onSelect() }}
    >
      {running && <div className="app-card-indicator" />}
      {isExternal && <div className="external-badge">PC</div>}

      <div className="app-card-icon">
        {app.icon
          ? <img src={app.icon} alt={app.name} draggable={false} />
          : <span className="app-card-fallback">{app.name[0]}</span>
        }
      </div>

      <div className="app-card-overlay">
        <p className="app-card-name">{app.name}</p>
      </div>
    </div>
  )
}
