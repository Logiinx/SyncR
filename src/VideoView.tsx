import { useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, ChevronDown, ExternalLink, ListVideo, Plus, RefreshCw, Trash2, Undo2, X } from 'lucide-react'
import { useListItems, usePage } from './animations'
import { nearDay, shortDate } from './dates'
import Dialog from './Dialog'
import { plural, t } from './i18n'
import { openLink } from './links'
import { useLocalState } from './localState'
import Spinner from './Spinner'
import { FillSwitch } from './tabLines'
import { byChannel, checkVideos, clearFresh, clearWatched, markAllWatched, markOpened, setWatched, useChecking, useVideoFeed, type FeedVideo } from './video'
import { AddVideoDialog, FollowDialog, FollowsWindow } from './VideoFollows'
import VideoLogo from './VideoLogo'
import { playVideo } from './videoPlayer'
import { useResumePosition, videoClock } from './videoPositions'

type List = 'towatch' | 'watched'

// Videos found since the tab last showed get a "New" tag for as long as it stays open, also those
// that arrive meanwhile. Marked as shown right away: the next time the tab opens, they aren't new.
function useNewVideos(feed: ReturnType<typeof useVideoFeed>) {
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const fresh = [...(feed?.toWatch ?? []), ...(feed?.watched ?? [])].filter((video) => video.fresh).map((video) => video.id)
    if (!fresh.length) return
    void clearFresh(fresh)
    setNewIds((now) => new Set([...now, ...fresh]))
  }, [feed])
  return newIds
}

const videoDay = (video: FeedVideo) => nearDay(video.published) ?? shortDate(video.published)

// A channel's 2 or more videos folded into one row
function VideoGroup({ videos, open, newCount, onToggle }: { videos: FeedVideo[]; open: boolean; newCount: number; onToggle: () => void }) {
  const newest = videos[0]
  return (
    <li className={open ? 'video-row video-group' : 'video-row video-group folded'} data-item={`group-${newest.followId}`}>
      <button className="video-row-open" aria-expanded={open} onClick={onToggle}>
        <ChevronDown size={14} className="video-group-chevron" />
        {newest.channelIcon ? (
          <img className="video-follow-icon" src={newest.channelIcon} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="video-follow-icon" />
        )}
        <span className="video-text">
          <span className="video-title" title={newest.channel}>{newest.channel}</span>
          <span className="video-meta">
            <VideoLogo platform={newest.platform} />
            <span>{plural(videos.length, '{n} video', '{n} videos')}</span>
            <span>· {videoDay(newest)}</span>
            {newCount > 0 && <span className="video-new">{plural(newCount, '{n} new video', '{n} new videos')}</span>}
          </span>
        </span>
      </button>
    </li>
  )
}

// One video: a click opens it in the player window and marks it as opened; it stays in To watch
// until it's ticked. A video that's gone can't be opened, only removed from the list.
function VideoRow({ video, isNew, inGroup }: { video: FeedVideo; isNew: boolean; inGroup?: boolean }) {
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
    <li className={`video-row${video.gone ? ' gone' : ''}${inGroup ? ' in-group' : ''}`} data-item={video.id}>
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
            <span>· {videoDay(video)}</span>
            {video.gone && <span>· {t('No longer available')}</span>}
            {video.opened && !video.gone && !video.watched && <span className="video-opened">{t('Opened')}</span>}
            {isNew && <span className="video-new">{t('New')}</span>}
          </span>
        </span>
      </button>
      {!video.gone && (
        <button className="video-row-action" title={t('Open in browser')} onClick={openInBrowser}>
          <ExternalLink size={16} />
        </button>
      )}
      {video.watched ? (
        <>
          <button className="video-row-action" title={t('Back to To watch')} onClick={() => void setWatched(video.id, false)}>
            <Undo2 size={16} />
          </button>
          <button className="video-row-action" title={t('Remove from Watched')} onClick={() => void clearWatched([video.id])}>
            <X size={16} />
          </button>
        </>
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
  const newIds = useNewVideos(feed)
  const { checking, errors } = useChecking()
  const [list, setList] = useState<List>('towatch')
  const [channel, setChannel] = useState('all') // a follow's id, or all of them
  const [adding, setAdding] = useState(false)
  const [addingVideo, setAddingVideo] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [grouped, setGrouped] = useLocalState('syncr.video.byChannel', false)
  const [openGroups, setOpenGroups] = useLocalState<string[]>('syncr.video.openGroups', [])
  const follows = feed?.follows
  // A follow that was just removed: back to all of them
  const shownChannel = follows?.some((follow) => follow.id === channel) ? channel : 'all'
  const videos = (list === 'towatch' ? feed?.toWatch : feed?.watched)?.filter((video) => shownChannel === 'all' || video.followId === shownChannel)
  const listRef = useRef<HTMLUListElement>(null)
  // One channel chosen: there's nothing to group
  const grouping = grouped && shownChannel === 'all'
  useListItems(listRef, `${list} ${shownChannel} ${grouping}`)
  const tagNew = (video: FeedVideo) => newIds.has(video.id) && !video.opened && !video.gone && !video.watched
  const toggleGroup = (id: string) => setOpenGroups((now) => (now.includes(id) ? now.filter((other) => other !== id) : [...now, id]))
  const anyVideos = !!feed?.toWatch.length || !!feed?.watched.length
  // Shows where it went: To watch, all follows, its group open
  function showAdded(followId: string) {
    setList('towatch')
    setChannel('all')
    setOpenGroups((now) => (now.includes(followId) ? now : [...now, followId]))
  }
  const empty = !follows?.length && !anyVideos ? t('No follows yet') : list === 'towatch' ? t('Nothing to watch') : t('No watched videos yet')

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
            {(!!follows?.length || anyVideos) && (
              <label className="reminders-hide-repeating" title={t('Fold each channel’s videos into one row')}>
                <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
                {t('By channel')}
              </label>
            )}
            {/* What the list shows now: all follows, or the chosen one */}
            <button className="reminders-refresh" disabled={list !== 'towatch' || !videos?.length} title={t('Mark all as watched')} onClick={() => setMarkingAll(true)}>
              <CheckCheck size={15} />
            </button>
            <button className="reminders-refresh" disabled={list !== 'watched' || !videos?.length} title={t('Clear watched videos')} onClick={() => setClearingAll(true)}>
              <Trash2 size={15} />
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
            <button className="reminders-new" onClick={() => setAddingVideo(true)}>
              <Plus size={15} /> {t('Add a video')}
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
          {/* A flat list, so a video stays the same item whether it's in a group or not */}
          {(grouping ? byChannel(videos ?? []) : (videos ?? []).map((video) => [video])).flatMap((group) => {
            if (group.length === 1) return [<VideoRow key={group[0].id} video={group[0]} isNew={tagNew(group[0])} />]
            const id = group[0].followId
            const open = openGroups.includes(id)
            return [
              <VideoGroup key={`group-${id}`} videos={group} open={open} newCount={group.filter(tagNew).length} onToggle={() => toggleGroup(id)} />,
              ...(open ? group.map((video) => <VideoRow key={video.id} video={video} isNew={tagNew(video)} inGroup />) : []),
            ]
          })}
        </ul>
      </div>
      {adding && <FollowDialog onClose={() => setAdding(false)} />}
      {addingVideo && <AddVideoDialog onAdded={showAdded} onClose={() => setAddingVideo(false)} />}
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
      {clearingAll && videos && (
        <Dialog
          request={{
            title: t('Clear watched videos?'),
            message: plural(videos.length, '{n} video leaves Watched for good.', '{n} videos leave Watched for good.'),
            confirmLabel: t('Clear'),
            danger: true,
            onConfirm: () => void clearWatched(videos.map((video) => video.id)),
          }}
          onClose={() => setClearingAll(false)}
        />
      )}
    </main>
  )
}

export default VideoView
