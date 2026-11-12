// The Twitch and YouTube logos in their own colors: the one exception to "Lucide only", as
// Lucide has no brand logos. Shapes from Simple Icons (simpleicons.org, free to use, CC0).
// i18n-ok
const TWITCH = 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z'
// i18n-ok
const YOUTUBE = 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z'
// i18n-ok
const PLAY = 'M9.545 15.568V8.432L15.818 12z'

function VideoLogo({ platform, size = 15 }: { platform: 'twitch' | 'youtube'; size?: number }) {
  // i18n-ok: names of the sites
  const name = platform === 'twitch' ? 'Twitch' : 'YouTube'
  return (
    <svg className="video-logo" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={name}>
      <title>{name}</title>
      {platform === 'twitch' ? (
        <path fill="#9146ff" d={TWITCH} />
      ) : (
        <>
          <path fill="#ff0033" d={YOUTUBE} />
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
