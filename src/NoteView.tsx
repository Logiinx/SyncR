import { useEffect, useRef } from 'react'
import type { Note } from './db'
import { getScroll, setScroll } from './localState'
import NoteEditor from './NoteEditor'

const SAVE_SCROLL_MS = 200

const isAtBottom = (page: HTMLElement) => page.scrollHeight - page.scrollTop - page.clientHeight < 4

// The scrollable page around the editor. Restores and remembers the scroll position.
function NoteView({ note, autoFocus }: { note: Note; autoFocus: boolean }) {
  const pageRef = useRef<HTMLElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const atBottom = useRef(false)

  // On open: go back to where we were (bottom by default).
  // Runs after the editor has put the note's text on the page.
  useEffect(() => {
    const page = pageRef.current
    if (!page) return
    const saved = getScroll(note.id)
    page.scrollTop = !saved || saved.atBottom ? page.scrollHeight : saved.top
    atBottom.current = isAtBottom(page)
  }, [note.id])

  // At the bottom of the note: stay there when the note changes size. E.g. opening the sidebar
  // makes the note narrower, its lines wrap and it gets taller, which would push the end of
  // the note out of view. (Elsewhere the browser keeps the top line in place by itself.)
  useEffect(() => {
    const page = pageRef.current
    const content = page?.querySelector('.editor')
    if (!page || !content) return
    const observer = new ResizeObserver(() => {
      if (atBottom.current) page.scrollTop = page.scrollHeight
    })
    observer.observe(page)
    observer.observe(content)
    return () => observer.disconnect()
  }, [note.id])

  function onScroll() {
    if (pageRef.current) atBottom.current = isAtBottom(pageRef.current)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const page = pageRef.current
      if (!page) return
      setScroll(note.id, { top: page.scrollTop, atBottom: isAtBottom(page) })
    }, SAVE_SCROLL_MS)
  }

  return (
    <main className="page" ref={pageRef} onScroll={onScroll}>
      <NoteEditor note={note} autoFocus={autoFocus} />
    </main>
  )
}

export default NoteView
