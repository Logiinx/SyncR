import { useRef, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Bold, ImageIcon, Italic, ListTodo, Redo2, Strikethrough, Underline, Undo2 } from 'lucide-react'
import { insertImages } from './image'

const ICON_SIZE = 16

// Slim bar above the note, pinned while the note scrolls. Scrolls sideways when the
// buttons don't fit (phone).
function Toolbar({ editor }: { editor: Editor }) {
  const fileInput = useRef<HTMLInputElement>(null)

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
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function ToolButton({ title, active, disabled, onClick, children }: ToolButtonProps) {
  return (
    <button
      className={active ? 'active' : ''}
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
