import { useEffect, useRef } from 'react'
import type { Note } from './db'
import { getScroll, setScroll } from './localState'
import NoteEditor from './NoteEditor'

const SAVE_SCROLL_MS = 200

// The scrollable page around the editor. Restores and remembers the scroll position.
function NoteView({ note, autoFocus }: { note: Note; autoFocus: boolean }) {
  const pageRef = useRef<HTMLElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)

  // On open: go back to where we were (bottom by default).
  // Runs after the editor has put the note's text on the page.
  useEffect(() => {
    const page = pageRef.current
    if (!page) return
    const saved = getScroll(note.id)
    page.scrollTop = !saved || saved.atBottom ? page.scrollHeight : saved.top
  }, [note.id])

  function onScroll() {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const page = pageRef.current
      if (!page) return
      const atBottom = page.scrollHeight - page.scrollTop - page.clientHeight < 4
      setScroll(note.id, { top: page.scrollTop, atBottom })
    }, SAVE_SCROLL_MS)
  }

  return (
    <main className="page" ref={pageRef} onScroll={onScroll}>
      <NoteEditor note={note} autoFocus={autoFocus} />
    </main>
  )
}

export default NoteView
