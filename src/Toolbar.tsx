import { useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { insertImages } from './image'

// Slim bar above the note, pinned while the note scrolls. More buttons come in step 7.
function Toolbar({ editor }: { editor: Editor }) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className="toolbar">
      <button
        title="Insert image"
        aria-label="Insert image"
        // Keep the cursor in the note on PC (the image goes where the cursor is)
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fileInput.current?.click()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <circle cx="5.5" cy="6" r="1.2" />
          <path d="M1.5 12l4-4 3 3 2-2 4 4" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Hidden file picker. On the phone it offers the gallery or the camera. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          insertImages(editor, Array.from(e.target.files ?? []))
          e.target.value = '' // so picking the same file again still works
        }}
      />
    </div>
  )
}

export default Toolbar
