import { useEffect, useState } from 'react'

// Opens the full-screen view of an image (called when an image in a note is clicked)
export function openImageViewer(url: string) {
  window.dispatchEvent(new CustomEvent('open-image', { detail: url }))
}

// Full-screen image view. Click the image: fit to screen ↔ real size.
// Close: click the dark area, ✕, Escape, or the phone's back button.
function ImageViewer() {
  const [url, setUrl] = useState<string | null>(null)
  const [realSize, setRealSize] = useState(false)

  useEffect(() => {
    const onOpen = (e: Event) => {
      setUrl((e as CustomEvent<string>).detail)
      setRealSize(false)
      // An extra history entry, so the phone's back button closes the viewer
      // instead of leaving the app
      history.pushState({ imageViewer: true }, '')
    }
    const onBack = () => setUrl(null)
    window.addEventListener('open-image', onOpen)
    window.addEventListener('popstate', onBack)
    return () => {
      window.removeEventListener('open-image', onOpen)
      window.removeEventListener('popstate', onBack)
    }
  }, [])

  useEffect(() => {
    if (!url) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [url])

  // Going back removes the extra history entry; popstate then hides the viewer
  function close() {
    history.back()
  }

  if (!url) return null
  return (
    <div className={realSize ? 'image-viewer real-size' : 'image-viewer'} onClick={close}>
      <img
        src={url}
        alt=""
        onClick={(e) => {
          e.stopPropagation()
          setRealSize(!realSize)
        }}
      />
      <button className="image-viewer-close" aria-label="Close" title="Close (Esc)" onClick={close}>
        ✕
      </button>
    </div>
  )
}

export default ImageViewer
