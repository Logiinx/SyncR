import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { X } from 'lucide-react'
import { saveCardContent, type Card as CardData } from './db'
import { extensions } from './NoteEditor'

const SAVE_DELAY_MS = 500

interface Props {
  card: CardData
  autoFocus: boolean
  onDelete: () => void
}

// One card on the Board: the same editor as notes, saved shortly after you stop typing.
// ✕ deletes it (the Board offers Undo for a few seconds).
function Card({ card, autoFocus, onDelete }: Props) {
  // Set while a save is waiting; cleared once it's done.
  const saveTimer = useRef<number | undefined>(undefined)

  const save = (editor: NonNullable<ReturnType<typeof useEditor>>) =>
    saveCardContent(card.id, editor.getJSON(), editor.getText({ blockSeparator: '\n' }))

  const editor = useEditor({
    extensions,
    content: card.content,
    editorProps: { attributes: { spellcheck: 'false' } },
    onUpdate: ({ editor }) => {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = undefined
        save(editor)
      }, SAVE_DELAY_MS)
    },
    // Clicking out of the card: save now
    onBlur: ({ editor }) => {
      if (saveTimer.current === undefined) return
      window.clearTimeout(saveTimer.current)
      saveTimer.current = undefined
      save(editor)
    },
  })

  // A card just added with "+": put the cursor in it, ready to type. (The editor's own
  // autofocus option runs before the card is on the page, so it didn't work here.)
  useEffect(() => {
    if (editor && autoFocus) editor.commands.focus('end')
  }, [editor, autoFocus])

  // The card was changed from outside (later: sync): show it, unless an edit is waiting
  useEffect(() => {
    if (!editor || !card.content || saveTimer.current !== undefined) return
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(card.content)) {
      editor.commands.setContent(card.content, { emitUpdate: false })
    }
  }, [editor, card.content])

  // Closing the Board (or deleting the card) while a save is waiting: save it now
  useEffect(() => {
    if (!editor) return
    return () => {
      if (saveTimer.current === undefined) return
      window.clearTimeout(saveTimer.current)
      saveTimer.current = undefined
      save(editor)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  return (
    <div className="card">
      <EditorContent editor={editor} className="card-editor" />
      <button className="card-delete" onClick={onDelete} title="Delete card">
        <X size={13} />
      </button>
    </div>
  )
}

export default Card
