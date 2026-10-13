import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createNote, db, noteTitle } from './db'
import NoteEditor from './NoteEditor'
import Sidebar from './Sidebar'
import UpdateBanner from './UpdateBanner'

function App() {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const activeNote = useLiveQuery(
    () => (activeId ? db.notes.get(activeId) : undefined),
    [activeId],
  )

  function openNote(id: string) {
    setActiveId(id)
    setSidebarOpen(false)
  }

  async function newNote() {
    openNote(await createNote())
  }

  return (
    <div className="app">
      <UpdateBanner />
      <header className="topbar">
        <button className="menu-button" onClick={() => setSidebarOpen(true)} title="Notes">
          ☰
        </button>
        {/* Replaced by tabs in step 4b */}
        <span className="current-title">{activeNote ? noteTitle(activeNote) : ''}</span>
      </header>

      {sidebarOpen && (
        <Sidebar
          activeId={activeId}
          onOpen={openNote}
          onNew={newNote}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      <main className="page">
        {activeNote ? (
          // key: a fresh editor for each note
          <NoteEditor key={activeNote.id} note={activeNote} />
        ) : (
          <p className="empty">Open a note with ☰, or create a new one.</p>
        )}
      </main>
    </div>
  )
}

export default App
