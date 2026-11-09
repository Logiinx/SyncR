// Runs in every page and frame of the video player window's site, before the page's own code.
// When YouTube's player-only page shows an error, this asks for the next way to open the video
// (videoPlayer.ts). A site can't call the app, so the request is a visit to an address that
// doesn't exist: video_window.rs catches it and cancels the visit. Faking it only changes the way a video
// opens. Slow loading isn't an error, and once a video has played nothing is checked anymore.
// It also tells the app how far the video is, for resuming later (videoPositions.ts): a plain
// request, as those visits make the page think it's being left.
(() => {
  const report = (t, length) => {
    fetch(`https://syncr-video.localhost/position?t=${Math.floor(t)}&length=${Math.floor(length)}`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
  }
  // Its end at once, as the next video of a playlist follows. Caught on the way down: this event
  // doesn't bubble up.
  addEventListener('ended', ({ target }) => {
    if (target.duration > 0) report(target.duration, target.duration)
  }, true)
  let sent = -1
  setInterval(() => {
    // The longest, as an ad can come first
    const video = [...document.querySelectorAll('video')].sort((a, b) => (b.duration || 0) - (a.duration || 0))[0]
    if (!video || !(video.duration > 0) || video.currentTime < 1 || video.currentTime === sent) return
    sent = video.currentTime
    report(video.currentTime, video.duration)
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
  // Twitch's own page (the fallback when our player can't play a video) starts in theater mode:
  // its button pressed once, unless it's on already. Found by its alt+T shortcut, the same in
  // every language. Only at the start: switching it off afterwards is the viewer's choice.
  if (window === top && location.hostname === 'www.twitch.tv' && location.pathname.startsWith('/videos/')) {
    const started = Date.now()
    const timer = setInterval(() => {
      if (document.querySelector('.persistent-player--theatre') || Date.now() - started > 30000) return clearInterval(timer)
      const button = [...document.querySelectorAll('button[aria-label]')]
        .find((button) => /\(alt\+t\)/i.test(button.getAttribute('aria-label')) && button.getBoundingClientRect().width)
      if (!button) return
      button.click()
      clearInterval(timer)
    }, 500)
    return
  }
  if (!/^www\.youtube(-nocookie)?\.com$/.test(location.hostname) || !location.pathname.startsWith('/embed/')) return
  const watchForRefusal = () => {
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
  }
  watchForRefusal()

  // Controls that fade like in our own Twitch player (player.js): 2.8 s without moving the mouse,
  // at once when it leaves. YouTube waits 4 s. Not while paused, in a menu, over the controls, or
  // during an ad. Its own classes do the hiding: "fadein" on the layout it uses now (controls
  // outside the player), "ytp-autohide" on the older one, which it still gives some videos.
  const QUIET_AFTER = 2800
  const OVER_CONTROLS = '#player-controls button:hover, #player-controls yt-progress-bar:hover, .ytp-chrome-bottom:hover'
  const IN_MENU = '#bottom-sheet-wrapper bottom-sheet-layout, .ytp-settings-menu:not([style*="display: none"])'
  const keepShowing = (player) => player.getPlayerState?.() !== 1 || player.classList.contains('ad-showing') || document.querySelector(`${OVER_CONTROLS}, ${IN_MENU}`)
  let quietTimer
  const quiet = () => {
    const player = document.querySelector('#movie_player')
    // Only the viewer's own moves bring the controls back, not this
    if (!player || keepShowing(player)) return void (quietTimer = setTimeout(quiet, QUIET_AFTER))
    player.classList.add('ytp-autohide')
    document.querySelector('#player-control-overlay')?.classList.remove('fadein')
  }
  const wake = () => {
    clearTimeout(quietTimer)
    document.querySelector('#movie_player')?.classList.remove('ytp-autohide')
    document.querySelector('#player-control-overlay')?.classList.add('fadein')
    quietTimer = setTimeout(quiet, QUIET_AFTER)
  }
  for (const kind of ['pointermove', 'pointerdown', 'keydown']) addEventListener(kind, wake, true)
  document.addEventListener('mouseleave', () => {
    clearTimeout(quietTimer)
    quiet()
  })
  wake()

  // Start quality and subtitles. The app's wishes come in the address's # part, from
  // video-forward.html: a fallback site doesn't pass them, so its player is left alone.
  const wanted = new URLSearchParams(location.hash.slice(1))
  if (!wanted.has('syncr-subtitles')) return
  // The window takes the video's shape (video_window.rs). Not during an ad, which can have another shape.
  if (window === top) {
    let shapeSent = ''
    setInterval(() => {
      const video = document.querySelector('#movie_player video')
      if (!video?.videoWidth || document.fullscreenElement || document.querySelector('#movie_player.ad-showing')) return
      const shape = (video.videoWidth / video.videoHeight).toFixed(4)
      if (shape === shapeSent) return
      shapeSent = shape
      fetch(`https://syncr-video.localhost/fit?ratio=${shape}&beside=0`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
    }, 1000)
  }
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

  // The next video of a playlist while in full screen (video_window.rs, video_player_next): this same page
  // plays it, as a new page would leave full screen. The address changes too, as extensions read
  // the video from it. Says whether it could.
  window.syncrNextVideo = (id, start, subtitles) => {
    const player = document.querySelector('#movie_player')
    if (!document.fullscreenElement || !player?.loadVideoById || !/^[\w-]{6,20}$/.test(id)) return false
    history.replaceState(history.state, '', `/embed/${id}${location.search}${location.hash}`)
    player.loadVideoById({ videoId: id, startSeconds: start })
    qualityFrom = QUALITIES.indexOf(wanted.get('syncr-quality'))
    wish = subtitles
    needsLanguage = true
    watchForRefusal()
    return true
  }
})()
