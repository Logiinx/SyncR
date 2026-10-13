import { useEditorState, type Editor } from '@tiptap/react'
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

  return (
    <BubbleMenu editor={editor} className="selection-menu">
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
    </BubbleMenu>
  )
}

export default SelectionMenu
