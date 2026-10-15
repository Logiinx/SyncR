import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Baseline, Bold, ImageIcon, Italic, ListTodo, Redo2, Strikethrough, Underline, Undo2 } from 'lucide-react'
import { currentZoom } from './appearance'
import ColorPicker from './ColorPicker'
import { insertImages } from './image'

const ICON_SIZE = 16

// Slim bar above the note, pinned while the note scrolls. Scrolls sideways when the
// buttons don't fit (phone).
function Toolbar({ editor }: { editor: Editor }) {
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
    }),
  })

  const chain = () => editor.chain().focus()

  return (
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
        <Baseline size={ICON_SIZE} />
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
      <ToolButton title="Insert image" onClick={() => fileInput.current?.click()}>
        <ImageIcon size={ICON_SIZE} />
      </ToolButton>
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
