import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import ContextMenu from './ContextMenu'
import { createNote, db, deleteNote, noteTitle, renameNote, type Note } from './db'
import Dialog, { type DialogRequest } from './Dialog'
import { forgetScroll, useLocalState } from './localState'
import NoteView from './NoteView'
import Sidebar from './Sidebar'
import SettingsDialog from './SettingsDialog'
import TabBar from './TabBar'
import UpdateBanner from './UpdateBanner'
import SyncButton from './SyncButton'
import WindowControls from './WindowControls'

const isNarrowScreen = () => window.matchMedia('(max-width: 699px)').matches

function App() {
  // Remembered after a restart (per device)
  const [openTabs, setOpenTabs] = useLocalState<string[]>('syncr.tabs', [])
  const [activeId, setActiveId] = useLocalState<string | null>('syncr.activeTab', null)
  const [sidebarOpen, setSidebarOpen] = useLocalState('syncr.sidebarOpen', false)
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
  const tabNotes = tabsResult?.notes.filter((n): n is Note => n !== undefined) ?? []
  const activeNote = useLiveQuery(
    () => (activeId ? db.notes.get(activeId) : undefined),
    [activeId],
  )

  // Close tabs whose note no longer exists (e.g. deleted on the other device)
  useEffect(() => {
    if (!tabsResult || tabsResult.ids !== openTabs) return
    const missing = openTabs.filter((_, i) => !tabsResult.notes[i])
    if (missing.length === 0) return
    missing.forEach(forgetScroll)
    const remaining = openTabs.filter((id) => !missing.includes(id))
    setOpenTabs(remaining)
    if (activeId && missing.includes(activeId)) setActiveId(remaining.at(-1) ?? null)
  }, [tabsResult, openTabs, activeId, setOpenTabs, setActiveId])

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
        <button className="menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} title="Notes">
          ☰
        </button>
        <TabBar
          notes={tabNotes}
          activeId={activeId}
          onSelect={openNote}
          onClose={closeTab}
          onNew={newNote}
          onMenu={(noteId, x, y) => setMenu({ noteId, x, y })}
          onRename={askRename}
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
            onNew={newNote}
            onClose={() => setSidebarOpen(false)}
            onMenu={(noteId, x, y) => setMenu({ noteId, x, y })}
            onSettings={() => setSettingsOpen(true)}
          />
        )}
        {showNote ? (
          // key: a fresh view and editor for each note
          <NoteView key={activeNote.id} note={activeNote} autoFocus={activeNote.id === newNoteId} />
        ) : (
          <main className="page">
            <p className="empty">Open a note with ☰, or create one with +.</p>
          </main>
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
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
