import { Extension } from '@tiptap/react'
import { Plugin, Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { currentZoom } from './appearance'

// Drag a section by its ⋮⋮ grip (left of the ▶ arrow) to move it, with everything inside.
// A blue line shows where it will land: between any two blocks, also inside another section.
// Mouse: the grip shows when hovering a section. Phone (no hover): it shows for the section
// the cursor is in. Pointer events, so mouse and finger work the same way.

const MOUSE_DRAG_DISTANCE = 5 // px before a press on the grip becomes a drag
const SCROLL_EDGE = 40 // px from the top/bottom of the page where dragging scrolls it
const SCROLL_STEP = 12 // px scrolled per pointer move near an edge
const GRIP_REACH = 24 // px: the grip sits this far left of its section

// Where sections can be: in the note itself or inside another section
const CONTAINERS = new Set(['doc', 'detailsContent'])

interface Drop {
  pos: number // where the section will be inserted
  line: { top: number; left: number; width: number } // the blue line, in client pixels
}

export const DragSections = Extension.create({
  name: 'dragSections',

  addProseMirrorPlugins() {
    return [new Plugin({ view: (view) => new SectionDragger(view) })]
  },
})

class SectionDragger {
  view: EditorView
  wrapper: HTMLElement // the element around the editor; grip and line are placed in it
  grip: HTMLElement
  line: HTMLElement
  section: HTMLElement | null = null // the section the grip belongs to
  drag: { pointerId: number; from: number; startY: number; moving: boolean; drop: Drop | null } | null = null
  canHover = window.matchMedia('(hover: hover)').matches

  constructor(view: EditorView) {
    this.view = view
    this.wrapper = view.dom.parentElement!
    this.wrapper.classList.add('has-section-grips')

    this.grip = document.createElement('div')
    this.grip.className = 'section-grip'
    this.grip.textContent = '⋮⋮'
    this.grip.title = 'Drag to move this section'
    this.grip.hidden = true
    this.grip.addEventListener('pointerdown', this.onPointerDown)
    this.grip.addEventListener('pointermove', this.onPointerMove)
    this.grip.addEventListener('pointerup', this.onPointerUp)
    this.grip.addEventListener('pointercancel', this.stopDrag)

    this.line = document.createElement('div')
    this.line.className = 'section-drop-line'
    this.line.hidden = true

    this.wrapper.append(this.grip, this.line)
    this.wrapper.addEventListener('mousemove', this.onHover)
    this.wrapper.addEventListener('mouseleave', this.onLeave)
  }

  // ---------- Showing the grip ----------

  onHover = (e: MouseEvent) => {
    if (this.drag) return
    if (this.grip.contains(e.target as Node)) return
    // Look a bit to the right of the pointer first: on the way from a section's title to its
    // grip, the pointer crosses the margin (or, for a nested section, the outer one)
    const find = (element: Element | null) => element?.closest<HTMLElement>('.tiptap [data-type="details"]') ?? null
    const reach = GRIP_REACH * currentZoom()
    this.showGrip(find(document.elementFromPoint(e.clientX + reach, e.clientY)) ?? find(e.target as Element))
  }

  onLeave = () => {
    if (!this.drag && this.canHover) this.showGrip(null)
  }

  // Called by ProseMirror after every change (typing, cursor moves)
  update() {
    if (this.drag) return
    if (!this.canHover) {
      // Phone: the section the cursor is in (the innermost one)
      const { $from } = this.view.state.selection
      let section: HTMLElement | null = null
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'details') {
          section = this.view.nodeDOM($from.before(d)) as HTMLElement | null
          break
        }
      }
      this.showGrip(section)
    } else if (this.section) {
      this.showGrip(this.section.isConnected ? this.section : null) // text above may have moved it
    }
  }

  showGrip(section: HTMLElement | null) {
    this.section = section
    this.grip.hidden = !section
    if (!section) return
    const zoom = currentZoom()
    const wrapperRect = this.wrapper.getBoundingClientRect()
    const rect = section.getBoundingClientRect()
    // Positions inside the zoomed page are in CSS pixels: client pixels / zoom
    this.grip.style.top = `${(rect.top - wrapperRect.top) / zoom}px`
    this.grip.style.left = `${(rect.left - wrapperRect.left) / zoom}px`
  }

  // Position of the section node in the document (null if it's gone)
  sectionPos(): number | null {
    if (!this.section?.isConnected) return null
    const $inside = this.view.state.doc.resolve(this.view.posAtDOM(this.section, 0))
    for (let d = $inside.depth; d > 0; d--) {
      const pos = $inside.before(d)
      if (this.view.nodeDOM(pos) === this.section) return pos
    }
    return null
  }

  // ---------- Dragging ----------

  onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    const from = this.sectionPos()
    if (from === null) return
    e.preventDefault() // no text selection, and the phone keyboard stays as it is
    this.grip.setPointerCapture(e.pointerId)
    this.drag = { pointerId: e.pointerId, from, startY: e.clientY, moving: false, drop: null }
  }

  onPointerMove = (e: PointerEvent) => {
    const drag = this.drag
    if (!drag || e.pointerId !== drag.pointerId) return
    if (!drag.moving) {
      if (Math.abs(e.clientY - drag.startY) < MOUSE_DRAG_DISTANCE) return
      drag.moving = true
      this.wrapper.classList.add('dragging-section')
    }
    this.autoScroll(e.clientY)
    drag.drop = this.findDrop(e.clientX, e.clientY, drag.from)
    this.showLine(drag.drop)
  }

  onPointerUp = (e: PointerEvent) => {
    const drag = this.drag
    if (!drag || e.pointerId !== drag.pointerId) return
    if (drag.moving && drag.drop) this.move(drag.from, drag.drop.pos)
    this.stopDrag()
  }

  stopDrag = () => {
    this.drag = null
    this.line.hidden = true
    this.wrapper.classList.remove('dragging-section')
    if (this.canHover) this.showGrip(null)
    else this.update()
  }

  // The block under the pointer whose parent can hold a section; drop above or below it,
  // depending on which half the pointer is in. Not inside the dragged section itself.
  findDrop(x: number, y: number, from: number): Drop | null {
    const { view } = this
    const editorRect = view.dom.getBoundingClientRect()
    // Pointer left/right of the text: look at the text column at the same height
    const left = Math.min(Math.max(x, editorRect.left + 40), editorRect.right - 40)
    const hit = view.posAtCoords({ left, top: y })
    if (!hit) return null
    const doc = view.state.doc
    const node = doc.nodeAt(from)!
    const $pos = doc.resolve(hit.pos)
    for (let d = $pos.depth; d > 0; d--) {
      if (!CONTAINERS.has($pos.node(d - 1).type.name)) continue
      const blockPos = $pos.before(d)
      const block = $pos.node(d)
      const dom = view.nodeDOM(blockPos) as HTMLElement | null
      if (!dom) return null
      const rect = dom.getBoundingClientRect()
      const before = y < rect.top + rect.height / 2
      const pos = before ? blockPos : blockPos + block.nodeSize
      // Inside (or right at the edges of) the dragged section: no move
      if (pos >= from && pos <= from + node.nodeSize) return null
      return { pos, line: { top: before ? rect.top : rect.bottom, left: rect.left, width: rect.width } }
    }
    return null
  }

  showLine(drop: Drop | null) {
    this.line.hidden = !drop
    if (!drop) return
    const zoom = currentZoom()
    const wrapperRect = this.wrapper.getBoundingClientRect()
    this.line.style.top = `${(drop.line.top - wrapperRect.top) / zoom}px`
    this.line.style.left = `${(drop.line.left - wrapperRect.left) / zoom}px`
    this.line.style.width = `${drop.line.width / zoom}px`
  }

  // Near the top/bottom of the page, scroll it so long notes can be crossed
  autoScroll(y: number) {
    const page = this.wrapper.closest('.page')
    if (!page) return
    const rect = page.getBoundingClientRect()
    if (y < rect.top + SCROLL_EDGE) page.scrollTop -= SCROLL_STEP
    else if (y > rect.bottom - SCROLL_EDGE) page.scrollTop += SCROLL_STEP
  }

  // One step, so one Ctrl+Z puts it back
  move(from: number, to: number) {
    const { state } = this.view
    const node = state.doc.nodeAt(from)
    if (!node) return
    const tr = state.tr.delete(from, from + node.nodeSize)
    const insertAt = tr.mapping.map(to)
    tr.insert(insertAt, node)
    tr.setSelection(Selection.near(tr.doc.resolve(insertAt + 1)))
    this.view.dispatch(tr.scrollIntoView())
  }

  destroy() {
    this.grip.remove()
    this.line.remove()
    this.wrapper.removeEventListener('mousemove', this.onHover)
    this.wrapper.removeEventListener('mouseleave', this.onLeave)
    this.wrapper.classList.remove('has-section-grips', 'dragging-section')
  }
}
