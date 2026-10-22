import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditorState, type Editor, type JSONContent } from '@tiptap/react'
import {
  Bold,
  Check,
  Ellipsis,
  FoldVertical,
  IndentIncrease,
  ImageIcon,
  Italic,
  Link,
  ListTodo,
  Palette,
  Pin,
  Redo2,
  Rows3,
  SquareCode,
  Strikethrough,
  Table,
  Underline,
  Undo2,
} from 'lucide-react'
import { currentZoom } from './appearance'
import ColorPicker from './ColorPicker'
import ContextMenu from './ContextMenu'
import { canMakeCodeBlock, codeBlockToParagraphs, selectionToCodeBlock } from './codeBlock'
import { createCard } from './db'
import { insertImages } from './image'
import { hasLineBreaks, splitLineBreaks } from './lineBreaks'
import { alignLine, pathAbove } from './alignPaths'
import { copyLinkToBlock } from './noteLinks'
import { useNarrow } from './useNarrow'

const ICON_SIZE = 16

// Slim bar above the note, pinned while the note scrolls. Groups: undo · text style · what the
// lines are (checklist, section, code, separate lines) · insert · use elsewhere (link, pin).
// Buttons that can't be used right now are grayed out, so the others never move. Without a
// selection, the line buttons act on the cursor's line. On a phone the buttons after Checklist
// don't fit: they're in a "⋯" list. Scrolls sideways if it still doesn't fit.
function Toolbar({ editor, noteId, title }: { editor: Editor; noteId: string; title: string }) {
  const narrow = useNarrow()
  const fileInput = useRef<HTMLInputElement>(null)
  // Color picker under the color button (fixed: the toolbar itself may scroll sideways)
  const [colors, setColors] = useState<{ left: number; top: number } | null>(null)
  const colorPanel = useRef<HTMLDivElement>(null)

  // Closes on a click elsewhere or Escape
  useEffect(() => {
    if (!colors) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (!colorPanel.current?.contains(target) && !target.closest('.color-button')) setColors(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setColors(null)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [colors])

  function toggleColors(button: HTMLElement) {
    if (colors) return setColors(null)
    const rect = button.getBoundingClientRect()
    const zoom = currentZoom()
    setColors({ left: rect.left / zoom, top: rect.bottom / zoom + 4 })
  }

  // Re-checked whenever the cursor or the note changes: which buttons light up
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      checklist: editor.isActive('taskList'),
      inSection: editor.isActive('details'),
      canMakeSection: editor.can().setDetails(),
      inCodeBlock: editor.isActive('codeBlock'),
      canMakeCodeBlock: canMakeCodeBlock(editor),
      hasLineBreaks: hasLineBreaks(editor),
      canAlign: !!pathAbove(editor),
      aligned: !!editor.state.selection.$from.parent.attrs.alignIndent,
      hasSelection: !editor.state.selection.empty,
    }),
  })

  const chain = () => editor.chain().focus()

  // Section and code block: one button each, lit when the cursor is inside one; clicking it
  // then turns it back into normal lines
  const toggleSection = () => (state.inSection ? chain().unsetDetails().run() : chain().setDetails().run())
  const toggleCodeBlock = () => (state.inCodeBlock ? codeBlockToParagraphs(editor) : selectionToCodeBlock(editor))
  const insertTable = () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  const pickImage = () => fileInput.current?.click()
  // Like Tab, but after the last ">" back to the left edge (no Shift+Tab on a phone)
  const alignUnder = () => alignLine(editor, 1, true) && editor.commands.focus()

  // A check mark for a moment after "Copy link" or "Pin" (on the "⋯" button on a phone)
  const [done, setDone] = useState<'link' | 'pin' | null>(null)
  const showDone = (what: 'link' | 'pin') => {
    setDone(what)
    setTimeout(() => setDone(null), 1200)
  }

  // "Copy link": a link to the cursor's line, to paste in any note
  const copyLink = () => copyLinkToBlock(editor, noteId, title).then(() => showDone('link'))

  // "Pin": the selection (with its formatting) becomes a new priority card on the Board.
  // A piece that can't stand on its own (e.g. part of a table) is pinned as plain text.
  async function pin() {
    const { from, to } = editor.state.selection
    const text = editor.state.doc.textBetween(from, to, '\n').trim()
    if (!text) return
    let content: JSONContent = { type: 'doc', content: editor.state.selection.content().content.toJSON() }
    try {
      editor.schema.nodeFromJSON(content).check()
    } catch {
      content = {
        type: 'doc',
        content: text.split('\n').map((line) => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : undefined,
        })),
      }
    }
    await createCard({ content, text, priority: true })
    window.dispatchEvent(new Event('open-board')) // App.tsx: shows the Board if it's hidden
    showDone('pin')
  }

  // Phone: the "⋯" list, with only what can be used right now
  const [more, setMore] = useState<{ x: number; y: number } | null>(null)
  const moreItems = [
    { label: state.inSection ? 'Remove section' : 'Section', show: state.inSection || state.canMakeSection, onClick: toggleSection },
    {
      label: state.inCodeBlock ? 'Back to normal text' : 'Code block',
      show: state.inCodeBlock || state.canMakeCodeBlock,
      onClick: toggleCodeBlock,
    },
    { label: 'Separate lines', show: state.hasLineBreaks, onClick: () => splitLineBreaks(editor) },
    { label: 'Align under ">"', show: state.canAlign, onClick: alignUnder },
    { label: 'Table', show: true, onClick: insertTable },
    { label: 'Image', show: true, onClick: pickImage },
    { label: 'Copy link to this spot', show: true, onClick: copyLink },
    { label: 'Pin to Board', show: state.hasSelection, onClick: pin },
  ].filter((item) => item.show)

  return (
    <>
      <div className="toolbar">
        <ToolButton title="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
          <Undo2 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton title="Redo (Ctrl+Y)" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
          <Redo2 size={ICON_SIZE} />
        </ToolButton>
  
        <span className="toolbar-separator" />
  
        <ToolButton title="Bold (Ctrl+B)" active={state.bold} onClick={() => chain().toggleBold().run()}>
          <Bold size={ICON_SIZE} />
        </ToolButton>
        <ToolButton title="Italic (Ctrl+I)" active={state.italic} onClick={() => chain().toggleItalic().run()}>
          <Italic size={ICON_SIZE} />
        </ToolButton>
        <ToolButton title="Underline (Ctrl+U)" active={state.underline} onClick={() => chain().toggleUnderline().run()}>
          <Underline size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          title="Strikethrough (Ctrl+Shift+S)"
          active={state.strike}
          onClick={() => chain().toggleStrike().run()}
        >
          <Strikethrough size={ICON_SIZE} />
        </ToolButton>
  
        <ToolButton
          title="Text color and highlight"
          className="color-button"
          active={!!colors}
          onClick={(e) => toggleColors(e.currentTarget)}
        >
          <Palette size={ICON_SIZE} />
        </ToolButton>
        {colors && (
          <div className="color-popover" ref={colorPanel} style={colors}>
            <ColorPicker editor={editor} onPicked={() => setColors(null)} />
          </div>
        )}
  
        <span className="toolbar-separator" />
  
        <ToolButton title="Checklist" active={state.checklist} onClick={() => chain().toggleTaskList().run()}>
          <ListTodo size={ICON_SIZE} />
        </ToolButton>
        {narrow ? (
          <ToolButton
            title="More"
            active={!!more}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              setMore(more ? null : { x: rect.left, y: rect.bottom + 4 * currentZoom() })
            }}
          >
            {done ? <Check size={ICON_SIZE} /> : <Ellipsis size={ICON_SIZE} />}
          </ToolButton>
        ) : (
          <>
            <ToolButton
              title={state.inSection ? 'Remove the section around the cursor (keeps its text)' : 'Fold the selected lines into a section'}
              active={state.inSection}
              disabled={!state.inSection && !state.canMakeSection}
              onClick={toggleSection}
            >
              <FoldVertical size={ICON_SIZE} />
            </ToolButton>
            <ToolButton
              title={state.inCodeBlock ? 'Turn the code block back into normal text' : 'Make the selected lines a code block'}
              active={state.inCodeBlock}
              disabled={!state.inCodeBlock && !state.canMakeCodeBlock}
              onClick={toggleCodeBlock}
            >
              <SquareCode size={ICON_SIZE} />
            </ToolButton>
            <ToolButton
              title="Separate lines (turns Shift+Enter line breaks into real lines)"
              disabled={!state.hasLineBreaks}
              onClick={() => splitLineBreaks(editor)}
            >
              <Rows3 size={ICON_SIZE} />
            </ToolButton>
            <ToolButton
              title={'Line up this line under the next ">" of the line above (Tab, Shift+Tab to go back)'}
              active={state.aligned}
              disabled={!state.canAlign}
              onClick={alignUnder}
            >
              <IndentIncrease size={ICON_SIZE} />
            </ToolButton>
  
            <span className="toolbar-separator" />
  
            <ToolButton title="Insert table" onClick={insertTable}>
              <Table size={ICON_SIZE} />
            </ToolButton>
            <ToolButton title="Insert image" onClick={pickImage}>
              <ImageIcon size={ICON_SIZE} />
            </ToolButton>
  
            <span className="toolbar-separator" />
  
            <ToolButton title="Copy a link to this spot (paste it in any note)" onClick={copyLink}>
              {done === 'link' ? <Check size={ICON_SIZE} /> : <Link size={ICON_SIZE} />}
            </ToolButton>
            <ToolButton
              title="Pin to the Board (copies the selection into a priority card)"
              disabled={!state.hasSelection}
              onClick={pin}
            >
              {done === 'pin' ? <Check size={ICON_SIZE} /> : <Pin size={ICON_SIZE} />}
            </ToolButton>
          </>
        )}
        {/* Hidden file picker. On the phone it offers the gallery or the camera. */}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            insertImages(editor, Array.from(e.target.files ?? []))
            e.target.value = '' // so picking the same file again still works
          }}
        />
      </div>
      {/* Outside the toolbar, so the list doesn't get the toolbar's button style */}
      {more && <ContextMenu x={more.x} y={more.y} items={moreItems} onClose={() => setMore(null)} />}
    </>
  )
}

interface ToolButtonProps {
  title: string
  className?: string
  active?: boolean
  disabled?: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}

function ToolButton({ title, className, active, disabled, onClick, children }: ToolButtonProps) {
  return (
    <button
      className={[className, active && 'active'].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // Keep the cursor (and the phone keyboard) in the note
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default Toolbar
