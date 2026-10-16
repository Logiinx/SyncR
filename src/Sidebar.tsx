import { useLiveQuery } from 'dexie-react-hooks'
import { Bell, Gamepad2, Settings, TriangleAlert } from 'lucide-react'
import { db, noteTitle, type Note } from './db'
import { listReminders, REMINDERS_TAB } from './reminders'
import { GAMES_TAB } from './games'

interface Props {
  activeId: string | null
  onOpen: (id: string) => void
  onClose: () => void
  onMenu: (id: string, x: number, y: number) => void
  onSettings: () => void
  onGames: () => void
  onReminders: () => void
}

// "Today, 14:32", "Yesterday, 09:10", otherwise "14-10-2026"
function formatDate(time: number) {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const day = new Date(time).setHours(0, 0, 0, 0)
  const today = new Date()
  if (day === today.setHours(0, 0, 0, 0)) return `Today, ${clock}`
  // (setDate instead of "minus 24 hours": days with a clock change are 23 or 25 hours long)
  today.setDate(today.getDate() - 1)
  if (day === today.getTime()) return `Yesterday, ${clock}`
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`
}

// The text under the title. When the title is the first line, the preview starts after it.
function notePreview(note: Note) {
  const lines = note.text.split('\n').filter((line) => line.trim() !== '')
  if (!note.title) lines.shift()
  return lines.join(' ').slice(0, 300)
}

// The note list. Pushes the note aside; on narrow screens it slides over it
// instead, and the dark backdrop (only shown there) closes it.
function Sidebar({ activeId, onOpen, onClose, onMenu, onSettings, onGames, onReminders }: Props) {
  // Re-runs automatically whenever the notes change.
  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray(), [])
  // Upcoming reminders, without release reminders (hidden in the tab, see RemindersView.tsx)
  const upcoming = useLiveQuery(
    async () => (await listReminders()).filter((r) => r.doneAt === null && !r.gameId).length,
    [],
  )

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="sidebar">
        <button className={activeId === GAMES_TAB ? 'sidebar-games active' : 'sidebar-games'} onClick={onGames}>
          <Gamepad2 size={15} /> Games
        </button>
        <button
          className={activeId === REMINDERS_TAB ? 'sidebar-games active' : 'sidebar-games'}
          onClick={onReminders}
        >
          <Bell size={15} /> Reminders
          {!!upcoming && <span className="reminders-count">{upcoming}</span>}
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
                <span className="note-date">{formatDate(note.updatedAt)}</span>
                <span className="note-title">
                  {/* A conflict copy made by sync: open it to compare it with the original */}
                  {note.conflictOf && <TriangleAlert size={13} className="conflict-mark" aria-label="Conflict copy" />}
                  {noteTitle(note)}
                </span>
                <span className="note-preview">{notePreview(note)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <button className="footer-button" onClick={onSettings}>
            <Settings size={15} /> Settings
          </button>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
