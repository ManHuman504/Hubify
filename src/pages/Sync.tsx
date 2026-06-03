import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './Page.css'
import './Sync.css'

interface SyncToken {
  email: string
  token: string
}

interface AuthResponse {
  ok: boolean
  token: string
}

interface IgnoredList {
  ignored: string[]
}

interface SyncAppEntry {
  name: string
  path: string
  group: string | null
  hotkey: string | null
}
interface SyncGroupEntry {
  id: string
  name: string
  color: string | null
}
interface SyncThemeEntry {
  active: string
  custom_themes: any[]
}
interface SyncStatEntry {
  path: string
  total_minutes: number
}
interface SyncRemote {
  apps: SyncAppEntry[]
  groups: SyncGroupEntry[]
  theme: SyncThemeEntry
  stats: SyncStatEntry[]
}

type AuthTab = 'login' | 'register'

export default function Sync() {
  const [token, setToken] = useState<SyncToken | null>(null)
  const [authTab, setAuthTab] = useState<AuthTab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const [ignored, setIgnored] = useState<string[]>([])
  const [newIgnored, setNewIgnored] = useState('')

  const [pulled, setPulled] = useState<SyncRemote | null>(null)

  useEffect(() => {
    invoke<SyncToken | null>('sync_get_token').then(t => {
      if (t) setToken(t)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (token) {
      invoke<IgnoredList>('sync_get_ignored').then(r => setIgnored(r.ignored)).catch(() => {})
    }
  }, [token])

  const showStatus = (ok: boolean, msg: string) => {
    setStatus({ ok, msg })
    setTimeout(() => setStatus(null), 4000)
  }

  const handleAuth = async () => {
    if (!email || !password) { showStatus(false, 'Fill in email and password'); return }
    setLoading(true)
    try {
      const cmd = authTab === 'login' ? 'sync_login' : 'sync_register'
      const resp = await invoke<AuthResponse>(cmd, { email, password })
      if (resp.ok) {
        setToken({ email, token: resp.token })
        showStatus(true, authTab === 'login' ? 'Logged in' : 'Registered')
        setPassword('')
      } else {
        showStatus(false, 'Server rejected the request')
      }
    } catch (e: any) {
      showStatus(false, typeof e === 'string' ? e : e?.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await invoke('sync_logout')
      setToken(null)
      setIgnored([])
      setPulled(null)
      showStatus(true, 'Logged out')
    } catch (e: any) {
      showStatus(false, 'Logout failed')
    }
  }

  const handlePush = async () => {
    setLoading(true)
    try {
      await invoke('sync_push')
      showStatus(true, 'Pushed to cloud')
    } catch (e: any) {
      showStatus(false, typeof e === 'string' ? e : e?.message || 'Push failed')
    } finally {
      setLoading(false)
    }
  }

  const handlePull = async () => {
    setLoading(true)
    try {
      const remote = await invoke<SyncRemote>('sync_pull')
      setPulled(remote)
      showStatus(true, `Pulled: ${remote.apps.length} apps, ${remote.groups.length} groups`)
    } catch (e: any) {
      showStatus(false, typeof e === 'string' ? e : e?.message || 'Pull failed')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    if (!pulled) return
    setLoading(true)
    try {
      await invoke('sync_import', { remote: pulled })
      setPulled(null)
      showStatus(true, 'Imported remote data into local store')
    } catch (e: any) {
      showStatus(false, typeof e === 'string' ? e : e?.message || 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  const addIgnored = () => {
    const val = newIgnored.trim()
    if (!val) return
    if (ignored.includes(val)) { showStatus(false, 'Already in list'); return }
    const next = [...ignored, val]
    setIgnored(next)
    setNewIgnored('')
    invoke('sync_set_ignored', { ignored: next }).catch(() => {})
  }

  const removeIgnored = (idx: number) => {
    const next = ignored.filter((_, i) => i !== idx)
    setIgnored(next)
    invoke('sync_set_ignored', { ignored: next }).catch(() => {})
  }

  const keyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAuth()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Cloud Sync</h2>
        <p className="page-subtitle">Backup and restore your apps, groups, and settings</p>
      </div>

      <div className="sync-card sync-dev-notice">
        <strong>⚠ Preview</strong> — Cloud sync is not yet available in the test build.
        This feature will be enabled in stable releases.
      </div>

      {status && (
        <div className={`sync-status ${status.ok ? 'sync-status-ok' : 'sync-status-err'}`}>
          {status.msg}
        </div>
      )}

      {!token ? (
        <section className="sync-card">
          <div className="sync-auth-tabs">
            <button className={`sync-auth-tab${authTab === 'login' ? ' active' : ''}`} onClick={() => setAuthTab('login')}>Login</button>
            <button className={`sync-auth-tab${authTab === 'register' ? ' active' : ''}`} onClick={() => setAuthTab('register')}>Register</button>
          </div>
          <div className="sync-auth-form">
            <input className="sync-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={keyDown} />
            <input className="sync-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={keyDown} />
            <button className="sync-btn sync-btn-primary" onClick={handleAuth} disabled={loading}>
              {loading ? '...' : authTab === 'login' ? 'Login' : 'Register'}
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="sync-card">
            <div className="sync-account-row">
              <span className="sync-account-email">{token.email}</span>
              <button className="sync-btn sync-btn-danger" onClick={handleLogout}>Logout</button>
            </div>
          </section>

          <section className="sync-card">
            <h3 className="sync-section-title">Sync Actions</h3>
            <div className="sync-actions">
              <button className="sync-btn sync-btn-primary" onClick={handlePush} disabled={loading}>
                Push to Cloud
              </button>
              <button className="sync-btn sync-btn-secondary" onClick={handlePull} disabled={loading}>
                Pull from Cloud
              </button>
            </div>
            <p className="sync-hint">Push uploads your local apps, groups, and theme. Pull downloads the server version.</p>
          </section>

          {pulled && (
            <section className="sync-card">
              <h3 className="sync-section-title">Remote Data</h3>
              <div className="sync-remote-info">
                <div className="sync-remote-stat"><strong>{pulled.apps.length}</strong> apps</div>
                <div className="sync-remote-stat"><strong>{pulled.groups.length}</strong> groups</div>
                <div className="sync-remote-stat"><strong>{pulled.stats.length}</strong> stats</div>
              </div>
              {pulled.apps.length > 0 && (
                <details className="sync-details">
                  <summary>Show apps</summary>
                  <ul className="sync-app-list">
                    {pulled.apps.map((a, i) => (
                      <li key={i} className="sync-app-item">{a.name} <span className="sync-app-path">{a.path}</span></li>
                    ))}
                  </ul>
                </details>
              )}
              <button className="sync-btn sync-btn-primary" onClick={handleImport} disabled={loading}>
                Import to Local Store
              </button>
            </section>
          )}

          <section className="sync-card">
            <h3 className="sync-section-title">Ignored Apps</h3>
            <p className="sync-hint">Apps in this list will not be pushed to the cloud.</p>
            <div className="sync-ignored-row">
              <input className="sync-input sync-input-wide" placeholder="App path or name to ignore" value={newIgnored} onChange={e => setNewIgnored(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addIgnored() }} />
              <button className="sync-btn sync-btn-primary" onClick={addIgnored}>Add</button>
            </div>
            {ignored.length > 0 && (
              <ul className="sync-ignored-list">
                {ignored.map((item, i) => (
                  <li key={i} className="sync-ignored-item">
                    <span>{item}</span>
                    <button className="sync-btn sync-btn-small sync-btn-danger" onClick={() => removeIgnored(i)}>×</button>
                  </li>
                ))}
              </ul>
            )}
            {ignored.length === 0 && <p className="sync-empty">No ignored apps</p>}
          </section>
        </>
      )}
    </div>
  )
}
