import { useLiveQuery } from 'dexie-react-hooks'
import { t } from './i18n'
import { useEffect, useRef, useState } from 'react'
import { useListItems, useSlideIn } from './animations'
import { Bell, Gamepad2, Mail, RefreshCw, Search, Settings, TriangleAlert, Video, X } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'
import { useGmailAccounts } from './gmail'
import { useMissed } from './mailAlerts'
import { MAIL_TAB } from './mailbox'
import { VIDEO_TAB } from './video'
import Spinner from './Spinner'
import { db, noteTitle, type Note } from './db'
import { REMINDERS_TAB } from './reminders'
import { GAMES_TAB } from './games'
import { checkForUpdates } from './UpdateBanner'
import { searchNotes, type Snippet } from './noteSearch'
import { clockTime, nearDay, shortDate } from './dates'

interface Props {
  activeId: string | null
  onOpen: (id: string) => void
  onClose: () => void
  onMenu: (id: string, x: number, y: number) => void
  onSettings: () => void
  onGames: () => void
  onReminders: () => void
  onMail: () => void
  onVideo: (() => void) | null // null: no Video tab (video.ts)
  query: string // search across all notes; kept in App so it survives closing the sidebar
  onQuery: (query: string) => void
  focusSearch: boolean // Ctrl+Shift+F (App.tsx): the box should get the cursor
  onSearchFocused: () => void
}

// "Today, 14:32", "Yesterday, 09:10", otherwise "14 Oct 2026". A last edit is never ahead,
// except from a device whose clock runs fast: then its date, not "Tomorrow"
function formatDate(time: number) {
  const near = nearDay(time)
  return near && near !== t('Tomorrow') ? `${near}, ${clockTime(time)}` : shortDate(time)
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
function Sidebar({ activeId, onOpen, onClose, onMenu, onSettings, onGames, onReminders, onMail, onVideo, query, onQuery, focusSearch, onSearchFocused }: Props) {
  const slideIn = useSlideIn()
  const accounts = useGmailAccounts()
  const missed = useMissed()
  const [checking, setChecking] = useState(false)
  // Re-runs automatically whenever the notes change.
  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray(), [])

  // While searching, only the matching notes, each with the text around the match
  const results = notes && query.trim() ? searchNotes(notes, query) : null
  const searchInput = useRef<HTMLInputElement>(null)
  // New and deleted notes grow in and shrink out; not while the search changes the list
  const listRef = useRef<HTMLUListElement>(null)
  useListItems(listRef, query.trim())
  useEffect(() => {
    if (!focusSearch) return
    searchInput.current?.select()
    onSearchFocused()
  }, [focusSearch, onSearchFocused])

  return (
    <>
      <div className={'backdrop' + slideIn} onClick={onClose} />
      <aside className={'sidebar' + slideIn}>
        <button className={activeId === GAMES_TAB ? 'sidebar-games active' : 'sidebar-games'} onClick={onGames}>
          <Gamepad2 size={15} /> {t('Games')}
        </button>
        <button
          className={activeId === REMINDERS_TAB ? 'sidebar-games active' : 'sidebar-games'}
          onClick={onReminders}
        >
          <Bell size={15} /> {t('Reminders')}
        </button>
        {/* PC only (the phone has the Gmail app), once a Gmail account is added. The count:
            emails whose pop-up faded by itself, still unread ("missed") */}
        {(isTauri() || import.meta.env.DEV) && accounts.length > 0 && (
          <button className={activeId === MAIL_TAB ? 'sidebar-games active' : 'sidebar-games'} onClick={onMail}>
            <Mail size={15} /> {t('Mail')}
            {missed.length > 0 && <span className="sidebar-count" title={t('Missed emails')}>{missed.length}</span>}
          </button>
        )}
        {onVideo && (
          <button className={activeId === VIDEO_TAB ? 'sidebar-games active' : 'sidebar-games'} onClick={onVideo}>
            <Video size={15} /> {t('Video')}
          </button>
        )}
        <div className="game-search-bar sidebar-search">
          <Search size={15} />
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onQuery('')}
            placeholder={t('Search notes')}
            spellCheck={false}
          />
          {query && (
            <button className="game-search-clear" onClick={() => onQuery('')} title={t('Clear')}>
              <X size={15} />
            </button>
          )}
        </div>
        {results?.length === 0 && <p className="sidebar-no-results">{t('No notes found')}</p>}
        <ul className="note-list" ref={listRef}>
          {(results ?? notes?.map((note) => ({ note, snippet: null })))?.map(({ note, snippet }) => {
            const preview = snippet ? snippet.map((part) => part.text).join('') : notePreview(note)
            return (
              <li key={note.id} data-item={note.id}>
                <button
                  className={note.id === activeId ? 'active' : ''}
                  onClick={() => onOpen(note.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onMenu(note.id, e.clientX, e.clientY)
                  }}
                >
                  <span className="note-date">{formatDate(note.updatedAt)}</span>
                  <span className="note-title" title={noteTitle(note)}>
                    {/* A conflict copy made by sync: open it to compare it with the original */}
                    {note.conflictOf && <TriangleAlert size={13} className="conflict-mark" aria-label={t('Conflict copy')} />}
                    {noteTitle(note)}
                  </span>
                  <span className="note-preview" title={preview}>
                    {snippet ? <SnippetText parts={snippet} /> : preview}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="sidebar-footer">
          <button className="footer-button" onClick={onSettings}>
            <Settings size={15} /> {t('Settings')}
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
            title={t('Check for updates')}
            aria-label={t('Check for updates')}
          >
            {checking ? <Spinner label={t('Checking for updates')} /> : <RefreshCw size={15} />}
          </button>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
