import { useRef, useState } from 'react'
import { ListVideo, Plus } from 'lucide-react'
import { usePage } from './animations'
import { t } from './i18n'
import { useFollows } from './video'
import { FollowDialog, FollowsWindow } from './VideoFollows'

// The Video tab (video.ts). Uses the Games tab's page layout (.games).
function VideoView() {
  const pageRef = useRef<HTMLElement>(null)
  usePage(pageRef)
  const follows = useFollows()
  const [adding, setAdding] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  return (
    <main className="page games-page" ref={pageRef}>
      <div className="games">
        <div className="games-views reminders-toolbar">
          <button className="reminders-new" onClick={() => setAdding(true)}>
            <Plus size={15} /> {t('Add a follow')}
          </button>
          <div className="reminders-tools">
            <button className="reminders-new" disabled={!follows?.length} onClick={() => setListOpen(true)}>
              <ListVideo size={15} /> {t('Follows')}
            </button>
          </div>
        </div>
        {follows && <p className="games-empty">{follows.length ? t('No videos yet') : t('No follows yet')}</p>}
      </div>
      {adding && <FollowDialog onClose={() => setAdding(false)} />}
      {listOpen && <FollowsWindow onClose={() => setListOpen(false)} />}
    </main>
  )
}

export default VideoView
