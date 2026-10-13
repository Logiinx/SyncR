import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createNote, db, type Note } from './db'
import { forgetScroll, useLocalState } from './localState'
import NoteView from './NoteView'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import UpdateBanner from './UpdateBanner'

const isNarrowScreen = () => window.matchMedia('(max-width: 699px)').matches

function App() {
  // Remembered after a restart (per device)
  const [openTabs, setOpenTabs] = useLocalState<string[]>('syncr.tabs', [])
  const [activeId, setActiveId] = useLocalState<string | null>('syncr.activeTab', null)
  const [sidebarOpen, setSidebarOpen] = useLocalState('syncr.sidebarOpen', false)
  // Only a brand-new note gets the cursor automatically
  const [newNoteId, setNewNoteId] = useState<string | null>(null)

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

  const showNote = activeNote && openTabs.includes(activeNote.id)

  return (
    <div className="app">
      <UpdateBanner />
      <header className="topbar">
        <button className="menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} title="Notes">
          ☰
        </button>
        <TabBar
          notes={tabNotes}
          activeId={activeId}
          onSelect={openNote}
          onClose={closeTab}
          onNew={newNote}
        />
      </header>

      <div className="body">
        {sidebarOpen && (
          <Sidebar
            activeId={activeId}
            onOpen={openNote}
            onNew={newNote}
            onClose={() => setSidebarOpen(false)}
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
    </div>
  )
}

export default App
