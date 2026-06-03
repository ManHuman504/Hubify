import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import './GuardianPopup.css'

interface StartupChange {
  name: string
  cmd: string
  kind: string
}

export default function GuardianPopup() {
  const [change, setChange] = useState<StartupChange | null>(
    () => (window as any).__guardianData || null
  )
  const [waiting, setWaiting] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const setup = async () => {
      const { listen } = await import('@tauri-apps/api/event')

      // Check if we already got data passed via the event
      const unlisten = await listen<StartupChange>('guardian:startup-change', (event) => {
        setChange(event.payload)
        setWaiting(false)
        if (closeTimer.current) clearTimeout(closeTimer.current)
      })

      // Auto-close if no event within 15s
      closeTimer.current = setTimeout(async () => {
        const win = getCurrentWebviewWindow()
        await win.close().catch(() => {})
      }, 15000)

      return unlisten
    }

    const cleanup = setup()
    return () => {
      cleanup.then(fn => fn()).catch(() => {})
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  const handleResponse = async (allow: boolean) => {
    if (!change || waiting) return
    setWaiting(true)

    try {
      if (allow) {
        await invoke('guardian_allow_startup', { name: change.name, cmd: change.cmd })
      } else {
        await invoke('guardian_deny_startup', { name: change.name, cmd: change.cmd })
      }
    } catch (_) {}

    const win = getCurrentWebviewWindow()
    await win.close().catch(() => {})
  }

  if (!change) {
    return (
      <div className="gp-overlay">
        <div className="gp-modal gp-waiting">
          <span className="gp-spinner" />
          <p>Waiting for registry changes…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="gp-overlay">
      <div className="gp-modal">
        <div className="gp-header">
          <span className="gp-icon">🛡️</span>
          <span className="gp-title">Startup Change Detected</span>
        </div>
        <p className="gp-desc">
          A program has added itself to Windows startup.
        </p>
        <div className="gp-info">
          <div className="gp-row">
            <span className="gp-label">Name</span>
            <span className="gp-value">{change.name}</span>
          </div>
          <div className="gp-row">
            <span className="gp-label">Command</span>
            <span className="gp-value gp-path" onClick={() => invoke('guardian_open_folder', { cmd: change.cmd }).catch(() => {})}>
              {change.cmd}
            </span>
          </div>
        </div>
        <p className="gp-ask">Do you want to allow this?</p>
        <div className="gp-actions">
          <button className="gp-btn gp-btn-deny" onClick={() => handleResponse(false)} disabled={waiting}>
            {waiting ? '…' : 'Deny'}
          </button>
          <button className="gp-btn gp-btn-allow" onClick={() => handleResponse(true)} disabled={waiting}>
            {waiting ? '…' : 'Allow'}
          </button>
        </div>
      </div>
    </div>
  )
}
