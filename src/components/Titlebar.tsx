import { getCurrentWindow } from '@tauri-apps/api/window'
import './Titlebar.css'

const win = getCurrentWindow()

export default function Titlebar() {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-drag" data-tauri-drag-region />
      <div className="titlebar-controls">
        <button className="tb-btn minimize" onClick={() => win.minimize()} title="Minimize">
          <span />
        </button>
        <button className="tb-btn maximize" onClick={() => win.toggleMaximize()} title="Maximize">
          <span />
        </button>
        <button className="tb-btn close" onClick={() => win.hide()} title="Close">
          <span />
        </button>
      </div>
    </div>
  )
}
