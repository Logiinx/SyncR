// The controls shared by our own players: the Twitch player's page (player.js) and YouTube's
// player-only page, where video-watch.js puts them in a shadow root over YouTube's own player.
// They never touch a video directly: each player gives a "media" object (what's below), so the
// same buttons, bar, menu, keys and fading work on both.
//
// env: {
//   root: document or a shadow root ($ looks there), box: the element they go in (#player),
//   surface: what a click on the picture lands on, html: (text) => what innerHTML takes,
//   labels, locale, stopKeys: true to keep every plain key from the page under it,
//   hooks: { fillTip, dayAt, menu(row, title, menu), keys: { key: action }, keepShowing,
//            beforeMenu, pictureClick: () => true when it did something }
// }
// media: {
//   element: the <video> (its events), paused(), time(), duration(), bufferedEnd(),
//   play(), pause(), seek(seconds), volume() 0-1, muted(), setVolume(0-1), setMuted(on),
//   rate(), setRate(speed), qualities(): [{ value, text }], quality(): the value ticked,
//   qualityText(): shown on the ⚙️ button, setQuality(value)
// }
function playerControls(env, media) {
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
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
        <div id="track"><div id="buffer"></div><div id="played"></div><div id="muted"></div><div id="muted-played"></div></div>
        <div id="ticks"></div>
        <div id="knob"></div>
        <div id="tip" hidden><div id="tip-picture" hidden></div><div id="tip-time"></div><div id="tip-game" hidden></div></div>
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
        <button class="button" id="time"><span id="time-now"></span><span id="time-day"></span></button>
        <div id="spacer"></div>
        <button class="button" id="settings"><svg viewBox="0 0 24 24"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg><span id="settings-text"></span></button>
        <button class="button" id="chat-button"></button>
        <button class="button" id="full"></button>
      </div>
    </div>
  </div>
  <button id="skip" hidden></button>
  <div id="menu" hidden></div>
  <div id="spinner"><span></span></div>
  <div id="flash"></div>
  <div id="message" hidden><div id="message-text"></div><button id="retry"></button></div>`))

  // ---- Time -----------------------------------------------------------------------------------
  function clock(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor(total / 60) % 60
    const rest = String(total % 60).padStart(2, '0')
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
  }

  let dragging = null // the moment being dragged to, 0 to 1
  function drawTime() {
    const length = media.duration() || 0
    const shown = dragging !== null ? dragging * length : media.time()
    const part = length ? shown / length : 0
    $('played').style.width = `${part * 100}%`
    $('track').style.setProperty('--played', `${part * 100}%`)
    $('knob').style.left = `${part * 100}%`
    $('time-now').textContent = `${clock(shown)} / ${clock(length)}`
    const day = hooks.dayAt?.(shown)
    $('time-day').textContent = day ? `· ${day}` : ''
    $('buffer').style.width = `${length ? (media.bufferedEnd() / length) * 100 : 0}%`
  }

  function jumpTo(seconds) {
    const length = media.duration()
    if (!length) return
    media.seek(Math.min(Math.max(seconds, 0), length - 0.5))
    drawTime()
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
  const keepShowing = () => media.paused() || dragging !== null || !$('menu').hidden || $('bottom').matches(':hover') || !!hooks.keepShowing?.()
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
  function flash(text) {
    const shown = $('flash')
    shown.textContent = text
    shown.classList.add('show')
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => shown.classList.remove('show'), 500)
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
  $('back').onclick = () => jumpTo(media.time() - JUMP)
  $('forward').onclick = () => jumpTo(media.time() + JUMP)
  $('back').title = labels.back
  $('forward').title = labels.forward

  // A click on the picture: closes the menu if it's open, otherwise play or pause
  env.surface.addEventListener('click', () => {
    if (!$('menu').hidden) closeMenu()
    else if (!hooks.pictureClick?.()) togglePlay()
  })
  env.surface.addEventListener('dblclick', toggleFull)
  box.addEventListener('contextmenu', (event) => event.preventDefault())
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

  // ---- Quality and speed ------------------------------------------------------------------------
  const speedText = (speed) => `${numbers.format(speed)}×`
  function drawSettings() {
    const levels = media.qualities()
    const speed = media.rate() === 1 ? '' : speedText(media.rate())
    $('settings-text').textContent = [levels.length ? media.qualityText() : '', speed].filter(Boolean).join(' · ')
    $('settings').title = labels.settings
    // Not while typing in it: drawing it again would take the text box away
    if (!$('menu').hidden && !typing()) drawMenu()
  }
  video.addEventListener('ratechange', drawSettings)

  function drawMenu() {
    const menu = $('menu')
    menu.textContent = ''
    const title = (text) => {
      const line = document.createElement('div')
      line.className = 'menu-title'
      line.textContent = text
      menu.append(line)
    }
    const tick = (button) => button.insertAdjacentHTML('beforeend', html(icon('check')))
    const levels = media.qualities()
    if (levels.length) {
      title(labels.quality)
      const ticked = media.quality()
      for (const item of levels) {
        const on = item.value === ticked
        const row = document.createElement('button')
        row.className = `menu-item${on ? ' on' : ''}`
        row.textContent = item.text
        if (on) tick(row)
        row.onclick = () => {
          media.setQuality(item.value)
          closeMenu()
          drawSettings()
        }
        menu.append(row)
      }
    }
    title(labels.speed)
    const speeds = document.createElement('div')
    speeds.className = 'menu-choices'
    for (const speed of SPEEDS) {
      const button = document.createElement('button')
      button.textContent = speedText(speed)
      if (speed === media.rate()) button.className = 'on'
      button.onclick = () => media.setRate(speed)
      speeds.append(button)
    }
    menu.append(speeds)
    const row = (text, on, action) => {
      const button = document.createElement('button')
      button.className = `menu-item${on ? ' on' : ''}`
      button.textContent = text
      if (on) tick(button)
      button.onclick = () => {
        action()
        drawMenu()
      }
      menu.append(button)
    }
    hooks.menu?.(row, title, menu)
  }
  function openMenu() {
    hooks.beforeMenu?.()
    $('menu').hidden = false
    $('settings').classList.add('open')
    drawMenu()
    wake()
  }
  function closeMenu() {
    $('menu').hidden = true
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
  const jumpBack = () => { jumpTo(media.time() - JUMP); flash(`−${JUMP} s`) }
  const jumpForward = () => { jumpTo(media.time() + JUMP); flash(`+${JUMP} s`) }
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
    ...hooks.keys,
  }
  const NO_REPEAT = [' ', 'k', 'm', 'f', ...Object.keys(hooks.keys || {})]
  addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (typing()) {
      if (event.key === 'Escape') focused().blur()
      if (env.stopKeys) event.stopImmediatePropagation()
      return
    }
    // Not held back: the browser leaves full screen on it by itself
    if (event.key === 'Escape') return closeMenu()
    if (env.stopKeys && event.key !== 'Tab') event.stopImmediatePropagation()
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (/^[0-9]$/.test(key)) {
      jumpTo((media.duration() || 0) * (Number(key) / 10))
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
  function refresh() {
    drawPlay()
    drawVolume()
    drawTime()
    drawSettings()
  }
  refresh()
  drawFull()
  wake()

  return { refresh, $, icon, clock, numbers, wake, flash, loading, drawTime, drawSettings, drawMenu, closeMenu, jumpTo, typing, userPaused: () => userPaused, dragging: () => dragging !== null }
}

// The controls' looks, the same in both players. Text in the app's font ('SyncR UI', which each
// page declares: a shadow root can't).
const CONTROLS_CSS = `
  :where(#player) { position: relative; overflow: hidden; outline: none; color: #fff; font: 13px 'SyncR UI', sans-serif; user-select: none; cursor: default; }
  :where(#player) [hidden] { display: none !important; }
  :where(#player) svg { display: block; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  :where(#player) button { padding: 0; border: 0; background: none; color: inherit; font: inherit; }
  #player.quiet { cursor: none; }

  #ui { position: absolute; inset: 0; opacity: 1; pointer-events: none; transition: opacity 0.2s ease; }
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
  #track { position: relative; width: 100%; height: 4px; border-radius: 2px; overflow: hidden; background: rgba(255, 255, 255, 0.25); transition: height 0.15s; }
  #progress:hover #track, #player.dragging #track { height: 6px; }
  #buffer, #played { position: absolute; top: 0; bottom: 0; left: 0; width: 0; }
  #buffer { background: rgba(255, 255, 255, 0.35); }
  #played { background: var(--text-blue, #6ea8fe); }
  /* Muted parts: dimmer ahead, full color once played, so the position still shows inside one */
  #muted, #muted-played { position: absolute; inset: 0; background: var(--muted-parts, none); }
  #muted { opacity: 0.6; }
  #muted-played { clip-path: inset(0 calc(100% - var(--played, 0%)) 0 0); }
  #ticks { position: absolute; inset: 0; pointer-events: none; }
  #ticks i { position: absolute; top: 5px; width: 2px; height: 10px; margin-left: -1px; border-radius: 1px; background: #fff; }
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
  #skip { position: absolute; left: 50%; bottom: 72px; transform: translateX(-50%); height: 32px; padding: 0 14px; border-radius: 6px; background: var(--accent, #2d4f7c); color: #fff; white-space: nowrap; }

  #bar { display: flex; align-items: center; gap: 2px; height: 46px; }
  .button {
    position: relative; width: 40px; height: 40px; flex: none;
    display: flex; align-items: center; justify-content: center;
    border-radius: 6px; transition: background 0.15s;
  }
  .button:hover, .button.open { background: rgba(255, 255, 255, 0.14); }
  .button svg { width: 20px; height: 20px; }
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
  #time { width: auto; gap: 4px; padding: 0 6px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  #time-day:empty { display: none; }
  #spacer { flex: 1; min-width: 0; }
  #settings { flex: 0 1 auto; width: auto; min-width: 40px; gap: 6px; padding: 0 8px; box-sizing: border-box; }
  #settings span { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  #settings span:empty { display: none; }
  /* A small window at a large app scale: the least needed go first */
  #bottom { container-type: inline-size; }
  @container (max-width: 490px) { #settings span { display: none; } }
  @container (max-width: 410px) { #back, #forward { display: none; } }
  @container (max-width: 330px) { #time { display: none; } }
  @container (max-width: 540px) { #time-day { display: none; } }

  #menu {
    position: absolute; right: 12px; bottom: 62px; z-index: 5;
    min-width: 250px; max-height: calc(100% - 80px); overflow: auto; box-sizing: border-box;
    padding: 6px; border-radius: 8px;
    background: var(--bg, #161616); border: 1px solid rgba(255, 255, 255, 0.14);
    color: var(--text, #e4e4e4);
  }
  .menu-title { padding: 8px 12px 4px; font-size: 12px; color: var(--text-dim, #9a9a9a); }
  .menu-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 32px; padding: 0 12px; box-sizing: border-box; border-radius: 6px; text-align: left; }
  .menu-item:hover { background: var(--hover, #262626); }
  #goto-text { display: block; width: calc(100% - 8px); height: 30px; margin: 2px 4px 4px; padding: 0 8px; box-sizing: border-box; border: 0; border-radius: 6px; outline: none; background: var(--hover, #262626); color: inherit; font: inherit; font-size: 12px; user-select: text; }
  #goto { position: absolute; bottom: 76px; width: 250px; box-sizing: border-box; padding: 6px; border-radius: 8px; background: var(--bg, #161616); border: 1px solid rgba(255, 255, 255, 0.14); color: var(--text, #e4e4e4); }
  #goto-note { padding: 2px 12px 6px; font-size: 12px; color: var(--text-dim, #9a9a9a); }
  #goto-note.wrong { color: var(--text-orange, #f0a052); }
  .menu-item.on { color: var(--text-blue, #6ea8fe); }
  .menu-item svg { width: 16px; height: 16px; }
  .menu-choices { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 0 4px 4px; }
  .menu-choices button { height: 30px; border-radius: 6px; background: var(--hover, #262626); font-variant-numeric: tabular-nums; }
  .menu-choices button:hover { background: rgba(255, 255, 255, 0.14); }
  .menu-choices button.on { background: var(--accent, #2d4f7c); color: #fff; }

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
