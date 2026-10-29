import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react'
import { TaskItem } from '@tiptap/extension-list'
import StarterKit from '@tiptap/starter-kit'
import { ChevronDown, Ellipsis, FolderInput, Heading, Palette, Pencil, Sparkles, Trash2 } from 'lucide-react'
import {
  saveCardContent,
  setCardDeleted,
  setCardColor,
  setCardPriority,
  updateCardTitle,
  type Card as CardData,
} from './db'
import { extensions } from './NoteEditor'
import { colorMenuItems, tintStyle } from './cardColors'
import ContextMenu from './ContextMenu'
import ColorPicker from './ColorPicker'
import { useFoldAnimation, useListItem } from './animations'
import { currentZoom } from './appearance'

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
  onMoveToGroup: (x: number, y: number) => void // "Move to group…": the Board shows the groups there
}

// One card on the Board: the same editor as notes, saved shortly after you stop typing.
// Not editable until you double-click it (or right-click → Edit), so a click and drag moves it
// (Board.tsx). Clicking out of it or Escape ends editing. Checkboxes can be ticked anytime.
// Everything else is in its menu (right-click; "⋯" on the phone): Delete (the Board offers Undo
// for a few seconds), priority (moves up with the other priority cards, blue tint), title.
// Optional title (menu → Add title, or typed first on a new card): bold, centered; clicking it
// folds the text away. Emptying it removes it.
// A card with a title but no text is kept.
// Left empty when editing ends: removed silently, nothing to undo. (Left empty when the
// Board closes: the Board removes it the next time it opens.)
function Card({ card, autoFocus, onDelete, onPress, onMoveToGroup }: Props) {
  // Set while a save is waiting; cleared once it's done.
  const saveTimer = useRef<number | undefined>(undefined)
  // colors: the "Color…" list instead of the menu. editing: as it was when the menu opened, so
  // the items don't move when pressing one ends editing ("Edit" appeared above and the click
  // landed on the wrong item)
  const [menu, setMenu] = useState<{ x: number; y: number; colors?: boolean; editing?: boolean } | null>(null)
  const [editing, setEditing] = useState(autoFocus)
  const [editingTitle, setEditingTitle] = useState(false)
  const cancelTitle = useRef(false) // Escape: the title's blur doesn't save
  const newTitle = useRef(false) // the title of a card just added with "+": Enter goes on to the text
  const hasTitle = useRef(!!card.title) // for onBlur below (it keeps the first render's card)
  hasTitle.current = !!card.title
  const cardRef = useRef<HTMLDivElement>(null)
  useListItem(cardRef)

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
            ? StarterKit.configure({ link: false, codeBlock: false, blockquote: false, trailingNode: false })
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
        if (event.key !== 'Escape' || document.querySelector('.slash-menu-popup, .card-colors')) return false
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

  // A card just added with "+": cursor in its title first (Enter, Tab or ↓ go on to the text,
  // Escape drops the card). The text is editable already, so clicking it skips the title.
  // An effect, not just the starting state: the card can appear before the Board knows it's the
  // new one. (The editor's own autofocus option runs before the card is on the page.)
  useEffect(() => {
    if (!editor || !autoFocus) return
    setEditing(true)
    editor.setEditable(true, false)
    newTitle.current = true
    setEditingTitle(true)
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
  // Gives whether the card has a title now.
  function saveTitle(value: string) {
    setEditingTitle(false)
    if (cancelTitle.current) {
      cancelTitle.current = false
      return !!card.title
    }
    const title = value.trim()
    if (title === (card.title ?? '')) return !!title
    if (title) updateCardTitle(card.id, { title })
    else updateCardTitle(card.id, { title: undefined, titleAlign: undefined, folded: undefined })
    return !!title
  }

  // The new card's title loses focus, not to its text (clicked away, Escape): editing ends, and
  // the card is removed if it's still empty
  function leaveNewCard(titled: boolean) {
    if (!editor) return
    setEditing(false)
    editor.setEditable(false, false)
    if (editor.isEmpty && !titled) setCardDeleted(card.id, true)
  }

  const folded = !!card.title && card.folded
  useFoldAnimation(!!folded, () => document.querySelector(`[data-card-id="${CSS.escape(card.id)}"] > .card-editor`))
  const className = [
    'card',
    card.priority && 'priority',
    card.color && 'colored',
    editing && 'editing',
    (card.title || editingTitle) && 'titled',
    folded && 'folded',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      style={tintStyle(card.color)}
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
        setMenu({ x: event.clientX, y: event.clientY, editing })
      }}
    >
      {(card.title || editingTitle) && (
        <div
          className="card-title"
          title={editingTitle ? undefined : folded ? 'Unfold' : 'Fold'}
          onClick={() => !editingTitle && updateCardTitle(card.id, { folded: card.folded ? undefined : true })}
          onDoubleClick={(event) => event.stopPropagation()} // folds twice, doesn't edit the text
        >
          {card.title && <ChevronDown size={14} className="card-fold" />}
          {editingTitle ? (
            <input
              autoFocus
              defaultValue={card.title ?? ''}
              placeholder="Title"
              spellCheck={false}
              onBlur={(event) => {
                const toText = !!editor && editor.view.dom.contains(event.relatedTarget as Node | null)
                const titled = saveTitle(event.currentTarget.value)
                if (!newTitle.current) return
                newTitle.current = false
                if (!toText) leaveNewCard(titled)
              }}
              onKeyDown={(event) => {
                if (newTitle.current && ['Enter', 'Tab', 'ArrowDown'].includes(event.key)) {
                  event.preventDefault()
                  editor?.commands.focus('end') // blurs the title: saved above
                  return
                }
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  cancelTitle.current = true
                  event.currentTarget.blur()
                }
              }}
            />
          ) : (
            <span>{card.title}</span>
          )}
        </div>
      )}
      <EditorContent editor={editor} className="card-editor" />
      <div className="card-buttons">
        {editing && editor && <CardColorButton editor={editor} />}
        {/* Phone only (CSS): opens the card's menu (right-click on the PC) */}
        <button
          className="card-more"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            setMenu({ x: box.left, y: box.bottom + 4, editing })
          }}
          title="More"
        >
          <Ellipsis size={13} />
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={menu.colors ? colorMenuItems(card.color, (color) => setCardColor(card.id, color)) : [
            // Edit: phone only (on the PC a double-click edits; a double tap is unreliable)
            ...(menu.editing || !window.matchMedia('(pointer: coarse)').matches
              ? []
              : [{ label: 'Edit', icon: Pencil, onClick: () => startEditing() }]),
            { label: card.title ? 'Edit title' : 'Add title', icon: Heading, divider: true, onClick: () => setEditingTitle(true) },
            {
              label: card.priority ? 'Remove priority' : 'Mark as priority',
              icon: Sparkles,
              divider: true,
              onClick: () => setCardPriority(card.id, !card.priority),
            },
            { label: 'Color…', icon: Palette, onClick: () => setMenu({ ...menu, colors: true }) },
            { label: 'Move to group…', icon: FolderInput, onClick: () => onMoveToGroup(menu.x, menu.y) },
            { label: 'Delete', icon: Trash2, danger: true, onClick: onDelete },
          ]}
        />
      )}
    </div>
  )
}

// While editing: text colors for the selected text (no highlights on cards), like the toolbar's
// color button in notes. Only shown while some text is selected; the colors close by themselves
// when the selection goes (a color picked, a click elsewhere, Escape).
function CardColorButton({ editor }: { editor: Editor }) {
  const hasSelection = useEditorState({ editor, selector: ({ editor }) => !editor.state.selection.empty })
  const [colors, setColors] = useState<{ right: number; top: number } | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hasSelection) setColors(null)
  }, [hasSelection])

  useEffect(() => {
    if (!colors) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (!panel.current?.contains(target) && !target.closest('.card-color')) setColors(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setColors(null)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [colors])

  function toggle(button: HTMLElement) {
    if (colors) return setColors(null)
    const rect = button.getBoundingClientRect()
    const zoom = currentZoom()
    // Lined up with the button's right edge (the Board is at the window's right)
    setColors({ right: (window.innerWidth - rect.right) / zoom, top: rect.bottom / zoom + 4 })
  }

  if (!hasSelection) return null
  return (
    <>
      <button
        className={['card-color', colors && 'active'].filter(Boolean).join(' ')}
        title="Text color"
        aria-label="Text color"
        // Keep the selection (and the phone keyboard) in the card
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => toggle(e.currentTarget)}
      >
        <Palette size={13} />
      </button>
      {colors && (
        <div className="color-popover card-colors" ref={panel} style={colors}>
          <ColorPicker editor={editor} onPicked={() => setColors(null)} highlights={false} />
        </div>
      )}
    </>
  )
}

export default Card
