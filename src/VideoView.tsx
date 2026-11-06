import { useRef } from 'react'
import { usePage } from './animations'
import { t } from './i18n'

// The Video tab (video.ts). Uses the Games tab's page layout (.games).
function VideoView() {
  const pageRef = useRef<HTMLElement>(null)
  usePage(pageRef)
  return (
    <main className="page games-page" ref={pageRef}>
      <div className="games">
        <p className="games-empty">{t('No videos yet')}</p>
      </div>
    </main>
  )
}

export default VideoView
