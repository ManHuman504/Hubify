import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './UpdateModal.css'
import '../components/AddAppDialog.css'

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

  const formatSize = (percent: number) => `${Math.round(percent)}%`

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog update-dialog" onClick={e => e.stopPropagation()}>
        <div className="update-header">
          <h2 className="dialog-title">Update Available</h2>
          <button className="add-det-back" onClick={onClose}>✕</button>
        </div>

        <div className="update-version-info">
          <div className="update-version-badge">
            <span className="update-version-current">v{info.current_version}</span>
            <span className="update-version-latest">v{info.latest_version}</span>
          </div>
          <span className="update-arrow">→</span>
          {info.asset_name && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{info.asset_name}</span>
          )}
        </div>

        {info.release_notes && (
          <div className="update-release-notes">{info.release_notes}</div>
        )}

        {state === 'error' && (
          <div className="update-error">{errorMsg}</div>
        )}

        {state === 'downloading' && (
          <div className="update-progress">
            <div className="update-progress-bar">
              <div className="update-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="update-progress-text">Downloading update... {formatSize(progress)}</span>
          </div>
        )}

        {state === 'downloaded' && (
          <div className="update-progress-text" style={{ color: 'var(--accent)', textAlign: 'center' }}>
            Downloaded — starting installer...
          </div>
        )}

        <div className="dialog-footer">
          <button className="btn-cancel" onClick={onClose}>
            {state === 'downloaded' ? 'Install Later' : 'Remind Later'}
          </button>
          <button
            className="btn-add"
            onClick={handleUpdate}
            disabled={state === 'downloading' || state === 'downloaded'}
          >
            {state === 'downloading' ? 'Downloading...' : 'Update Now'}
          </button>
        </div>
      </div>
    </div>
  )
}
