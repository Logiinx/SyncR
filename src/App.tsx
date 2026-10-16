import { useEffect, useState } from 'react'
import { ChevronLeft, Gamepad2, Plus } from 'lucide-react'
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
import SettingsDialog from './SettingsDialog'
import TabBar, { type Tab } from './TabBar'
import GamesView from './GamesView'
import { GAMES_TAB } from './games'
import UpdateBanner from './UpdateBanner'
import SyncButton from './SyncButton'
import WindowControls from './WindowControls'

const isNarrowScreen = () => window.matchMedia('(max-width: 699px)').matches

function App() {
  // Remembered after a restart (per device)
  const [openTabs, setOpenTabs] = useLocalState<string[]>('syncr.tabs', [])
  const [activeId, setActiveId] = useLocalState<string | null>('syncr.activeTab', null)
  const [sidebarOpen, setSidebarOpen] = useLocalState('syncr.sidebarOpen', false)
  const [boardOpen, setBoardOpen] = useLocalState('syncr.boardOpen', false)

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

  // "Pin" in the selection menu: show the Board so the new card is visible
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
  // The tabs that exist: notes found in the database, and the Games tab
  const tabs: Tab[] = (tabsResult?.ids ?? []).flatMap((id, i): Tab[] => {
    if (id === GAMES_TAB) return [{ id, title: 'Games', icon: <Gamepad2 size={14} className="tab-icon" /> }]
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
    const missing = openTabs.filter((id, i) => id !== GAMES_TAB && !tabsResult.notes[i])
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
          ☰
        </button>
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={openNote}
          onClose={closeTab}
          onNew={newNote}
          onMenu={(noteId, x, y) => noteId !== GAMES_TAB && setMenu({ noteId, x, y })}
          onRename={askRename}
          onReorder={setOpenTabs}
        />
        <div className="drag-space" data-tauri-drag-region />
        <SyncButton />
        <WindowControls />
      </header>
      <UpdateBanner />

      <div className="body">
        {sidebarOpen && (
          <Sidebar
            activeId={activeId}
            onOpen={openNote}
            onClose={() => setSidebarOpen(false)}
            onMenu={(noteId, x, y) => setMenu({ noteId, x, y })}
            onSettings={() => setSettingsOpen(true)}
            onGames={() => openNote(GAMES_TAB)}
          />
        )}
        {activeId === GAMES_TAB && openTabs.includes(GAMES_TAB) ? (
          <GamesView />
        ) : showNote ? (
          // key: a fresh view and editor for each note
          <NoteView key={activeNote.id} note={activeNote} autoFocus={activeNote.id === newNoteId} />
        ) : (
          <main className="page">
            <div className="empty">
              <button className="empty-new" onClick={newNote}>
                <Plus size={16} /> New note
              </button>
              <p>or open one with ☰</p>
            </div>
          </main>
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
            { label: 'Rename', onClick: () => askRename(menu.noteId) },
            { label: 'Delete', danger: true, onClick: () => askDelete(menu.noteId) },
          ]}
        />
      )}
      <ReminderAlerts />
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
