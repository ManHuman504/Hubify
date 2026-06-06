import { useState, useEffect, useCallback, useRef, createContext, useContext, ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

export interface App {
  id: string
  name: string
  path: string
  icon: string | null
  group_id: string | null
  hotkey: string | null
}

export interface Group {
  id: string
  name: string
  color: string | null
}

export interface StoreData {
  apps: App[]
  groups: Group[]
  scanned_apps: DetectedApp[]
  theme: ThemeConfig
}

export interface ProcessInfo {
  running: boolean
  pid: number | null
  cpu: number
  mem_mb: number
}

export interface DetectedApp {
  name: string
  path: string
  icon: string | null
}

export interface CustomTheme {
  id: string
  name: string
  vars: Record<string, string>
}

export interface ThemeConfig {
  active: string
  custom_themes: CustomTheme[]
}

interface AppsContextType {
  apps: App[]
  groups: Group[]
  scannedApps: DetectedApp[]
  processInfo: Record<string, ProcessInfo>
  theme: ThemeConfig
  addApp: (path: string, name?: string, groupId?: string | null) => Promise<void>
  addApps: (items: { path: string; name?: string }[], groupId?: string | null) => Promise<void>
  removeApp: (id: string) => Promise<void>
  launchApp: (path: string) => Promise<void>
  killApp: (path: string) => Promise<void>
  moveAppToGroup: (appId: string, groupId: string | null) => Promise<void>
  addGroup: (name: string, color?: string) => Promise<Group>
  removeGroup: (id: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  refresh: () => Promise<void>
  setTheme: (themeId: string) => Promise<void>
  saveTheme: (theme: CustomTheme) => Promise<void>
  deleteTheme: (themeId: string) => Promise<void>
  setAppHotkey: (appId: string, hotkey: string | null) => Promise<void>
}

const AppsContext = createContext<AppsContextType | null>(null)

export function AppsProvider({ children }: { children: ReactNode }) {
  const [apps, setApps] = useState<App[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [scannedApps, setScannedApps] = useState<DetectedApp[]>([])
  const [theme, setThemeState] = useState<ThemeConfig>({ active: 'dark', custom_themes: [] })
  const [processInfo, setProcessInfo] = useState<Record<string, ProcessInfo>>({})
  const appsRef = useRef<App[]>([])
  appsRef.current = apps

  const refresh = useCallback(async () => {
    const data = await invoke<StoreData>('get_store')
    setApps(data.apps)
    setGroups(data.groups)
    setScannedApps(data.scanned_apps || [])
    if (data.theme) setThemeState(data.theme)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    // Listen for backend updates (like after winget_install)
    const unlisten = (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      return listen('store_updated', () => {
        refresh()
      })
    })()
    
    return () => {
      unlisten.then(f => f())
    }
  }, [refresh])

// Poll process status every 2s to reduce IPC frequency
  useEffect(() => {
    let lastActiveJson = ''
    let pending = false

    const poll = async () => {
      if (pending) return
      pending = true
      try {
        const current = appsRef.current
        if (!current.length) { pending = false; return }

        const paths = current.map(a => a.path)
        const infoObj = await invoke<Record<string, ProcessInfo>>('get_processes_info', { paths })
        const newProcessInfo: Record<string, ProcessInfo> = {}
        for (const app of current) { if (infoObj[app.path]) { newProcessInfo[app.id] = infoObj[app.path] } }

        setProcessInfo(newProcessInfo)

        const activeApps = current.filter(a => newProcessInfo[a.id]?.running).map(a => ({ name: a.name, path: a.path }))

        const json = JSON.stringify(activeApps)
        if (json !== lastActiveJson) { lastActiveJson = json; invoke('update_tray_menu', { activeApps }).catch(() => {}) }
      } catch (e) { console.error('Failed to poll process info', e) }
      pending = false
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [])

  // ── Apps ──────────────────────────────────────────────────────────────────

  const addApp = useCallback(async (path: string, name?: string, groupId?: string | null) => {
    const app = await invoke<App>('add_app', { path, name, groupId: groupId ?? null })
    setApps(prev => [...prev, app])
  }, [])

  const addApps = useCallback(async (items: { path: string; name?: string }[], groupId?: string | null) => {
    const newApps = await invoke<App[]>('add_apps', { items, groupId: groupId ?? null })
    setApps(prev => [...prev, ...newApps])
  }, [])

  const removeApp = useCallback(async (id: string) => {
    await invoke('remove_app', { id })
    setApps(prev => prev.filter(a => a.id !== id))
  }, [])

  const launchApp = useCallback(async (path: string) => {
    await invoke('launch_app', { path })
    getCurrentWindow().hide()
  }, [])

  const killApp = useCallback(async (path: string) => {
    await invoke('kill_app', { path })
  }, [])

  const moveAppToGroup = useCallback(async (appId: string, groupId: string | null) => {
    await invoke('move_app_to_group', { appId, groupId })
    setApps(prev => prev.map(a => a.id === appId ? { ...a, group_id: groupId } : a))
  }, [])

  // ── Groups ────────────────────────────────────────────────────────────────

  const addGroup = useCallback(async (name: string, color?: string) => {
    const group = await invoke<Group>('add_group', { name, color: color ?? null })
    setGroups(prev => [...prev, group])
    return group
  }, [])

  const removeGroup = useCallback(async (id: string) => {
    await invoke('remove_group', { id })
    setGroups(prev => prev.filter(g => g.id !== id))
    setApps(prev => prev.map(a => a.group_id === id ? { ...a, group_id: null } : a))
  }, [])

  const renameGroup = useCallback(async (id: string, name: string) => {
    await invoke('rename_group', { id, name })
    setGroups(prev => prev.map(g => g.id === id ? { ...g, name } : g))
  }, [])

  const setTheme = useCallback(async (themeId: string) => {
    await invoke('set_active_theme', { themeId })
    setThemeState(prev => ({ ...prev, active: themeId }))
  }, [])

  const saveTheme = useCallback(async (t: CustomTheme) => {
    await invoke('save_custom_theme', { theme: t })
    setThemeState(prev => {
      const themes = prev.custom_themes.filter(th => th.id !== t.id)
      themes.push(t)
      return { ...prev, custom_themes: themes }
    })
  }, [])

  const deleteTheme = useCallback(async (themeId: string) => {
    await invoke('delete_custom_theme', { themeId })
    setThemeState(prev => ({
      ...prev,
      custom_themes: prev.custom_themes.filter(t => t.id !== themeId),
      active: prev.active === themeId ? 'dark' : prev.active,
    }))
  }, [])

  const setAppHotkey = useCallback(async (appId: string, hotkey: string | null) => {
    await invoke('set_app_hotkey', { appId, hotkey })
    setApps(prev => prev.map(a => a.id === appId ? { ...a, hotkey } : a))
  }, [])

  return (
    <AppsContext.Provider value={{
      apps,
      groups,
      scannedApps,
      processInfo,
      theme,
      addApp,
      addApps,
      removeApp,
      launchApp,
      killApp,
      moveAppToGroup,
      addGroup,
      removeGroup,
      renameGroup,
      refresh,
      setTheme,
      saveTheme,
      deleteTheme,
      setAppHotkey,
    }}>
      {children}
    </AppsContext.Provider>
  )
}

export function useApps() {
  const ctx = useContext(AppsContext)
  if (!ctx) throw new Error('useApps must be used within AppsProvider')
  return ctx
}
