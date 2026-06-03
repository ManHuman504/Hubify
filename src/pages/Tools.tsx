import './Page.css'

const TOOLS = [
  { icon: '◉', name: 'Process Monitor',  desc: 'CPU & RAM per app in real time' },
  { icon: '◈', name: 'Network Monitor',  desc: 'Traffic per process via ETW' },
  { icon: '⬡', name: 'Disk Scanner',     desc: 'Visualize disk usage via MFT' },
  { icon: '✕', name: 'App Uninstaller',  desc: 'Clean removal with leftovers' },
  { icon: '⌖', name: 'Quick Search',     desc: 'Instant file search via MFT index' },
  { icon: '◷', name: 'Usage Stats',      desc: 'Hours per app per day / week' },
]

export default function Tools() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Tools</h1>
        <p className="page-subtitle">Built-in system utilities</p>
      </div>
      <div className="tools-grid">
        {TOOLS.map(tool => (
          <button key={tool.name} className="tool-card" disabled>
            <span className="tool-icon">{tool.icon}</span>
            <div>
              <p className="tool-name">{tool.name}</p>
              <p className="tool-desc">{tool.desc}</p>
            </div>
            <span className="tool-badge">Soon</span>
          </button>
        ))}
      </div>
    </div>
  )
}
