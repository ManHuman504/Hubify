import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useApps } from '../hooks/useApps'
import { layoutAwareMatch } from '../utils/keyboard'
import { useGlobalSearchFocus } from '../hooks/useGlobalSearchFocus'
import './Page.css'
import './Store.css'

interface WingetPackage {
  id: string
  name: string
  version: string
  source: string
}

interface WingetPackageDetail {
  id: string
  name: string
  version: string
  source: string
  description: string | null
  homepage: string | null
  publisher: string | null
  tags: string[]
}

interface InstallResult {
  success: boolean
  log: string
  exe_path: string | null
  icon: string | null
}

type InstallState = 'idle' | 'installing' | 'done' | 'error'

interface ManagersAvailable {
  winget: boolean
  scoop: boolean
  choco: boolean
}

export default function Store() {
  const { apps, groups, refresh } = useApps()

  const [managers, setManagers] = useState<ManagersAvailable | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WingetPackage[]>([])
  const [searching, setSearching] = useState(false)
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({})
  const [installLogs, setInstallLogs] = useState<Record<string, string>>({})
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  
  // Filtering & Sorting
  const [selectedSource, setSelectedSource] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'relevance' | 'name'>('relevance')

  const [selectedApp, setSelectedApp] = useState<WingetPackage | null>(null)
  const [appDetail, setAppDetail] = useState<WingetPackageDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [wingetInstalled, setWingetInstalled] = useState<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useGlobalSearchFocus(inputRef as React.RefObject<HTMLInputElement>)

  // Check availability and installed packages on mount
  useEffect(() => {
    invoke<ManagersAvailable>('winget_check')
      .then(r => setManagers(r))
      .catch(() => setManagers({ winget: false, scoop: false, choco: false }))

    invoke<any[]>('winget_list_installed')
      .then(list => setWingetInstalled(new Set(list.map(p => p.id.toLowerCase()))))
      .catch(() => {})
  }, [])

  // Sync with global apps list when it changes
  useEffect(() => {
    // If an app was uninstalled from Tools, we should clear its 'done' state here
    // so the Install button reappears.
    setInstallStates(prev => {
      const next = { ...prev }
      let changed = false
      for (const id in next) {
        if (next[id] === 'done') {
           // If it's no longer in the apps list, it might have been uninstalled
           const pkg = results.find(r => r.id === id)
           if (pkg && !apps.some(a => a.name.toLowerCase() === pkg.name.toLowerCase())) {
             delete next[id]
             changed = true
           }
        }
      }
      return changed ? next : prev
    })
  }, [apps, results])

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed || trimmed.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      // 1. Fetch Winget from api.winget.run for richer metadata
      let wingetRes: any = { Packages: [] }
      if (managers?.winget) {
        try {
          const req = await fetch(`https://api.winget.run/v2/packages?query=${encodeURIComponent(trimmed)}`)
          wingetRes = await req.json()
        } catch (e) {
          console.warn('Failed to fetch from winget.run', e)
        }
      }

      const wingetList = (wingetRes.Packages || []).map((p: any) => ({
        id: p.Id,
        name: p.Latest?.Name || p.Id,
        version: p.Versions?.[0] || '',
        source: 'winget',
        homepage: p.Latest?.Homepage || null,
        description: p.Latest?.Description || null,
        publisher: p.Latest?.Publisher || null,
        tags: p.Latest?.Tags || [],
        searchScore: p.SearchScore || 0
      }))

      // 2. Fetch Scoop/Choco from backend
      const cliList = await invoke<WingetPackage[]>('search_other_managers', { query: trimmed })

      // Merge
      let merged = [...wingetList, ...cliList]

      // Take top 30
      setResults(merged.slice(0, 30))
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [managers])

  const handleQueryChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 420)
  }

  // Filter & Sort results client-side
  let visibleResults = query.trim().length >= 2
    ? results.filter(r => layoutAwareMatch(r.name, query) || layoutAwareMatch(r.id, query))
    : results

  if (selectedSource !== 'all') {
    visibleResults = visibleResults.filter(r => r.source === selectedSource)
  }

  visibleResults.sort((a, b) => {
    if (sortBy === 'name') {
      return a.name.localeCompare(b.name)
    } else {
      // Relevance sort
      const lower = query.toLowerCase()
      const aName = a.name.toLowerCase()
      const bName = b.name.toLowerCase()

      const aNameExact = aName === lower
      const bNameExact = bName === lower
      if (aNameExact && !bNameExact) return -1
      if (!aNameExact && bNameExact) return 1

      const queryNoSpace = lower.replace(/\s+/g, '')
      const aOfficial = a.id.toLowerCase().includes(queryNoSpace) && a.id.includes('.')
      const bOfficial = b.id.toLowerCase().includes(queryNoSpace) && b.id.includes('.')
      
      if (aOfficial && !bOfficial) return -1
      if (!aOfficial && bOfficial) return 1

      const aScore = (a as any).searchScore || 0
      const bScore = (b as any).searchScore || 0
      if (aScore !== bScore) return bScore - aScore
      
      return a.name.length - b.name.length
    }
  })

  const handleInstall = async (pkg: WingetPackage | WingetPackageDetail, fallbackIconUrl: string | null = null) => {
    setInstallStates(s => ({ ...s, [pkg.id]: 'installing' }))
    setInstallLogs(l => ({ ...l, [pkg.id]: 'Installing…' }))

    try {
      const result = await invoke<InstallResult>('winget_install', {
        id: pkg.id,
        name: pkg.name,
        groupId: selectedGroup || null,
        fallbackIcon: fallbackIconUrl,
      })
      if (result.success) {
        setInstallStates(s => ({ ...s, [pkg.id]: 'done' }))
        setInstallLogs(l => ({ ...l, [pkg.id]: 'Installed successfully.' }))
        setWingetInstalled(prev => new Set(prev).add(pkg.id.toLowerCase()))
        await refresh()
      } else {
        const logLower = result.log.toLowerCase()
        if (logLower.includes('already installed') || logLower.includes('another installation')) {
          // "Already installed" but backend couldn't register — show error
          setInstallStates(s => ({ ...s, [pkg.id]: 'error' }))
          setInstallLogs(l => ({ ...l, [pkg.id]: 'Already installed on this PC, but Hubify could not find the app. Try adding it manually via Home → Add.' }))
        } else {
          setInstallStates(s => ({ ...s, [pkg.id]: 'error' }))
          setInstallLogs(l => ({ ...l, [pkg.id]: result.log || 'Install failed.' }))
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setInstallStates(s => ({ ...s, [pkg.id]: 'error' }))
      setInstallLogs(l => ({ ...l, [pkg.id]: msg }))
    }
  }

  const isInstalled = (pkg: { name: string, id: string }) => {
    if (installStates[pkg.id] === 'done') return true
    if (apps.some(a => a.name.toLowerCase() === pkg.name.toLowerCase())) return true
    if (wingetInstalled.has(pkg.id.toLowerCase())) return true
    return false
  }

  const handleSelectApp = async (pkg: WingetPackage) => {
    setSelectedApp(pkg)
    setAppDetail(null)

    // If we already have the rich data (e.g. from Winget API)
    if ((pkg as any).description || (pkg as any).homepage) {
      setAppDetail(pkg as WingetPackageDetail)
      return
    }

    setLoadingDetail(true)
    try {
      const detail = await invoke<WingetPackageDetail | null>('winget_show', { id: pkg.id })
      setAppDetail(detail)
    } catch {
      // Fallback
    } finally {
      setLoadingDetail(false)
    }
  }

  const hasAnyManager = managers?.winget || managers?.scoop || managers?.choco;

  if (managers && !hasAnyManager) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Store</h1>
        </div>
        <div className="page-empty">
          <span className="empty-icon">◈</span>
          <p>No package managers found</p>
          <p className="empty-hint">
            Install Winget, Scoop, or Chocolatey to use the store.
          </p>
        </div>
      </div>
    )
  }

  if (selectedApp) {
    const pkg = appDetail || (selectedApp as unknown as WingetPackageDetail)
    const state = installStates[pkg.id] ?? 'idle'
    const installed = isInstalled(pkg)
    const log = installLogs[pkg.id]
    
    let iconUrl = null
    if (pkg.homepage) {
       try {
         const url = new URL(pkg.homepage)
         iconUrl = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=128`
       } catch {}
    }

    return (
      <div className="page store-detail-page">
        <div className="store-detail-header">
          <button className="btn-back" onClick={() => setSelectedApp(null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            Back
          </button>
        </div>

        <div className="store-detail-content">
          <div className="store-detail-hero">
            <div className="store-detail-icon">
              {iconUrl ? (
                <img src={iconUrl} alt={pkg.name} />
              ) : (
                <span>{pkg.name[0]?.toUpperCase()}</span>
              )}
            </div>
            <div className="store-detail-title">
              <h1>{pkg.name}</h1>
              <div className="store-detail-meta-tags">
                <span className="store-tag ver">v{pkg.version}</span>
                <span className="store-tag src">{pkg.source || 'winget'}</span>
                {pkg.publisher && <span className="store-tag pub">{pkg.publisher}</span>}
              </div>
            </div>
            <div className="store-detail-actions">
              {state === 'installing' && (
                <div className="store-installing-wrap">
                  <span className="store-spinner" />
                  <span className="store-installing-label">Installing…</span>
                </div>
              )}
              {state === 'done' && <span className="store-done-badge">✓ Installed</span>}
              {state === 'idle' && installed && <span className="store-in-hub">✓ In hub</span>}
              {state === 'idle' && !installed && (
                <button className="btn-primary store-btn-hero" onClick={() => handleInstall(pkg, iconUrl)}>
                  ↓ Install
                </button>
              )}
              {state === 'error' && (
                <button className="btn-primary store-btn-hero error" onClick={() => handleInstall(pkg, iconUrl)}>
                  ↺ Retry Install
                </button>
              )}
            </div>
          </div>

          {loadingDetail && (
            <div className="store-detail-loading">
              <span className="store-spinner" /> Loading details…
            </div>
          )}

          {(!loadingDetail) && (
            <div className="store-detail-body">
              {pkg.description && (
                <div className="store-detail-section">
                  <h3>Description</h3>
                  <p className="store-detail-desc">{pkg.description}</p>
                </div>
              )}
              
              {pkg.tags && pkg.tags.length > 0 && (
                <div className="store-detail-section">
                  <h3>Tags</h3>
                  <div className="store-detail-tags-list">
                    {pkg.tags.map(t => (
                      <span key={t} className="store-tag subtle">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {pkg.homepage && (
                <div className="store-detail-section">
                  <h3>Links</h3>
                  <a href={pkg.homepage} target="_blank" rel="noreferrer" className="store-link">
                    {pkg.homepage}
                  </a>
                </div>
              )}
            </div>
          )}

          {log && (
            <div className="store-detail-log">
              <h3>Install Log</h3>
              <pre className={state === 'error' ? 'error' : ''}>{log}</pre>
            </div>
          )}
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
              {managers === null ? 'Checking package managers…' : 'Browse & install apps'}
            </p>
          </div>
          
          <div className="store-filters">
            {/* Sort Dropdown */}
            <select
              className="store-group-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
            >
              <option value="relevance">Best Match</option>
              <option value="name">Name (A-Z)</option>
            </select>

            {/* Source Dropdown */}
            <select
              className="store-group-select"
              value={selectedSource}
              onChange={e => setSelectedSource(e.target.value)}
            >
              <option value="all">All Sources</option>
              {managers?.winget && <option value="winget">Winget</option>}
              {managers?.scoop && <option value="scoop">Scoop</option>}
              {managers?.choco && <option value="choco">Chocolatey</option>}
            </select>

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
          <p className="empty-hint">Uses Winget, Scoop, and Chocolatey — one click install, auto-added to your hub</p>
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
            
            let listIconUrl = null
            if ((pkg as any).homepage) {
               try {
                 const url = new URL((pkg as any).homepage)
                 listIconUrl = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`
               } catch {}
            }

            return (
              <div key={pkg.id} className={`store-row ${installed ? 'installed' : ''}`} onClick={() => handleSelectApp(pkg)}>
                <div className="store-row-icon">
                  {listIconUrl ? (
                    <img src={listIconUrl} alt={pkg.name} className="store-row-icon-img" />
                  ) : (
                    <span className="store-row-icon-fallback">{pkg.name[0]?.toUpperCase()}</span>
                  )}
                </div>

                <div className="store-row-info">
                  <p className="store-row-name">{pkg.name}</p>
                  <div className="store-row-meta">
                    <span className="store-tag">{pkg.id}</span>
                    {pkg.version && <span className="store-tag ver">v{pkg.version}</span>}
                  </div>
                </div>

                <div className="store-row-actions" onClick={e => e.stopPropagation()}>
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
                      onClick={() => handleInstall(pkg, listIconUrl)}
                    >↺ Retry</button>
                  )}

                  {state === 'idle' && !installed && (
                    <button
                      className="store-btn-install"
                      onClick={() => handleInstall(pkg, listIconUrl)}
                    >
                      ↓ Install
                    </button>
                  )}

                  {state === 'idle' && installed && (
                    <span className="store-in-hub">✓ In hub</span>
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
