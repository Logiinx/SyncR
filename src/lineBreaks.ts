import { Extension, type Editor } from '@tiptap/react'
import { Fragment, Slice, type Node, type NodeType } from '@tiptap/pm/model'
import { Plugin, type Selection } from '@tiptap/pm/state'
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

// The selection, or the whole paragraph the cursor is in when nothing is selected
function range(selection: Selection) {
  const { from, to, empty, $from } = selection
  return empty ? { from: $from.start(), to: $from.end() } : { from, to }
}

export function hasLineBreaks(editor: Editor) {
  const { from, to } = range(editor.state.selection)
  return lineBreaks(editor.state.doc, from, to).length > 0
}

// "Separate lines" (toolbar): each line break in the selection (or in the cursor's paragraph)
// ends its paragraph and starts a new one. Looks the same, but each line is then its own block.
// In a list item the new lines stay in the same item (no new bullet). One step for Ctrl+Z.
export function splitLineBreaks(editor: Editor) {
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const { from, to } = range(tr.selection)
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

// Pasted text: each paragraph with line breaks becomes one paragraph per line, as with the
// button (Notesnook and many web pages use <br> between lines). The first line keeps the
// paragraph's attrs, the others start without a block id. Headings keep their line breaks.
function splitPastedLines(fragment: Fragment): Fragment {
  const nodes: Node[] = []
  fragment.forEach((node) => {
    if (node.type.name !== 'paragraph') {
      nodes.push(node.isTextblock || node.isLeaf ? node : node.copy(splitPastedLines(node.content)))
      return
    }
    let attrs = node.attrs
    let line: Node[] = []
    const endLine = () => {
      nodes.push(node.type.create(attrs, line, node.marks))
      attrs = { ...node.attrs, blockId: null }
      line = []
    }
    node.forEach((child) => (child.type.name === 'hardBreak' ? endLine() : line.push(child)))
    endLine()
  })
  return Fragment.from(nodes)
}

// "- ", "* " or "• " at the start of a line, also indented (all become the same level)
const BULLET = /^[ \t]*[-*•][ \t]+/

// Pasted lines that start with a dash become a bullet list, one item per line; lines next to
// each other form one list. Only for pastes of 2+ lines, so one "- x" pasted into a sentence
// stays text. Only at the top level of the paste. Ctrl+Shift+V skips this (keeps the dashes).
function pastedBullets(slice: Slice, inItem: NodeType | null, textBefore: boolean): Slice {
  const content = slice.content
  if (content.childCount < 2) return slice
  const marker = (node: Node) =>
    node.type.name === 'paragraph' && node.firstChild?.isText ? node.textContent.match(BULLET)?.[0].length : undefined
  const lines: Node[] = []
  content.forEach((node) => lines.push(node))
  if (!lines.some((node) => marker(node) !== undefined)) return slice
  const { bulletList, listItem, paragraph } = content.firstChild!.type.schema.nodes
  const item = (node: Node, type = listItem) => type.create(null, node.cut(marker(node) ?? 0))

  // Pasted inside a list or checklist: every line becomes an item of that list (not a list
  // inside the item; new checklist items unticked). The first line joins the cursor's item, unless it has a dash and the item has
  // text before the cursor: then it starts a new item. The last one gets the text after it.
  if (inItem) {
    if (!lines.every((node) => node.type === paragraph)) return slice
    const items = lines.map((node) => item(node, inItem))
    if (marker(lines[0]) !== undefined && textBefore) items.unshift(inItem.create(null, paragraph.create()))
    return new Slice(Fragment.from(items), 2, 2)
  }

  const nodes: Node[] = []
  let items: Node[] = []
  const endList = () => {
    if (items.length) nodes.push(bulletList.create(null, items))
    items = []
  }
  for (const node of lines) {
    if (marker(node) !== undefined) items.push(item(node))
    else {
      endList()
      nodes.push(node)
    }
  }
  endList()
  // A converted first or last line no longer joins the text around the cursor: the list goes
  // in as whole blocks (open depth 0 on that side)
  const open = (node: Node, depth: number) => (marker(node) !== undefined ? 0 : depth)
  return new Slice(Fragment.from(nodes), open(lines[0], slice.openStart), open(lines[lines.length - 1], slice.openEnd))
}

// Shift+Enter makes a new line, like Enter: it's often pressed out of habit (apps where Enter
// sends), and a line break would join the lines into one paragraph. Inside a list or checklist
// item it stays a line break (a new line without a new bullet), and code blocks keep their own
// behavior. Ctrl+Enter still makes a line break anywhere.
// Pasted line breaks become separate lines too (splitPastedLines). Pasting into a code block
// isn't affected: ProseMirror pastes plain text there, without this step.
export const LineBreaks = Extension.create({
  name: 'lineBreaks',
  priority: 150, // after ListEnter (200, its own Shift+Enter cases), before the line break (100)

  addProseMirrorPlugins() {
    let keepDashes = false // Ctrl+Shift+V: paste the text as it is
    return [
      new Plugin({
        props: {
          handleKeyDown: (_view, event) => {
            keepDashes = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v'
            return false
          },
          // The slice stays open at the same depths: the first line still joins the text
          // before the cursor, the last one the text after it
          transformPasted: (slice, view) => {
            const lines = new Slice(splitPastedLines(slice.content), slice.openStart, slice.openEnd)
            if (keepDashes) {
              keepDashes = false
              return lines
            }
            const { $from } = view.state.selection
            // The nearest list or checklist item, if any
            let item: NodeType | null = null
            for (let d = $from.depth; d > 0 && !item; d--) {
              const type = $from.node(d).type
              if (type.name === 'listItem' || type.name === 'taskItem') item = type
            }
            return pastedBullets(lines, item, $from.parentOffset > 0)
          },
        },
      }),
    ]
  },

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
