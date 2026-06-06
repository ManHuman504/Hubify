import { useState, useEffect, useRef } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import type { App, Group, DetectedApp } from '../hooks/useApps'
import { layoutAwareMatch } from '../utils/keyboard'
import './AddAppDialog.css'

interface Props {
  groups?: Group[]
  scanned?: DetectedApp[]
  apps?: App[]
  currentGroupId?: string | null
  onAdd: (path: string, name?: string, groupId?: string | null) => Promise<void>
  onAddMany: (items: { path: string; name?: string }[], groupId?: string | null) => Promise<void>
  onClose: () => void
}

const ICONS = {
  folder: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  globe: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  checkSmall: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
}

export default function AddAppDialog({ groups = [], scanned = [], apps = [], currentGroupId, onAdd, onAddMany, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [manGroupId, setManGroupId] = useState(currentGroupId ?? '')
  const [loadingIcon, setLoadingIcon] = useState(false)
  const [webIcon, setWebIcon] = useState<string | null>(null)

  const [addingPaths, setAddingPaths] = useState<Set<string>>(new Set())
  const [addingManual, setAddingManual] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const fetchWebIcon = async (appName: string) => {
    if (!appName.trim()) return
    setLoadingIcon(true)
    setWebIcon(null)
    try {
      const slug = appName.toLowerCase().replace(/[^a-z0-9]/g, '')
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

  const toggleSelect = (p: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  const handleAddSingle = async (det: DetectedApp) => {
    setAddingPaths(prev => new Set(prev).add(det.path))
    try {
      await onAdd(det.path, det.name, currentGroupId ?? null)
      onClose()
    } finally {
      setAddingPaths(prev => { const n = new Set(prev); n.delete(det.path); return n })
    }
  }

  const handleAddMany = async () => {
    if (selectedPaths.size === 0) return
    setAddingPaths(new Set(selectedPaths))
    try {
      const items = filtered.filter(d => selectedPaths.has(d.path))
      await onAddMany(items.map(d => ({ path: d.path, name: d.name })), currentGroupId ?? null)
      onClose()
    } finally {
      setAddingPaths(new Set())
    }
  }

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
    setAddingManual(true)
    try {
      await onAdd(path, name || undefined, (currentGroupId ?? manGroupId) || null)
      onClose()
    } finally {
      setAddingManual(false)
    }
  }

  const currentGroupPaths = new Set(
    apps
      .filter(a => currentGroupId ? a.group_id === currentGroupId : a.group_id === null)
      .map(a => a.path.toLowerCase())
  )

  const allKnown = [
    ...apps
      .filter(a => currentGroupId ? a.group_id !== currentGroupId : a.group_id !== null)
      .map(a => ({ name: a.name, path: a.path, icon: a.icon ?? null })),
    ...scanned.filter(d => !currentGroupPaths.has(d.path.toLowerCase())),
  ]

  const filtered = allKnown
    .filter(d => layoutAwareMatch(d.name, query))
    .slice(0, 100)

  const allFilteredSelectable = filtered
  const allFilteredSelected = allFilteredSelectable.length > 0 && allFilteredSelectable.every(d => selectedPaths.has(d.path))

  useEffect(() => {
    setSelectedPaths(new Set())
  }, [query])

  const hasScanned = scanned.length > 0

  return (
    <div className="add-backdrop" onClick={onClose}>
      <div className="add-sheet" onClick={e => e.stopPropagation()}>
        <div className="add-sheet-header">
          <h2 className="add-sheet-title">
            Add Application
            {currentGroupId && <span className="add-sheet-hint"> → {groups.find(g => g.id === currentGroupId)?.name ?? 'selected group'}</span>}
          </h2>
        </div>

        <div className="add-sheet-body">
          {hasScanned && (
            <div className="add-search-section">
              <input
                ref={searchRef}
                className="add-search-input"
                placeholder="Search installed programs…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />

              {filtered.length > 0 && (
                <div className="add-batch-bar">
                  <label className="add-check-label">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={() => {
                        if (allFilteredSelected) setSelectedPaths(new Set())
                        else setSelectedPaths(new Set(allFilteredSelectable.map(d => d.path)))
                      }}
                    />
                    <span>Select all ({allFilteredSelectable.length})</span>
                  </label>
                  {selectedPaths.size > 0 && (
                    <button className="add-batch-btn" onClick={handleAddMany}>
                      Add {selectedPaths.size}
                    </button>
                  )}
                </div>
              )}

              <div className="add-scanned-list">
                {filtered.length === 0 && (
                  <p className="add-empty">{query ? 'Nothing found' : 'Start typing to search…'}</p>
                )}
                {filtered.map(det => {
                  const selected = selectedPaths.has(det.path)
                  const adding = addingPaths.has(det.path)
                  return (
                    <div
                      key={det.path}
                      className={`add-scanned-row ${selected ? 'selected' : ''}`}
                    >
                      <div className="add-scanned-check" onClick={() => toggleSelect(det.path)}>
                        {selected ? ICONS.checkSmall : <span className="add-check-empty" />}
                      </div>
                      <div className="add-scanned-icon" onClick={() => toggleSelect(det.path)}>
                        {det.icon
                          ? <img src={det.icon} alt={det.name} draggable={false} />
                          : <span className="add-scanned-icon-fallback">{det.name[0]}</span>
                        }
                      </div>
                      <div className="add-scanned-info" onClick={() => toggleSelect(det.path)}>
                        <p className="add-scanned-name">{det.name}</p>
                        <p className="add-scanned-path">{det.path}</p>
                      </div>
                      <button
                        className="add-scanned-add"
                        onClick={() => handleAddSingle(det)}
                        disabled={adding}
                      >
                        {adding ? '…' : ICONS.plus}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="add-manual-section">
            <div className="add-manual-label">Add manually</div>
            <div className="add-manual-form">
              <div className="add-manual-row">
                <div className="add-manual-field">
                  <input
                    value={path}
                    onChange={e => setPath(e.target.value)}
                    placeholder="Path to .exe"
                    spellCheck={false}
                  />
                </div>
                <button className="add-btn-icon" onClick={pickFile} title="Browse">{ICONS.folder}</button>
              </div>
              <div className="add-manual-row">
                <div className="add-manual-field">
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="App name (auto from filename)"
                  />
                </div>
                <button
                  className="add-btn-icon"
                  title="Fetch icon from web"
                  disabled={!name.trim() || loadingIcon}
                  onClick={() => fetchWebIcon(name)}
                >
                  {loadingIcon ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>…</span> : ICONS.globe}
                </button>
              </div>
              {webIcon && (
                <div className="add-web-icon">
                  <img src={webIcon} alt="web icon" />
                  <span>Icon found online</span>
                </div>
              )}
              {!currentGroupId && groups.length > 0 && (
                <select className="add-manual-select" value={manGroupId} onChange={e => setManGroupId(e.target.value)}>
                  <option value="">— No group —</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
              {currentGroupId && (
                <div className="add-manual-group">Group: {groups.find(g => g.id === currentGroupId)?.name ?? 'Selected group'}</div>
              )}
            </div>
            <button className="add-manual-add" onClick={handleAddManual} disabled={!path || addingManual}>
              {addingManual ? 'Adding…' : ICONS.plus}
              <span>Add to library</span>
            </button>
          </div>
        </div>

        <div className="add-sheet-footer">
          <button className="add-cancel" onClick={onClose}>Cancel</button>
          {hasScanned && selectedPaths.size > 0 && (
            <button className="add-done" onClick={handleAddMany}>
              Add {selectedPaths.size} app{selectedPaths.size > 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
