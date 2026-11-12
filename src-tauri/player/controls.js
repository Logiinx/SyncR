// The controls shared by our own players: the Twitch player's page (player.js) and YouTube's
// player-only page, where video-watch.js puts them in a shadow root over YouTube's own player.
// They never touch a video directly: each player gives a "media" object (what's below), so the
// same buttons, bar, menu, keys and fading work on both.
//
// env: {
//   root: document or a shadow root ($ looks there), box: the element they go in (#player),
//   surface: what a click on the picture lands on, html: (text) => what innerHTML takes,
//   labels, locale, stopKeys: true to keep every plain key from the page under it,
//   hooks: { fillTip, besideTime: (seconds) => text after the time, besideOnHover: it slides out only while the time is hovered, menu({ title, row, pick, choices, panel, element }): its part of the ⚙️ menu,
//            keys: { key: action }, keepShowing,
//            beforeMenu, pictureClick: () => true when it did something }
// }
// media: {
//   element: the <video> (its events), paused(), time(), duration(), bufferedEnd(),
//   play(), pause(), seek(seconds), volume() 0-1, muted(), setVolume(0-1), setMuted(on),
//   rate(), setRate(speed), qualities(): [{ value, text }], quality(): the value ticked,
//   qualityText(): shown on the ⚙️ button, setQuality(value),
//   link(seconds or none): the video's address, starting at that second (none: no right-click menu),
//   subtitles (only a player that has them): { tracks(): [{ value, text }], track(): the value on
//     or '' when off, setTrack(value or ''), toggle(), size(), setSize(n), moved(), resetPlace() }
// }
function playerControls(env, media) {
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
  const JUMP = 10 // seconds
  const QUIET_AFTER = 1500 // ms without moving the mouse before the controls fade
  const ICONS = {
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
    pause: '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>',
    volumeHigh: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    volumeLow: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
    volumeOff: '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    subtitles: '<rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>',
    // The ⚙️ menu's rows (Lucide SlidersHorizontal, Gauge); chat = Lucide MessageSquare, also the chat button's
    quality: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
    speed: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    chat: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
    minus: '<path d="M5 12h14"/>',
    // The right-click menu's lines (Lucide Copy, Clock)
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    clock: '<path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  }
  const icon = (name) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`
  const html = env.html || ((text) => text)
  const setIcon = (element, name) => { element.innerHTML = html(icon(name)) }
  const $ = (id) => env.root.getElementById(id)
  const labels = env.labels || {}
  const hooks = env.hooks || {}
  const box = env.box
  const video = media.element
  const numbers = new Intl.NumberFormat(env.locale || undefined, { maximumFractionDigits: 2 })

  box.insertAdjacentHTML('beforeend', html(`
  <div id="ui">
    <div id="shade"></div>
    <button id="big">${icon('play')}</button>
    <div id="bottom">
      <div id="progress">
        <div id="track"><div id="buffer"></div><div id="played"></div><div id="marked"></div><div id="marked-played"></div></div>
        <div id="knob"></div>
        <div id="tip" hidden><div id="tip-picture" hidden></div><div id="tip-time"></div><div id="tip-game" hidden></div><div id="tip-part" hidden><i></i><span></span></div></div>
      </div>
      <div id="goto" hidden><div class="menu-title" id="goto-title"></div><input id="goto-text" type="text" spellcheck="false" autocomplete="off"><div id="goto-note"></div></div>
      <div id="bar">
        <button class="button" id="play"></button>
        <button class="button" id="back"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg><b>10</b></button>
        <button class="button" id="forward"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg><b>10</b></button>
        <div id="volume">
          <button class="button" id="mute"></button>
          <input id="level" type="range" min="0" max="1" step="0.05">
          <span id="level-text"></span>
        </div>
        <button class="button" id="time"><span id="time-now"></span><span id="time-beside"></span></button>
        <div id="spacer"></div>
        <button class="button" id="subtitles" hidden></button>
        <button class="button" id="settings"><svg viewBox="0 0 24 24"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg><span id="settings-text"></span></button>
        <button class="button" id="chat-button"></button>
        <button class="button" id="full"></button>
      </div>
    </div>
  </div>
  <button id="skip" hidden></button>
  <div id="menus"><div id="menu-side" hidden></div><div id="menu" hidden></div></div>
  <div id="context" hidden></div>
  <div id="spinner"><span></span></div>
  <div id="flash"></div>
  <div id="message" hidden><div id="message-text"></div><button id="retry"></button></div>`))

  // ---- Time -----------------------------------------------------------------------------------
  $('time-beside').classList.toggle('on-hover', !!hooks.besideOnHover)
  function clock(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor(total / 60) % 60
    const rest = String(total % 60).padStart(2, '0')
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
  }

  let dragging = null // the moment being dragged to, 0 to 1
  // Quick jumps in a row (a held arrow key, the 10 s buttons, number keys) make one: the first at
  // once, the rest when they stop. Each jump drops what the player was downloading (on Twitch the
  // app still fetches it to the end), so many in a row would only slow it down.
  const GATHER = 300 // ms
  let pending = null // where the gathered jumps lead, or none
  let gatherTimer = null
  const target = () => pending ?? media.time()
  function drawTime() {
    const length = media.duration() || 0
    const shown = dragging !== null ? dragging * length : target()
    const part = length ? shown / length : 0
    $('played').style.width = `${part * 100}%`
    $('track').style.setProperty('--played', `${part * 100}%`)
    $('knob').style.left = `${part * 100}%`
    $('time-now').textContent = `${clock(shown)} / ${clock(length)}`
    const beside = hooks.besideTime?.(shown)
    $('time-beside').textContent = beside ? `· ${beside}` : ''
    $('buffer').style.width = `${length ? (media.bufferedEnd() / length) * 100 : 0}%`
  }

  // gathered: one of quick jumps in a row (above); otherwise at once
  function jumpTo(seconds, gathered) {
    const length = media.duration()
    if (!length) return
    const place = Math.min(Math.max(seconds, 0), length - 0.5)
    const soon = gathered && gatherTimer !== null
    clearTimeout(gatherTimer)
    gatherTimer = gathered ? setTimeout(endGathering, GATHER) : null
    pending = soon ? place : null
    if (!soon) media.seek(place)
    drawTime()
  }
  function endGathering() {
    gatherTimer = null
    if (pending === null) return
    const place = pending
    pending = null
    media.seek(place)
    drawTime()
  }

  // ---- Drawn on the bar -------------------------------------------------------------------------
  // Gaps cut the bar into parts (chapters, game changes); marked parts get a color, dimmer ahead
  // and full once played (muted parts, SponsorBlock's). Seconds; each player gives its own.
  let gaps = []
  let marked = [] // { start, end, color }
  const GAP = 2 // px
  const at = (seconds) => `${(seconds / media.duration()) * 100}%`
  function drawParts() {
    const length = media.duration()
    const cuts = []
    for (const seconds of [...gaps].sort((a, b) => a - b)) {
      if (!length || seconds <= 0 || seconds >= length) continue
      const place = at(seconds)
      cuts.push(`#000 calc(${place} - ${GAP / 2}px)`, `transparent calc(${place} - ${GAP / 2}px)`, `transparent calc(${place} + ${GAP / 2}px)`, `#000 calc(${place} + ${GAP / 2}px)`)
    }
    $('track').style.setProperty('--gaps', cuts.length ? `linear-gradient(to right, ${cuts.join(', ')})` : 'none')
    const colors = []
    for (const part of [...marked].sort((a, b) => a.start - b.start)) {
      if (!length) break
      const [from, to] = [at(part.start), at(Math.min(part.end, length))]
      colors.push(`transparent ${from}`, `${part.color} ${from}`, `${part.color} ${to}`, `transparent ${to}`)
    }
    $('track').style.setProperty('--marked-parts', colors.length ? `linear-gradient(to right, ${colors.join(', ')})` : 'none')
  }
  const setGaps = (list) => { gaps = list; drawParts() }
  const setMarked = (list) => { marked = list; drawParts() }
  video.addEventListener('durationchange', drawParts)

  // ---- Preview pictures in the tip --------------------------------------------------------------
  // One small picture from a sheet of many. picture: { address, width, height, cols, column, row }
  // (the sheet's size and where in it), or null. Shown 220 wide; none in a small player.
  const PICTURE = { width: 220, needsWidth: 260, needsHeight: 220 }
  const sheets = new Map() // address: 'loading', 'ready' or 'failed'
  let wantedPicture = null
  function showPicture(picture) {
    const tipPicture = $('tip-picture')
    const room = box.clientWidth >= PICTURE.needsWidth && box.clientHeight >= PICTURE.needsHeight
    wantedPicture = room ? picture : null
    if (!wantedPicture) return void (tipPicture.hidden = true)
    const { address } = picture
    if (!sheets.has(address)) {
      sheets.set(address, 'loading')
      const image = new Image()
      image.onload = () => {
        sheets.set(address, 'ready')
        if (wantedPicture?.address === address && !$('tip').hidden) showPicture(wantedPicture)
      }
      image.onerror = () => {
        sheets.set(address, 'failed')
        if (wantedPicture?.address === address) tipPicture.hidden = true
      }
      image.src = address
    }
    const state = sheets.get(address)
    tipPicture.hidden = state === 'failed'
    const scale = PICTURE.width / picture.width
    tipPicture.style.width = `${PICTURE.width}px`
    tipPicture.style.height = `${Math.round(picture.height * scale)}px`
    // A dark box until its sheet is here
    if (state !== 'ready') return void (tipPicture.style.backgroundImage = 'none')
    tipPicture.style.backgroundImage = `url("${address}")`
    tipPicture.style.backgroundSize = `${Math.round(picture.cols * picture.width * scale)}px auto`
    tipPicture.style.backgroundPosition = `-${Math.round(picture.column * picture.width * scale)}px -${Math.round(picture.row * picture.height * scale)}px`
  }
  // The tip's dim lines under the time: a name (game, chapter), then a marked part with its color
  function tipLines(name, part) {
    $('tip-game').textContent = name || ''
    $('tip-game').hidden = !name
    $('tip-part').hidden = !part
    if (!part) return
    $('tip-part').querySelector('i').style.background = part.color
    $('tip-part').querySelector('span').textContent = part.text
  }

  function fillTip(seconds) {
    if (hooks.fillTip) return hooks.fillTip(seconds)
    $('tip-time').textContent = clock(seconds)
  }
  const partAt = (event) => {
    const area = $('progress').getBoundingClientRect()
    return Math.min(Math.max((event.clientX - area.left) / area.width, 0), 1)
  }
  $('progress').addEventListener('pointermove', (event) => {
    const part = partAt(event)
    const length = media.duration()
    $('tip').hidden = !length
    if (length) fillTip(part * length)
    // Stays inside the window near both ends
    const width = $('progress').clientWidth
    const half = $('tip').offsetWidth / 2
    $('tip').style.left = `${Math.min(Math.max(part * width, half), width - half)}px`
    if (dragging !== null) {
      dragging = part
      drawTime()
    }
  })
  $('progress').addEventListener('pointerleave', () => { if (dragging === null) $('tip').hidden = true })
  $('progress').addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !media.duration()) return
    $('progress').setPointerCapture(event.pointerId)
    dragging = partAt(event)
    box.classList.add('dragging')
    drawTime()
  })
  const endDrag = (apply) => {
    if (dragging === null) return
    const part = dragging
    dragging = null
    box.classList.remove('dragging')
    if (apply) jumpTo(part * media.duration())
    if (!$('progress').matches(':hover')) $('tip').hidden = true
  }
  $('progress').addEventListener('pointerup', () => endDrag(true))
  $('progress').addEventListener('pointercancel', () => endDrag(false))

  // ---- Controls that fade -----------------------------------------------------------------------
  let quietTimer
  const keepShowing = () => media.paused() || dragging !== null || !$('menu').hidden || !$('context').hidden || $('bottom').matches(':hover') || !!hooks.keepShowing?.()
  function wake() {
    box.classList.remove('quiet')
    clearTimeout(quietTimer)
    quietTimer = setTimeout(() => {
      if (keepShowing()) wake()
      else box.classList.add('quiet')
    }, QUIET_AFTER)
  }
  box.addEventListener('pointermove', wake)
  box.addEventListener('pointerdown', wake)
  document.documentElement.addEventListener('pointerleave', () => {
    if (!keepShowing()) box.classList.add('quiet')
  })

  let flashTimer
  function flash(text, showFor = 500) {
    const shown = $('flash')
    shown.textContent = text
    shown.classList.add('show')
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => shown.classList.remove('show'), showFor)
  }

  // ---- Buttons ----------------------------------------------------------------------------------
  // What the user asked for, as a reload after an error also stops the video
  let userPaused = false
  function togglePlay() {
    userPaused = !media.paused()
    if (userPaused) media.pause()
    else media.play()
  }

  function drawPlay() {
    const paused = media.paused()
    box.classList.toggle('paused', paused)
    setIcon($('play'), paused ? 'play' : 'pause')
    $('play').title = paused ? labels.play : labels.pause
    $('big').title = labels.play
    if (paused) wake()
  }
  for (const kind of ['play', 'pause', 'ended']) video.addEventListener(kind, drawPlay)

  function loading(on) {
    box.classList.toggle('loading', on)
    $('spinner').hidden = !on
  }
  video.addEventListener('waiting', () => loading(true))
  video.addEventListener('seeking', () => loading(true))
  video.addEventListener('playing', () => loading(false))
  video.addEventListener('canplay', () => loading(false))
  video.addEventListener('seeked', () => { if (video.readyState >= 3) loading(false) })
  video.addEventListener('ended', () => loading(false))
  video.addEventListener('timeupdate', drawTime)
  video.addEventListener('durationchange', drawTime)
  video.addEventListener('progress', drawTime)

  $('play').onclick = togglePlay
  $('big').onclick = togglePlay
  $('back').onclick = () => jumpTo(target() - JUMP, true)
  $('forward').onclick = () => jumpTo(target() + JUMP, true)
  $('back').title = labels.back
  $('forward').title = labels.forward

  // A click on the picture: closes the menu if it's open, otherwise play or pause
  env.surface.addEventListener('click', () => {
    if (skipClick) skipClick = false // it only closed the right-click menu
    else if (!$('menu').hidden) closeMenu()
    else if (!hooks.pictureClick?.()) togglePlay()
  })
  env.surface.addEventListener('dblclick', toggleFull)
  box.addEventListener('contextmenu', (event) => event.preventDefault())

  // ---- Right-click on the picture: copy the video's link, or the link at the current second ----
  // Same look as the ⚙️ menu, at the mouse, kept inside the player.
  let skipClick = false
  const closeContext = () => { $('context').hidden = true }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // When the page may not use the clipboard: the old way, a hidden box selected and copied
      const field = document.createElement('textarea')
      field.value = text
      field.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0'
      document.body.append(field)
      field.select()
      document.execCommand('copy')
      field.remove()
    }
    flash(labels.linkCopied, 1200)
  }
  env.surface.addEventListener('contextmenu', (event) => {
    if (!media.link) return
    closeMenu()
    hooks.beforeMenu?.()
    const at = Math.floor(media.time())
    const menu = $('context')
    menu.textContent = ''
    const line = (iconName, text, link, allowed = true) => {
      const button = document.createElement('button')
      button.className = 'menu-item'
      button.disabled = !allowed
      const name = document.createElement('span')
      name.className = 'menu-name'
      name.insertAdjacentHTML('beforeend', html(icon(iconName)))
      name.append(text)
      button.append(name)
      button.onclick = () => { closeContext(); copyText(link) }
      menu.append(button)
    }
    line('copy', labels.copyLink, media.link())
    line('clock', (labels.copyLinkAt || '{time}').replace('{time}', clock(at)), media.link(at), at > 0)
    menu.hidden = false
    // In the player's own pixels: the app's scale is a zoom on it
    const area = box.getBoundingClientRect()
    const scale = area.width / box.offsetWidth || 1
    const x = (event.clientX - area.left) / scale
    const y = (event.clientY - area.top) / scale
    menu.style.left = `${Math.max(8, Math.min(x, box.offsetWidth - menu.offsetWidth - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(y, box.offsetHeight - menu.offsetHeight - 8))}px`
    wake()
  })
  // A press anywhere else closes it (on the picture, without also playing or pausing)
  addEventListener('pointerdown', (event) => {
    skipClick = false
    if ($('context').hidden || event.composedPath().includes($('context'))) return
    closeContext()
    skipClick = event.button === 0
  }, true)
  addEventListener('blur', closeContext)
  addEventListener('resize', closeContext)
  // The keyboard always stays with the page: Space on a clicked button would press it again
  const focused = () => env.root.activeElement
  const typing = () => !!focused()?.matches('input[type=text]')
  box.addEventListener('click', () => {
    if (focused() && focused() !== document.body && !typing()) focused().blur()
  })

  function drawVolume() {
    const silent = media.muted() || media.volume() === 0
    setIcon($('mute'), silent ? 'volumeOff' : media.volume() <= 0.5 ? 'volumeLow' : 'volumeHigh')
    $('mute').title = silent ? labels.unmute : labels.mute
    $('level').value = silent ? 0 : media.volume()
    $('level').title = labels.volume
    $('level-text').textContent = `${Math.round((silent ? 0 : media.volume()) * 100)}%`
  }
  video.addEventListener('volumechange', drawVolume)
  $('mute').onclick = () => {
    if (media.volume() === 0) {
      media.setVolume(0.5)
      media.setMuted(false)
    } else media.setMuted(!media.muted())
  }
  $('level').addEventListener('input', () => {
    media.setVolume(Number($('level').value))
    media.setMuted(false)
  })

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen().catch(() => {})
  }
  function drawFull() {
    const full = !!document.fullscreenElement
    setIcon($('full'), full ? 'minimize' : 'maximize')
    $('full').title = full ? labels.exitFullscreen : labels.fullscreen
  }
  document.addEventListener('fullscreenchange', drawFull)
  $('full').onclick = toggleFull

  // ---- Subtitles (YouTube) ----------------------------------------------------------------------
  // Grayed when the video has none. On or off is kept per channel by the player itself.
  const subtitles = media.subtitles
  const SIZES = { smallest: 0.5, biggest: 2, step: 0.1 }
  const percent = new Intl.NumberFormat(env.locale || undefined, { style: 'percent' })
  function drawSubtitles() {
    if (!subtitles) return
    const button = $('subtitles')
    const has = subtitles.tracks().length > 0
    const on = has && !!subtitles.track()
    if (button.hidden) setIcon(button, 'subtitles')
    button.hidden = false
    button.classList.toggle('on', on)
    button.classList.toggle('off', !has)
    button.title = !has ? labels.noSubtitles : on ? labels.subtitlesHide : labels.subtitlesShow
  }
  function toggleSubtitles() {
    if (!subtitles?.tracks().length) return
    subtitles.toggle()
  }
  $('subtitles').onclick = toggleSubtitles

  // ---- Quality and speed ------------------------------------------------------------------------
  const speedText = (speed) => `${numbers.format(speed)}×`
  function drawSettings() {
    const levels = media.qualities()
    const speed = media.rate() === 1 ? '' : speedText(media.rate())
    $('settings-text').textContent = [levels.length ? media.qualityText() : '', speed].filter(Boolean).join(' · ')
    $('settings').title = labels.settings
    // Not while typing in it or dragging a slider: drawing it again would take them away
    if (!$('menu').hidden && !focused()?.matches('input')) drawMenu()
  }
  video.addEventListener('ratechange', drawSettings)

  // ---- The ⚙️ menu ------------------------------------------------------------------------------
  // A short list (#menu); a row with more choices opens them in a panel on its left (#menu-side),
  // on hover or click. Once a panel is open, another row takes over after a short wait, so a
  // slanted move towards the panel doesn't switch it. When there's no room beside the list, a
  // click shows the panel in its place, with a Back line.
  const SWITCH_WAIT = 50 // ms
  let sideKey = null // the panel open, or none
  let narrow = false // no room beside the list: the panel replaces it
  let panels = {}
  let hoverTimer
  const speedName = (speed) => (speed === 1 ? labels.normal : speedText(speed))
  const tick = (button) => button.insertAdjacentHTML('beforeend', html(icon('check')))

  // What fills the list or a panel: titles, rows, a sliding switch
  function builder(target) {
    const title = (text) => {
      const line = document.createElement('div')
      line.className = 'menu-title'
      line.textContent = text
      target.append(line)
    }
    const item = (text, on, action) => {
      const button = document.createElement('button')
      button.className = `menu-item${on ? ' on' : ''}`
      button.textContent = text
      if (on) tick(button)
      button.onclick = action
      target.append(button)
      return button
    }
    // A choice that stays (redraws the menu), and one that's done (closes it)
    const row = (text, on, action) => item(text, on, () => { action(); drawMenu() })
    const pick = (text, on, action) => item(text, on, () => { action(); closeMenu(); drawSettings() })
    // The app's sliding switch: equal buttons, the blue fill and a faint one under the mouse slide
    // between them. choose(value) mustn't redraw the menu, or nothing slides.
    const choices = (items, current, choose) => {
      const line = document.createElement('div')
      line.className = 'menu-switch'
      line.style.setProperty('--count', items.length)
      const fill = document.createElement('i')
      const ghost = document.createElement('i')
      ghost.className = 'ghost'
      line.append(ghost, fill)
      const moveTo = (part, index) => {
        part.hidden = index < 0
        if (index >= 0) part.style.transform = `translateX(${index * 100}%)`
      }
      const buttons = items.map((choice, index) => {
        const button = document.createElement('button')
        button.textContent = choice.text
        button.onpointerenter = () => moveTo(ghost, index)
        button.onclick = () => {
          buttons.forEach((other) => other.classList.toggle('on', other === button))
          moveTo(fill, index)
          choose(choice.value)
        }
        return button
      })
      line.onpointerleave = () => moveTo(ghost, -1)
      const chosen = items.findIndex((choice) => choice.value === current)
      buttons[chosen]?.classList.add('on')
      // Placed at once, then sliding from there
      fill.style.transition = ghost.style.transition = 'none'
      moveTo(fill, chosen)
      moveTo(ghost, -1)
      requestAnimationFrame(() => { fill.style.transition = ghost.style.transition = '' })
      line.append(...buttons)
      target.append(line)
    }
    return { title, row, pick, choices, element: target }
  }

  // A row of the list that opens a panel: its icon and name, then what's chosen there, dim
  function panelRow(menu, key, text, value, fill, iconName) {
    panels[key] = fill
    const button = document.createElement('button')
    button.className = 'menu-item menu-panel'
    button.dataset.panel = key
    const name = document.createElement('span')
    name.className = 'menu-name'
    name.insertAdjacentHTML('beforeend', html(icon(iconName)))
    name.append(text)
    const shown = document.createElement('span')
    shown.className = 'menu-value'
    const valueText = document.createElement('span')
    valueText.textContent = value || ''
    shown.append(valueText)
    shown.insertAdjacentHTML('beforeend', html(icon('chevronLeft')))
    button.append(name, shown)
    button.onpointerenter = () => {
      clearTimeout(hoverTimer)
      // Cut with dots (a long subtitle track): its full text on hover
      valueText.title = valueText.scrollWidth > valueText.clientWidth ? valueText.textContent : ''
      if (narrow) return
      if (!sideKey) openSide(key, true)
      else hoverTimer = setTimeout(() => openSide(key, true), SWITCH_WAIT)
    }
    button.onpointerleave = () => clearTimeout(hoverTimer)
    button.onclick = () => {
      clearTimeout(hoverTimer)
      openSide(key, false)
    }
    menu.append(button)
  }

  function drawMenu() {
    const menu = $('menu')
    menu.textContent = ''
    panels = {}
    const main = builder(menu)
    const panel = (key, text, value, fill, iconName) => panelRow(menu, key, text, value, fill, iconName)
    const levels = media.qualities()
    if (levels.length) {
      panel('quality', labels.quality, media.qualityText(), (side) => {
        const ticked = media.quality()
        for (const item of levels) side.pick(item.text, item.value === ticked, () => media.setQuality(item.value))
      }, 'quality')
    }
    panel('speed', labels.speed, speedName(media.rate()), (side) => {
      for (const speed of SPEEDS) side.pick(speedName(speed), speed === media.rate(), () => media.setRate(speed))
    }, 'speed')
    const tracks = subtitles?.tracks() || []
    if (tracks.length) {
      const current = subtitles.track()
      const on = tracks.find((item) => item.value === current)
      panel('subtitles', labels.subtitles, on ? on.text : labels.subtitlesOff, (side) => drawSubtitlesMenu(side, tracks), 'subtitles')
    }
    hooks.menu?.({ ...main, panel })
    const info = document.createElement('div')
    info.id = 'menu-info'
    menu.append(info)
    drawInfo()
    drawSide()
  }

  function drawSide() {
    const side = $('menu-side')
    const fill = sideKey && panels[sideKey]
    $('menus').classList.toggle('narrow', !!fill && narrow)
    for (const row of $('menu').querySelectorAll('.menu-panel')) row.classList.toggle('open', !!fill && row.dataset.panel === sideKey)
    if (!fill) {
      side.hidden = true
      return
    }
    side.textContent = ''
    side.hidden = false
    if (narrow) {
      const back = document.createElement('button')
      back.className = 'menu-item menu-back'
      back.innerHTML = html(icon('chevronLeft'))
      back.append(labels.menuBack)
      back.onclick = () => {
        sideKey = null
        drawSide()
      }
      side.append(back)
    }
    fill(builder(side))
  }

  // Room beside the list for the panel, inside the player
  const sideFits = () => $('menu-side').getBoundingClientRect().left >= box.getBoundingClientRect().left + 8

  function openSide(key, byHover) {
    if (key === sideKey || (narrow && byHover)) return
    const before = sideKey
    sideKey = key
    drawSide()
    if (!narrow && !sideFits()) {
      // A hover never takes the list away from under the mouse: that needs a click
      if (byHover) {
        sideKey = before
        if (!before) narrow = true
        drawSide()
        return
      }
      narrow = true
      drawSide()
    }
    if (!before && !narrow) {
      const side = $('menu-side')
      side.classList.remove('unfold')
      void side.offsetWidth
      side.classList.add('unfold')
    }
  }

  // The video's tracks (a pick counts for this video only), then size and place, for every video
  function drawSubtitlesMenu(side, tracks) {
    const current = subtitles.track()
    for (const item of [{ value: '', text: labels.subtitlesOff }, ...tracks]) {
      side.pick(item.text, item.value === current, () => subtitles.setTrack(item.value))
    }
    const menu = side.element
    const size = Math.round(subtitles.size() * 10) / 10
    const line = document.createElement('div')
    line.className = 'menu-size'
    const name = document.createElement('span')
    name.textContent = labels.subtitleSize
    const shown = document.createElement('span')
    shown.className = 'menu-size-value'
    shown.textContent = percent.format(size)
    const change = (iconName, text, by, allowed) => {
      const button = document.createElement('button')
      button.innerHTML = html(icon(iconName))
      button.title = text
      button.disabled = !allowed
      button.onclick = () => {
        subtitles.setSize(Math.round((size + by) * 10) / 10)
        drawMenu()
      }
      return button
    }
    line.append(name, change('minus', labels.smaller, -SIZES.step, size > SIZES.smallest), shown, change('plus', labels.bigger, SIZES.step, size < SIZES.biggest))
    menu.append(line)
    const reset = document.createElement('button')
    reset.className = 'menu-item'
    reset.textContent = labels.resetPosition
    reset.disabled = !subtitles.moved()
    reset.onclick = () => {
      subtitles.resetPlace()
      drawMenu()
    }
    const hint = document.createElement('div')
    hint.className = 'menu-note'
    hint.textContent = labels.dragSubtitles
    menu.append(reset, hint)
  }
  function openMenu() {
    closeContext()
    hooks.beforeMenu?.()
    sideKey = null
    narrow = false
    $('menu').hidden = false
    $('settings').classList.add('open')
    drawMenu()
    wake()
  }
  function closeMenu() {
    clearTimeout(hoverTimer)
    sideKey = null
    narrow = false
    $('menu').hidden = true
    drawSide()
    $('settings').classList.remove('open')
  }
  $('settings').onclick = () => ($('menu').hidden ? openMenu() : closeMenu())

  // ---- Keyboard ---------------------------------------------------------------------------------
  function changeVolume(by) {
    media.setMuted(false)
    const level = Math.round(Math.min(Math.max(media.volume() + by, 0), 1) * 20) / 20
    media.setVolume(level)
    flash(`${Math.round(level * 100)}%`)
  }
  const jumpBack = () => { jumpTo(target() - JUMP, true); flash(`−${JUMP} s`) }
  const jumpForward = () => { jumpTo(target() + JUMP, true); flash(`+${JUMP} s`) }
  const KEYS = {
    ' ': togglePlay,
    k: togglePlay,
    ArrowLeft: jumpBack,
    j: jumpBack,
    ArrowRight: jumpForward,
    l: jumpForward,
    ArrowUp: () => changeVolume(0.05),
    ArrowDown: () => changeVolume(-0.05),
    m: () => $('mute').click(),
    f: toggleFull,
    ...(subtitles ? { c: toggleSubtitles } : {}),
    ...hooks.keys,
  }
  const NO_REPEAT = [' ', 'k', 'm', 'f', 'c', ...Object.keys(hooks.keys || {})]
  addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (typing()) {
      if (event.key === 'Escape') focused().blur()
      if (env.stopKeys) event.stopImmediatePropagation()
      return
    }
    // Not held back: the browser leaves full screen on it by itself
    if (event.key === 'Escape') { closeContext(); return closeMenu() }
    if (env.stopKeys && event.key !== 'Tab') event.stopImmediatePropagation()
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (/^[0-9]$/.test(key)) {
      jumpTo((media.duration() || 0) * (Number(key) / 10), true)
      return event.preventDefault()
    }
    const action = KEYS[key]
    if (!action) return
    event.preventDefault()
    if (event.repeat && NO_REPEAT.includes(key)) return
    action()
    wake()
  }, true)

  // Everything drawn again, for a player whose video events don't tell about every change
  // ---- What's playing: a dim last line in the ⚙️ menu --------------------------------------------
  // The size from the picture itself; frames and video data per second measured over the last few
  // seconds played (per second of video, so pauses and speed don't change them); the codec and
  // the source from the player (media.info).
  const CODECS = { avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC', hev1: 'HEVC', vp09: 'VP9', vp9: 'VP9', vp8: 'VP8', av01: 'AV1' }
  const codecName = (codec) => (codec ? CODECS[codec.split('.')[0]] || codec.split('.')[0] : '')
  let samples = []
  setInterval(() => {
    const at = video.currentTime
    const last = samples[samples.length - 1]
    if (last && at <= last.at) return // paused: nothing new
    samples.push({ at, frames: video.getVideoPlaybackQuality?.().totalVideoFrames, bytes: video.webkitVideoDecodedByteCount })
    if (samples.length > 6) samples.shift()
    if (!$('menu').hidden) drawInfo()
  }, 1000)
  video.addEventListener('seeking', () => { samples = [] })
  video.addEventListener('resize', () => { if (!$('menu').hidden) drawInfo() })

  function infoText() {
    const parts = []
    if (video.videoHeight) parts.push(`${video.videoWidth}×${video.videoHeight}`)
    const first = samples[0]
    const last = samples[samples.length - 1]
    const span = last ? last.at - first.at : 0
    if (span >= 1 && last.frames > first.frames) parts.push((labels.fps || '{n} fps').replace('{n}', Math.round((last.frames - first.frames) / span)))
    const info = media.info?.() || {}
    const codec = codecName(info.codec)
    if (codec) parts.push(codec)
    if (span >= 1 && last.bytes > first.bytes) parts.push(`${numbers.format(Math.round(((last.bytes - first.bytes) * 8) / span / 1e5) / 10)} Mb/s`)
    return [...parts, ...(info.extra || [])].join(' · ')
  }
  function drawInfo() {
    const line = $('menu-info')
    if (line) line.textContent = infoText()
  }

  function refresh() {
    drawPlay()
    drawVolume()
    drawTime()
    drawSubtitles()
    drawSettings()
  }
  refresh()
  drawFull()
  wake()

  return { refresh, $, icon, clock, numbers, wake, flash, loading, drawTime, drawSettings, drawMenu, closeMenu, jumpTo, typing, setGaps, setMarked, showPicture, tipLines, userPaused: () => userPaused, dragging: () => dragging !== null }
}

// The controls' looks, the same in both players. Text in the app's font ('SyncR UI', which each
// page declares: a shadow root can't).
const CONTROLS_CSS = `
  :where(#player) { position: relative; overflow: hidden; outline: none; color: #fff; font: 13px 'SyncR UI', sans-serif; user-select: none; cursor: default; }
  :where(#player) [hidden] { display: none !important; }
  :where(#player) svg { display: block; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  :where(#player) button { padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
  /* Grayed ones can't be used: the plain arrow (hidden controls: none, as they let the mouse through) */
  :where(#player) button:disabled, :where(#player) button.off { cursor: default; }
  #player.quiet { cursor: none; }

  /* Always on a layer of its own: otherwise each fade over a playing video changes how the text
     beside it (the chat) is drawn, and the names seem to glow for a moment */
  #ui { position: absolute; inset: 0; opacity: 1; pointer-events: none; transition: opacity 0.2s ease; will-change: opacity; }
  #player.quiet #ui { opacity: 0; }
  #player.quiet #ui * { pointer-events: none !important; }
  #shade { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0, 0, 0, 0.78), transparent 130px); }

  #big {
    position: absolute; top: 50%; left: 50%; width: 68px; height: 68px; margin: -34px 0 0 -34px;
    display: none; align-items: center; justify-content: center;
    border-radius: 50%; background: rgba(0, 0, 0, 0.55); pointer-events: auto;
    transition: background 0.15s;
  }
  #big svg { width: 30px; height: 30px; fill: currentColor; }
  #big:hover { background: var(--accent, #2d4f7c); }
  #player.paused:not(.loading) #big { display: flex; }

  /* Above the chat in full screen, for the tip's picture */
  #bottom { position: absolute; z-index: 5; left: 0; right: 0; bottom: 0; padding: 0 12px 6px; pointer-events: auto; }
  #progress { position: relative; height: 20px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
  #track { position: relative; width: 100%; height: 4px; border-radius: 2px; overflow: hidden; background: rgba(255, 255, 255, 0.25); transition: height 0.15s; mask-image: var(--gaps, none); }
  #progress:hover #track, #player.dragging #track { height: 6px; }
  #buffer, #played { position: absolute; top: 0; bottom: 0; left: 0; width: 0; }
  #buffer { background: rgba(255, 255, 255, 0.35); }
  #played { background: var(--text-blue, #6ea8fe); }
  /* Marked parts: dimmer ahead, full color once played, so the position still shows inside one */
  #marked, #marked-played { position: absolute; inset: 0; background: var(--marked-parts, none); }
  #marked { opacity: 0.6; }
  #marked-played { clip-path: inset(0 calc(100% - var(--played, 0%)) 0 0); }
  #knob {
    position: absolute; top: 50%; left: 0; width: 14px; height: 14px; margin: -7px 0 0 -7px;
    border-radius: 50%; background: #fff; opacity: 0; pointer-events: none; transition: opacity 0.15s;
  }
  #progress:hover #knob, #player.dragging #knob { opacity: 1; }
  #tip {
    position: absolute; bottom: 22px; transform: translateX(-50%); padding: 3px 8px; border-radius: 6px;
    background: rgba(0, 0, 0, 0.85); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none;
    text-align: center;
  }
  #tip-picture { margin: 2px -5px 4px; border-radius: 4px; background-color: rgba(255, 255, 255, 0.08); background-repeat: no-repeat; }
  #tip-game { max-width: 220px; overflow: hidden; text-overflow: ellipsis; color: var(--text-dim, #9a9a9a); }
  #tip-part { display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--text-dim, #9a9a9a); }
  #tip-part i { width: 8px; height: 8px; flex: none; border-radius: 2px; }
  #skip { position: absolute; left: 50%; bottom: 72px; transform: translateX(-50%); height: 32px; padding: 0 14px; border-radius: 6px; background: var(--accent, #2d4f7c); color: #fff; white-space: nowrap; }

  #bar { display: flex; align-items: center; gap: 6px; height: 46px; }
  .button {
    position: relative; width: 40px; height: 40px; flex: none;
    display: flex; align-items: center; justify-content: center;
    border-radius: 6px; transition: background 0.15s;
  }
  .button:hover, .button.open { background: rgba(255, 255, 255, 0.14); }
  .button svg { width: 20px; height: 20px; }
  .button.on { color: var(--text-blue, #6ea8fe); }
  .button.off { opacity: 0.4; background: none; }
  #play svg { width: 22px; height: 22px; fill: currentColor; }
  /* The number inside the round arrows */
  .button b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 400; }
  #volume { display: flex; align-items: center; }
  #level {
    width: 0; margin: 0; opacity: 0; accent-color: #fff; cursor: pointer;
    transition: width 0.2s, opacity 0.2s, margin 0.2s;
  }
  #volume:hover #level { width: 84px; margin-right: 6px; opacity: 1; }
  #level-text { width: 0; overflow: hidden; opacity: 0; font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; transition: width 0.2s, opacity 0.2s, margin 0.2s; }
  #volume:hover #level-text { width: 32px; margin-right: 6px; opacity: 1; }
  #time { flex: 0 1 auto; width: auto; min-width: 0; gap: 4px; padding: 0 6px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  #time-now { flex: none; }
  #time-beside { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  #time-beside:empty { display: none; }
  /* Slides out to the right while the time is hovered (or its Go to box is open), like the volume */
  #time-beside.on-hover { max-width: 0; margin-left: -4px; opacity: 0; transition: max-width 0.2s, margin 0.2s, opacity 0.2s; }
  #time:hover #time-beside.on-hover, #time.open #time-beside.on-hover, #time:focus-visible #time-beside.on-hover { max-width: 120px; margin-left: 0; opacity: 1; }
  #spacer { flex: 1; min-width: 0; }
  #settings { flex: 0 1 auto; width: auto; min-width: 40px; gap: 6px; padding: 0 8px; box-sizing: border-box; }
  #settings span { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  #settings span:empty { display: none; }
  /* A small window at a large app scale: the least needed go first */
  #bottom { container-type: inline-size; }
  @container (max-width: 490px) { #settings span { display: none; } }
  @container (max-width: 410px) { #back, #forward { display: none; } }
  @container (max-width: 330px) { #time { display: none; } }
  @container (max-width: 540px) { #time-beside { display: none; } }

  /* The list on the right, a row's panel on its left, bottoms in line */
  #menus { position: absolute; top: 18px; right: 12px; bottom: 70px; z-index: 5; display: flex; align-items: flex-end; gap: 6px; pointer-events: none; }
  #menu, #menu-side {
    flex-shrink: 0; max-height: 100%; overflow: auto; box-sizing: border-box; pointer-events: auto;
    scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
    padding: 6px; border-radius: 8px;
    background: var(--bg, #161616); border: 1px solid rgba(255, 255, 255, 0.14);
    color: var(--text, #e4e4e4);
  }
  #menu { min-width: 220px; }
  #context {
    position: absolute; z-index: 6; min-width: 200px; padding: 6px; box-sizing: border-box; border-radius: 8px; pointer-events: auto;
    background: var(--bg, #161616); border: 1px solid rgba(255, 255, 255, 0.14); color: var(--text, #e4e4e4);
  }
  #context .menu-item { justify-content: flex-start; white-space: nowrap; }
  #menu-side { min-width: 250px; max-width: 340px; }
  #menus.narrow #menu { display: none; }
  #menu-side.unfold { animation: unfold 0.16s cubic-bezier(0.32, 0.72, 0, 1); /* the app's menus: 0.16 s, --ease-open */ }
  @keyframes unfold { from { clip-path: inset(0 0 0 100%); } to { clip-path: inset(0); } }
  .no-animations #menu-side { animation: none; }
  .menu-panel.open { background: var(--hover, #262626); }
  .menu-value { display: flex; align-items: center; gap: 4px; min-width: 0; color: var(--text-dim, #9a9a9a); }
  .menu-value span { min-width: 0; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-value svg { flex-shrink: 0; }
  .menu-name { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .menu-name svg { flex-shrink: 0; color: var(--text-dim, #9a9a9a); }
  .menu-item.menu-back { justify-content: flex-start; gap: 6px; padding-left: 8px; }
  .menu-title { padding: 8px 12px 4px; font-size: 12px; color: var(--text-dim, #9a9a9a); }
  /* What's playing: wraps within the menu's width instead of widening it */
  #menu-info { width: 0; min-width: calc(100% - 24px); padding: 6px 12px 4px; color: var(--text-dim, #9a9a9a); font-size: 11px; line-height: 15px; font-variant-numeric: tabular-nums; user-select: text; }
  #menu-info:empty { display: none; }
  .menu-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 32px; padding: 0 12px; box-sizing: border-box; border-radius: 6px; text-align: left; }
  .menu-item:hover { background: var(--hover, #262626); }
  .menu-item:disabled { opacity: 0.4; background: none; }
  .menu-size { display: flex; align-items: center; gap: 4px; min-height: 32px; padding: 0 4px 0 12px; }
  .menu-size > span:first-child { flex: 1; }
  .menu-size button { width: 30px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: var(--hover, #262626); }
  .menu-size button:hover { background: rgba(255, 255, 255, 0.14); }
  .menu-size button:disabled { opacity: 0.4; background: var(--hover, #262626); }
  .menu-size svg { width: 16px; height: 16px; }
  .menu-size-value { min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
  .menu-note { padding: 2px 12px 6px; font-size: 12px; color: var(--text-dim, #9a9a9a); }
  #goto-text { display: block; width: calc(100% - 8px); height: 30px; margin: 2px 4px 4px; padding: 0 8px; box-sizing: border-box; border: 0; border-radius: 6px; outline: none; background: var(--hover, #262626); color: inherit; font: inherit; font-size: 12px; user-select: text; }
  #goto { position: absolute; bottom: 70px; width: 250px; box-sizing: border-box; padding: 6px; border-radius: 8px; background: var(--bg, #161616); border: 1px solid rgba(255, 255, 255, 0.14); color: var(--text, #e4e4e4); }
  #goto-note { padding: 2px 12px 6px; font-size: 12px; color: var(--text-dim, #9a9a9a); }
  #goto-note.wrong { color: var(--text-orange, #f0a052); }
  .menu-item.on { color: var(--text-blue, #6ea8fe); }
  .menu-item svg { width: 16px; height: 16px; }
  /* The app's sliding switch (FillSwitch): sunken track, thin frame, the fill 2 px inside */
  .menu-switch { position: relative; display: grid; grid-template-columns: repeat(var(--count), 1fr); margin: 2px 4px 4px; padding: 2px; border: 1px solid var(--border, #2a2a2a); border-radius: 8px; background: var(--bg-sunken, #101010); }
  .menu-switch button { position: relative; height: 26px; border-radius: 6px; color: var(--text-dim, #9a9a9a); font-variant-numeric: tabular-nums; }
  .menu-switch button:hover, .menu-switch button.on { color: var(--text, #e4e4e4); }
  .menu-switch i { position: absolute; top: 2px; bottom: 2px; left: 2px; width: calc((100% - 4px) / var(--count)); border-radius: 6px; background: var(--accent, #2d4f7c); transition: transform 0.24s cubic-bezier(0.32, 0.72, 0, 1); pointer-events: none; } /* like FillSwitch */
  .menu-switch i.ghost { background: color-mix(in srgb, var(--accent, #2d4f7c) 30%, transparent); }

  #spinner { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
  #spinner span { width: 44px; height: 44px; box-sizing: border-box; border: 4px solid rgba(255, 255, 255, 0.25); border-top-color: #fff; border-radius: 50%; animation: turn 0.8s linear infinite; }
  @keyframes turn { to { transform: rotate(360deg); } }
  #flash {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 10px 18px; border-radius: 999px;
    background: rgba(0, 0, 0, 0.6); font-size: 18px; font-variant-numeric: tabular-nums; white-space: nowrap;
    opacity: 0; pointer-events: none; transition: opacity 0.3s;
  }
  #flash.show { opacity: 1; transition: none; }
  #message {
    position: absolute; inset: 0; display: flex; flex-direction: column; gap: 14px; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.6); text-align: center;
  }
  #message button { height: 32px; padding: 0 14px; border-radius: 6px; background: var(--accent, #2d4f7c); color: #fff; }

  .no-animations * { transition: none !important; }
`
