import { useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Baseline } from 'lucide-react'
import ColorPicker from './ColorPicker'
import { BubbleMenu } from '@tiptap/react/menus'

// Small menu that appears above selected text. Hidden otherwise, so the window stays clean.
function SelectionMenu({ editor }: { editor: Editor }) {
  // Re-checked every time the selection changes
  const { canMakeSection, inSection } = useEditorState({
    editor,
    selector: ({ editor }) => ({
      canMakeSection: editor.can().setDetails(),
      inSection: editor.isActive('details'),
    }),
  })

  // The color button opens the palette inside the menu
  const [showColors, setShowColors] = useState(false)

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
      <button
        className={showColors ? 'active' : ''}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShowColors(!showColors)}
        title="Text color and highlight"
        aria-label="Text color and highlight"
      >
        <Baseline size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().setDetails().run()}
        disabled={!canMakeSection}
        title="Fold the selected lines into a section"
      >
        Section
      </button>
      {inSection && (
        <button
          onClick={() => editor.chain().focus().unsetDetails().run()}
          title="Remove the section around the cursor, keep its text"
        >
          Unwrap
        </button>
      )}
      {showColors && <ColorPicker editor={editor} onPicked={() => setShowColors(false)} />}
    </BubbleMenu>
  )
}

export default SelectionMenu
