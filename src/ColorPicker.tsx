import { useEditorState, type Editor } from '@tiptap/react'
import { t } from './i18n'
import { Ban } from 'lucide-react'
import { COLORS } from './cardColors'

const textColor = (id: string) => `var(--text-${id})`
export const highlightColor = (id: string) => `var(--hl-${id})`

// Phone: Android draws its own selection (white text), ignoring our ::selection style, so
// the new color only shows once unselected. Put the cursor at the end of the text instead.
// (Only with a selection: moving a plain cursor would forget the color just picked for it.)
function showPickedColor(editor: Editor) {
  if (window.matchMedia('(pointer: coarse)').matches && !editor.state.selection.empty) {
    editor.commands.setTextSelection(editor.state.selection.to)
  }
}

// Text color for the selected text, or for what's typed next. No id: the default color.
export function pickTextColor(editor: Editor, id: string | undefined) {
  const chain = editor.chain().focus()
  if (id) chain.setColor(textColor(id)).run()
  else chain.unsetColor().run()
  showPickedColor(editor)
}

// The palette id of the text color at the selection or cursor (undefined: the default color)
export const currentTextColor = (editor: Editor) =>
  COLORS.find(({ id }) => editor.getAttributes('textStyle').color === textColor(id))?.id

// Two rows of swatches: text color, then highlighter. The first swatch of each row removes it.
// Cards only get the text color row (highlights = false).
function ColorPicker({ editor, onPicked, highlights = true }: { editor: Editor; onPicked: () => void; highlights?: boolean }) {
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
    showPickedColor(editor)
    onPicked()
  }

  return (
    <div className="color-picker">
      <div className="color-row" role="group" aria-label={t('Text color')}>
        <Swatch title={t('Default color')} selected={!color} onClick={() => pick(() => pickTextColor(editor, undefined))}>
          <Ban size={14} />
        </Swatch>
        {COLORS.map(({ id, name }) => (
          <Swatch
            key={id}
            title={t(name)}
            selected={color === textColor(id)}
            onClick={() => pick(() => pickTextColor(editor, id))}
          >
            <span style={{ color: textColor(id) }}>{'A'}</span>
          </Swatch>
        ))}
      </div>
      {highlights && (
        <div className="color-row" role="group" aria-label={t('Highlight')}>
          <Swatch title={t('No highlight')} selected={!highlight} onClick={() => pick(() => chain().unsetHighlight().run())}>
            <Ban size={14} />
          </Swatch>
          {COLORS.map(({ id, name }) => (
            <Swatch
              key={id}
              title={t('{color} highlight', { color: t(name) })}
              selected={highlight === highlightColor(id)}
              onClick={() => pick(() => chain().setHighlight({ color: highlightColor(id) }).run())}
            >
              <span className="highlight-swatch" style={{ background: highlightColor(id) }} />
            </Swatch>
          ))}
        </div>
      )}
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
