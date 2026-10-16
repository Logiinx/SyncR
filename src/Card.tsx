import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Flag, X } from 'lucide-react'
import { saveCardContent, setCardDeleted, setCardPriority, type Card as CardData } from './db'
import { extensions } from './NoteEditor'
import ContextMenu from './ContextMenu'

const SAVE_DELAY_MS = 500

interface Props {
  card: CardData
  autoFocus: boolean
  onDelete: () => void
}

// One card on the Board: the same editor as notes, saved shortly after you stop typing.
// ✕ deletes it (the Board offers Undo for a few seconds). The flag (or right-click) marks it
// as priority: it moves up with the other priority cards (Board.tsx) and gets an orange look.
// Left empty when clicking away: removed silently, nothing to undo. (Left empty when the
// Board closes: the Board removes it the next time it opens.)
function Card({ card, autoFocus, onDelete }: Props) {
  // Set while a save is waiting; cleared once it's done.
  const saveTimer = useRef<number | undefined>(undefined)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

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
    // Clicking out of the card: save now, or remove it if it's empty
    onBlur: ({ editor }) => {
      if (editor.isEmpty) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = undefined
        setCardDeleted(card.id, true)
        return
      }
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

  // Closing the Board (or deleting the card) while a save is waiting: save it now.
  // Not the place to remove an empty card: in development React runs this cleanup once right
  // after the card appears (StrictMode), which removed every new card.
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
    <div
      className={`card${card.priority ? ' priority' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <EditorContent editor={editor} className="card-editor" />
      <div className="card-buttons">
        <button
          className="card-flag"
          onClick={() => setCardPriority(card.id, !card.priority)}
          title={card.priority ? 'Remove priority' : 'Mark as priority'}
        >
          <Flag size={12} />
        </button>
        <button className="card-delete" onClick={onDelete} title="Delete card">
          <X size={13} />
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: card.priority ? 'Remove priority' : 'Mark as priority',
              onClick: () => setCardPriority(card.id, !card.priority),
            },
            { label: 'Delete', danger: true, onClick: onDelete },
          ]}
        />
      )}
    </div>
  )
}

export default Card
