import { useLiveQuery } from 'dexie-react-hooks'
import { X } from 'lucide-react'
import { db, type VideoRow } from './db'
import { plural, t } from './i18n'
import { formatDue } from './reminders'
import type { VideoAlert } from './videoAlerts'
import VideoLogo from './VideoLogo'
import { videoClock } from './videoPositions'

// New videos of bell channels in the desktop pop-up (videoAlerts.ts), below the emails. The same
// card as an email's: a strip in the site's color, the site's logo + when it was found + the
// channel, the thumbnail beside the title and length. A click on it plays it (SyncR's player);
// Watch (big) · Add to queue · ✕ (the card goes, the video stays in To watch). From FOLD_FROM on,
// one "N new videos" card opens the Video tab. They can fade like emails (ReminderPopup.tsx).
const FOLD_FROM = 4

// A card's key among the pop-up's fading cards (ReminderPopup.tsx)
export const videoFadeKey = (id: string) => `video:${id}` // i18n-ok

// play · queue: Add to queue · close: ✕ or faded · open-tab: the folded card (all of them go)
export type VideoAlertAction = 'video-play' | 'video-queue' | 'video-close' | 'video-open-tab'

interface Shown {
  alert: VideoAlert
  video: VideoRow
  channel: string
}

// The cards' videos, read from the database (the alerts only hold ids); one that's gone isn't shown
export function useShownVideoAlerts(alerts: VideoAlert[]) {
  return useLiveQuery(async () => {
    const [videos, follows] = await Promise.all([db.videos.bulkGet(alerts.map((alert) => alert.id)), db.videoFollows.toArray()])
    return alerts.flatMap((alert, i): Shown[] => {
      const video = videos[i]
      const follow = video && follows.find((other) => !other.deleted && other.platform === video.platform && other.channelId === video.channelId)
      return video && follow ? [{ alert, video, channel: follow.name }] : []
    })
  }, [alerts])
}

function VideoCard({ shown: { alert, video, channel }, fading, onAction }: {
  shown: Shown
  fading: boolean
  onAction: (action: VideoAlertAction) => void
}) {
  return (
    <div className={`reminder-alert${fading ? ' fading' : ''}`} style={{ borderLeftColor: `var(--${video.platform})` }}>
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
      <div className="reminder-alert-buttons">
        <button className="primary" onClick={() => onAction('video-play')}>{t('Watch')}</button>
        <button onClick={() => onAction('video-queue')}>{t('Add to queue')}</button>
        <button className="video-alert-close" onClick={() => onAction('video-close')} title={t('Dismiss')} aria-label={t('Dismiss')}>
          <X size={15} />
        </button>
      </div>
    </div>
  )
}

export function VideoCards({ shown, fading, onAction }: {
  shown: Shown[]
  fading: Set<string> // keys of cards fading out by themselves (videoFadeKey)
  onAction: (alert: VideoAlert, action: VideoAlertAction) => void
}) {
  if (!shown.length) return null
  if (shown.length >= FOLD_FROM) {
    const channels = [...new Set(shown.map((item) => item.channel))]
    const platforms = new Set(shown.map((item) => item.video.platform))
    const all = (action: VideoAlertAction) => shown.forEach((item) => onAction(item.alert, action))
    return (
      <div
        className={`reminder-alert${shown.every((item) => fading.has(videoFadeKey(item.alert.id))) ? ' fading' : ''}`}
        style={{ borderLeftColor: platforms.size === 1 ? `var(--${shown[0].video.platform})` : undefined }}
      >
        <button className="reminder-alert-body" onClick={() => all('video-open-tab')} title={t('Show in the Video tab')}>
          <span className="reminder-alert-due">
            {platforms.size === 1 && <VideoLogo platform={shown[0].video.platform} />} {formatDue(shown[0].alert.at)}
          </span>
          <span className="reminder-alert-text">{plural(shown.length, '{n} new video', '{n} new videos')}</span>
          <span className="reminder-alert-note">{channels.join(', ')}</span>
        </button>
        <div className="reminder-alert-buttons">
          <button className="primary" onClick={() => all('video-open-tab')}>{t('Show in the Video tab')}</button>
          <button className="video-alert-close" onClick={() => all('video-close')} title={t('Dismiss all')} aria-label={t('Dismiss all')}>
            <X size={15} />
          </button>
        </div>
      </div>
    )
  }
  return (
    <>
      {shown.map((item) => (
        <VideoCard key={item.alert.id} shown={item} fading={fading.has(videoFadeKey(item.alert.id))} onAction={(action) => onAction(item.alert, action)} />
      ))}
    </>
  )
}
