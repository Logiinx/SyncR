import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Link } from '@tiptap/extension-link'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { Highlight } from '@tiptap/extension-highlight'
import { registerFlush, syncSoon } from './autoSync'
import { noteTitle, saveNoteContent, type Note } from './db'
import SelectionMenu from './SelectionMenu'
import Toolbar from './Toolbar'
import ImageViewer from './ImageViewer'
import ContextMenu from './ContextMenu'
import { ClickTitleToToggle } from './clickTitleToToggle'
import { Image } from './image'
import { OpenLinksOnClick } from './links'
import { tableExtensions } from './tables'
import { ColorRules } from './colorRules'
import { ListEnter } from './lists'
import { SmartTypography } from './typography'
import { CodeBlock } from './codeBlock'
import { DragSections } from './dragSections'
import { SlashMenu } from './slashMenu'
import { jumpToBlock, NoteLinks, PROTOCOL, takePendingJump } from './noteLinks'
import { NotePicker } from './notePicker'
import TableMenu from './TableMenu'
import { CellSelection } from '@tiptap/pm/tables'

const SAVE_DELAY_MS = 500

const extensions = [
  StarterKit.configure({ link: false, codeBlock: false }),
  CodeBlock,
  // Links: pasting an address makes a link (also over selected text). Clicks: see links.ts.
  // Not "inclusive": text typed right after a link doesn't become part of it.
  // syncr:note/… links point to another note (noteLinks.ts)
  Link.extend({ inclusive: () => false }).configure({
    openOnClick: false,
    protocols: [{ scheme: PROTOCOL, optionalSlashes: true }],
  }),
  NoteLinks,
  NotePicker,
  OpenLinksOnClick,
  // Text color and highlighter, from a fixed palette (ColorPicker.tsx)
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  ColorRules,
  ListEnter,
  SmartTypography,
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
  DragSections,
  SlashMenu,
  Image,
  // Checklists. Typing "[ ] " at the start of a line also makes one; Tab indents an item.
  TaskList,
  TaskItem.configure({ nested: true }),
  ...tableExtensions,
  Placeholder.configure({
    includeChildren: true,
    placeholder: ({ node }) => (node.type.name === 'detailsSummary' ? 'Section title' : ''),
  }),
]

// Edits one note and saves it automatically shortly after you stop typing.
function NoteEditor({ note, autoFocus }: { note: Note; autoFocus: boolean }) {
  // Set while a save is waiting; cleared once it's done.
  const saveTimer = useRef<number | undefined>(undefined)
  const [imageMenu, setImageMenu] = useState<{ pos: number; x: number; y: number } | null>(null)
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null)

  const editor = useEditor({
    extensions,
    content: note.content,
    autofocus: autoFocus ? 'end' : false,
    // No red spelling lines under words
    editorProps: { attributes: { spellcheck: 'false' } },
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

  // A link to this note was followed: jump to the linked block. Waits a moment, so it comes
  // after NoteView has restored the scroll position.
  useEffect(() => {
    if (!editor) return
    editor.storage.notePicker.noteId = note.id // the [[ picker marks "this note"
    const jump = () => {
      const target = takePendingJump(note.id)
      if (target?.blockId) setTimeout(() => jumpToBlock(editor, target.blockId!))
    }
    jump()
    window.addEventListener('syncr-jump', jump)
    return () => window.removeEventListener('syncr-jump', jump)
  }, [editor, note.id])

  // Right-click (long press on a phone) on an image: menu with "Delete image". In a table:
  // the table menu. Elsewhere in the note, the normal menu (copy, paste, spelling) stays.
  function onContextMenu(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('td, th')) {
      e.preventDefault()
      // The menu works on the cell under the mouse, unless several cells are selected
      if (!(editor.state.selection instanceof CellSelection)) {
        const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
        if (pos) editor.chain().focus().setTextSelection(pos.pos).run()
      }
      setTableMenu({ x: e.clientX, y: e.clientY })
      return
    }
    const box = target.closest('.note-image')
    if (!box) return
    e.preventDefault()
    setImageMenu({ pos: editor.view.posAtDOM(box, 0), x: e.clientX, y: e.clientY })
  }

  function deleteImage(pos: number) {
    const node = editor.state.doc.nodeAt(pos)
    if (node?.type.name !== 'image') return // the note changed meanwhile (e.g. sync)
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
  }

  return (
    <>
      <Toolbar editor={editor} />
      <ImageViewer />
      <SelectionMenu editor={editor} noteId={note.id} title={noteTitle(note)} />
      <EditorContent editor={editor} className="editor" onContextMenu={onContextMenu} />
      {tableMenu && <TableMenu editor={editor} x={tableMenu.x} y={tableMenu.y} onClose={() => setTableMenu(null)} />}
      {imageMenu && (
        <ContextMenu
          x={imageMenu.x}
          y={imageMenu.y}
          onClose={() => setImageMenu(null)}
          items={[{ label: 'Delete image', danger: true, onClick: () => deleteImage(imageMenu.pos) }]}
        />
      )}
    </>
  )
}

export default NoteEditor
