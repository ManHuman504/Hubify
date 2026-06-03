import { useState, useEffect, useRef } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import type { Group, DetectedApp } from '../hooks/useApps'
import { layoutAwareMatch } from '../utils/keyboard'
import './AddAppDialog.css'

interface Props {
  groups?: Group[]
  scanned?: DetectedApp[]         // already-scanned list from Library
  onAdd: (path: string, name?: string, groupId?: string | null) => Promise<void>
  onClose: () => void
}

type Mode = 'search' | 'manual'

export default function AddAppDialog({ groups = [], scanned = [], onAdd, onClose }: Props) {
  const [mode, setMode] = useState<Mode>(scanned.length > 0 ? 'search' : 'manual')

  // Search mode
  const [query, setQuery] = useState('')
  const [selectedDet, setSelectedDet] = useState<DetectedApp | null>(null)
  const [detGroupId, setDetGroupId] = useState('')

  // Manual mode
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [manGroupId, setManGroupId] = useState('')
  const [loadingIcon, setLoadingIcon] = useState(false)
  const [webIcon, setWebIcon] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'search') searchRef.current?.focus()
  }, [mode])

  // ── Icon from web ────────────────────────────────────────────────────────
  const fetchWebIcon = async (appName: string) => {
    if (!appName.trim()) return
    setLoadingIcon(true)
    setWebIcon(null)
    try {
      // Try clearbit logo API (works for well-known apps via their domain)
      // We build a best-guess domain from the app name
      const slug = appName.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
      const candidates = [
        `https://logo.clearbit.com/${slug}.com`,
        `https://logo.clearbit.com/${slug}.io`,
        `https://logo.clearbit.com/${slug}.net`,
      ]
      for (const url of candidates) {
        const res = await fetch(url)
        if (res.ok) {
          const blob = await res.blob()
          const reader = new FileReader()
          const dataUrl = await new Promise<string>(resolve => {
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
          setWebIcon(dataUrl)
          setLoadingIcon(false)
          return
        }
      }
    } catch {
      // silent
    }
    setLoadingIcon(false)
  }

  // ── Add from search ──────────────────────────────────────────────────────
  const handleAddDetected = async (det: DetectedApp) => {
    setLoading(true)
    try {
      await onAdd(det.path, det.name, detGroupId || null)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  // ── Add manual ───────────────────────────────────────────────────────────
  const pickFile = async () => {
    const selected = await open({
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      multiple: false,
    })
    if (typeof selected === 'string') {
      setPath(selected)
      if (!name) {
        const parts = selected.replace(/\\/g, '/').split('/')
        const stem = parts[parts.length - 1].replace('.exe', '')
        setName(stem)
      }
    }
  }

  const handleAddManual = async () => {
    if (!path) return
    setLoading(true)
    try {
      await onAdd(path, name || undefined, manGroupId || null)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  // ── Filtered list ────────────────────────────────────────────────────────
  const filtered = scanned.filter(d => layoutAwareMatch(d.name, query)).slice(0, 80)

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog add-dialog" onClick={e => e.stopPropagation()}>
        <div className="add-dialog-header">
          <h2 className="dialog-title">Add Application</h2>
          <div className="add-dialog-tabs">
            {scanned.length > 0 && (
              <button
                className={`add-tab ${mode === 'search' ? 'active' : ''}`}
                onClick={() => setMode('search')}
              >
                From library
              </button>
            )}
            <button
              className={`add-tab ${mode === 'manual' ? 'active' : ''}`}
              onClick={() => setMode('manual')}
            >
              Manual
            </button>
          </div>
        </div>

        {/* ── Search mode ── */}
        {mode === 'search' && (
          <div className="add-search-mode">
            <input
              ref={searchRef}
              className="add-search-input"
              placeholder="Search installed programs…"
              value={query}
              onChange={e => { setQuery(e.target.value); setSelectedDet(null) }}
            />

            {selectedDet ? (
              <div className="add-det-confirm">
                <div className="add-det-confirm-icon">
                  {selectedDet.icon
                    ? <img src={selectedDet.icon} alt={selectedDet.name} />
                    : <span>{selectedDet.name[0]}</span>
                  }
                </div>
                <div className="add-det-confirm-info">
                  <p className="add-det-name">{selectedDet.name}</p>
                  <p className="add-det-path">{selectedDet.path}</p>
                </div>
                <button className="add-det-back" onClick={() => setSelectedDet(null)}>✕</button>
              </div>
            ) : (
              <div className="add-results-list">
                {filtered.length === 0 && query.length > 0 && (
                  <p className="add-results-empty">Nothing found</p>
                )}
                {filtered.length === 0 && query.length === 0 && (
                  <p className="add-results-empty">Start typing to search…</p>
                )}
                {filtered.map(det => (
                  <button
                    key={det.path}
                    className="add-result-row"
                    onClick={() => setSelectedDet(det)}
                  >
                    <div className="add-result-icon">
                      {det.icon
                        ? <img src={det.icon} alt={det.name} draggable={false} />
                        : <span>{det.name[0]}</span>
                      }
                    </div>
                    <div className="add-result-info">
                      <p className="add-result-name">{det.name}</p>
                      <p className="add-result-path">{det.path}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {selectedDet && groups.length > 0 && (
              <div className="dialog-field">
                <label>Group <span>(optional)</span></label>
                <select className="dialog-select" value={detGroupId} onChange={e => setDetGroupId(e.target.value)}>
                  <option value="">— No group —</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}

            <div className="dialog-footer">
              <button className="btn-cancel" onClick={onClose}>Cancel</button>
              <button
                className="btn-add"
                onClick={() => selectedDet && handleAddDetected(selectedDet)}
                disabled={!selectedDet || loading}
              >
                {loading ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {/* ── Manual mode ── */}
        {mode === 'manual' && (
          <div className="add-manual-mode">
            <div className="dialog-field">
              <label>Path</label>
              <div className="path-row">
                <input
                  value={path}
                  onChange={e => setPath(e.target.value)}
                  placeholder="C:\Program Files\..."
                  spellCheck={false}
                />
                <button onClick={pickFile}>Browse</button>
              </div>
            </div>

            <div className="dialog-field">
              <label>Name <span>(optional)</span></label>
              <div className="name-row">
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Auto-detected from filename"
                />
                <button
                  className="btn-icon-web"
                  title="Fetch icon from web"
                  disabled={!name.trim() || loadingIcon}
                  onClick={() => fetchWebIcon(name)}
                >
                  {loadingIcon ? '…' : '🌐'}
                </button>
              </div>
              {webIcon && (
                <div className="web-icon-preview">
                  <img src={webIcon} alt="web icon" />
                  <span className="web-icon-label">Icon found online — will be used on add</span>
                </div>
              )}
            </div>

            {groups.length > 0 && (
              <div className="dialog-field">
                <label>Group <span>(optional)</span></label>
                <select className="dialog-select" value={manGroupId} onChange={e => setManGroupId(e.target.value)}>
                  <option value="">— No group —</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}

            <div className="dialog-footer">
              <button className="btn-cancel" onClick={onClose}>Cancel</button>
              <button className="btn-add" onClick={handleAddManual} disabled={!path || loading}>
                {loading ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
