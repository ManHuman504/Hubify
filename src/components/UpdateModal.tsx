import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './UpdateModal.css'

export interface UpdateInfo {
  available: boolean
  latest_version: string
  current_version: string
  release_notes: string
  download_url: string | null
  asset_name: string | null
  error: string | null
}

interface Props {
  info: UpdateInfo
  onClose: () => void
  onUpdateInstalled: () => void
}

type UpdateState = 'idle' | 'downloading' | 'downloaded' | 'error'

export default function UpdateModal({ info, onClose, onUpdateInstalled }: Props) {
  const [state, setState] = useState<UpdateState>('idle')
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  const handleUpdate = async () => {
    if (!info.download_url) return
    setState('downloading')
    setProgress(0)

    try {
      const path = await invoke<string>('download_update', { url: info.download_url })
      setState('downloaded')
      setProgress(100)

      await invoke('install_update', { path })
      await invoke('exit_app')
      onUpdateInstalled()
    } catch (e: any) {
      setState('error')
      setErrorMsg(typeof e === 'string' ? e : 'Update failed')
    }
  }

  return (
    <div className="upd-backdrop" onClick={onClose}>
      <div className="upd-modal" onClick={e => e.stopPropagation()}>
        <div className="upd-header">
          <div className="upd-header-left">
            <div className="upd-header-icon">⬇</div>
            <span className="upd-header-title">Update Available</span>
          </div>
          <button className="upd-close" onClick={onClose}>✕</button>
        </div>

        <div className="upd-versions">
          <div className="upd-version-card upd-version-current">
            <div className="upd-version-label">Current</div>
            <div className="upd-version-number">v{info.current_version}</div>
          </div>
          <span className="upd-version-arrow">→</span>
          <div className="upd-version-card upd-version-latest">
            <div className="upd-version-label">Latest</div>
            <div className="upd-version-number">v{info.latest_version}</div>
          </div>
        </div>

        <div className="upd-body">
          {info.release_notes && (
            <>
              <div className="upd-release-label">Release Notes</div>
              <div className="upd-release-notes">{info.release_notes}</div>
            </>
          )}

          {info.asset_name && (
            <div className="upd-asset-name">{info.asset_name}</div>
          )}

          {state === 'error' && (
            <div className="upd-error">{errorMsg}</div>
          )}

          {state === 'downloading' && (
            <div className="upd-progress">
              <div className="upd-progress-bar">
                <div className="upd-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="upd-progress-text">Downloading update… {Math.round(progress)}%</span>
            </div>
          )}

          {state === 'downloaded' && (
            <div className="upd-downloaded-msg">Downloaded — starting installer…</div>
          )}
        </div>

        <div className="upd-footer">
          <button className="upd-btn upd-btn-secondary" onClick={onClose}>
            {state === 'downloaded' ? 'Install Later' : 'Remind Later'}
          </button>
          <button
            className="upd-btn upd-btn-primary"
            onClick={handleUpdate}
            disabled={state === 'downloading' || state === 'downloaded'}
          >
            {state === 'downloading' ? 'Downloading…' : 'Update Now'}
          </button>
        </div>
      </div>
    </div>
  )
}
