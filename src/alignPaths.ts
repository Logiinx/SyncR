import { Extension, type Editor } from '@tiptap/react'

// Lining a line up under a ">" of the line above, for paths ("Games > RPG > …" with the next
// line starting under "RPG"). The font isn't fixed-width, so spaces can't do it exactly: the
// line gets a left indent instead (attribute alignIndent, in em so it follows the text size),
// measured from where each ">" of the line above is drawn.
// Tab: under the next ">", Shift+Tab: the previous one (then back to the left edge).
// Enter keeps the indent on the new line; Backspace at the start of the line removes it.
// The toolbar's "Align under >" button does what Tab does, and wraps back to the left edge.

const NEAR = 0.05 // em: two indents this close are the same stop

// The line above the cursor's line, if both are plain lines and it has a ">"
export function pathAbove(editor: Editor) {
  const { $from } = editor.state.selection
  if ($from.parent.type.name !== 'paragraph' || $from.depth < 1) return null
  // Lists and tables keep their own Tab
  if (['listItem', 'taskItem', 'tableCell', 'tableHeader'].includes($from.node($from.depth - 1).type.name)) return null
  const index = $from.index($from.depth - 1)
  if (index === 0) return null
  const above = $from.node($from.depth - 1).child(index - 1)
  return above.type.name === 'paragraph' && above.textContent.includes('>') ? above : null
}

// Where the ">" of the line above are drawn, in em from the cursor line's left edge
function alignStops(editor: Editor): number[] {
  const { state, view } = editor
  const { $from } = state.selection
  const above = pathAbove(editor)
  if (!above) return []

  const lineDom = view.nodeDOM($from.before())
  if (!(lineDom instanceof HTMLElement)) return []
  const box = lineDom.getBoundingClientRect()
  const scale = box.width / lineDom.offsetWidth || 1 // app scale (CSS zoom)
  const em = parseFloat(getComputedStyle(lineDom).fontSize) * scale
  const aboveStart = $from.before() - above.nodeSize + 1

  const stops: number[] = []
  above.descendants((node, pos) => {
    if (!node.isText) return
    for (let i = node.text!.indexOf('>'); i >= 0; i = node.text!.indexOf('>', i + 1)) {
      const x = view.coordsAtPos(aboveStart + pos + i, 1).left
      stops.push(Math.round(((x - box.left) / em) * 1000) / 1000)
    }
  })
  return stops.sort((a, b) => a - b)
}

// Moves the cursor's line to the next (1) or previous (-1) stop. wrap: past the last stop,
// back to the left edge (the toolbar button, which has no Shift+Tab)
export function alignLine(editor: Editor, direction: 1 | -1, wrap = false): boolean {
  const { $from } = editor.state.selection
  const current: number = $from.parent.attrs.alignIndent ?? 0
  const stops = alignStops(editor)
  let indent: number | undefined
  if (direction === 1) {
    indent = stops.find((stop) => stop > current + NEAR)
    if (indent === undefined) {
      if (!stops.length) return false
      if (!wrap) return true // already under the last one
      indent = 0
    }
  } else {
    if (!current) return false
    indent = [...stops].reverse().find((stop) => stop < current - NEAR) ?? 0
  }

  // Spaces typed at the start of the line would push it off the stop
  const tr = editor.state.tr
  const start = $from.start()
  const spaces = /^[  \t]*/.exec($from.parent.textContent)![0].length
  if (spaces) tr.delete(start, start + spaces)
  tr.setNodeAttribute($from.before(), 'alignIndent', indent || null)
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

export const AlignPaths = Extension.create({
  name: 'alignPaths',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          alignIndent: {
            default: null,
            parseHTML: (element) => parseFloat(element.getAttribute('data-align-indent') ?? '') || null,
            renderHTML: (attributes) =>
              attributes.alignIndent
                ? { 'data-align-indent': attributes.alignIndent, style: `padding-left: ${attributes.alignIndent}em` }
                : {},
          },
        },
      },
    ]
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => alignLine(editor, 1),
      'Shift-Tab': ({ editor }) => alignLine(editor, -1),
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        const { $from } = selection
        if (!selection.empty || $from.parentOffset > 0 || !$from.parent.attrs.alignIndent) return false
        return editor.commands.updateAttributes('paragraph', { alignIndent: null })
      },
    }
  },
})
