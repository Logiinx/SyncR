import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { saveNoteContent, type Note } from './db'

const SAVE_DELAY_MS = 500

// Edits one note and saves it automatically shortly after you stop typing.
function NoteEditor({ note, autoFocus }: { note: Note; autoFocus: boolean }) {
  const saveTimer = useRef<number | undefined>(undefined)

  const editor = useEditor({
    extensions: [StarterKit],
    content: note.content,
    autofocus: autoFocus ? 'end' : false,
    onUpdate: ({ editor }) => {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        saveNoteContent(note.id, editor.getJSON(), editor.getText({ blockSeparator: '\n' }))
      }, SAVE_DELAY_MS)
    },
  })

  // Save right away if the note is closed before the delay is over.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== undefined && editor) {
        window.clearTimeout(saveTimer.current)
        saveNoteContent(note.id, editor.getJSON(), editor.getText({ blockSeparator: '\n' }))
      }
    }
  }, [editor, note.id])

  return <EditorContent editor={editor} className="editor" />
}

export default NoteEditor
