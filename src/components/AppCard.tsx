import { useState } from 'react'
import type { App, ProcessInfo } from '../hooks/useApps'
import ContextMenu from './ContextMenu'
import './AppCard.css'

interface Props {
  app: App
  info?: ProcessInfo
  onSelect: () => void
  onLaunch: () => void
  onKill: () => void
  onRemove: () => void
}

export default function AppCard({ app, info, onSelect, onLaunch, onKill, onRemove }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const running = info?.running ?? false

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const menuItems = [
    ...(running
      ? [{ label: 'Kill', icon: '◼', danger: true, onClick: onKill }]
      : [{ label: 'Launch', icon: '▶', onClick: onLaunch }]),
    { label: 'Remove', icon: '✕', danger: true, onClick: onRemove },
  ]

  return (
    <>
      <div
        className={`app-card ${running ? 'running' : ''}`}
        onContextMenu={handleContextMenu}
        onClick={onSelect}
      >
        {/* Running indicator */}
        {running && <span className="app-card-running-dot" />}

        {/* Icon fills the full card */}
        <div className="app-card-icon">
          {app.icon
            ? <img src={app.icon} alt={app.name} draggable={false} />
            : <span className="app-card-fallback">{app.name[0]}</span>
          }
        </div>

        {/* Name overlay on hover */}
        <div className="app-card-overlay">
          <p className="app-card-name">{app.name}</p>
        </div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x} y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
