import { noteTitle, type Note } from './db'

interface Props {
  notes: Note[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

// The row of open notes at the top. Middle-click also closes a tab.
function TabBar({ notes, activeId, onSelect, onClose, onNew }: Props) {
  return (
    <nav className="tabs">
      {notes.map((note) => (
        <div
          key={note.id}
          className={note.id === activeId ? 'tab active' : 'tab'}
          onClick={() => onSelect(note.id)}
          onAuxClick={(e) => e.button === 1 && onClose(note.id)}
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
