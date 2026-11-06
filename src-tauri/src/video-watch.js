// Runs in every page and frame of the video player window's site, before the page's own code.
// When YouTube's player-only page shows an error, this asks for the next way to open the video
// (videoPlayer.ts). A site can't call the app, so the request is a visit to an address that
// doesn't exist: lib.rs catches it and cancels the visit. Faking it only changes the way a video
// opens. Slow loading isn't an error, and once a video has played nothing is checked anymore.
// It also tells the app how far the video is, for resuming later (videoPositions.ts): a plain
// request, as those visits make the page think it's being left.
(() => {
  let sent = -1
  setInterval(() => {
    // The longest, as an ad can come first
    const video = [...document.querySelectorAll('video')].sort((a, b) => (b.duration || 0) - (a.duration || 0))[0]
    if (!video || !(video.duration > 0) || video.currentTime < 1 || video.currentTime === sent) return
    sent = video.currentTime
    fetch(`https://syncr-video.localhost/position?t=${Math.floor(video.currentTime)}&length=${Math.floor(video.duration)}`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
  }, 5000)

  const ask = ({ code, video }) => {
    location.href = `https://syncr-video.invalid/refused?code=${encodeURIComponent(code)}&video=${encodeURIComponent(video)}`
  }
  // muitube.com has the player in a frame, and a frame can't send its page elsewhere
  if (window === top && location.hostname === 'www.muitube.com') {
    addEventListener('message', ({ data }) => {
      if (data?.syncrRefused) ask(data.syncrRefused)
    })
  }
  if (!/^www\.youtube(-nocookie)?\.com$/.test(location.hostname) || !location.pathname.startsWith('/embed/')) return
  const started = Date.now()
  let seen = 0
  const timer = setInterval(() => {
    const player = document.querySelector('#movie_player')
    if (player?.getPlayerState?.() === 1 || Date.now() - started > 120000) return clearInterval(timer)
    const data = player?.getVideoData?.()
    // Seen twice, as the player sometimes gets over a problem by itself
    if (!data?.errorCode || !document.querySelector('.ytp-error') || ++seen < 2) return
    clearInterval(timer)
    const refused = { code: data.errorCode, video: data.video_id }
    if (window === top) ask(refused)
    else parent.postMessage({ syncrRefused: refused }, '*')
  }, 500)

  // Start quality and subtitles. The app's wishes come in the address's # part, from
  // video-forward.html: a fallback site doesn't pass them, so its player is left alone.
  const wanted = new URLSearchParams(location.hash.slice(1))
  if (!wanted.has('syncr-subtitles')) return
  const QUALITIES = ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny']
  // The chosen one or the highest under it, once. After that, the player's menu decides.
  let qualityFrom = QUALITIES.indexOf(wanted.get('syncr-quality'))
  const setQuality = (player) => {
    const levels = player.getAvailableQualityLevels?.() || []
    const level = QUALITIES.slice(qualityFrom).find((name) => levels.includes(name))
    if (!level) return
    player.setPlaybackQualityRange(level, level)
    qualityFrom = -1
  }
  // The chosen language, human-written first. Without it the language the video is spoken in (that
  // of its auto-generated track), as on means on.
  const bestTrack = (tracks) => {
    const inLanguage = (language) => {
      const found = tracks.filter((track) => track.languageCode.split('-')[0] === language)
      return found.find((track) => track.kind !== 'asr') || found[0]
    }
    const spoken = tracks.find((track) => track.kind === 'asr')?.languageCode.split('-')[0]
    return inLanguage(wanted.get('syncr-language')) || inLanguage(spoken) || tracks[0]
  }
  // A change right after a click or key is the viewer's choice for this channel. Any other is
  // YouTube's own memory (of the last video, or from before an ad) and gets put back. The state is
  // read from the player, not its button, which differs between YouTube's layouts.
  let wish = wanted.get('syncr-subtitles') === '1'
  let needsLanguage = true
  let touched = 0
  let settledAt = 0
  for (const kind of ['pointerdown', 'keydown']) addEventListener(kind, () => { touched = Date.now() }, true)
  setInterval(() => {
    const player = document.querySelector('#movie_player')
    if (!player?.getOption || player.classList.contains('ad-showing') || Date.now() < settledAt) return
    if (qualityFrom >= 0) setQuality(player)
    const tracks = player.getOption('captions', 'tracklist', { includeAsr: true }) || []
    if (!tracks.length) return
    const current = player.getOption('captions', 'track')
    const on = !!current?.languageCode
    if (on !== wish && Date.now() - touched < 1500) {
      wish = on
      needsLanguage = on
      fetch(`https://syncr-video.localhost/subtitles?on=${on ? 1 : 0}&video=${encodeURIComponent(player.getVideoData().video_id)}`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
    }
    if (on !== wish) player.setOption('captions', 'track', wish ? bestTrack(tracks) : {})
    else if (on && needsLanguage) {
      needsLanguage = false
      const best = bestTrack(tracks)
      if (best.vss_id !== current.vss_id) player.setOption('captions', 'track', best)
    } else return
    settledAt = Date.now() + 1000
  }, 500)
})()
