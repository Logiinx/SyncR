import { useLiveQuery } from 'dexie-react-hooks'
import { Settings } from 'lucide-react'
import { db, noteTitle } from './db'

interface Props {
  activeId: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onClose: () => void
  onMenu: (id: string, x: number, y: number) => void
  onSettings: () => void
}

// The note list. Pushes the note aside; on narrow screens it slides over it
// instead, and the dark backdrop (only shown there) closes it.
function Sidebar({ activeId, onOpen, onNew, onClose, onMenu, onSettings }: Props) {
  // Re-runs automatically whenever the notes change.
  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray(), [])

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="sidebar">
        <button className="new-note" onClick={onNew}>
          + New note
        </button>
        <ul className="note-list">
          {notes?.map((note) => (
            <li key={note.id}>
              <button
                className={note.id === activeId ? 'active' : ''}
                onClick={() => onOpen(note.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onMenu(note.id, e.clientX, e.clientY)
                }}
              >
                {noteTitle(note)}
              </button>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <button className="settings-button" onClick={onSettings}>
            <Settings size={15} /> Settings
          </button>
          <span className="version">v{__APP_VERSION__}</span>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
