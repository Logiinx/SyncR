import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { Bell, Gamepad2, RefreshCw, Search, Settings, TriangleAlert, X } from 'lucide-react'
import Spinner from './Spinner'
import { db, noteTitle, type Note } from './db'
import { REMINDERS_TAB } from './reminders'
import { GAMES_TAB } from './games'
import { checkForUpdates } from './UpdateBanner'
import { searchNotes, type Snippet } from './noteSearch'

interface Props {
  activeId: string | null
  onOpen: (id: string) => void
  onClose: () => void
  onMenu: (id: string, x: number, y: number) => void
  onSettings: () => void
  onGames: () => void
  onReminders: () => void
  query: string // search across all notes; kept in App so it survives closing the sidebar
  onQuery: (query: string) => void
  focusSearch: boolean // Ctrl+Shift+F (App.tsx): the box should get the cursor
  onSearchFocused: () => void
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

// A search snippet with the matched words in bold
function SnippetText({ parts }: { parts: Snippet }) {
  return parts.map((part, i) => (part.match ? <strong key={i}>{part.text}</strong> : part.text))
}

// The text under the title. When the title is the first line, the preview starts after it.
function notePreview(note: Note) {
  const lines = note.text.split('\n').filter((line) => line.trim() !== '')
  if (!note.title) lines.shift()
  return lines.join(' ').slice(0, 300)
}

// The note list. Pushes the note aside; on narrow screens it slides over it
// instead, and the dark backdrop (only shown there) closes it.
function Sidebar({ activeId, onOpen, onClose, onMenu, onSettings, onGames, onReminders, query, onQuery, focusSearch, onSearchFocused }: Props) {
  const [checking, setChecking] = useState(false)
  // Re-runs automatically whenever the notes change.
  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray(), [])

  // While searching, only the matching notes, each with the text around the match
  const results = notes && query.trim() ? searchNotes(notes, query) : null
  const searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focusSearch) return
    searchInput.current?.select()
    onSearchFocused()
  }, [focusSearch, onSearchFocused])

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
        </button>
        <div className="game-search-bar sidebar-search">
          <Search size={15} />
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onQuery('')}
            placeholder="Search notes"
            spellCheck={false}
          />
          {query && (
            <button className="game-search-clear" onClick={() => onQuery('')} title="Clear">
              <X size={15} />
            </button>
          )}
        </div>
        {results?.length === 0 && <p className="sidebar-no-results">No notes found</p>}
        <ul className="note-list">
          {(results ?? notes?.map((note) => ({ note, snippet: null })))?.map(({ note, snippet }) => (
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
                <span className="note-preview">{snippet ? <SnippetText parts={snippet} /> : notePreview(note)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <button className="footer-button" onClick={onSettings}>
            <Settings size={15} /> Settings
          </button>
          {/* Check for updates: the result shows in the bar at the top; the loading ring while checking */}
          <button
            className="footer-icon"
            onClick={async () => {
              if (checking) return
              setChecking(true)
              await checkForUpdates()
              setChecking(false)
            }}
            title="Check for updates"
            aria-label="Check for updates"
          >
            {checking ? <Spinner label="Checking for updates" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
