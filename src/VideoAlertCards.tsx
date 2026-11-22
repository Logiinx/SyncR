import { useEffect, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, List, ListPlus, ListVideo, Play, X } from 'lucide-react'
import CardBar, { LineButtons, type BarButton } from './CardBar'
import { useCardPieces, VIDEO_PIECES } from './videoCards'
import { VideoCardContent } from './VideoHoverCard'
import { db, type VideoRow } from './db'
import { plural, t } from './i18n'
import { formatDue } from './reminders'
import { QUEUED_FADE_SECONDS, type QueuedNote } from './queuedNote'
import { usePopupCardSize, type VideoAlert } from './videoAlerts'
import VideoLogo from './VideoLogo'
import { videoClock } from './videoPositions'
import { betterTitles, checkTitles, useDeArrow, withBetterTitle } from './videoTitles'

// New videos of bell channels in the desktop pop-up (videoAlerts.ts), below the emails. The same
// card as an email's, with a strip in the site's color, in one of two sizes (Video settings):
// Large = the Video tab's hover card (VideoHoverCard.tsx: big picture, whole title, channel, day,
// views and likes, as its checkboxes say); Compact = the site's logo + when it was found + the
// channel, then a small picture beside the title and length. A click on it plays it (SyncR's
// player); a bar at the bottom (CardBar, like the emails'): ▶ Watch · Add to queue · ✕ (the card
// goes, the video stays in To watch). Like the emails (mockup A + B, video-popup-cards.html), only
// the newest video gets the card; older ones are one-line rows below it (VideoRow), under a
// "N new videos · Show in the Video tab" head. They fade like emails (ReminderPopup.tsx).

// A card's key among the pop-up's fading cards (ReminderPopup.tsx)
export const videoFadeKey = (id: string) => `video:${id}` // i18n-ok

// play · queue: Add to queue · close: ✕ or faded · open-tab: the head's button (all of them go)
export type VideoAlertAction = 'video-play' | 'video-queue' | 'video-close' | 'video-open-tab'

interface Shown {
  alert: VideoAlert
  video: VideoRow & { originalTitle?: string }
  channel: string
}

// The cards' videos, read from the database (the alerts only hold ids); one that's gone isn't shown
// (with DeArrow's better title, asked here too: a new video may have one already)
export function useShownVideoAlerts(alerts: VideoAlert[]) {
  const deArrow = useDeArrow()
  const shown = useLiveQuery(async () => {
    const [videos, follows, better] = await Promise.all([db.videos.bulkGet(alerts.map((alert) => alert.id)), db.videoFollows.toArray(), betterTitles()])
    return alerts.flatMap((alert, i): Shown[] => {
      const video = videos[i]
      const follow = video && follows.find((other) => !other.deleted && other.platform === video.platform && other.channelId === video.channelId)
      return video && follow ? [{ alert, video: withBetterTitle(video, better), channel: follow.name }] : []
    })
  }, [alerts, deArrow])
  useEffect(() => {
    if (shown?.length && deArrow) void checkTitles(shown.map(({ video }) => ({ ...video, title: video.originalTitle ?? video.title })))
  }, [shown, deArrow])
  return shown
}

function VideoCard({ shown: { alert, video, channel }, large, fading, onAction }: {
  shown: Shown
  large: boolean
  fading: boolean
  onAction: (action: VideoAlertAction) => void
}) {
  const shows = useCardPieces()
  return (
    <div className={`reminder-alert bar-card${fading ? ' fading' : ''}`} style={{ borderLeftColor: `var(--${video.platform})` }}>
      {large ? (
        <button className="reminder-alert-body video-card video-alert-large" onClick={() => onAction('video-play')} title={t('Watch')}>
          <VideoCardContent video={{ ...video, channel }} opened={null} shows={shows} />
        </button>
      ) : (
        <button className="reminder-alert-body" onClick={() => onAction('video-play')} title={t('Watch')}>
          <span className="reminder-alert-due">
            <VideoLogo platform={video.platform} /> {formatDue(alert.at)} · <span className="mail-alert-account">{channel}</span>
          </span>
          <span className="video-alert-main">
            {video.thumbnail && <img className="video-alert-thumb" src={video.thumbnail} alt="" />}
            <span className="video-alert-text">
              <span className="reminder-alert-text">{video.title}</span>
              {video.duration > 0 && <span className="reminder-alert-note">{videoClock(video.duration)}</span>}
            </span>
          </span>
        </button>
      )}
      <CardBar buttons={videoButtons(onAction)} />
    </div>
  )
}

// A new video's 3 actions: the card's bar, also the icons of a row
const videoButtons = (onAction: (action: VideoAlertAction) => void): BarButton[] => [
  { label: t('Watch'), icon: <Play size={15} />, primary: true, onClick: () => onAction('video-play') },
  { label: t('Add to queue'), icon: <ListPlus size={15} />, onClick: () => onAction('video-queue') },
  { label: t('Dismiss'), icon: <X size={15} />, end: 'close', onClick: () => onAction('video-close') },
]

// An older video, as one line below the newest one's card (like an email's row): a small
// picture, the channel (semi-bold), the title (dim), then the card's 3 actions as icons. The
// site only by its color (strip). A click on the line plays it, like the card.
function VideoRow({ shown: { video, channel }, fading, onAction }: {
  shown: Shown
  fading: boolean
  onAction: (action: VideoAlertAction) => void
}) {
  return (
    <div className={`reminder-alert card-line${fading ? ' fading' : ''}`} style={{ borderLeftColor: `var(--${video.platform})` }}>
      <button className="card-line-body" onClick={() => onAction('video-play')} title={t('Watch')}>
        {video.thumbnail ? <img className="video-line-thumb" src={video.thumbnail} alt="" /> : <span className="video-line-thumb" />}
        <span className="card-line-name">{channel}</span>
        <span className="card-line-text">{video.title}</span>
      </button>
      <LineButtons buttons={videoButtons(onAction)} />
    </div>
  )
}

export function VideoCards({ shown, fading, onAction }: {
  shown: Shown[]
  fading: Set<string> // keys of cards fading out by themselves (videoFadeKey)
  onAction: (alert: VideoAlert, action: VideoAlertAction) => void
}) {
  const size = usePopupCardSize()
  const shows = useCardPieces()
  // Large with every hover card piece off would be empty: Compact then
  const large = size === 'large' && VIDEO_PIECES.some(shows)
  if (!shown.length) return null
  return (
    <>
      {shown.length > 1 && (
        <div className="reminder-alerts-head">
          <span>{plural(shown.length, '{n} new video', '{n} new videos')}</span>
          <button onClick={() => shown.forEach((item) => onAction(item.alert, 'video-open-tab'))}>{t('Show in the Video tab')}</button>
        </div>
      )}
      {shown.map((item, i) => {
        const props = { shown: item, fading: fading.has(videoFadeKey(item.alert.id)), onAction: (action: VideoAlertAction) => onAction(item.alert, action) }
        return i === 0 ? <VideoCard key={item.alert.id} {...props} large={large} /> : <VideoRow key={item.alert.id} {...props} />
      })}
    </>
  )
}

// "Added to queue" (queuedNote.ts): a copied video the link shortcut sent to the Queue. A
// confirmation, not an alert: the message is the heading, in green (added) or blue (already
// there), also the strip and a badge on the picture; then the title, the site's logo, channel
// and length. A click on it or Show queue shows the Queue; Watch now plays it (bar: CardBar); ✕ or after a few
// seconds it goes (ReminderPopup.tsx). A line at the bottom counts those seconds down; full
// while the mouse is over the pop-up (the count starts again after).
export function QueuedCard({ note, fading, paused, onOpen, onWatch, onClose }: {
  note: QueuedNote
  fading: boolean
  paused: boolean
  onOpen: () => void
  onWatch: () => void
  onClose: () => void
}) {
  const { video } = note
  const color = note.already ? 'var(--text-blue)' : 'var(--text-green)'
  return (
    <div
      className={`reminder-alert bar-card queued-card${fading ? ' fading' : ''}`}
      style={{ borderLeftColor: color, '--queued-color': color, '--countdown': `${QUEUED_FADE_SECONDS}s` } as CSSProperties}
    >
      <button className="reminder-alert-body" onClick={onOpen} title={t('Show the queue')}>
        <span className="video-alert-main">
          <span className="queued-thumb">
            {video.thumbnail ? <img className="video-alert-thumb" src={video.thumbnail} alt="" /> : <span className="video-alert-thumb" />}
            <span className="queued-badge">{note.already ? <List size={12} strokeWidth={3} /> : <Check size={12} strokeWidth={3.5} />}</span>
          </span>
          <span className="video-alert-text">
            <span className="reminder-alert-text queued-heading">{note.already ? t('Already in the queue') : t('Added to queue')}</span>
            <span className="queued-title">{video.title}</span>
            <span className="queued-meta">
              <VideoLogo platform={video.platform} size={12} />
              <span className="mail-alert-account">{note.channel}</span>
              {video.duration > 0 && <span className="queued-length">· {videoClock(video.duration)}</span>}
            </span>
          </span>
        </span>
      </button>
      <CardBar
        buttons={[
          { label: t('Watch now'), icon: <Play size={15} />, primary: true, onClick: onWatch },
          { label: t('Show queue'), icon: <ListVideo size={15} />, onClick: onOpen },
          { label: t('Dismiss'), icon: <X size={15} />, end: 'close', onClick: onClose },
        ]}
      />
      {/* A new card or the end of a pause starts the count again */}
      <span key={`${note.at}${paused}`} className={`queued-countdown${paused ? ' paused' : ''}`} />
    </div>
  )
}
