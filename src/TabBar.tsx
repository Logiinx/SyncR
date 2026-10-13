import { noteTitle, type Note } from './db'

interface Props {
  notes: Note[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onMenu: (id: string, x: number, y: number) => void
  onRename: (id: string) => void
}

// The row of open notes at the top. Middle-click closes, double-click renames, right-click opens a menu.
function TabBar({ notes, activeId, onSelect, onClose, onNew, onMenu, onRename }: Props) {
  return (
    <nav className="tabs">
      {notes.map((note) => (
        <div
          key={note.id}
          className={note.id === activeId ? 'tab active' : 'tab'}
          onClick={() => onSelect(note.id)}
          onAuxClick={(e) => e.button === 1 && onClose(note.id)}
          onDoubleClick={() => onRename(note.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            onMenu(note.id, e.clientX, e.clientY)
          }}
          title={noteTitle(note)}
        >
          <span className="tab-title">{noteTitle(note)}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              onClose(note.id)
            }}
            title="Close tab"
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={onNew} title="New note">
        +
      </button>
    </nav>
  )
}

export default TabBar
