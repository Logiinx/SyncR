import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Placeholder } from '@tiptap/extensions'
import { registerFlush, syncSoon } from './autoSync'
import { saveNoteContent, type Note } from './db'
import SelectionMenu from './SelectionMenu'
import { ClickTitleToToggle } from './clickTitleToToggle'
import { Image } from './image'

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
  Image,
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

  // The note was changed from outside (sync downloaded a newer version): show it.
  // Skipped while a save is waiting, because then this device's edit is the newest.
  useEffect(() => {
    if (!editor || !note.content || saveTimer.current !== undefined) return
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(note.content)) {
      editor.commands.setContent(note.content, { emitUpdate: false })
    }
  }, [editor, note.content])

  useEffect(() => {
    if (!editor) return

    // Saves now if a save is waiting
    const saveNow = async () => {
      if (saveTimer.current === undefined) return
      window.clearTimeout(saveTimer.current)
      saveTimer.current = undefined
      await saveNoteContent(note.id, editor.getJSON(), editor.getText({ blockSeparator: '\n' }))
    }

    // Leaving the editor (tap elsewhere, phone keyboard closed) or the app (back button,
    // switching apps): save now, then sync right away.
    const saveAndSync = () => saveNow().then(syncSoon)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveAndSync()
    }
    editor.on('blur', saveAndSync)
    document.addEventListener('visibilitychange', onVisibility)
    // Closing the app or installing an update: finalSync() saves this editor first
    const unregister = registerFlush(saveNow)

    return () => {
      editor.off('blur', saveAndSync)
      document.removeEventListener('visibilitychange', onVisibility)
      unregister()
      // The note is closed (tab closed, other note opened): save a waiting edit
      saveNow()
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
