import { useState, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Bold, Check, FoldVertical, Italic, Link, Palette, Pin, Rows3, SquareCode, Underline, Ungroup } from 'lucide-react'
import type { JSONContent } from '@tiptap/react'
import { createCard } from './db'
import ColorPicker from './ColorPicker'
import { canMakeCodeBlock, codeBlockToParagraphs, selectionToCodeBlock } from './codeBlock'
import { copyLinkToBlock } from './noteLinks'
import { selectionHasLineBreaks, splitLineBreaks } from './lineBreaks'
import { BubbleMenu } from '@tiptap/react/menus'

const ICON_SIZE = 16

// Small menu that appears under selected text, with the most used buttons of the toolbar.
// Hidden otherwise, so the window stays clean.
function SelectionMenu({ editor, noteId, title }: { editor: Editor; noteId: string; title: string }) {
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
      canMakeCodeBlock: canMakeCodeBlock(editor),
      hasLineBreaks: selectionHasLineBreaks(editor),
    }),
  })

  // The color button opens the palette inside the menu
  const [showColors, setShowColors] = useState(false)
  const chain = () => editor.chain().focus()

  // The note's scroll area (NoteView's .page): the menu stays inside it, below the toolbar stuck
  // to its top (bottom padding 16: TipTap adds the 8px offset after this). Looked up each time:
  // the editor is only put in the page after the first render.
  const page = () => editor.view.dom.closest<HTMLElement>('.page')
  const area = () => ({
    boundary: page() ?? undefined,
    padding: { top: (page()?.querySelector<HTMLElement>('.toolbar')?.offsetHeight ?? 0) + 8, right: 8, bottom: 16, left: 8 },
  })
  // Scrolling the note places the menu again (TipTap only listens to the window's scrolling).
  // Set the first time the menu shows.
  const [scrollTarget, setScrollTarget] = useState<HTMLElement | null>(null)

  // "Copy link": shows a check mark for a moment once the link is on the clipboard
  const [copied, setCopied] = useState(false)
  function copyLink() {
    copyLinkToBlock(editor, noteId, title).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  // "Pin": the selection (with its formatting) becomes a new priority card on the Board.
  // A piece that can't stand on its own (e.g. part of a table) is pinned as plain text.
  const [pinned, setPinned] = useState(false)
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
    setPinned(true)
    setTimeout(() => setPinned(false), 1200)
  }

  return (
    <BubbleMenu
      editor={editor}
      className={showColors ? 'selection-menu with-colors' : 'selection-menu'}
      // Below the selection, so it doesn't cover what you selected; above when there's no room.
      // A selection taller than the window (Ctrl+A) has room on neither side: the menu then stays
      // below and slides up to the bottom edge, over the text. Hidden once the selection is
      // scrolled completely out of view.
      options={{
        placement: 'bottom',
        offset: 8,
        flip: () => ({ ...area(), fallbackStrategy: 'initialPlacement' as const }),
        shift: () => ({ ...area(), crossAxis: true }),
        hide: area,
        scrollTarget: scrollTarget ?? window,
        onShow: () => setScrollTarget(page()),
        onHide: () => setShowColors(false),
      }}
    >
      {/* Code has no formatting: these would do nothing there */}
      {!state.inCodeBlock && (
        <>
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
        </>
      )}

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
          {/* Not UnfoldVertical: at this size it looks just like the fold icon above */}
          <Ungroup size={ICON_SIZE} />
        </MenuButton>
      )}

      <MenuButton
        title={state.inCodeBlock ? 'Turn the code block back into normal text' : 'Make the selected lines a code block'}
        active={state.inCodeBlock}
        disabled={!state.inCodeBlock && !state.canMakeCodeBlock}
        onClick={() => (state.inCodeBlock ? codeBlockToParagraphs(editor) : selectionToCodeBlock(editor))}
      >
        <SquareCode size={ICON_SIZE} />
      </MenuButton>
      {/* Only when there's something to split (lineBreaks.ts) */}
      {state.hasLineBreaks && (
        <MenuButton title="Separate lines (turns Shift+Enter line breaks into real lines)" onClick={() => splitLineBreaks(editor)}>
          <Rows3 size={ICON_SIZE} />
        </MenuButton>
      )}

      <span className="menu-divider" />

      <MenuButton title="Copy a link to this spot (paste it in any note)" onClick={copyLink}>
        {copied ? <Check size={ICON_SIZE} /> : <Link size={ICON_SIZE} />}
      </MenuButton>
      <MenuButton title="Pin to the Board (copies the selection into a priority card)" onClick={pin}>
        {pinned ? <Check size={ICON_SIZE} /> : <Pin size={ICON_SIZE} />}
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
