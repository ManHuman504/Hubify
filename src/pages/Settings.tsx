import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useApps, type CustomTheme } from '../hooks/useApps'
import UpdateModal, { type UpdateInfo } from '../components/UpdateModal'
import './Page.css'
import './Settings.css'

const DEFAULT_COLORS = {
  dark: {
    '--accent': '#7c6fff',
    '--accent-hover': '#8f84ff',
    '--accent-subtle': 'rgba(124, 111, 255, 0.14)',
    '--bg-surface': 'rgba(28, 28, 32, 0.55)',
    '--bg-elevated': 'rgba(36, 36, 42, 0.65)',
    '--text-primary': 'rgba(240, 240, 244, 0.95)',
    '--text-secondary': 'rgba(160, 160, 174, 0.85)',
    '--text-muted': 'rgba(100, 100, 114, 0.7)',
    '--border': 'rgba(255, 255, 255, 0.08)',
  },
  light: {
    '--accent': '#6c63ff',
    '--accent-hover': '#5a52e0',
    '--accent-subtle': 'rgba(108, 99, 255, 0.1)',
    '--bg-surface': 'rgba(255, 255, 255, 0.55)',
    '--bg-elevated': 'rgba(252, 252, 255, 0.65)',
    '--text-primary': 'rgba(20, 20, 26, 0.95)',
    '--text-secondary': 'rgba(80, 80, 96, 0.85)',
    '--text-muted': 'rgba(140, 140, 158, 0.75)',
    '--border': 'rgba(0, 0, 0, 0.07)',
  },
}

const CSS_VARS = [
  { key: '--accent', label: 'Accent', type: 'color' },
  { key: '--bg-surface', label: 'Surface BG', type: 'rgba' },
  { key: '--bg-elevated', label: 'Elevated BG', type: 'rgba' },
  { key: '--text-primary', label: 'Text Primary', type: 'rgba' },
  { key: '--text-secondary', label: 'Text Secondary', type: 'rgba' },
  { key: '--text-muted', label: 'Text Muted', type: 'rgba' },
  { key: '--border', label: 'Border', type: 'rgba' },
]

function parseRgba(val: string) {
  const m = val.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/)
  if (!m) return null
  return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a: parseFloat(m[4]) }
}

function formatRgba(r: number, g: number, b: number, a: number) {
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function ColorInput({
  label, value, onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const parsed = parseRgba(value)
  const [r, setR] = useState(parsed?.r ?? 0)
  const [g, setG] = useState(parsed?.g ?? 0)
  const [b, setB] = useState(parsed?.b ?? 0)
  const [a, setA] = useState(parsed?.a ?? 1)

  useEffect(() => {
    const p = parseRgba(value)
    if (p) { setR(p.r); setG(p.g); setB(p.b); setA(p.a) }
  }, [value])

  const emit = useCallback((rr: number, gg: number, bb: number, aa: number) => {
    onChange(formatRgba(rr, gg, bb, aa))
  }, [onChange])

  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`

  return (
    <div className="color-input-row">
      <span className="color-input-label">{label}</span>
      <div className="color-input-controls">
        <input
          type="color"
          className="color-input-swatch"
          value={hex}
          onChange={e => {
            const h = e.target.value
            const rr = parseInt(h.slice(1, 3), 16)
            const gg = parseInt(h.slice(3, 5), 16)
            const bb = parseInt(h.slice(5, 7), 16)
            emit(rr, gg, bb, a)
          }}
        />
        <div className="color-input-rgba">
          <input className="color-num" value={r} onChange={e => emit(+e.target.value || 0, g, b, a)} placeholder="R" />
          <input className="color-num" value={g} onChange={e => emit(r, +e.target.value || 0, b, a)} placeholder="G" />
          <input className="color-num" value={b} onChange={e => emit(r, g, +e.target.value || 0, a)} placeholder="B" />
          <input className="color-num alpha" value={a.toFixed(2)} onChange={e => emit(r, g, b, Math.min(1, Math.max(0, +e.target.value || 0)))} placeholder="A" step="0.01" />
        </div>
      </div>
    </div>
  )
}

function HotkeyRecorder({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [recording, setRecording] = useState(false)
  const [pending, setPending] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        setPending('')
        return
      }
      if (e.key === 'Enter' && pending) {
        onChange(pending)
        setRecording(false)
        setPending('')
        return
      }
      if (e.key === 'Backspace' && !pending) {
        onChange(null)
        setRecording(false)
        return
      }
      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') {
        // modifier only — wait for next key
        return
      }
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
      parts.push(key)
      const combo = parts.join('+')
      if (combo) {
        onChange(combo)
        setRecording(false)
        setPending('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [recording, pending, onChange])

  return (
    <div className="hk-recorder" ref={ref}>
      {recording ? (
        <span className="hk-recording" onClick={() => { setRecording(false); setPending('') }}>
          {pending || 'Press keys...'}
        </span>
      ) : (
        <span className="hk-value" onClick={() => setRecording(true)}>
          {value || <span className="hk-none">None</span>}
        </span>
      )}
      {value && !recording && (
        <button className="hk-clear" onClick={() => onChange(null)} title="Remove hotkey">×</button>
      )}
    </div>
  )
}

export default function Settings() {
  const { theme, setTheme, saveTheme, deleteTheme, apps, setAppHotkey } = useApps()
  const [managers, setManagers] = useState({ winget: false, scoop: false, choco: false })
  const [indexerReady, setIndexerReady] = useState(false)
  const [guardianEnabled, setGuardianEnabled] = useState(true)
  const [updateCheckEnabled, setUpdateCheckEnabled] = useState(true)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [checkResult, setCheckResult] = useState<string | null>(null)

  // Editing state
  const [editingVars, setEditingVars] = useState<Record<string, string>>({})
  const [editName, setEditName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    invoke('winget_check').then(r => setManagers(r as any)).catch(() => {})
    invoke<boolean>('is_indexer_ready').then(r => setIndexerReady(r)).catch(() => {})
    invoke<boolean>('get_guardian_enabled').then(r => setGuardianEnabled(r)).catch(() => {})
    invoke<boolean>('get_update_check_enabled').then(r => setUpdateCheckEnabled(r)).catch(() => {})
  }, [])

  // Initialize editing vars when starting a new custom theme
  const startNewTheme = () => {
    const base = theme.active === 'light' ? DEFAULT_COLORS.light : DEFAULT_COLORS.dark
    setEditingVars({ ...base })
    setEditName('')
    setEditingId(null)
  }

  const startEditTheme = (ct: CustomTheme) => {
    const base = { ...DEFAULT_COLORS.dark, ...ct.vars }
    setEditingVars(base)
    setEditName(ct.name)
    setEditingId(ct.id)
  }

  const applyPreview = () => {
    const root = document.documentElement
    for (const [key, val] of Object.entries(editingVars)) {
      root.style.setProperty(key, val)
    }
  }

  // Preview on edit
  useEffect(() => { applyPreview() }, [editingVars])

  const handleSave = async () => {
    if (!editName.trim()) return
    const id = editingId || `custom_${Date.now()}`
    const baseVars = theme.active === 'light' ? DEFAULT_COLORS.light : DEFAULT_COLORS.dark
    // Only save vars that differ from the base
    const diff: Record<string, string> = {}
    for (const [k, v] of Object.entries(editingVars)) {
      if (baseVars[k as keyof typeof baseVars] !== v) {
        diff[k] = v
      }
    }
    const ct: CustomTheme = { id, name: editName.trim(), vars: diff }
    await saveTheme(ct)
    await setTheme(id)
  }

  const handleSelectPreset = async (id: string) => {
    await setTheme(id)
    if (['dark', 'light', 'neo', 'neo-retro', 'midnight', 'sunset', 'forest', 'nord', 'synthwave'].includes(id)) {
      setEditingId(null)
      setEditingVars({})
      setEditName('')
    }
  }

  const tabs = ['Personalization', 'System', 'Analytics', 'Keybinds', 'Debug', 'About'] as const
  const [settingsTab, setSettingsTab] = useState<string>('Personalization')

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      {/* Tab bar */}
      <div className="settings-tabs">
        {tabs.map(t => (
          <button
            key={t}
            className={`settings-tab ${settingsTab === t ? 'active' : ''}`}
            onClick={() => setSettingsTab(t)}
          >{t}</button>
        ))}
      </div>

      <div className="settings-content">
        {/* ── Personalization Tab ──────────────────────────────── */}
        {settingsTab === 'Personalization' && (
          <>
            <div className="settings-section">
              <p className="settings-section-title">Theme Preset</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info">
                  <p className="settings-row-label">Guardian Mode</p>
                  <p className="settings-row-desc">Monitors startup registry and alerts when new programs add themselves to autostart.</p>
                </div>
                <button
                  className={`toggle-btn ${guardianEnabled ? 'active' : ''}`}
                  onClick={() => {
                    const next = !guardianEnabled
                    setGuardianEnabled(next)
                    invoke('set_guardian_enabled', { enabled: next }).catch(() => {})
                  }}
                >
                  <div className="toggle-thumb" />
                </button>
              </div>
              <div className="settings-row">
                  <div className="settings-row-info">
                    <p className="settings-row-label">Active Theme</p>
                    <p className="settings-row-desc">Choose a base or your saved custom theme.</p>
                  </div>
                  <div className="theme-preset-group">
                    <button
                      className={`theme-preset-btn ${theme.active === 'dark' ? 'active' : ''}`}
                      onClick={() => handleSelectPreset('dark')}
                    >Dark</button>
                    <button
                      className={`theme-preset-btn ${theme.active === 'light' ? 'active' : ''}`}
                      onClick={() => handleSelectPreset('light')}
                    >Light</button>
                    <button
                      className={`theme-preset-btn ${theme.active === 'neo' ? 'active' : ''}`}
                      onClick={() => handleSelectPreset('neo')}
                    >Neo</button>
                    <button
                      className={`theme-preset-btn ${theme.active === 'neo-retro' ? 'active' : ''}`}
                      onClick={() => handleSelectPreset('neo-retro')}
                    >Neo-Retro</button>
                    <button
                      className={`theme-preset-btn ${theme.active === 'midnight' ? 'active' : ''}`}
                      onClick={() => handleSelectPreset('midnight')}
                    >Midnight</button>
                    <button
                      className={`theme-preset-btn ${theme.active === 'sunset' ? 'active' : ''}`}
                      onClick={() => handleSelectPreset('sunset')}
                    >Sunset</button>
                    <button
                      className={`theme-preset-btn ${theme.active === 'forest' ? 'active' : ''}`}
                      onClick={() => handleSelectPreset('forest')}
                    >Forest</button>
                    <button
                      className={`theme-preset-btn ${theme.active === 'nord' ? 'active' : ''}`}
                      onClick={() => handleSelectPreset('nord')}
                    >Nord</button>
                    <button
                      className={`theme-preset-btn ${theme.active === 'synthwave' ? 'active' : ''}`}
                      onClick={() => handleSelectPreset('synthwave')}
                    >Synthwave</button>
                    {theme.custom_themes.map(ct => (
                      <button
                        key={ct.id}
                        className={`theme-preset-btn custom ${theme.active === ct.id ? 'active' : ''}`}
                        onClick={() => { handleSelectPreset(ct.id); startEditTheme(ct) }}
                      >{ct.name}</button>
                    ))}
                    <button className="theme-preset-btn new" onClick={startNewTheme}>+ New</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Theme Editor */}
            {(editingId !== null || (editingVars['--accent'] && Object.keys(editingVars).length > 0)) && (
              <div className="settings-section">
                <p className="settings-section-title">Edit Theme</p>
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <p className="settings-row-label">Theme Name</p>
                    </div>
                    <input
                      className="theme-name-input"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder="My Theme"
                    />
                  </div>
                  {CSS_VARS.map(cv => (
                    <div className="settings-row" key={cv.key}>
                      <div className="settings-row-info" style={{ flex: 'none', width: 120 }}>
                        <p className="settings-row-label">{cv.label}</p>
                      </div>
                      <ColorInput
                        label={cv.key}
                        value={editingVars[cv.key] || ''}
                        onChange={v => setEditingVars(prev => ({ ...prev, [cv.key]: v }))}
                      />
                    </div>
                  ))}
                  <div className="settings-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                    {editingId && (
                      <button className="detail-btn danger" onClick={async () => {
                        await deleteTheme(editingId)
                        setEditingId(null); setEditingVars({}); setEditName('')
                      }}>Delete</button>
                    )}
                    <button className="detail-btn" onClick={() => {
                      setEditingId(null); setEditingVars({}); setEditName('')
                    }}>Cancel</button>
                    <button className="detail-btn primary" onClick={handleSave}>
                      {editingId ? 'Update Theme' : 'Save Theme'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── System Tab ──────────────────────────────────────── */}
        {settingsTab === 'System' && (
          <div className="settings-section">
            <p className="settings-section-title">System</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info">
                  <p className="settings-row-label">reEverything Indexer</p>
                  <p className="settings-row-desc">Native file indexer for instant PC search.</p>
                </div>
                <span className={`settings-badge ${indexerReady ? 'ok' : 'pending'}`}>
                  {indexerReady ? '✓ Ready' : '⟳ Indexing…'}
                </span>
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <p className="settings-row-label">Package Managers</p>
                  <p className="settings-row-desc">Available managers for the Store.</p>
                </div>
                <div className="settings-managers">
                  {(['winget', 'scoop', 'choco'] as const).map(m => (
                    <span key={m} className={`settings-badge ${managers[m] ? 'ok' : 'missing'}`}>
                      {m}{managers[m] ? ' ✓' : ' ✕'}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Analytics Tab ───────────────────────────────────── */}
        {settingsTab === 'Analytics' && (
          <div className="settings-section">
            <p className="settings-section-title">Analytics</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info">
                  <p className="settings-row-label">Usage Tracking</p>
                  <p className="settings-row-desc">
                    Per-app metrics (uptime, CPU, memory, network) are recorded locally
                    while Hubify is running. Open the
                    Analytics sidebar tab for charts and detailed stats.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Keybinds Tab ────────────────────────────────────── */}
        {settingsTab === 'Keybinds' && (
          <div className="settings-section">
            <p className="settings-section-title">Keybinds</p>
            <p className="settings-section-desc">
              Assign global hotkeys to apps. Press the hotkey to focus the app if running, or launch it.
            </p>
            <div className="settings-card">
              {apps.length === 0 ? (
                <div className="settings-row">
                  <p className="settings-row-desc">Add apps first to assign hotkeys.</p>
                </div>
              ) : (
                <div className="hk-app-list">
                  {apps.map(app => (
                    <div key={app.id} className="hk-app-row">
                      <div className="hk-app-info">
                        {app.icon && <img className="hk-app-icon" src={app.icon} alt="" />}
                        <span className="hk-app-name">{app.name}</span>
                      </div>
                      <div className="hk-app-controls">
                        <HotkeyRecorder
                          value={app.hotkey}
                          onChange={v => setAppHotkey(app.id, v)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="settings-section-title" style={{ marginTop: 20 }}>Global Hotkeys</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info">
                  <p className="settings-row-label">Toggle Hubify Window</p>
                  <p className="settings-row-desc">Show or hide the main window from anywhere.</p>
                </div>
                <div className="hk-recorder hk-static">
                  <span className="hk-value">Ctrl+Shift+H</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Debug Tab ──────────────────────────────────────── */}
        {settingsTab === 'Debug' && (
          <div className="settings-section">
            <p className="settings-section-title">Debug</p>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-info">
                  <p className="settings-row-label">Reset Onboarding</p>
                  <p className="settings-row-desc">Show the first-run setup again on next launch.</p>
                </div>
                <button className="detail-btn danger" onClick={async () => {
                  await invoke('reset_setup_status')
                  window.location.reload()
                }}>
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── About Tab ───────────────────────────────────────── */}
        {settingsTab === 'About' && (
          <>
            <div className="settings-section">
              <p className="settings-section-title">About</p>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <p className="settings-row-label">Hubify</p>
                    <p className="settings-row-desc">All-in-one Windows app hub. Built with Tauri + Rust.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <p className="settings-section-title">Updates</p>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <p className="settings-row-label">Auto-check updates</p>
                    <p className="settings-row-desc">Check for new versions on startup.</p>
                  </div>
                  <button
                    className={`toggle-btn ${updateCheckEnabled ? 'active' : ''}`}
                    onClick={() => {
                      const next = !updateCheckEnabled
                      setUpdateCheckEnabled(next)
                      invoke('set_update_check_enabled', { enabled: next }).catch(() => {})
                    }}
                  >
                    <div className="toggle-thumb" />
                  </button>
                </div>
                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="settings-row-info">
                      <p className="settings-row-label">Check for updates</p>
                      <p className="settings-row-desc">
                        Current version: v{updateInfo?.current_version ?? '0.1.0'}
                      </p>
                    </div>
                    <button
                      className="detail-btn"
                      disabled={checkingUpdate}
                      onClick={async () => {
                        setCheckingUpdate(true)
                        setCheckResult(null)
                        try {
                          const info = await invoke<UpdateInfo>('check_for_update')
                          setUpdateInfo(info)
                          if (info.available) {
                            setCheckResult(`Update v${info.latest_version} available!`)
                          } else {
                            setCheckResult('You have the latest version.')
                          }
                        } catch {
                          setCheckResult('Failed to check for updates.')
                        } finally {
                          setCheckingUpdate(false)
                        }
                      }}
                    >
                      {checkingUpdate ? 'Checking…' : 'Check'}
                    </button>
                  </div>
                  {checkResult && (
                    <p style={{ fontSize: 11, color: !checkResult.includes('latest') && !checkResult.includes('Failed') ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {checkResult}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {updateInfo?.available && (
              <UpdateModal
                info={updateInfo}
                onClose={() => setUpdateInfo(null)}
                onUpdateInstalled={() => {}}
              />
            )}

            <div className="settings-section">
              <p className="settings-section-title">Support</p>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <p className="settings-row-label">Report a Bug</p>
                    <p className="settings-row-desc">
                      Open a GitHub issue with pre-filled system info.
                    </p>
                  </div>
                  <button className="detail-btn" onClick={() => invoke('report_bug')}>
                    Report Bug
                  </button>
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <p className="settings-row-label">GitHub Releases</p>
                    <p className="settings-row-desc">
                      Download the latest version manually.
                    </p>
                  </div>
                  <button className="detail-btn" onClick={async () => {
                    const { openUrl } = await import('@tauri-apps/plugin-opener')
                    await openUrl('https://github.com/ManHuman504/Hubify/releases/latest')
                  }}>
                    Open Releases
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
