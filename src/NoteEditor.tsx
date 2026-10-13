import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Placeholder } from '@tiptap/extensions'
import { saveNoteContent, type Note } from './db'
import SelectionMenu from './SelectionMenu'
import { ClickTitleToToggle } from './clickTitleToToggle'

const SAVE_DELAY_MS = 500

const extensions = [
  StarterKit,
  // Collapsible sections. Open/closed isn't saved, so they're always closed when a note opens.
  Details.configure({
    persist: false,
    renderToggleButton: ({ element, isOpen }) => {
      element.textContent = '▶'
      element.setAttribute('aria-label', isOpen ? 'Close section' : 'Open section')
    },
  }),
  DetailsSummary,
  DetailsContent,
  ClickTitleToToggle,
  Placeholder.configure({
    includeChildren: true,
    placeholder: ({ node }) => (node.type.name === 'detailsSummary' ? 'Section title' : ''),
  }),
]

// Edits one note and saves it automatically shortly after you stop typing.
function NoteEditor({ note, autoFocus }: { note: Note; autoFocus: boolean }) {
  // Set while a save is waiting; cleared once it's done.
  const saveTimer = useRef<number | undefined>(undefined)

  const editor = useEditor({
    extensions,
    content: note.content,
    autofocus: autoFocus ? 'end' : false,
    onUpdate: ({ editor }) => {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = undefined
        saveNoteContent(note.id, editor.getJSON(), editor.getText({ blockSeparator: '\n' }))
      }, SAVE_DELAY_MS)
    },
  })

  // Save right away if the note is closed while a save is still waiting.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== undefined && editor) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = undefined
        saveNoteContent(note.id, editor.getJSON(), editor.getText({ blockSeparator: '\n' }))
      }
    }
  }, [editor, note.id])

  return (
    <>
      <SelectionMenu editor={editor} />
      <EditorContent editor={editor} className="editor" />
    </>
  )
}

export default NoteEditor
