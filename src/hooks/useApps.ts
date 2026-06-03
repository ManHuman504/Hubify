import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface App {
  id: string
  name: string
  path: string
  icon: string | null
  group_id: string | null
}

export interface Group {
  id: string
  name: string
  color: string | null
}

export interface StoreData {
  apps: App[]
  groups: Group[]
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

export function useApps() {
  const [apps, setApps] = useState<App[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [processInfo, setProcessInfo] = useState<Record<string, ProcessInfo>>({})
  const appsRef = useRef<App[]>([])
  appsRef.current = apps

  const refresh = useCallback(async () => {
    const data = await invoke<StoreData>('get_store')
    setApps(data.apps)
    setGroups(data.groups)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Poll process status every 3s
  useEffect(() => {
    const poll = async () => {
      const current = appsRef.current
      if (!current.length) return
      const results = await Promise.all(
        current.map(a => invoke<ProcessInfo>('get_process_info', { path: a.path })
          .then(info => [a.id, info] as const))
      )
      setProcessInfo(Object.fromEntries(results))
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  // ── Apps ──────────────────────────────────────────────────────────────────

  const addApp = useCallback(async (path: string, name?: string, groupId?: string | null) => {
    const app = await invoke<App>('add_app', { path, name, groupId: groupId ?? null })
    setApps(prev => [...prev, app])
  }, [])

  const removeApp = useCallback(async (id: string) => {
    await invoke('remove_app', { id })
    setApps(prev => prev.filter(a => a.id !== id))
  }, [])

  const launchApp = useCallback(async (path: string) => {
    await invoke('launch_app', { path })
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

  return {
    apps,
    groups,
    processInfo,
    addApp,
    removeApp,
    launchApp,
    killApp,
    moveAppToGroup,
    addGroup,
    removeGroup,
    renameGroup,
  }
}
