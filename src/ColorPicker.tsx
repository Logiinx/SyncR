import { useEditorState, type Editor } from '@tiptap/react'
import { Ban } from 'lucide-react'

// The fixed palette. Notes store "var(--text-red)" etc., not the color itself, so the
// colors can be tuned later in index.css and every note follows.
export const COLORS = [
  { id: 'red', name: 'Red' },
  { id: 'orange', name: 'Orange' },
  { id: 'yellow', name: 'Yellow' },
  { id: 'green', name: 'Green' },
  { id: 'blue', name: 'Blue' },
  { id: 'purple', name: 'Purple' },
  { id: 'pink', name: 'Pink' },
  { id: 'gray', name: 'Gray' },
]
const textColor = (id: string) => `var(--text-${id})`
const highlightColor = (id: string) => `var(--hl-${id})`

// Two rows of swatches: text color, then highlighter. The first swatch of each row removes it.
function ColorPicker({ editor, onPicked }: { editor: Editor; onPicked: () => void }) {
  const { color, highlight } = useEditorState({
    editor,
    selector: ({ editor }) => ({
      color: editor.getAttributes('textStyle').color as string | undefined,
      highlight: editor.isActive('highlight') ? (editor.getAttributes('highlight').color as string) : undefined,
    }),
  })
  const chain = () => editor.chain().focus()
  const pick = (run: () => void) => {
    run()
    onPicked()
  }

  return (
    <div className="color-picker">
      <div className="color-row" role="group" aria-label="Text color">
        <Swatch title="Default color" selected={!color} onClick={() => pick(() => chain().unsetColor().run())}>
          <Ban size={14} />
        </Swatch>
        {COLORS.map(({ id, name }) => (
          <Swatch
            key={id}
            title={name}
            selected={color === textColor(id)}
            onClick={() => pick(() => chain().setColor(textColor(id)).run())}
          >
            <span style={{ color: textColor(id) }}>A</span>
          </Swatch>
        ))}
      </div>
      <div className="color-row" role="group" aria-label="Highlight">
        <Swatch title="No highlight" selected={!highlight} onClick={() => pick(() => chain().unsetHighlight().run())}>
          <Ban size={14} />
        </Swatch>
        {COLORS.map(({ id, name }) => (
          <Swatch
            key={id}
            title={`${name} highlight`}
            selected={highlight === highlightColor(id)}
            onClick={() => pick(() => chain().setHighlight({ color: highlightColor(id) }).run())}
          >
            <span className="highlight-swatch" style={{ background: highlightColor(id) }} />
          </Swatch>
        ))}
      </div>
    </div>
  )
}

interface SwatchProps {
  title: string
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}

function Swatch({ title, selected, onClick, children }: SwatchProps) {
  return (
    <button
      className={selected ? 'swatch selected' : 'swatch'}
      title={title}
      aria-label={title}
      aria-pressed={selected}
      // Keep the selection (and the phone keyboard) in the note
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default ColorPicker
