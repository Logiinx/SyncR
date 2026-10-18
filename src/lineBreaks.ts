import { Extension, type Editor } from '@tiptap/react'
import type { Node } from '@tiptap/pm/model'
import { canSplit } from '@tiptap/pm/transform'

// Line breaks (Shift+Enter, or pasted text that used <br>) look exactly like separate lines,
// since paragraphs have no spacing. But the lines stay one paragraph: triple-click, headings,
// lists and sections then act on all of them at once.

// The line breaks inside from–to that can become separate lines: only those in paragraphs
// (also inside list items, sections, tables). Headings and section titles keep theirs.
function lineBreaks(doc: Node, from: number, to: number): number[] {
  const positions: number[] = []
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name === 'hardBreak' && parent?.type.name === 'paragraph' && pos >= from && pos < to) {
      positions.push(pos)
    }
  })
  return positions
}

export function selectionHasLineBreaks(editor: Editor) {
  const { from, to } = editor.state.selection
  return lineBreaks(editor.state.doc, from, to).length > 0
}

// "Separate lines" (selection menu): each line break in the selection ends its paragraph and
// starts a new one. Looks the same, but each line is then its own block. In a list item the
// new lines stay in the same item (no new bullet). One step, so Ctrl+Z undoes it.
export function splitLineBreaks(editor: Editor) {
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const { from, to } = tr.selection
      const positions = lineBreaks(tr.doc, from, to)
      // The new paragraph doesn't take the block id: links keep pointing to the first line
      const after = [{ type: tr.doc.type.schema.nodes.paragraph, attrs: { blockId: null } }]
      // From the last to the first: each change only moves what comes after it
      for (const pos of positions.reverse()) {
        if (!canSplit(tr.doc, pos, 1, after)) continue
        tr.delete(pos, pos + 1).split(pos, 1, after)
      }
      return positions.length > 0
    })
    .run()
}

// Shift+Enter makes a new line, like Enter: it's often pressed out of habit (apps where Enter
// sends), and a line break would join the lines into one paragraph. Inside a list or checklist
// item it stays a line break (a new line without a new bullet), and code blocks keep their own
// behavior. Ctrl+Enter still makes a line break anywhere.
export const ShiftEnter = Extension.create({
  name: 'shiftEnter',
  priority: 150, // after ListEnter (200, its own Shift+Enter cases), before the line break (100)

  addKeyboardShortcuts() {
    return {
      'Shift-Enter': ({ editor }) => {
        const { $from } = editor.state.selection
        if ($from.parent.type.name === 'codeBlock') return false
        if ($from.depth >= 2 && ['listItem', 'taskItem'].includes($from.node(-1).type.name)) return false
        // A plain Enter through every key handler, so all of Enter's cases apply (lists,
        // section titles, slash menu…), as ProseMirror itself does for Android's Enter
        const { view } = editor
        const enter = new KeyboardEvent('keydown', { key: 'Enter' })
        return view.someProp('handleKeyDown', (handle) => handle(view, enter)) ?? false
      },
    }
  },
})
