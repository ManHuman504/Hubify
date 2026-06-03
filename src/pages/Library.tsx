import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useApps } from '../hooks/useApps'
import type { DetectedApp, Group } from '../hooks/useApps'
import { layoutAwareMatch } from '../utils/keyboard'
import './Page.css'
import './Library.css'

const STORAGE_KEY = 'hubify_scanned'

interface LibraryProps {
  onScannedChange?: (list: DetectedApp[]) => void
}

interface GroupPickerProps {
  groups: Group[]
  app: DetectedApp
  addedPaths: Set<string>
  onAdd: (det: DetectedApp, groupId: string | null) => Promise<void>
  onClose: () => void
}

function GroupPicker({ groups, app, addedPaths, onAdd, onClose }: GroupPickerProps) {
  const [groupId, setGroupId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const isAdded = addedPaths.has(app.path.toLowerCase())

  const handle = async () => {
    setLoading(true)
    try {
      await onAdd(app, groupId || null)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="lib-picker-backdrop" onClick={onClose}>
      <div className="lib-picker" onClick={e => e.stopPropagation()}>
        <div className="lib-picker-icon">
          {app.icon
            ? <img src={app.icon} alt={app.name} />
            : <span>{app.name[0]}</span>
          }
        </div>
        <p className="lib-picker-name">{app.name}</p>
        {groups.length > 0 && (
          <div className="lib-picker-field">
            <label>Add to group</label>
            <select
              className="lib-picker-select"
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
            >
              <option value="">— No group —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}
        <div className="lib-picker-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-add" onClick={handle} disabled={loading || isAdded}>
            {loading ? 'Adding…' : isAdded ? '✓ Already added' : '+ Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Library({ onScannedChange }: LibraryProps) {
  const { apps, groups, addApp } = useApps()
  const addedPaths = new Set(apps.map(a => a.path.toLowerCase()))

  const [detected, setDetected] = useState<DetectedApp[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [search, setSearch] = useState('')
  const [picking, setPicking] = useState<DetectedApp | null>(null)

  // Persist to localStorage and notify parent
  useEffect(() => {
    if (detected.length > 0) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(detected)) } catch {}
    }
    onScannedChange?.(detected)
  }, [detected])

  const scan = useCallback(async () => {
    setLoading(true)
    setProgress(0)

    // Animate progress while waiting
    const timer = setInterval(() => {
      setProgress(p => {
        if (p >= 90) { clearInterval(timer); return 90 }
        return p + Math.random() * 12
      })
    }, 180)

    try {
      const list = await invoke<DetectedApp[]>('scan_installed_apps')
      clearInterval(timer)
      setProgress(100)
      setDetected(list)
    } catch {
      clearInterval(timer)
    } finally {
      setTimeout(() => { setLoading(false); setProgress(0) }, 400)
    }
  }, [])

  const handleAdd = async (det: DetectedApp, groupId: string | null) => {
    await addApp(det.path, det.name, groupId)
  }

  const filtered = detected.filter(d => layoutAwareMatch(d.name, search))

  return (
    <div className="page">
      <div className="page-header">
        <div className="header-row">
          <div>
            <h1 className="page-title">Library</h1>
            <p className="page-subtitle">
              {detected.length > 0
                ? `${detected.length} programs found`
                : 'Auto-detect installed programs'}
            </p>
          </div>
          <button className="btn-primary" onClick={scan} disabled={loading}>
            {loading ? 'Scanning…' : detected.length > 0 ? '⟳ Rescan' : '⟳ Scan'}
          </button>
        </div>

        {/* Progress bar */}
        {loading && (
          <div className="lib-progress-wrap">
            <div className="lib-progress-bar" style={{ width: `${progress}%` }} />
            <span className="lib-progress-label">
              Scanning registry… {progress < 100 ? `${Math.floor(progress)}%` : 'Done'}
            </span>
          </div>
        )}

        {/* Search */}
        {detected.length > 0 && !loading && (
          <div className="library-search-row">
            <input
              className="library-search"
              placeholder="Search programs…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className="library-count">
              {search ? `${filtered.length} of ${detected.length}` : `${detected.length} found`}
            </span>
          </div>
        )}
      </div>

      {/* Empty state */}
      {detected.length === 0 && !loading && (
        <div className="page-empty">
          <span className="empty-icon">⊞</span>
          <p>Click "Scan" to find installed programs</p>
          <p className="empty-hint">Reads Windows registry — results are saved between sessions</p>
        </div>
      )}

      {/* Scanning placeholder */}
      {loading && detected.length === 0 && (
        <div className="page-empty">
          <span className="library-spinner" />
          <p>Scanning registry…</p>
          <p className="empty-hint">This may take a few seconds</p>
        </div>
      )}

      {/* Grid */}
      {!loading && filtered.length > 0 && (
        <div className="lib-grid">
          {filtered.map(det => {
            const key = det.path.toLowerCase()
            const isAdded = addedPaths.has(key)

            return (
              <div
                key={det.path}
                className={`lib-card ${isAdded ? 'lib-card-added' : ''}`}
                onClick={() => !isAdded && setPicking(det)}
                title={isAdded ? 'Already in your hub' : `Click to add ${det.name}`}
              >
                <div className="lib-card-icon">
                  {det.icon
                    ? <img src={det.icon} alt={det.name} draggable={false} />
                    : <span className="lib-card-fallback">{det.name[0]}</span>
                  }
                </div>
                <div className="lib-card-overlay">
                  <p className="lib-card-name">{det.name}</p>
                  {isAdded && <span className="lib-card-added-badge">✓</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Group picker modal */}
      {picking && (
        <GroupPicker
          groups={groups}
          app={picking}
          addedPaths={addedPaths}
          onAdd={handleAdd}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
