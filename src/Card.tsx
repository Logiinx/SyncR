import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import { TaskItem } from '@tiptap/extension-list'
import StarterKit from '@tiptap/starter-kit'
import { ChevronDown, Ellipsis, Sparkles, X } from 'lucide-react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  saveCardContent,
  setCardDeleted,
  setCardPriority,
  updateCardTitle,
  type Card as CardData,
} from './db'
import { extensions } from './NoteEditor'
import ContextMenu from './ContextMenu'
import ColorPicker from './ColorPicker'

const SAVE_DELAY_MS = 500

const LISTS = ['bulletList', 'orderedList', 'taskList']

// Cards made before the trailing paragraph was switched off (see below) may end with an
// empty paragraph right after a list: drop it when a card is shown or changed by sync.
// (Not while typing: leaving a list with Enter makes the same empty line, and it must stay.)
function withoutTrailingLine(content: JSONContent): JSONContent {
  const blocks = content.content ?? []
  const last = blocks[blocks.length - 1]
  const beforeLast = blocks[blocks.length - 2]
  if (last?.type === 'paragraph' && !last.content?.length && LISTS.includes(beforeLast?.type ?? '')) {
    return { ...content, content: blocks.slice(0, -1) }
  }
  return content
}

interface Props {
  card: CardData
  autoFocus: boolean // just added with "+": starts in edit mode, cursor in it
  onDelete: () => void
  onPress: (event: React.PointerEvent) => void // pressed (not while editing): may start a drag (Board.tsx)
}

// One card on the Board: the same editor as notes, saved shortly after you stop typing.
// Not editable until you double-click it (or right-click → Edit), so a click and drag moves it
// (Board.tsx). Clicking out of it or Escape ends editing. Checkboxes can be ticked anytime.
// ✕ deletes it (the Board offers Undo for a few seconds). The sparkle (or right-click) marks it
// as priority: it moves up with the other priority cards and gets a blue tint.
// Optional title (right-click → Add title): bold, centered or left, edited with a double-click,
// and its ▾ folds the text away. A card with a title but no text is kept.
// Left empty when editing ends: removed silently, nothing to undo. (Left empty when the
// Board closes: the Board removes it the next time it opens.)
function Card({ card, autoFocus, onDelete, onPress }: Props) {
  // Set while a save is waiting; cleared once it's done.
  const saveTimer = useRef<number | undefined>(undefined)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(autoFocus)
  const [editingTitle, setEditingTitle] = useState(false)
  const cancelTitle = useRef(false) // Escape: the title's blur doesn't save
  const hasTitle = useRef(!!card.title) // for onBlur below (it keeps the first render's card)
  hasTitle.current = !!card.title
  const cardRef = useRef<HTMLDivElement>(null)

  const save = (editor: Editor) =>
    saveCardContent(card.id, editor.getJSON(), editor.getText({ blockSeparator: '\n' }))

  // The notes' extensions, except that checkboxes can be ticked while the card isn't being
  // edited (the editor allows it, and the "change" listener below saves it in the card).
  // No trailing paragraph: in notes it keeps a line free below a list at the end, but on a
  // card it looks like an empty line that can't be removed. Enter on an empty item ends a list.
  const cardExtensions = useMemo(
    () =>
      extensions.map((extension) =>
        extension.name === 'taskItem'
          ? TaskItem.configure({ nested: true, onReadOnlyChecked: () => true })
          : extension.name === 'starterKit'
            ? StarterKit.configure({ link: false, codeBlock: false, trailingNode: false })
            : extension,
      ),
    [],
  )

  const editor = useEditor({
    extensions: cardExtensions,
    content: card.content && withoutTrailingLine(card.content),
    editable: autoFocus,
    editorProps: {
      attributes: { spellcheck: 'false' },
      // Escape ends editing (unless the "/" menu is open: then Escape closes that)
      handleKeyDown: (view, event) => {
        if (event.key !== 'Escape' || document.querySelector('.slash-menu-popup')) return false
        view.dom.blur()
        return true
      },
    },
    onUpdate: ({ editor }) => {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = undefined
        save(editor)
      }, SAVE_DELAY_MS)
    },
    // Clicking out of the card: editing ends; save now, or remove the card if it's empty
    onBlur: ({ editor }) => {
      setEditing(false)
      editor.setEditable(false, false)
      if (editor.isEmpty && !hasTitle.current) {
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

  // A checkbox ticked while not editing: the editor leaves the item unchanged then, so set it
  // here. The item is found from the checkbox's place on the page. (A plain listener: the
  // checkbox is made by the editor, not React, so React's onChange doesn't see it.)
  useEffect(() => {
    const element = cardRef.current
    if (!editor || !element) return
    const tick = (event: Event) => {
      const input = event.target as HTMLInputElement
      const item = input.closest('li')
      if (editor.isEditable || input.type !== 'checkbox' || !item) return
      const pos = editor.view.posAtDOM(item, 0) - 1 // just before the item
      const node = editor.state.doc.nodeAt(pos)
      if (node?.type.name !== 'taskItem') return
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: input.checked }))
    }
    element.addEventListener('change', tick)
    return () => element.removeEventListener('change', tick)
  }, [editor])

  // Double-click (or right-click → Edit): edit, with the cursor where you clicked
  function startEditing(at?: { left: number; top: number }) {
    if (!editor) return
    setEditing(true)
    editor.setEditable(true, false)
    const pos = at && editor.view.posAtCoords(at)?.pos
    if (pos !== undefined) editor.chain().focus().setTextSelection(pos).run()
    else editor.commands.focus('end')
  }

  // A card just added with "+": edit it, cursor in it, ready to type. An effect, not just the
  // starting state: the card can appear before the Board knows it's the new one. (The editor's
  // own autofocus option runs before the card is on the page, so it didn't work here either.)
  useEffect(() => {
    if (editor && autoFocus) startEditing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, autoFocus])

  // The card was changed from outside (sync): show it, unless an edit is waiting.
  // Both compared without that empty line, so the one just made by leaving a list stays.
  useEffect(() => {
    if (!editor || !card.content || saveTimer.current !== undefined) return
    const content = withoutTrailingLine(card.content)
    if (JSON.stringify(withoutTrailingLine(editor.getJSON())) !== JSON.stringify(content)) {
      editor.commands.setContent(content, { emitUpdate: false })
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

  // Title typed: saved when it loses focus (Enter too). Emptied: the title is removed.
  function saveTitle(value: string) {
    setEditingTitle(false)
    if (cancelTitle.current) {
      cancelTitle.current = false
      return
    }
    const title = value.trim()
    if (title === (card.title ?? '')) return
    if (title) updateCardTitle(card.id, { title })
    else updateCardTitle(card.id, { title: undefined, titleAlign: undefined, folded: undefined })
  }

  const folded = !!card.title && card.folded
  const className = [
    'card',
    card.priority && 'priority',
    editing && 'editing',
    (card.title || editingTitle) && 'titled',
    folded && 'folded',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      data-card-id={card.id}
      ref={cardRef}
      onPointerDown={(event) => {
        // Checkboxes, links and the buttons keep their own click
        const target = event.target as HTMLElement
        if (!editing && !target.closest('input, label, a, button')) onPress(event)
      }}
      onDoubleClick={(event) => {
        if (!editing) startEditing({ left: event.clientX, top: event.clientY })
      }}
      onContextMenu={(event) => {
        // Phone: a long press on the text is for Android's menu (copy, paste); the card's menu
        // is on the "⋯" button instead, so the two never open together
        if (window.matchMedia('(pointer: coarse)').matches) return
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      {(card.title || editingTitle) && (
        <div className={`card-title${card.titleAlign === 'left' ? ' left' : ''}`}>
          {card.title && (
            <button
              className="card-fold"
              onClick={() => updateCardTitle(card.id, { folded: card.folded ? undefined : true })}
              title={folded ? 'Unfold' : 'Fold'}
            >
              <ChevronDown size={14} />
            </button>
          )}
          {editingTitle ? (
            <input
              autoFocus
              defaultValue={card.title ?? ''}
              placeholder="Title"
              spellCheck={false}
              onBlur={(event) => saveTitle(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  cancelTitle.current = true
                  event.currentTarget.blur()
                }
              }}
            />
          ) : (
            <span
              onDoubleClick={(event) => {
                event.stopPropagation() // edits the title, not the text
                setEditingTitle(true)
              }}
            >
              {card.title}
            </span>
          )}
        </div>
      )}
      <EditorContent editor={editor} className="card-editor" />
      {/* Selected text while editing: text colors (no highlights on cards) */}
      {editor && (
        <BubbleMenu
          editor={editor}
          className="selection-menu card-color-menu"
          options={{ placement: 'bottom', offset: 8, flip: true, shift: { padding: 8 } }}
        >
          <ColorPicker editor={editor} onPicked={() => {}} highlights={false} />
        </BubbleMenu>
      )}
      <div className="card-buttons">
        {/* Phone only (CSS): opens the card's menu (right-click on the PC) */}
        <button
          className="card-more"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            setMenu({ x: box.left, y: box.bottom + 4 })
          }}
          title="More"
        >
          <Ellipsis size={13} />
        </button>
        <button
          className="card-priority"
          onClick={() => setCardPriority(card.id, !card.priority)}
          title={card.priority ? 'Remove priority' : 'Mark as priority'}
        >
          <Sparkles size={12} />
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
            ...(editing ? [] : [{ label: 'Edit', onClick: () => startEditing() }]),
            ...(card.title
              ? [
                  { label: 'Edit title', onClick: () => setEditingTitle(true) },
                  {
                    label: card.titleAlign === 'left' ? 'Center title' : 'Align title left',
                    onClick: () =>
                      updateCardTitle(card.id, { titleAlign: card.titleAlign === 'left' ? undefined : 'left' }),
                  },
                  {
                    label: 'Remove title',
                    onClick: () => updateCardTitle(card.id, { title: undefined, titleAlign: undefined, folded: undefined }),
                  },
                ]
              : [{ label: 'Add title', onClick: () => setEditingTitle(true) }]),
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
