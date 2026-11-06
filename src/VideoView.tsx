import { useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, ExternalLink, ListVideo, Plus, RefreshCw, Undo2, X } from 'lucide-react'
import { useListItems, usePage } from './animations'
import { nearDay, shortDate } from './dates'
import Dialog from './Dialog'
import { plural, t } from './i18n'
import { openLink } from './links'
import Spinner from './Spinner'
import { FillSwitch } from './tabLines'
import { checkVideos, clearFresh, markAllWatched, markOpened, setWatched, useChecking, useVideoFeed, type FeedVideo } from './video'
import { FollowDialog, FollowsWindow } from './VideoFollows'
import VideoLogo from './VideoLogo'
import { playVideo } from './videoPlayer'
import { useResumePosition, videoClock } from './videoPositions'

type List = 'towatch' | 'watched'

const FLASH_MS = 3600 // .video-row.fresh in index.css: 3 × 1.2 s

// Videos found since the tab was last showing flash softly once, when it opens or as they arrive
// while it's open. Not while the window is hidden: they wait until it's back.
function useFlashing(feed: ReturnType<typeof useVideoFeed>) {
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set())
  const [visible, setVisible] = useState(!document.hidden)
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  useEffect(() => {
    if (!feed || !visible) return
    const fresh = [...feed.toWatch, ...feed.watched].filter((video) => video.fresh)
    if (!fresh.length) return
    void clearFresh(fresh.map((video) => video.id))
    const shown = fresh.filter((video) => !video.watched && !video.opened && !video.gone).map((video) => video.id)
    if (!shown.length) return
    setFlashing((now) => new Set([...now, ...shown]))
    // Not stopped when leaving the tab: there's nothing left to do by then
    setTimeout(() => setFlashing((now) => new Set([...now].filter((id) => !shown.includes(id)))), FLASH_MS)
  }, [feed, visible])
  return flashing
}

// One video: a click opens it in the player window and marks it as opened; it stays in To watch
// until it's ticked. A video that's gone can't be opened, only removed from the list.
function VideoRow({ video, flash }: { video: FeedVideo; flash: boolean }) {
  const position = useResumePosition(video.id)
  function open() {
    playVideo(video)
    void markOpened(video.id)
  }
  function openInBrowser() {
    openLink(video.url)
    void markOpened(video.id)
  }
  return (
    <li className={`video-row${video.gone ? ' gone' : ''}${flash ? ' fresh' : ''}`} data-item={video.id}>
      <button className="video-row-open" disabled={video.gone} onClick={open}>
        <span className="video-thumb">
          {video.thumbnail && !video.gone && (
            <img
              src={video.thumbnail}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
            />
          )}
          {!video.gone && video.duration > 0 && <span className="video-duration">{videoClock(video.duration)}</span>}
          {position && !video.watched && !video.gone && (
            <span className="video-progress"><span style={{ width: `${(position.t / position.length) * 100}%` }} /></span>
          )}
        </span>
        <span className="video-text">
          <span className="video-title" title={video.title}>{video.title}</span>
          <span className="video-meta">
            <VideoLogo platform={video.platform} />
            <span className="video-channel" title={video.channel}>{video.channel}</span>
            <span>· {nearDay(video.published) ?? shortDate(video.published)}</span>
            {video.gone && <span>· {t('No longer available')}</span>}
            {video.opened && !video.gone && !video.watched && <span className="video-opened">{t('Opened')}</span>}
          </span>
        </span>
      </button>
      {!video.gone && (
        <button className="video-row-action" title={t('Open in browser')} onClick={openInBrowser}>
          <ExternalLink size={16} />
        </button>
      )}
      {video.watched ? (
        <button className="video-row-action" title={t('Back to To watch')} onClick={() => void setWatched(video.id, false)}>
          <Undo2 size={16} />
        </button>
      ) : video.gone ? (
        <button className="video-row-action" title={t('Remove')} onClick={() => void setWatched(video.id, true)}>
          <X size={16} />
        </button>
      ) : (
        <button className="video-row-action" title={t('Mark as watched')} onClick={() => void setWatched(video.id, true)}>
          <Check size={16} />
        </button>
      )}
    </li>
  )
}

// The Video tab (video.ts). Uses the Games tab's page layout (.games).
function VideoView() {
  const pageRef = useRef<HTMLElement>(null)
  usePage(pageRef)
  const feed = useVideoFeed()
  const flashing = useFlashing(feed)
  const { checking, errors } = useChecking()
  const [list, setList] = useState<List>('towatch')
  const [channel, setChannel] = useState('all') // a follow's id, or all of them
  const [adding, setAdding] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const follows = feed?.follows
  // A follow that was just removed: back to all of them
  const shownChannel = follows?.some((follow) => follow.id === channel) ? channel : 'all'
  const videos = (list === 'towatch' ? feed?.toWatch : feed?.watched)?.filter((video) => shownChannel === 'all' || video.followId === shownChannel)
  const listRef = useRef<HTMLUListElement>(null)
  useListItems(listRef, `${list} ${shownChannel}`)
  const empty = !follows?.length ? t('No follows yet') : list === 'towatch' ? t('Nothing to watch') : t('No watched videos yet')

  return (
    <main className="page games-page" ref={pageRef}>
      <div className="games">
        <div className="games-views reminders-toolbar video-toolbar">
          <FillSwitch
            className="video-lists"
            options={[
              { value: 'towatch' as List, label: t('To watch') },
              { value: 'watched' as List, label: t('Watched') },
            ]}
            value={list}
            onChange={setList}
          />
          {!!follows?.length && (
            <select className="video-channel-filter" value={shownChannel} onChange={(e) => setChannel(e.target.value)}>
              <option value="all">{t('All follows')}</option>
              {follows.map((follow) => (
                <option key={follow.id} value={follow.id}>{follow.name}</option>
              ))}
            </select>
          )}
          <div className="reminders-tools">
            {/* What the list shows now: all follows, or the chosen one */}
            <button className="reminders-refresh" disabled={list !== 'towatch' || !videos?.length} title={t('Mark all as watched')} onClick={() => setMarkingAll(true)}>
              <CheckCheck size={15} />
            </button>
            <button className="reminders-refresh" disabled={checking || !follows?.length} title={t('Check for new videos')} onClick={() => void checkVideos()}>
              {checking ? <Spinner label={t('Checking…')} /> : <RefreshCw size={15} />}
            </button>
            <button className="reminders-new" disabled={!follows?.length} onClick={() => setListOpen(true)}>
              <ListVideo size={15} /> {t('Follows')}
            </button>
            <button className="reminders-new" onClick={() => setAdding(true)}>
              <Plus size={15} /> {t('Add a follow')}
            </button>
          </div>
        </div>
        {errors.map((error) => (
          <p key={error} className="games-empty error">{error}</p>
        ))}
        {feed && videos?.length === 0 && checking && list === 'towatch' && follows?.length ? (
          <ul className="video-list">
            {[0, 1, 2].map((row) => (
              <li key={row} className="video-row">
                <span className="video-thumb skeleton" />
                <span className="video-text">
                  <span className="skeleton" style={{ width: '70%' }} />
                  <span className="skeleton" style={{ width: '35%', height: '0.75em' }} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          feed && videos?.length === 0 && <p className="games-empty">{empty}</p>
        )}
        <ul className="video-list" ref={listRef}>
          {videos?.map((video) => <VideoRow key={video.id} video={video} flash={flashing.has(video.id)} />)}
        </ul>
      </div>
      {adding && <FollowDialog onClose={() => setAdding(false)} />}
      {listOpen && <FollowsWindow onClose={() => setListOpen(false)} />}
      {markingAll && videos && (
        <Dialog
          request={{
            title: t('Mark all as watched?'),
            message: plural(videos.length, '{n} video moves to Watched.', '{n} videos move to Watched.'),
            confirmLabel: t('Mark as watched'),
            onConfirm: () => void markAllWatched(videos.map((video) => video.id)),
          }}
          onClose={() => setMarkingAll(false)}
        />
      )}
    </main>
  )
}

export default VideoView
