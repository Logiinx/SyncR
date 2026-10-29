import { Node, type Editor } from '@tiptap/react'
import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'
import { db } from './db'
import { openImageViewer } from './ImageViewer'

const MAX_WIDTH = 2000 // wider images are scaled down
const JPEG_QUALITY = 0.85

// Prepares an image file for storing: scales it down if it's wider than MAX_WIDTH.
// Screenshots (PNG) stay PNG so text stays sharp; everything else becomes JPEG (smaller).
// Throws if the browser can't read the image (e.g. HEIC on some phones).
async function prepareImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  const keepAsIs = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)
  if (width <= MAX_WIDTH && keepAsIs) {
    bitmap.close()
    return { blob: file, width, height }
  }

  const scale = Math.min(1, MAX_WIDTH / width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, JPEG_QUALITY))
  if (!blob) throw new Error('Could not convert the image')
  return { blob, width: canvas.width, height: canvas.height }
}

// Saves an image on this device and returns what the note needs to show it.
async function addAttachment(file: Blob) {
  const { blob, width, height } = await prepareImage(file)
  const id = crypto.randomUUID()
  await db.attachments.add({ id, blob, createdAt: Date.now() })
  return { id, width, height }
}

// Shown images, by attachment id. Kept for the whole session so switching notes doesn't
// reload them (a few MB at most).
const urls = new Map<string, string>()

async function attachmentUrl(id: string): Promise<string | undefined> {
  if (!urls.has(id)) {
    const attachment = await db.attachments.get(id)
    if (!attachment) return undefined
    urls.set(id, URL.createObjectURL(attachment.blob))
  }
  return urls.get(id)
}

// After inserting an image, the image is selected, so typing or pasting would replace it.
// Instead, put the cursor on the line below it (adding an empty line if there's none).
function cursorBelow({ tr }: { tr: Transaction }) {
  const after = tr.selection.to
  if (!tr.doc.resolve(after).nodeAfter?.isTextblock) {
    tr.insert(after, tr.doc.type.schema.nodes.paragraph.create())
  }
  tr.setSelection(TextSelection.create(tr.doc, after + 1))
  return true
}

// An image in a note, on its own line. The note stores only the attachment id and the size
// (the size reserves the space before the image has loaded, so the page doesn't jump).
// Only our own images are recognized: images in pasted web pages are dropped.
export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true, // one unit: can be selected, deleted, copied, but has no editable inside
  draggable: true,

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-attachment') },
      width: { default: null, parseHTML: (el) => Number(el.getAttribute('width')) || null },
      height: { default: null, parseHTML: (el) => Number(el.getAttribute('height')) || null },
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-attachment]' }]
  },

  // Used when copying: pasting it into a note keeps the same image
  renderHTML({ node }) {
    const { id, width, height } = node.attrs
    return ['img', { 'data-attachment': id, width, height }]
  },

  addNodeView() {
    return ({ node }) => {
      const { id, width, height } = node.attrs
      // A box around the image. While the image isn't on this device yet (sync is still
      // downloading it), the box shows "Image loading…" at the image's size.
      const box = document.createElement('div')
      box.className = 'note-image'
      if (width && height) {
        box.style.width = `${width}px`
        box.style.aspectRatio = `${width} / ${height}`
      }
      const img = document.createElement('img')
      box.append(img)

      const load = async () => {
        const url = await attachmentUrl(id)
        box.classList.toggle('missing', !url)
        if (url) {
          img.src = url
          window.removeEventListener('attachments-changed', load)
        }
      }
      // Sync downloaded images: try again
      window.addEventListener('attachments-changed', load)
      load()

      // Click / tap = full-screen view (dragging the image doesn't count as a click)
      img.addEventListener('click', () => openImageViewer(img.src))
      return {
        dom: box,
        destroy: () => window.removeEventListener('attachments-changed', load),
      }
    }
  },

  // Pasted image files (e.g. from the snipping tool) go where the cursor is,
  // dropped image files go where they're dropped
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            const files = imageFiles(event.clipboardData?.files)
            if (files.length === 0) return false
            insertImages(editor, files)
            return true
          },
          handleDrop: (view, event, _slice, moved) => {
            const files = imageFiles(event.dataTransfer?.files)
            // moved = an image dragged within the note: let the editor move it
            if (moved || files.length === 0) return false
            const target = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (target) editor.commands.setTextSelection(target.pos)
            insertImages(editor, files)
            return true
          },
        },
      }),
    ]
  },
})

function imageFiles(files: FileList | undefined): File[] {
  return Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
}

// Stores the images and inserts them at the cursor, one after the other
export async function insertImages(editor: Editor, files: File[]) {
  for (const file of files) {
    try {
      const attrs = await addAttachment(file)
      editor.chain().focus().insertContent({ type: 'image', attrs }).command(cursorBelow).run()
    } catch (error) {
      console.error(error)
      window.alert('This image could not be added. Its format may not be supported.')
    }
  }
}

// Puts an image on the clipboard. Clipboards only take PNG, so other formats are redrawn as
// PNG first. The PNG is handed over as a promise: browsers only allow writing right after
// the click, so nothing may be awaited before write().
export async function copyImage(src: string) {
  const png = (async () => {
    const blob = await (await fetch(src)).blob()
    if (blob.type === 'image/png') return blob
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    bitmap.close()
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png'),
    )
  })()
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
  } catch (error) {
    console.error(error)
    window.alert("This image couldn't be copied.")
  }
}
