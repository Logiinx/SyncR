import { useState, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Bold, FoldVertical, Italic, Palette, SquareCode, UnfoldVertical, Underline } from 'lucide-react'
import ColorPicker from './ColorPicker'
import { codeBlockToParagraphs, selectionToCodeBlock } from './codeBlock'
import { BubbleMenu } from '@tiptap/react/menus'

const ICON_SIZE = 16

// Small menu that appears under selected text, with the most used buttons of the toolbar.
// Hidden otherwise, so the window stays clean.
function SelectionMenu({ editor }: { editor: Editor }) {
  // Re-checked every time the selection changes
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      canMakeSection: editor.can().setDetails(),
      inSection: editor.isActive('details'),
      inCodeBlock: editor.isActive('codeBlock'),
    }),
  })

  // The color button opens the palette inside the menu
  const [showColors, setShowColors] = useState(false)
  const chain = () => editor.chain().focus()

  return (
    <BubbleMenu
      editor={editor}
      className={showColors ? 'selection-menu with-colors' : 'selection-menu'}
      // Below the selection, so it doesn't cover what you selected; above when there's no room
      options={{
        placement: 'bottom',
        offset: 8,
        flip: true,
        shift: { padding: 8 },
        onHide: () => setShowColors(false),
      }}
    >
      <MenuButton title="Bold (Ctrl+B)" active={state.bold} onClick={() => chain().toggleBold().run()}>
        <Bold size={ICON_SIZE} />
      </MenuButton>
      <MenuButton title="Italic (Ctrl+I)" active={state.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic size={ICON_SIZE} />
      </MenuButton>
      <MenuButton title="Underline (Ctrl+U)" active={state.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline size={ICON_SIZE} />
      </MenuButton>
      <MenuButton title="Text color and highlight" active={showColors} onClick={() => setShowColors(!showColors)}>
        <Palette size={ICON_SIZE} />
      </MenuButton>

      <span className="menu-divider" />

      <MenuButton
        title="Fold the selected lines into a section"
        disabled={!state.canMakeSection}
        onClick={() => chain().setDetails().run()}
      >
        <FoldVertical size={ICON_SIZE} />
      </MenuButton>
      {state.inSection && (
        <MenuButton
          title="Remove the section around the cursor, keep its text"
          onClick={() => chain().unsetDetails().run()}
        >
          <UnfoldVertical size={ICON_SIZE} />
        </MenuButton>
      )}

      <MenuButton
        title={state.inCodeBlock ? 'Turn the code block back into normal text' : 'Make the selected lines a code block'}
        active={state.inCodeBlock}
        onClick={() => (state.inCodeBlock ? codeBlockToParagraphs(editor) : selectionToCodeBlock(editor))}
      >
        <SquareCode size={ICON_SIZE} />
      </MenuButton>

      {showColors && <ColorPicker editor={editor} onPicked={() => setShowColors(false)} />}
    </BubbleMenu>
  )
}

interface MenuButtonProps {
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function MenuButton({ title, active, disabled, onClick, children }: MenuButtonProps) {
  return (
    <button
      className={active ? 'active' : ''}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // Keep the selection (and the phone keyboard) in the note
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default SelectionMenu
