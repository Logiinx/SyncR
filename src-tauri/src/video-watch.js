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

  // The app's wishes come in the address's # part, from video-forward.html: a fallback site doesn't
  // pass them, so its player is left alone.
  const wanted = new URLSearchParams(location.hash.slice(1))
  const own = wanted.has('syncr-subtitles')

  // YouTube's controls on a fallback site's player (ours replace them on our own way, below) fade
  // like in our own Twitch player (player.js): 1.5 s without moving the mouse,
  // at once when it leaves. YouTube waits 4 s. Not while paused, in a menu, over the controls, or
  // during an ad. Its own classes do the hiding: "fadein" on the layout it uses now (controls
  // outside the player), "ytp-autohide" on the older one, which it still gives some videos.
  const QUIET_AFTER = 1500
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
  if (!own) {
    for (const kind of ['pointermove', 'pointerdown', 'keydown']) addEventListener(kind, wake, true)
    document.addEventListener('mouseleave', () => {
      clearTimeout(quietTimer)
      quiet()
    })
    wake()
    return
  }

  // Start quality and subtitles
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
  // A track and its translation, if any, as one value
  const trackKey = (track) => `${track.vss_id}>${track.translationLanguage?.languageCode || ''}`
  // One line translated into the language chosen in Settings, when no track is in it: from the
  // written track in the spoken language, else any written one, else the auto-generated one
  const translationTrack = (player, tracks) => {
    const language = wanted.get('syncr-language')
    const base = (track) => track.languageCode.split('-')[0]
    if (!language || tracks.some((track) => base(track) === language)) return null
    const into = (player.getOption('captions', 'translationLanguages') || []).find((one) => one.languageCode === language)
    const spoken = tracks.find((track) => track.kind === 'asr')
    const open = tracks.filter((track) => track.is_translateable)
    const from = open.find((track) => track.kind !== 'asr' && spoken && base(track) === base(spoken)) || open.find((track) => track.kind !== 'asr') || open[0]
    return into && from ? { ...from, translationLanguage: into } : null
  }
  // The menu's pick for this video (trackKey), else the best one
  let chosenTrack = null
  const pickTrack = (player, tracks) => {
    const all = [...tracks, translationTrack(player, tracks)].filter(Boolean)
    return all.find((track) => trackKey(track) === chosenTrack) || bestTrack(tracks)
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
    if (on !== wish) player.setOption('captions', 'track', wish ? pickTrack(player, tracks) : {})
    else if (on && needsLanguage) {
      needsLanguage = false
      const best = pickTrack(player, tracks)
      if (trackKey(best) !== trackKey(current)) player.setOption('captions', 'track', best)
    } else return
    settledAt = Date.now() + 1000
  }, 500)

  // ---- Our own controls (controls.js) over YouTube's player ----------------------------------------
  // YouTube's own parts are hidden, not removed: its player keeps working underneath, and its error
  // screen stays (the check above reads it). Ours sit in a shadow root, so neither page's looks
  // reach the other. The page refuses HTML given as plain text (Trusted Types): a policy of our own.
  let data = {}
  try { data = JSON.parse(wanted.get('syncr-data') || '{}') } catch {}
  let chosenQuality = null // the menu's choice for this video: a quality's name, 'auto', or none yet
  const HIDE_YOUTUBE = [
    '.ytp-chrome-top', '.ytp-chrome-bottom', '.ytp-gradient-top', '.ytp-gradient-bottom', '.ytp-pause-overlay',
    '.html5-endscreen', '.ytp-ce-element', '.ytp-cards-teaser', '.ytp-cards-button', '.ytp-watermark',
    '.ytp-large-play-button', '.ytp-paid-content-overlay', '.ytp-spinner', '.ytp-bezel', '.ytp-bezel-text-wrapper',
    '.ytp-overflow-button', '.ytp-youtube-button', '.ytp-impression-link', '.ytp-suggested-action',
    '.ytp-featured-product', '.ytp-tooltip', '.ytp-popup', '.ytp-contextmenu', '.ytp-doubletap-ui-legacy',
    '#player-controls', '#player-control-overlay', '.ytPlayerControlsContainerHost', '.player-controls-top',
    '.player-controls-bottom',
  ]
  const startControls = () => {
    const player = document.querySelector('#movie_player')
    const element = player?.querySelector('video')
    if (!player?.getPlayerState || !element || !document.body) return false
    const policy = trustedTypes.createPolicy('syncr-controls', { createHTML: (text) => text })
    const pageStyle = document.createElement('style')
    // Our font (the same numbers as index.css): a shadow root can't declare one
    // Subtitles move up out of the way while our controls show (lift, below), as YouTube does for its own.
    // Each box moves, not their layer: a moved layer gets painted under the video. Not while being
    // dragged: they follow the mouse, down to YouTube's own place (LOWEST).
    pageStyle.textContent = `${HIDE_YOUTUBE.join(', ')} { display: none !important; }
      html.syncr-stopped .ytp-error { display: none !important; }
      ${data.animations === false ? '' : 'html:not(.syncr-moving-subtitles) .caption-window { transition: translate 0.2s ease; }'}
      html.syncr-controls-shown:not(.syncr-moving-subtitles) .caption-window { translate: 0 calc(-1 * var(--syncr-lift, 0px)); }
      @font-face { font-family: 'SyncR UI'; font-weight: 400; src: local('Segoe UI'), local('SegoeUI'); ascent-override: 101%; descent-override: 32.5%; line-gap-override: 0%; }`
    document.head.append(pageStyle)

    const host = document.createElement('div')
    host.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647'
    for (const [name, color] of Object.entries(data.colors || {})) host.style.setProperty(name, color)
    if (data.zoom) host.style.zoom = data.zoom
    const root = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `${CONTROLS_CSS} #player { position: absolute; inset: 0; } #surface { position: absolute; inset: 0; } #time { pointer-events: none; }
      #surface.over-subtitles { cursor: grab; } #player.moving-subtitles #surface { cursor: grabbing; } #player.quiet #surface { cursor: none; }`
    const box = document.createElement('div')
    box.id = 'player'
    box.tabIndex = -1
    if (data.animations === false) box.classList.add('no-animations')
    const surface = document.createElement('div')
    surface.id = 'surface'
    box.append(surface)
    root.append(style, box)
    document.body.append(host)

    // Subtitles: their size and place, the same for every video, kept by this page's storage.
    // x and y: the middle of their bottom edge, as parts of the player (none = YouTube's place).
    // free: dragged anywhere; otherwise (the default) kept in the middle, moving only up and down.
    const LOOK_KEY = 'syncr-subtitles-look'
    let look = {}
    try { look = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}') || {} } catch {}
    const saveLook = () => { try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)) } catch {} }
    const lookStyle = document.createElement('style')
    document.head.append(lookStyle)
    const tracklist = () => player.getOption?.('captions', 'tracklist', { includeAsr: true }) || []
    const currentTrack = () => player.getOption?.('captions', 'track')
    // A language's name in that language
    const languageName = (code) => {
      try {
        const name = new Intl.DisplayNames([code], { type: 'language' }).of(code)
        return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
      } catch { return code }
    }
    const labels = data.labels || {}
    const subtitleTracks = () => {
      const tracks = tracklist()
      const shown = tracks.map((track) => {
        const name = languageName(track.languageCode) + (track.name ? ` – ${track.name}` : '')
        return { track, value: trackKey(track), text: track.kind === 'asr' ? (labels.autoGenerated || '{language}').replace('{language}', name) : name }
      })
      const translated = translationTrack(player, tracks)
      if (translated) shown.push({ track: translated, value: trackKey(translated), text: (labels.translated || '{language}').replace('{language}', languageName(translated.translationLanguage.languageCode)) })
      return shown
    }

    const qualityData = () => (player.getAvailableQualityData?.() || []).filter((one) => one.isPlayable !== false)
    const media = {
      element,
      paused: () => ![1, 3].includes(player.getPlayerState()),
      // YouTube's own short form (its Share button's)
      link: (at) => `https://youtu.be/${player.getVideoData().video_id}${at ? `?t=${at}` : ''}`,
      time: () => player.getCurrentTime() || 0,
      duration: () => player.getDuration() || 0,
      bufferedEnd: () => (player.getVideoLoadedFraction() || 0) * (player.getDuration() || 0),
      play: () => player.playVideo(),
      pause: () => player.pauseVideo(),
      seek: (seconds) => player.seekTo(seconds, true),
      volume: () => player.getVolume() / 100,
      muted: () => player.isMuted(),
      setVolume: (level) => player.setVolume(Math.round(level * 100)),
      setMuted: (on) => (on ? player.mute() : player.unMute()),
      rate: () => player.getPlaybackRate(),
      setRate: (speed) => player.setPlaybackRate(speed),
      qualities: () => {
        const levels = qualityData().map((one) => ({ value: one.quality, text: one.qualityLabel }))
        return levels.length ? [...levels, { value: 'auto', text: data.labels?.auto }] : []
      },
      quality: () => chosenQuality || player.getPlaybackQuality(),
      qualityText: () => {
        const name = player.getPlaybackQualityLabel?.() || qualityData().find((one) => one.quality === player.getPlaybackQuality())?.qualityLabel || ''
        return chosenQuality === 'auto' ? (name ? `${data.labels?.auto} (${name})` : data.labels?.auto) : name
      },
      // For the ⚙️ menu's last line: the picture's codec, from YouTube's "Stats for nerds"
      // ("avc1.640028 (137) / mp4a.40.2 (140)"); nothing when YouTube doesn't say
      info: () => {
        try { return { codec: (player.getStatsForNerds?.()?.codecs || '').split(' ')[0] } } catch { return {} }
      },
      setQuality: (value) => {
        chosenQuality = value
        qualityFrom = -1 // the start quality above is done with
        player.setPlaybackQualityRange(value, value)
      },
      subtitles: {
        tracks: () => subtitleTracks().map(({ value, text }) => ({ value, text })),
        track: () => (currentTrack()?.languageCode ? trackKey(currentTrack()) : ''),
        // A change right after a click or key: the check above notes on or off for the channel
        setTrack: (value) => {
          const found = value && subtitleTracks().find((one) => one.value === value)
          if (found) chosenTrack = value
          player.setOption('captions', 'track', found ? found.track : {})
        },
        toggle: () => player.setOption('captions', 'track', currentTrack()?.languageCode ? {} : pickTrack(player, tracklist())),
        size: () => look.size || 1,
        setSize: (size) => { look.size = size; saveLook(); drawLook() },
        moved: () => look.x !== undefined,
        centered: () => !look.free,
        // Back in the middle at the same height
        setCentered: (on) => { look.free = !on; if (on && look.x !== undefined) look.x = 0.5; saveLook(); drawLook() },
        resetPlace: () => { delete look.x; delete look.y; saveLook(); drawLook() },
      },
    }
    // ---- The bar's extras: chapters, previews, SponsorBlock's parts --------------------------------
    // Each read from what YouTube's page already has, SponsorBlock's asked once per video. Read
    // again for the next video of a playlist (same page). One missing leaves only that one out.
    // Set up before the controls, which draw the time (and so ask for the chapter) at once.
    let shownFor = null // the video they belong to
    let chapters = [] // { at: seconds, name }
    let previews = null // YouTube's picture sheets, the sharpest kind
    let sponsorParts = [] // { start, end, category }
    let tries = 0
    // The first array of chapters in an answer of YouTube's (they sit deep in the player bar's data)
    const findChapters = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 30) return null
      if (Array.isArray(value.chapters) && value.chapters[0]?.chapterRenderer) return value.chapters
      for (const key in value) {
        const found = findChapters(value[key], depth + 1)
        if (found) return found
      }
      return null
    }
    const readChapters = (id) => {
      const answer = player.getWatchNextResponse?.()
      const answerFor = answer?.currentVideoEndpoint?.watchEndpoint?.videoId
      if (!answer || (answerFor && answerFor !== id)) return false
      chapters = (findChapters(answer) || [])
        .map(({ chapterRenderer: one }) => ({ at: one.timeRangeStartMillis / 1000, name: one.title?.simpleText || one.title?.runs?.map((run) => run.text).join('') || '' }))
        .sort((a, b) => a.at - b.at)
      controls.setGaps(chapters.map((chapter) => chapter.at))
      // Another video's (the next one of a playlist): its list is redrawn, or the time is just the time
      if (controls.partsOpen()) chapters.length ? controls.openParts(chaptersList()) : controls.closeParts()
      drawTimeButton()
      return true
    }
    // "base|w#h#count#cols#rows#interval#name#sigh|…", the last kind the sharpest
    const readPreviews = (id) => {
      const answer = player.getPlayerResponse?.()
      if (!answer || answer.videoDetails?.videoId !== id) return false
      const [base, ...kinds] = answer.storyboards?.playerStoryboardSpecRenderer?.spec?.split('|') || []
      const level = kinds.length - 1
      const [width, height, count, cols, rows, interval, name, sigh] = (kinds[level] || '').split('#')
      const numbers = [width, height, count, cols, rows].map(Number)
      if (!base || numbers.some((number) => !(number > 0))) return true
      previews = { base, level, width: numbers[0], height: numbers[1], count: numbers[2], cols: numbers[3], rows: numbers[4], interval: Number(interval) / 1000, name, sigh }
      return true
    }
    const pictureAt = (seconds) => {
      if (!previews) return null
      const { base, level, width, height, count, cols, rows, name, sigh } = previews
      const interval = previews.interval || (player.getDuration() || 0) / count
      if (!(interval > 0)) return null
      const index = Math.min(Math.floor(seconds / interval), count - 1)
      const spot = index % (cols * rows)
      const address = `${base.replace('$L', level).replace('$N', name.replace('$M', Math.floor(index / (cols * rows))))}${sigh ? `&sigh=${sigh}` : ''}`
      return { address, width, height, cols, column: spot % cols, row: Math.floor(spot / cols) }
    }
    const chapterAt = (seconds) => {
      let name = ''
      for (const chapter of chapters) {
        if (chapter.at > seconds) break
        name = chapter.name
      }
      return name
    }
    // SponsorBlock's own colors and categories (the extension's defaults)
    const SPONSOR_COLORS = { sponsor: '#00d400', selfpromo: '#ffff00', interaction: '#cc00ff', intro: '#00ffff', outro: '#0202ed', preview: '#008fd6', music_offtopic: '#ff9900', filler: '#7300ff' }
    const sponsorAt = (seconds) => sponsorParts.find((part) => seconds >= part.start && seconds < part.end)
    // Asked by the first 4 characters of the video's scrambled id, so SponsorBlock never learns
    // which video it is (its private way); the answer lists several, ours is picked out.
    const askSponsorBlock = async (id) => {
      try {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
        const answer = await fetch(`https://sponsor.ajay.app/api/skipSegments/${hash.slice(0, 4)}?categories=${encodeURIComponent(JSON.stringify(Object.keys(SPONSOR_COLORS)))}`, { credentials: 'omit' })
        if (!answer.ok) return // 404: no parts for any of them
        const found = (await answer.json()).find((one) => one.videoID === id)
        if (shownFor !== id || !found) return
        sponsorParts = found.segments
          .filter((one) => SPONSOR_COLORS[one.category] && one.segment[1] > one.segment[0])
          .map((one) => ({ start: one.segment[0], end: one.segment[1], category: one.category }))
        controls.setMarked(sponsorParts.map((part) => ({ ...part, color: SPONSOR_COLORS[part.category] })))
      } catch {}
    }
    let chaptersRead = false
    let previewsRead = false
    setInterval(() => {
      const id = player.getVideoData?.()?.video_id
      if (!id) return
      if (id !== shownFor) {
        shownFor = id
        chapters = []
        previews = null
        sponsorParts = []
        chaptersRead = previewsRead = false
        tries = 0
        controls.setGaps([])
        controls.setMarked([])
        controls.closeParts()
        drawTimeButton()
        askSponsorBlock(id)
      }
      // YouTube's answers can come a little after the video
      if ((chaptersRead && previewsRead) || ++tries > 30) return
      if (!chaptersRead) chaptersRead = readChapters(id)
      if (!previewsRead) previewsRead = readPreviews(id)
      if (chaptersRead) controls.drawTime()
    }, 1000)

    const controls = playerControls({
      root,
      box,
      surface,
      html: (text) => policy.createHTML(text),
      labels: data.labels,
      locale: data.locale,
      stopKeys: true,
      hooks: {
        // Not after dragging the subtitles
        pictureClick: () => { const was = justMoved; justMoved = false; return was },
        fillTip: (seconds) => {
          root.getElementById('tip-time').textContent = controls.clock(seconds)
          controls.showPicture(pictureAt(seconds))
          const part = sponsorAt(seconds)
          controls.tipLines(chapterAt(seconds), part && { color: SPONSOR_COLORS[part.category], text: labels.sponsorParts?.[part.category] || part.category })
        },
        besideTime: (seconds) => chapterAt(seconds),
      },
    }, media)
    root.getElementById('chat-button').hidden = true
    // A click on the time (and the chapter after it) lists the chapters, like the Twitch player's games
    const timeButton = root.getElementById('time')
    const chaptersList = () => ({ button: timeButton, title: labels.chapters, parts: chapters })
    function drawTimeButton() {
      timeButton.title = chapters.length ? labels.chapters || '' : ''
      // Without chapters the time is only text (the page's style: no clicks, no hover)
      timeButton.style.pointerEvents = chapters.length ? 'auto' : ''
    }
    timeButton.onclick = () => {
      if (!chapters.length) return
      if (controls.partsOpen()) controls.closeParts()
      else controls.openParts(chaptersList())
    }
    drawTimeButton()
    // YouTube keeps its subtitles 2% above the bottom; our bar is 72 px high (controls.js) at the app's scale
    const BAR_HEIGHT = 72
    const LOWEST = 0.02
    const lift = () => {
      document.documentElement.classList.toggle('syncr-controls-shown', !box.classList.contains('quiet'))
      const bottom = look.x === undefined ? LOWEST : Math.max(look.y, LOWEST)
      // In the box's own pixels: its size is a zoom
      document.documentElement.style.setProperty('--syncr-lift', `${Math.max(0, (BAR_HEIGHT + 4) * (data.zoom || 1) - bottom * innerHeight) / (look.size || 1)}px`)
    }
    // Always placed by their middle: YouTube places auto-generated ones (rollup) by their left edge,
    // so a bigger size grew them to the right only, and a moved place put their left edge in the middle.
    // Never closer to the bottom than YouTube's own place (a small gap).
    const drawLook = () => {
      const middle = look.x === undefined ? 0.5 : look.x
      const bottom = look.x === undefined ? '' : `bottom: ${Math.max(look.y, LOWEST) * 100}% !important;`
      lookStyle.textContent = `.caption-window { zoom: ${look.size || 1}; }
        .caption-window.ytp-caption-window-bottom { left: ${middle * 100}% !important; margin-left: 0 !important; transform: translateX(-50%) !important; ${bottom} }`
      lift()
    }
    new MutationObserver(lift).observe(box, { attributes: true, attributeFilter: ['class'] })
    addEventListener('resize', lift)
    drawLook()

    // Dragging the subtitles: they lie under our controls, so the press is caught here. Kept inside
    // the player. Only the ones YouTube puts at the bottom (the usual place) move.
    const PLAIN_CLICK = 4 // px: moving less is a click on the picture
    const captionAt = (x, y) => [...document.querySelectorAll('.caption-window.ytp-caption-window-bottom')].find((one) => {
      const area = one.getBoundingClientRect()
      return x >= area.left && x <= area.right && y >= area.top && y <= area.bottom
    })
    let moving = null
    let justMoved = false
    surface.addEventListener('pointerdown', (event) => {
      justMoved = false
      const caption = event.button === 0 && captionAt(event.clientX, event.clientY)
      if (!caption) return
      const area = caption.getBoundingClientRect()
      const frame = player.getBoundingClientRect()
      moving = {
        fromX: event.clientX, fromY: event.clientY, frame,
        x: (area.left + area.width / 2 - frame.left) / frame.width,
        y: (frame.bottom - area.bottom) / frame.height,
        half: Math.min(area.width / 2 / frame.width, 0.5),
        height: Math.min(area.height / frame.height, 1),
        moved: false,
      }
      surface.setPointerCapture(event.pointerId)
      box.classList.add('moving-subtitles')
    })
    surface.addEventListener('pointermove', (event) => {
      if (!moving) return void surface.classList.toggle('over-subtitles', !!captionAt(event.clientX, event.clientY))
      const dx = event.clientX - moving.fromX
      const dy = event.clientY - moving.fromY
      if (!moving.moved && Math.hypot(dx, dy) < PLAIN_CLICK) return
      if (!moving.moved) document.documentElement.classList.add('syncr-moving-subtitles')
      moving.moved = true
      const within = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high))
      look.x = look.free ? within(moving.x + dx / moving.frame.width, moving.half, 1 - moving.half) : 0.5
      look.y = within(moving.y - dy / moving.frame.height, LOWEST, 1 - moving.height)
      drawLook()
    })
    const endMove = () => {
      if (!moving) return
      if (moving.moved) {
        justMoved = true
        saveLook()
      }
      moving = null
      box.classList.remove('moving-subtitles')
      document.documentElement.classList.remove('syncr-moving-subtitles')
    }
    surface.addEventListener('pointerup', endMove)
    surface.addEventListener('pointercancel', endMove)
    // YouTube says so, and the video's events don't cover everything (a quality or speed change)
    for (const kind of ['onStateChange', 'onPlaybackQualityChange', 'onPlaybackRateChange', 'onVolumeChange']) {
      player.addEventListener(kind, () => controls.refresh())
    }
    // Subtitles change without an event (on, off, another track, the list arriving)
    let subtitlesSeen = ''
    setInterval(() => {
      const now = `${media.subtitles.track()}|${tracklist().length}`
      if (now === subtitlesSeen) return
      subtitlesSeen = now
      controls.refresh()
    }, 300)
    // Loading is what YouTube says (3): at the end it stops without the video's usual events
    player.addEventListener('onStateChange', (state) => controls.loading(state === 3))
    // An error before the video has played: YouTube's error screen shows through, as the app gets
    // told and opens it another way (watchForRefusal). After: probably the network or YouTube's
    // streaming, so it loads again at the same spot once by itself, then offers Try again (like
    // the Twitch player). Speed, quality and subtitles are put back.
    const AGAIN_AFTER = 60000 // ms: an error again sooner gets the Try again button
    const SETTLE = 5000 // ms after reloading before an error counts
    let playedId = null // the video that has played in this page
    let lastTime = 0
    let reloadedAt = 0
    let restoreRate = null
    const stopped = (on) => {
      root.getElementById('message').hidden = !on
      document.documentElement.classList.toggle('syncr-stopped', on)
      if (on) controls.loading(false)
    }
    const reload = () => {
      stopped(false)
      reloadedAt = Date.now()
      restoreRate = player.getPlaybackRate()
      qualityFrom = QUALITIES.indexOf(chosenQuality || wanted.get('syncr-quality'))
      needsLanguage = true
      controls.loading(true)
      player.loadVideoById({ videoId: playedId, startSeconds: lastTime })
    }
    root.getElementById('message-text').textContent = labels.stoppedLoading || ''
    root.getElementById('retry').textContent = labels.retry || ''
    root.getElementById('retry').onclick = reload
    setInterval(() => {
      const videoData = player.getVideoData?.()
      const id = videoData?.video_id
      if (!videoData?.errorCode) {
        host.hidden = false
        if (player.getPlayerState() !== 1 || !id) return
        if (id !== playedId) restoreRate = null
        playedId = id
        lastTime = player.getCurrentTime() || 0
        if (restoreRate !== null && player.getPlaybackRate() !== restoreRate) player.setPlaybackRate(restoreRate)
        restoreRate = null
        return
      }
      if (id !== playedId) return void (host.hidden = true)
      if (Date.now() - reloadedAt < SETTLE || !root.getElementById('message').hidden) return
      if (Date.now() - reloadedAt > AGAIN_AFTER) reload()
      else stopped(true)
    }, 500)
    box.focus()
    return true
  }
  // Tried until YouTube's player is there; a mistake of ours stops it (the video still plays)
  const waitForPlayer = setInterval(() => {
    try {
      if (startControls()) clearInterval(waitForPlayer)
    } catch (error) {
      clearInterval(waitForPlayer)
      console.error(error)
    }
  }, 100)

  // The next video of a playlist while in full screen (video_window.rs, video_player_next): this same page
  // plays it, as a new page would leave full screen. The address changes too, as extensions read
  // the video from it. Says whether it could.
  window.syncrNextVideo = (id, start, subtitles) => {
    const player = document.querySelector('#movie_player')
    if (!document.fullscreenElement || !player?.loadVideoById || !/^[\w-]{6,20}$/.test(id)) return false
    history.replaceState(history.state, '', `/embed/${id}${location.search}${location.hash}`)
    player.loadVideoById({ videoId: id, startSeconds: start })
    qualityFrom = QUALITIES.indexOf(wanted.get('syncr-quality'))
    chosenQuality = null
    chosenTrack = null
    wish = subtitles
    needsLanguage = true
    watchForRefusal()
    return true
  }
})()
