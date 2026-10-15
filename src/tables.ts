import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'

// A cell's background color, from the same palette as the highlighter ("var(--hl-red)").
const backgroundColor = {
  default: null,
  parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
  renderHTML: (attributes: { backgroundColor: string | null }) =>
    attributes.backgroundColor ? { style: `background-color: ${attributes.backgroundColor}` } : {},
}

// Tables: insert from the toolbar, edit with the right-click menu (TableMenu.tsx).
// Tab jumps to the next cell (in the last cell it adds a row). Columns resize by dragging
// the line between them.
export const tableExtensions = [
  Table.configure({ resizable: true, cellMinWidth: 60 }),
  TableRow,
  TableHeader.extend({
    addAttributes() {
      return { ...this.parent?.(), backgroundColor }
    },
  }),
  TableCell.extend({
    addAttributes() {
      return { ...this.parent?.(), backgroundColor }
    },
  }),
]
