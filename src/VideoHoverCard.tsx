import { Eye, ListVideo, ThumbsUp, type LucideIcon } from 'lucide-react'
import { ageText, clockTime, fullDate } from './dates'
import { compactNumber, plural, t, type TextKey } from './i18n'
import type { FeedVideo } from './video'
import type { CardPiece } from './videoCards'
import VideoLogo from './VideoLogo'
import { videoClock, type VideoPosition } from './videoPositions'
import { useVideoStats } from './videoStats'

// What a video's picture and card need (a list's video, or a new one in the pop-up)
export type CardVideo = Pick<FeedVideo, 'id' | 'platform' | 'title' | 'channel' | 'thumbnail' | 'published' | 'duration' | 'gone' | 'live'>

// A video's picture with its length, and how far it was watched when it was stopped partway (on
// the row: the time shows it on hover; on its card: always)
export function VideoThumb({ video, opened }: { video: CardVideo; opened: VideoPosition | null }) {
  return (
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
      {/* A Twitch stream still being streamed: red badge on the picture, like the sites' own */}
      {video.live && !video.gone && (
        <span className="video-live">
          <span className="video-live-dot" />
          {t('Live')}
        </span>
      )}
      {!video.gone && video.duration > 0 && (
        <span className="video-duration">
          {opened ? (
            <>
              <span className="video-length">{videoClock(video.duration)}</span>
              <span className="video-spot">{`${videoClock(opened.t, video.duration >= 3600)} / ${videoClock(video.duration)}`}</span>
            </>
          ) : (
            videoClock(video.duration)
          )}
        </span>
      )}
      {opened && (
        <span className={`video-progress ${video.platform}`}><span style={{ width: `${(opened.t / opened.length) * 100}%` }} /></span>
      )}
    </span>
  )
}

// "1.2K" after its icon, like link cards' counts; the whole count in words for screen readers
function StatCount({ icon: Icon, n, one, other }: { icon: LucideIcon; n: number; one: TextKey; other: TextKey }) {
  const text = compactNumber(n)
  return (
    <span className="video-card-count" aria-label={plural(n, one, other, { count: text })}>
      <Icon size={13} aria-hidden />
      {text}
    </span>
  )
}

// A video row's card, shown after resting the mouse on it (also the pop-up's Large new-video card,
// VideoAlertCards.tsx): a bigger picture, the whole title, its
// channel (and playlist), how old it is and the day and time it came out, and its views and likes now (asked on the
// first hover: "…" meanwhile; nothing when gone or the ask failed)
export function VideoCardContent({ video, opened, from, shows }: { video: CardVideo; opened: VideoPosition | null; from?: string; shows: (piece: CardPiece) => boolean }) {
  const stats = useVideoStats(video, shows('videoStats'))
  const age = ageText(video.published)
  const counts = stats && [
    stats.views !== null && <StatCount key="views" icon={Eye} n={stats.views} one="{count} view" other="{count} views" />,
    stats.likes !== null && <StatCount key="likes" icon={ThumbsUp} n={stats.likes} one="{count} like" other="{count} likes" />,
  ].filter(Boolean)
  return (
    <>
      {shows('videoPicture') && video.thumbnail && !video.gone && <VideoThumb video={video} opened={opened} />}
      {shows('videoDetails') && (
        <>
          <span className="video-card-title">{video.title}</span>
          <span className="video-card-line">
            <VideoLogo platform={video.platform} />
            <span className="card-author">{video.channel}</span>
          </span>
          {from && (
            <span className="video-card-line">
              <ListVideo size={15} className="video-logo" aria-label={t('Playlist')} />
              <span>{from}</span>
            </span>
          )}
          <span className="video-card-line">
            <span>
              {age && <span className="card-bright">{age}</span>}
              {`${age ? ' · ' : ''}${fullDate(video.published)}, ${clockTime(video.published)}`}
            </span>
          </span>
        </>
      )}
      {shows('videoStats') && stats === undefined ? (
        <span className="video-card-line">…</span>
      ) : (
        !!counts?.length && <span className="video-card-line">{counts.flatMap((count, i) => (i ? [' · ', count] : [count]))}</span>
      )}
    </>
  )
}
