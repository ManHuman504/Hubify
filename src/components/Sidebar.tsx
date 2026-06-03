import type { Page } from '../App'
import './Sidebar.css'

interface NavItem {
  id: Page
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home',     label: 'Home',     icon: '⬡' },
  { id: 'library',  label: 'Library',  icon: '⊞' },
  { id: 'store',    label: 'Store',    icon: '◈' },
  { id: 'tools',    label: 'Tools',    icon: '⚙' },
  { id: 'tray',     label: 'Tray',     icon: '⬆' },
]

interface Props {
  active: Page
  onNavigate: (page: Page) => void
}

export default function Sidebar({ active, onNavigate }: Props) {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-mark">H</span>
        <span className="logo-text">Hubify</span>
      </div>

      <ul className="nav-list">
        {NAV_ITEMS.map(item => (
          <li key={item.id}>
            <button
              className={`nav-item ${active === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="sidebar-bottom">
        <button
          className={`nav-item ${active === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <span className="nav-icon">◎</span>
          <span className="nav-label">Settings</span>
        </button>
      </div>
    </nav>
  )
}
