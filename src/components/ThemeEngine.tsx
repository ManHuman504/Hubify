import { useEffect } from 'react'
import { useApps } from '../hooks/useApps'

const NEO_VARS: Record<string, string> = {
  '--accent': '#00ff9d',
  '--accent-hover': '#33ffb1',
  '--accent-subtle': 'rgba(0, 255, 157, 0.14)',
  '--bg-base': 'rgba(10, 10, 15, 0.0)',
  '--bg-surface': 'rgba(15, 15, 25, 0.6)',
  '--bg-elevated': 'rgba(20, 20, 35, 0.7)',
  '--bg-hover': 'rgba(0, 255, 157, 0.04)',
  '--text-primary': 'rgba(220, 255, 240, 0.95)',
  '--text-secondary': 'rgba(140, 200, 180, 0.85)',
  '--text-muted': 'rgba(80, 140, 120, 0.7)',
  '--border': 'rgba(0, 255, 157, 0.12)',
  '--border-subtle': 'rgba(0, 255, 157, 0.06)',
  '--nav-width': '210px',
  '--radius': '8px',
  '--radius-sm': '5px',
  '--titlebar-height': '36px',
}

export default function ThemeEngine() {
  const { theme } = useApps()

  useEffect(() => {
    const root = document.documentElement

    if (theme.active === 'dark' || theme.active === 'light') {
      root.setAttribute('data-theme', theme.active)
      const customVars = [
        '--bg-base', '--bg-surface', '--bg-elevated', '--bg-hover',
        '--border', '--border-subtle',
        '--text-primary', '--text-secondary', '--text-muted',
        '--accent', '--accent-hover', '--accent-subtle',
      ]
      for (const v of customVars) {
        root.style.removeProperty(v)
      }
      return
    }

    if (theme.active === 'neo') {
      root.setAttribute('data-theme', 'neo')
      for (const [key, val] of Object.entries(NEO_VARS)) {
        root.style.setProperty(key, val)
      }
      return
    }

    // Custom theme — use dark as base, then override
    root.setAttribute('data-theme', 'dark')
    const ct = theme.custom_themes.find(t => t.id === theme.active)
    if (!ct) return

    for (const [key, val] of Object.entries(ct.vars)) {
      root.style.setProperty(key, val)
    }
  }, [theme.active, theme.custom_themes])

  return null
}
