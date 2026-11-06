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
})()
