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

const NEO_RETRO_VARS: Record<string, string> = {
  '--accent': '#d26abf',
  '--accent-hover': '#d97cc9',
  '--accent-subtle': 'rgba(210, 106, 191, 0.14)',
  '--bg-base': 'rgba(10, 10, 14, 0.0)',
  '--bg-surface': 'rgba(63, 58, 74, 0.55)',
  '--bg-elevated': 'rgba(14, 14, 16, 0.65)',
  '--bg-hover': 'rgba(210, 106, 191, 0.04)',
  '--text-primary': 'rgba(240, 240, 244, 0.95)',
  '--text-secondary': 'rgba(160, 160, 174, 0.85)',
  '--text-muted': 'rgba(197, 197, 226, 0.70)',
  '--border': 'rgba(255, 255, 255, 0.08)',
  '--border-subtle': 'rgba(255, 255, 255, 0.04)',
  '--nav-width': '210px',
  '--radius': '8px',
  '--radius-sm': '5px',
  '--titlebar-height': '36px',
}

const MIDNIGHT_VARS: Record<string, string> = {
  '--accent': '#5b8def',
  '--accent-hover': '#7aa3f2',
  '--accent-subtle': 'rgba(91, 141, 239, 0.14)',
  '--bg-base': 'rgba(8, 10, 18, 0.0)',
  '--bg-surface': 'rgba(20, 25, 40, 0.55)',
  '--bg-elevated': 'rgba(15, 18, 30, 0.65)',
  '--bg-hover': 'rgba(91, 141, 239, 0.04)',
  '--text-primary': 'rgba(220, 230, 250, 0.95)',
  '--text-secondary': 'rgba(160, 180, 220, 0.85)',
  '--text-muted': 'rgba(100, 130, 180, 0.7)',
  '--border': 'rgba(100, 150, 255, 0.1)',
  '--border-subtle': 'rgba(100, 150, 255, 0.05)',
  '--nav-width': '210px',
  '--radius': '8px',
  '--radius-sm': '5px',
  '--titlebar-height': '36px',
}

const SUNSET_VARS: Record<string, string> = {
  '--accent': '#ff8c42',
  '--accent-hover': '#ffa366',
  '--accent-subtle': 'rgba(255, 140, 66, 0.14)',
  '--bg-base': 'rgba(18, 14, 10, 0.0)',
  '--bg-surface': 'rgba(40, 30, 25, 0.55)',
  '--bg-elevated': 'rgba(20, 15, 12, 0.65)',
  '--bg-hover': 'rgba(255, 140, 66, 0.04)',
  '--text-primary': 'rgba(255, 240, 225, 0.95)',
  '--text-secondary': 'rgba(220, 190, 160, 0.85)',
  '--text-muted': 'rgba(180, 140, 100, 0.7)',
  '--border': 'rgba(255, 180, 100, 0.1)',
  '--border-subtle': 'rgba(255, 180, 100, 0.05)',
  '--nav-width': '210px',
  '--radius': '8px',
  '--radius-sm': '5px',
  '--titlebar-height': '36px',
}

const FOREST_VARS: Record<string, string> = {
  '--accent': '#6abf69',
  '--accent-hover': '#85cd84',
  '--accent-subtle': 'rgba(106, 191, 105, 0.14)',
  '--bg-base': 'rgba(10, 14, 10, 0.0)',
  '--bg-surface': 'rgba(25, 35, 25, 0.55)',
  '--bg-elevated': 'rgba(12, 18, 12, 0.65)',
  '--bg-hover': 'rgba(106, 191, 105, 0.04)',
  '--text-primary': 'rgba(225, 245, 225, 0.95)',
  '--text-secondary': 'rgba(170, 210, 170, 0.85)',
  '--text-muted': 'rgba(110, 160, 110, 0.7)',
  '--border': 'rgba(100, 200, 100, 0.1)',
  '--border-subtle': 'rgba(100, 200, 100, 0.05)',
  '--nav-width': '210px',
  '--radius': '8px',
  '--radius-sm': '5px',
  '--titlebar-height': '36px',
}

const NORD_VARS: Record<string, string> = {
  '--accent': '#88c0d0',
  '--accent-hover': '#a3d0db',
  '--accent-subtle': 'rgba(136, 192, 208, 0.14)',
  '--bg-base': 'rgba(10, 12, 16, 0.0)',
  '--bg-surface': 'rgba(30, 35, 42, 0.55)',
  '--bg-elevated': 'rgba(18, 22, 28, 0.65)',
  '--bg-hover': 'rgba(136, 192, 208, 0.04)',
  '--text-primary': 'rgba(230, 240, 250, 0.95)',
  '--text-secondary': 'rgba(180, 200, 220, 0.85)',
  '--text-muted': 'rgba(130, 155, 180, 0.7)',
  '--border': 'rgba(136, 192, 208, 0.1)',
  '--border-subtle': 'rgba(136, 192, 208, 0.05)',
  '--nav-width': '210px',
  '--radius': '8px',
  '--radius-sm': '5px',
  '--titlebar-height': '36px',
}

const SYNTHWAVE_VARS: Record<string, string> = {
  '--accent': '#ff6ec7',
  '--accent-hover': '#ff8cd2',
  '--accent-subtle': 'rgba(255, 110, 199, 0.14)',
  '--bg-base': 'rgba(12, 8, 16, 0.0)',
  '--bg-surface': 'rgba(35, 20, 50, 0.55)',
  '--bg-elevated': 'rgba(15, 8, 25, 0.65)',
  '--bg-hover': 'rgba(255, 110, 199, 0.04)',
  '--text-primary': 'rgba(245, 225, 250, 0.95)',
  '--text-secondary': 'rgba(200, 170, 220, 0.85)',
  '--text-muted': 'rgba(150, 110, 180, 0.7)',
  '--border': 'rgba(255, 110, 199, 0.1)',
  '--border-subtle': 'rgba(255, 110, 199, 0.05)',
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

    if (theme.active === 'neo-retro') {
      root.setAttribute('data-theme', 'neo-retro')
      for (const [key, val] of Object.entries(NEO_RETRO_VARS)) {
        root.style.setProperty(key, val)
      }
      return
    }

    if (theme.active === 'midnight') {
      root.setAttribute('data-theme', 'midnight')
      for (const [key, val] of Object.entries(MIDNIGHT_VARS)) {
        root.style.setProperty(key, val)
      }
      return
    }

    if (theme.active === 'sunset') {
      root.setAttribute('data-theme', 'sunset')
      for (const [key, val] of Object.entries(SUNSET_VARS)) {
        root.style.setProperty(key, val)
      }
      return
    }

    if (theme.active === 'forest') {
      root.setAttribute('data-theme', 'forest')
      for (const [key, val] of Object.entries(FOREST_VARS)) {
        root.style.setProperty(key, val)
      }
      return
    }

    if (theme.active === 'nord') {
      root.setAttribute('data-theme', 'nord')
      for (const [key, val] of Object.entries(NORD_VARS)) {
        root.style.setProperty(key, val)
      }
      return
    }

    if (theme.active === 'synthwave') {
      root.setAttribute('data-theme', 'synthwave')
      for (const [key, val] of Object.entries(SYNTHWAVE_VARS)) {
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
