// The Twitch and YouTube logos in their own colors (shapes shared with link cards: siteLogos.ts)
import { PLAY_PATH as PLAY, TWITCH_PATH as TWITCH, YOUTUBE_PATH as YOUTUBE } from './siteLogos'

function VideoLogo({ platform, size = 15 }: { platform: 'twitch' | 'youtube'; size?: number }) {
  // i18n-ok: names of the sites
  const name = platform === 'twitch' ? 'Twitch' : 'YouTube'
  return (
    <svg className="video-logo" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={name}>
      <title>{name}</title>
      {platform === 'twitch' ? (
        <path style={{ fill: 'var(--twitch)' }} d={TWITCH} />
      ) : (
        <>
          <path style={{ fill: 'var(--youtube)' }} d={YOUTUBE} />
          <path fill="#fff" d={PLAY} />
        </>
      )}
    </svg>
  )
}

// A channel's picture (group rows, Follows window); an empty circle until it has one
export function ChannelPicture({ src }: { src: string | null | undefined }) {
  return src ? <img className="video-follow-icon" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="video-follow-icon" />
}

export default VideoLogo
