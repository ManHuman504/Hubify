import { useEffect, useRef } from 'react'
import './ContextMenu.css'

export interface MenuItem {
  label: string
  icon?: string
  danger?: boolean
  onClick: () => void
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose])

  // Adjust position to stay in viewport
  const style: React.CSSProperties = { left: x, top: y }

  return (
    <div className="ctx-menu" style={style} ref={ref}>
      {items.map((item, i) => (
        <button
          key={i}
          className={`ctx-item ${item.danger ? 'danger' : ''}`}
          onClick={() => { item.onClick(); onClose() }}
        >
          {item.icon && <span className="ctx-icon">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  )
}
