import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useApps } from '../hooks/useApps'
import { layoutAwareMatch } from '../utils/keyboard'
import './Page.css'
import './Store.css'

interface WingetPackage {
  id: string
  name: string
  version: string
  source: string
}

interface InstallResult {
  success: boolean
  log: string
  exe_path: string | null
  icon: string | null
}

type InstallState = 'idle' | 'installing' | 'done' | 'error'

export default function Store() {
  const { apps, groups } = useApps()
  const installedIds = new Set(
    apps.map(a => a.name.toLowerCase())
  )

  const [wingetOk, setWingetOk] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WingetPackage[]>([])
  const [searching, setSearching] = useState(false)
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({})
  const [installLogs, setInstallLogs] = useState<Record<string, string>>({})
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Check winget availability on mount
  useEffect(() => {
    invoke<{ available: boolean }>('winget_check')
      .then(r => setWingetOk(r.available))
      .catch(() => setWingetOk(false))
  }, [])

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed || trimmed.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const list = await invoke<WingetPackage[]>('winget_search', { query: trimmed })
      setResults(list)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleQueryChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 420)
  }

  // Filter results client-side with layout-aware matching
  const visibleResults = query.trim().length >= 2
    ? results.filter(r => layoutAwareMatch(r.name, query) || layoutAwareMatch(r.id, query))
    : results

  const handleInstall = async (pkg: WingetPackage) => {
    setInstallStates(s => ({ ...s, [pkg.id]: 'installing' }))
    setExpandedLog(pkg.id)
    setInstallLogs(l => ({ ...l, [pkg.id]: 'Installing…' }))

    try {
      const result = await invoke<InstallResult>('winget_install', {
        id: pkg.id,
        name: pkg.name,
        groupId: selectedGroup || null,
      })
      setInstallStates(s => ({ ...s, [pkg.id]: result.success ? 'done' : 'error' }))
      setInstallLogs(l => ({ ...l, [pkg.id]: result.log || (result.success ? 'Installed successfully.' : 'Install failed.') }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setInstallStates(s => ({ ...s, [pkg.id]: 'error' }))
      setInstallLogs(l => ({ ...l, [pkg.id]: msg }))
    }
  }

  const isInstalled = (pkg: WingetPackage) =>
    installedIds.has(pkg.name.toLowerCase()) ||
    installStates[pkg.id] === 'done'

  // ── Render ─────────────────────────────────────────────────────────────────

  if (wingetOk === false) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Store</h1>
        </div>
        <div className="page-empty">
          <span className="empty-icon">◈</span>
          <p>winget not found</p>
          <p className="empty-hint">
            Install the{' '}
            <a
              href="https://apps.microsoft.com/detail/9nblggh4nns1"
              target="_blank"
              rel="noreferrer"
              className="store-link"
            >
              App Installer
            </a>{' '}
            from Microsoft Store to enable winget.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="header-row">
          <div>
            <h1 className="page-title">Store</h1>
            <p className="page-subtitle">
              {wingetOk === null ? 'Checking winget…' : 'Browse & install apps via winget'}
            </p>
          </div>
          {/* Group selector for auto-assign */}
          {groups.length > 0 && (
            <select
              className="store-group-select"
              value={selectedGroup}
              onChange={e => setSelectedGroup(e.target.value)}
              title="Add installed app to group"
            >
              <option value="">No group</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>

        {/* Search */}
        <div className="store-search-row">
          <div className="store-search-wrap">
            <span className="store-search-icon">⌕</span>
            <input
              ref={inputRef}
              className="store-search"
              placeholder="Search apps… (e.g. vlc, discord, notepad++)"
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              autoFocus
            />
            {searching && <span className="store-search-spinner" />}
            {query && !searching && (
              <button className="store-search-clear" onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }}>×</button>
            )}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {!query && results.length === 0 && (
        <div className="page-empty">
          <span className="empty-icon store-empty-icon">◈</span>
          <p>Search for any app</p>
          <p className="empty-hint">Uses winget — one click install, auto-added to your hub</p>
        </div>
      )}

      {/* No results */}
      {query.length >= 2 && !searching && visibleResults.length === 0 && (
        <div className="page-empty">
          <span className="empty-icon">⊘</span>
          <p>Nothing found for "{query}"</p>
          <p className="empty-hint">Try a different query</p>
        </div>
      )}

      {/* Results list */}
      {visibleResults.length > 0 && (
        <div className="store-list">
          {visibleResults.map(pkg => {
            const state = installStates[pkg.id] ?? 'idle'
            const installed = isInstalled(pkg)
            const log = installLogs[pkg.id]
            const logOpen = expandedLog === pkg.id && log

            return (
              <div key={pkg.id} className={`store-row ${installed ? 'installed' : ''}`}>
                <div className="store-row-icon">
                  <span className="store-row-icon-fallback">{pkg.name[0]?.toUpperCase()}</span>
                </div>

                <div className="store-row-info">
                  <p className="store-row-name">{pkg.name}</p>
                  <div className="store-row-meta">
                    <span className="store-tag">{pkg.id}</span>
                    {pkg.version && <span className="store-tag ver">v{pkg.version}</span>}
                    <span className="store-tag src">{pkg.source || 'winget'}</span>
                  </div>

                  {/* Install log */}
                  {logOpen && (
                    <pre className={`store-log ${state === 'error' ? 'error' : ''}`}>{log}</pre>
                  )}
                </div>

                <div className="store-row-actions">
                  {state === 'installing' && (
                    <div className="store-installing-wrap">
                      <span className="store-spinner" />
                      <span className="store-installing-label">Installing…</span>
                    </div>
                  )}

                  {state === 'done' && (
                    <span className="store-done-badge">✓ Installed</span>
                  )}

                  {state === 'error' && (
                    <button
                      className="store-btn-retry"
                      onClick={() => handleInstall(pkg)}
                    >↺ Retry</button>
                  )}

                  {state === 'idle' && !installed && (
                    <button
                      className="store-btn-install"
                      onClick={() => handleInstall(pkg)}
                    >
                      ↓ Install
                    </button>
                  )}

                  {state === 'idle' && installed && (
                    <span className="store-in-hub">✓ In hub</span>
                  )}

                  {/* Toggle log */}
                  {log && (
                    <button
                      className="store-log-toggle"
                      onClick={() => setExpandedLog(expandedLog === pkg.id ? null : pkg.id)}
                      title="Show install log"
                    >
                      {expandedLog === pkg.id ? '▲' : '▼'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
