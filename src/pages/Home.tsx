import { useState } from 'react'
import { useApps } from '../hooks/useApps'
import type { App, Group, DetectedApp } from '../hooks/useApps'
import AppCard from '../components/AppCard'
import AppDetail from '../components/AppDetail'
import AddAppDialog from '../components/AddAppDialog'
import { layoutAwareMatch } from '../utils/keyboard'
import './Page.css'
import './Home.css'

interface HomeProps {
  scanned?: DetectedApp[]
}

type FilterId = 'all' | string

export default function Home({ scanned = [] }: HomeProps) {
  const {
    apps, groups, processInfo,
    addApp, removeApp, launchApp, killApp,
    moveAppToGroup, addGroup, removeGroup, renameGroup,
  } = useApps()

  const [showDialog, setShowDialog] = useState(false)
  const [selected, setSelected] = useState<App | null>(null)
  const [filter, setFilter] = useState<FilterId>('all')
  const [search, setSearch] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | 'all' | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [showGroupInput, setShowGroupInput] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  if (selected) {
    return (
      <AppDetail
        app={selected}
        onBack={() => setSelected(null)}
        onLaunch={() => launchApp(selected.path)}
        onKill={() => killApp(selected.path)}
        onRemove={() => { removeApp(selected.id); setSelected(null) }}
      />
    )
  }

  const baseApps = filter === 'all' ? apps : apps.filter(a => a.group_id === filter)
  const visibleApps = search.trim()
    ? baseApps.filter(a => layoutAwareMatch(a.name, search))
    : baseApps

  // ── Drag ─────────────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, appId: string) => {
    setDraggingId(appId)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleDragEnd = () => { setDraggingId(null); setDragOverGroup(null) }

  const handleDragOver = (e: React.DragEvent, gid: string | null) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverGroup(gid ?? 'all')
  }

  const handleDrop = (e: React.DragEvent, gid: string | null) => {
    e.preventDefault()
    if (draggingId) moveAppToGroup(draggingId, gid)
    setDraggingId(null)
    setDragOverGroup(null)
  }

  // ── Group CRUD ────────────────────────────────────────────────────────────

  const commitNewGroup = async () => {
    const n = newGroupName.trim()
    if (n) await addGroup(n)
    setNewGroupName('')
    setShowGroupInput(false)
  }

  const startRename = (g: Group) => { setEditingGroupId(g.id); setEditingName(g.name) }

  const commitRename = async () => {
    if (editingGroupId && editingName.trim()) await renameGroup(editingGroupId, editingName.trim())
    setEditingGroupId(null)
  }

  // Count apps per group for badge
  const countForGroup = (gid: string) => apps.filter(a => a.group_id === gid).length

  return (
    <div className="page">
      <div className="page-header">
        <div className="header-row">
          <div>
            <h1 className="page-title">Home</h1>
            <p className="page-subtitle">{apps.length} app{apps.length !== 1 ? 's' : ''}</p>
          </div>
          <button className="btn-primary" onClick={() => setShowDialog(true)}>+ Add</button>
        </div>

        {/* Search */}
        <div className="home-search-row">
          <input
            className="home-search"
            placeholder="Search apps…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Group tiles */}
        <div className="group-tiles">
          {/* All tile */}
          <button
            className={`group-tile ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
            onDragOver={e => handleDragOver(e, null)}
            onDrop={e => handleDrop(e, null)}
            data-drag-over={dragOverGroup === 'all' ? 'true' : undefined}
          >
            <span className="group-tile-name">All</span>
            <span className="group-tile-count">{apps.length}</span>
          </button>

          {groups.map(g => (
            <div
              key={g.id}
              className={`group-tile-wrap ${dragOverGroup === g.id ? 'drag-over' : ''}`}
              onDragOver={e => handleDragOver(e, g.id)}
              onDrop={e => handleDrop(e, g.id)}
            >
              {editingGroupId === g.id ? (
                <input
                  className="group-tile-edit"
                  value={editingName}
                  autoFocus
                  onChange={e => setEditingName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setEditingGroupId(null)
                  }}
                />
              ) : (
                <button
                  className={`group-tile ${filter === g.id ? 'active' : ''}`}
                  onClick={() => setFilter(g.id)}
                  onDoubleClick={() => startRename(g)}
                >
                  <span className="group-tile-name">{g.name}</span>
                  <div className="group-tile-right">
                    <span className="group-tile-count">{countForGroup(g.id)}</span>
                    <span
                      className="group-tile-del"
                      onClick={e => {
                        e.stopPropagation()
                        removeGroup(g.id)
                        if (filter === g.id) setFilter('all')
                      }}
                    >×</span>
                  </div>
                </button>
              )}
            </div>
          ))}

          {/* New group */}
          {showGroupInput ? (
            <input
              className="group-tile-new-input"
              placeholder="Group name…"
              value={newGroupName}
              autoFocus
              onChange={e => setNewGroupName(e.target.value)}
              onBlur={commitNewGroup}
              onKeyDown={e => {
                if (e.key === 'Enter') commitNewGroup()
                if (e.key === 'Escape') { setShowGroupInput(false); setNewGroupName('') }
              }}
            />
          ) : (
            <button className="group-tile-add" onClick={() => setShowGroupInput(true)}>
              <span>+</span>
              <span className="group-tile-add-label">New group</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      {apps.length === 0 ? (
        <div className="page-empty">
          <span className="empty-icon">⬡</span>
          <p>No apps yet</p>
          <p className="empty-hint">Click "+ Add" to get started</p>
        </div>
      ) : visibleApps.length === 0 ? (
        <div className="page-empty">
          <span className="empty-icon">⊡</span>
          <p>{search ? 'Nothing found' : 'No apps in this group'}</p>
          <p className="empty-hint">{search ? 'Try a different query' : 'Drag apps here or use "+ Add"'}</p>
        </div>
      ) : (
        <div className="apps-grid">
          {visibleApps.map(app => (
            <div
              key={app.id}
              draggable
              onDragStart={e => handleDragStart(e, app.id)}
              onDragEnd={handleDragEnd}
              className={`app-card-drag-wrap ${draggingId === app.id ? 'dragging' : ''}`}
            >
              <AppCard
                app={app}
                info={processInfo[app.id]}
                onSelect={() => setSelected(app)}
                onLaunch={() => launchApp(app.path)}
                onKill={() => killApp(app.path)}
                onRemove={() => removeApp(app.id)}
              />
            </div>
          ))}
        </div>
      )}

      {showDialog && (
        <AddAppDialog
          groups={groups}
          scanned={scanned}
          onAdd={(path, name, groupId) => addApp(path, name, groupId)}
          onClose={() => setShowDialog(false)}
        />
      )}
    </div>
  )
}
