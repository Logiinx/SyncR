import { useEffect, useRef, useState } from 'react'
import { Bell, ChevronLeft, Gamepad2, Mail, Menu, Pencil, Plus, Trash2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import ContextMenu from './ContextMenu'
import { createNote, db, deleteNote, noteTitle, renameNote } from './db'
import Dialog, { type DialogRequest } from './Dialog'
import { forgetScroll, useLocalState } from './localState'
import { onFollowLink } from './noteLinks'
import NoteView from './NoteView'
import ReminderAlerts from './ReminderAlerts'
import Sidebar from './Sidebar'
import Board from './Board'
import { usePanelSwipe } from './edgeSwipe'
import { setPendingSearch } from './noteSearch'
import SettingsDialog from './SettingsDialog'
import TabBar, { type Tab } from './TabBar'
import GamesView from './GamesView'
import RemindersView from './RemindersView'
import { REMINDERS_TAB } from './reminders'
import { GAMES_TAB, startGameChecks } from './games'
import { MAIL_TAB } from './mailbox'
import MailView from './MailView'
import { startCalendarChecks } from './calendarEvents'
import UpdateBanner from './UpdateBanner'
import WhatsNew from './WhatsNew'
import SyncButton from './SyncButton'
import WindowControls from './WindowControls'
import { usePage } from './animations'

const isNarrowScreen = () => window.matchMedia('(max-width: 699px)').matches

// Tabs that show a page instead of a note (their ids never look like a note id)
const isPageTab = (id: string) => id === GAMES_TAB || id === REMINDERS_TAB || id === MAIL_TAB

function App() {
  // Remembered after a restart (per device)
  const [openTabs, setOpenTabs] = useLocalState<string[]>('syncr.tabs', [])
  const [activeId, setActiveId] = useLocalState<string | null>('syncr.activeTab', null)
  // The notes sidebar and the Board start open on a new PC, so new users see that they exist
  // (on a phone they would cover the note: closed there)
  const [sidebarOpen, setSidebarOpen] = useLocalState('syncr.sidebarOpen', !isNarrowScreen())
  const [boardOpen, setBoardOpen] = useLocalState('syncr.boardOpen', !isNarrowScreen())
  const bodyRef = useRef<HTMLDivElement>(null)
  // Search across all notes (Sidebar.tsx): kept while the sidebar closes, not after a restart
  const [searchQuery, setSearchQuery] = useState('')
  const [focusSearch, setFocusSearch] = useState(false)
  usePanelSwipe(bodyRef, boardOpen, sidebarOpen, setBoardOpen, setSidebarOpen)

  // Games: release day check and daily refresh from IGDB (games.ts)
  useEffect(startGameChecks, [])

  // Google Calendar: events kept fresh in the background, for their alerts (calendarEvents.ts)
  useEffect(startCalendarChecks, [])

  // A conflict was resolved (ConflictCompare.tsx): show the note that was kept, close the copy
  useEffect(() => {
    const onOpenNote = (e: Event) => {
      const { id, close } = (e as CustomEvent<{ id: string; close?: string }>).detail
      setOpenTabs((tabs) => [...tabs.filter((t) => t !== close && t !== id), id])
      setActiveId(id)
      if (close) forgetScroll(close)
    }
    window.addEventListener('open-note', onOpenNote)
    return () => window.removeEventListener('open-note', onOpenNote)
  }, [setOpenTabs, setActiveId])

  // Ctrl+Shift+F: open the sidebar with the cursor in its search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== 'f') return
      e.preventDefault()
      if (isNarrowScreen()) setBoardOpen(false)
      setSidebarOpen(true)
      setFocusSearch(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setBoardOpen, setSidebarOpen])

  // "Pin" in the toolbar: show the Board so the new card is visible
  useEffect(() => {
    const open = () => {
      if (isNarrowScreen()) setSidebarOpen(false)
      setBoardOpen(true)
    }
    window.addEventListener('open-board', open)
    return () => window.removeEventListener('open-board', open)
  }, [setBoardOpen, setSidebarOpen])
  // Only a brand-new note gets the cursor automatically
  const [newNoteId, setNewNoteId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ noteId: string; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // `ids` lets us check the result matches the current tabs (it can lag one render behind)
  const tabsResult = useLiveQuery(
    async () => ({ ids: openTabs, notes: await db.notes.bulkGet(openTabs) }),
    [openTabs],
  )
  // The tabs that exist: notes found in the database, and the Games, Reminders and Mail tabs
  const tabs: Tab[] = (tabsResult?.ids ?? []).flatMap((id, i): Tab[] => {
    if (id === GAMES_TAB) return [{ id, title: 'Games', icon: <Gamepad2 size={14} className="tab-icon" /> }]
    if (id === REMINDERS_TAB) return [{ id, title: 'Reminders', icon: <Bell size={14} className="tab-icon" /> }]
    if (id === MAIL_TAB) return [{ id, title: 'Mail', icon: <Mail size={14} className="tab-icon" /> }]
    const note = tabsResult?.notes[i]
    return note ? [{ id, title: noteTitle(note) }] : []
  })
  const activeNote = useLiveQuery(
    () => (activeId ? db.notes.get(activeId) : undefined),
    [activeId],
  )

  // Close tabs whose note no longer exists (e.g. deleted on the other device)
  useEffect(() => {
    if (!tabsResult || tabsResult.ids !== openTabs) return
    const missing = openTabs.filter((id, i) => !isPageTab(id) && !tabsResult.notes[i])
    if (missing.length === 0) return
    missing.forEach(forgetScroll)
    const remaining = openTabs.filter((id) => !missing.includes(id))
    setOpenTabs(remaining)
    if (activeId && missing.includes(activeId)) setActiveId(remaining.at(-1) ?? null)
  }, [tabsResult, openTabs, activeId, setOpenTabs, setActiveId])

  // Clicking a link to a note (noteLinks.ts) opens it here, or says the target is gone
  useEffect(() => {
    onFollowLink(openNote, (message) =>
      setDialog({ title: 'Link', message, confirmLabel: 'OK', noCancel: true, onConfirm: () => {} }),
    )
  })

  function openNote(id: string) {
    if (!openTabs.includes(id)) setOpenTabs([...openTabs, id])
    setActiveId(id)
    if (isNarrowScreen()) setSidebarOpen(false)
  }

  function closeTab(id: string) {
    const index = openTabs.indexOf(id)
    const remaining = openTabs.filter((tabId) => tabId !== id)
    setOpenTabs(remaining)
    if (id === activeId) setActiveId(remaining[index] ?? remaining[index - 1] ?? null)
  }

  async function newNote() {
    const id = await createNote()
    setNewNoteId(id)
    openNote(id)
  }

  async function askRename(id: string) {
    const note = await db.notes.get(id)
    if (!note) return
    setDialog({
      title: 'Rename note',
      input: { initial: note.title ?? '', placeholder: `Leave empty to use the first line ("${noteTitle({ ...note, title: null })}")` },
      confirmLabel: 'Rename',
      onConfirm: (title) => renameNote(id, title),
    })
  }

  async function askDelete(id: string) {
    const note = await db.notes.get(id)
    if (!note) return
    setDialog({
      title: 'Delete note?',
      message: `"${noteTitle(note)}" will be deleted. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => {
        closeTab(id)
        forgetScroll(id)
        deleteNote(id)
      },
    })
  }

  const showNote = activeNote && openTabs.includes(activeNote.id)

  return (
    <div className="app">
      {/* Also the window title bar: empty areas marked data-tauri-drag-region move the window */}
      <header className="topbar" data-tauri-drag-region>
        <button
          className="menu-button"
          onClick={() => {
            // Phone: only one panel at a time, they both slide over the note
            if (isNarrowScreen()) setBoardOpen(false)
            setSidebarOpen(!sidebarOpen)
          }}
          title="Notes"
        >
          <Menu size={18} />
        </button>
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={openNote}
          onClose={closeTab}
          onNew={newNote}
          onMenu={(noteId, x, y) => !isPageTab(noteId) && setMenu({ noteId, x, y })}
          onRename={askRename}
          onReorder={setOpenTabs}
        />
        <div className="drag-space" data-tauri-drag-region />
        <SyncButton />
        <WindowControls />
      </header>
      <UpdateBanner />

      <div className="body" ref={bodyRef}>
        {sidebarOpen && (
          <Sidebar
            activeId={activeId}
            onOpen={(id) => {
              openNote(id)
              // A search result: the note jumps to the first match (noteSearch.ts)
              if (searchQuery.trim()) setPendingSearch(id, searchQuery)
            }}
            onClose={() => setSidebarOpen(false)}
            onMenu={(noteId, x, y) => setMenu({ noteId, x, y })}
            onSettings={() => setSettingsOpen(true)}
            onGames={() => openNote(GAMES_TAB)}
            onReminders={() => openNote(REMINDERS_TAB)}
            onMail={() => openNote(MAIL_TAB)}
            query={searchQuery}
            onQuery={setSearchQuery}
            focusSearch={focusSearch}
            onSearchFocused={() => setFocusSearch(false)}
          />
        )}
        {activeId === REMINDERS_TAB && openTabs.includes(REMINDERS_TAB) ? (
          <RemindersView />
        ) : activeId === GAMES_TAB && openTabs.includes(GAMES_TAB) ? (
          <GamesView />
        ) : activeId === MAIL_TAB && openTabs.includes(MAIL_TAB) ? (
          <MailView />
        ) : showNote ? (
          // key: a fresh view and editor for each note
          <NoteView key={activeNote.id} note={activeNote} autoFocus={activeNote.id === newNoteId} />
        ) : (
          <EmptyPage>
            <div className="empty">
              <button className="empty-new" onClick={newNote}>
                <Plus size={16} /> New note
              </button>
              <p>or open one with ☰</p>
            </div>
          </EmptyPage>
        )}
        {boardOpen ? (
          <Board onClose={() => setBoardOpen(false)} />
        ) : (
          // Small tab in the middle of the right edge: opens the Board
          <button
            className="board-toggle"
            onClick={() => {
              // Phone: only one panel at a time, they both slide over the note
              if (isNarrowScreen()) setSidebarOpen(false)
              setBoardOpen(true)
            }}
            title="Board"
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', icon: Pencil, onClick: () => askRename(menu.noteId) },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => askDelete(menu.noteId) },
          ]}
        />
      )}
      <ReminderAlerts />
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <WhatsNew />
    </div>
  )
}

// The page when no tab is open; crossfades like the others (animations.ts)
function EmptyPage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  usePage(ref)
  return (
    <main className="page" ref={ref}>
      {children}
    </main>
  )
}

export default App
