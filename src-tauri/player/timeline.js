// What the progress bar shows besides the time (uses player.js's video, labels, stored, jumpTo).
// Muted parts come from the playlist, previews, game changes and the start time from Twitch's
// answer about the video. If one of them can't be had, only that extra is missing: the video isn't affected.
const DETAILS_QUERY = 'query($id: ID!) { video(id: $id) { seekPreviewsURL moments(first: 100, types: [GAME_CHANGE], momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { positionMilliseconds details { ... on GameChangeMomentDetails { game { displayName } } } } } } } }'
const DETAILS_TRIES = 3
const DETAILS_AGAIN = 20000 // ms after a failed answer
const PICTURE_NEEDS = { width: 260, height: 220 } // a smaller player: only the time in the tip
const MUTED_GAP = 1 // seconds: parts closer than this count as one

// ---- Muted parts --------------------------------------------------------------------------------
let mutedParts = []
// lib.rs and the stand-in rename "-unmuted" pieces, so they all end in "-muted" by now
function noteMutedParts(pieces) {
  const parts = []
  for (const piece of pieces) {
    if (!piece.relurl?.includes('-muted.ts')) continue
    const last = parts[parts.length - 1]
    const end = piece.start + piece.duration
    if (last && piece.start - last.end < MUTED_GAP) last.end = end
    else parts.push({ start: piece.start, end })
  }
  mutedParts = parts
  drawMarks()
  drawSkip()
}

const mutedHere = () => mutedParts.find((part) => video.currentTime >= part.start - 0.01 && video.currentTime < part.end - 0.25)
function drawSkip() {
  $('skip').hidden = !mutedHere()
}
video.addEventListener('timeupdate', drawSkip)
video.addEventListener('seeking', drawSkip)
$('skip').textContent = labels.skipMuted
$('skip').onclick = () => {
  const part = mutedHere()
  if (part) jumpTo(part.end)
}

// ---- Game changes -------------------------------------------------------------------------------
let games = [] // { at: seconds, name }, one per change: Twitch can list the same game twice in a row
let showGames = stored('player.gameChanges', 1) === 1
function noteGames(moments) {
  const list = moments
    .map(({ node }) => ({ at: node.positionMilliseconds / 1000, name: node.details?.game?.displayName }))
    .filter((game) => game.name && game.at >= 0)
    .sort((a, b) => a.at - b.at)
  games = list.filter((game, index) => index === 0 || game.name !== list[index - 1].name)
  drawMarks()
}
// A stream with one game has nothing to tell
const gamesShown = () => showGames && games.length > 1
function gameAt(seconds) {
  if (!gamesShown()) return ''
  let name = ''
  for (const game of games) {
    if (game.at > seconds) break
    name = game.name
  }
  return name
}

// ---- Drawn on the bar ---------------------------------------------------------------------------
function drawMarks() {
  const length = video.duration
  const percent = (seconds) => `${(seconds / length) * 100}%`
  let stops = []
  if (length) {
    for (const part of mutedParts) {
      const color = 'var(--text-orange, #f0a052)'
      stops.push(`transparent ${percent(part.start)}`, `${color} ${percent(part.start)}`, `${color} ${percent(part.end)}`, `transparent ${percent(part.end)}`)
    }
  }
  $('track').style.setProperty('--muted-parts', stops.length ? `linear-gradient(to right, ${stops.join(', ')})` : 'none')
  const ticks = $('ticks')
  ticks.textContent = ''
  if (!length || !gamesShown()) return
  for (const game of games) {
    if (game.at <= 0 || game.at >= length) continue
    const tick = document.createElement('i')
    tick.style.left = percent(game.at)
    ticks.append(tick)
  }
}
video.addEventListener('durationchange', drawMarks)

// ---- Preview pictures ---------------------------------------------------------------------------
// Twitch's own list: about 200 small pictures per video, on sheets of a few rows and columns
let previews = null
const sheets = new Map() // address: 'loading', 'ready' or 'failed'
let wantedSheet = null

function loadSheet(address) {
  sheets.set(address, 'loading')
  const image = new Image()
  image.onload = () => {
    sheets.set(address, 'ready')
    if (wantedSheet === address && !$('tip').hidden) showTipPicture()
  }
  image.onerror = () => {
    sheets.set(address, 'failed')
    if (wantedSheet === address) $('tip-picture').hidden = true
  }
  image.src = address
}

let pictureAt = 0
function showTipPicture() {
  const box = $('tip-picture')
  const room = player.clientWidth >= PICTURE_NEEDS.width && player.clientHeight >= PICTURE_NEEDS.height
  if (!previews || !room) {
    box.hidden = true
    wantedSheet = null
    return
  }
  const { interval, count, cols, rows, width, height, images, folder } = previews
  const index = Math.min(Math.floor(pictureAt / interval), count - 1)
  const perSheet = cols * rows
  const name = images[Math.floor(index / perSheet)]
  if (!name) {
    box.hidden = true
    wantedSheet = null
    return
  }
  const address = `${folder}/${encodeURIComponent(name)}`
  wantedSheet = address
  if (!sheets.has(address)) loadSheet(address)
  const state = sheets.get(address)
  box.hidden = state === 'failed'
  // A dark box until its sheet is here
  if (state !== 'ready') {
    box.style.backgroundImage = 'none'
    return
  }
  const spot = index % perSheet
  box.style.backgroundImage = `url("${address}")`
  box.style.backgroundPosition = `-${(spot % cols) * width}px -${Math.floor(spot / cols) * height}px`
}

async function askPreviews(url) {
  const place = new URL(url)
  const folder = `/v/${place.host}${place.pathname.slice(0, place.pathname.lastIndexOf('/'))}`
  const response = await fetch(`/v/${place.host}${place.pathname}`)
  if (!response.ok) throw new Error(`Previews answered ${response.status}`)
  const list = await response.json()
  const best = list.find((one) => one.quality === 'high') || list[0]
  const usable = best && best.interval > 0 && best.count > 0 && best.cols > 0 && best.rows > 0 && best.width > 0 && best.height > 0 && Array.isArray(best.images)
  if (!usable) return
  previews = { ...best, folder }
  const box = $('tip-picture')
  box.style.width = `${best.width}px`
  box.style.height = `${best.height}px`
}

// ---- Go to a time -------------------------------------------------------------------------------
// A place in the video: 23:45 or 1:23:45. Answers in seconds, or null.
function findMoment(text) {
  const match = text.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/)
  if (!match || Number(match[3]) > 59) return null
  if (match[1] !== undefined && Number(match[2]) > 59) return null
  const place = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
  return place < video.duration ? place : null
}

function drawGoToNote(wrong) {
  const note = $('goto-note')
  note.classList.toggle('wrong', wrong)
  note.textContent = wrong ? labels.goToWrong : labels.goToHint
}
function closeGoTo() {
  $('goto').hidden = true
  $('time').classList.remove('open')
  if (document.activeElement === $('goto-text')) $('goto-text').blur()
}
function openGoTo() {
  closeMenu()
  const box = $('goto')
  box.hidden = false
  $('time').classList.add('open')
  $('goto-text').value = ''
  drawGoToNote(false)
  // Above the time, inside the player
  box.style.left = `${Math.max(Math.min($('time').offsetLeft, $('bottom').clientWidth - box.offsetWidth - 12), 12)}px`
  $('goto-text').focus()
  wake()
}
$('time').title = labels.goTo
$('goto-title').textContent = labels.goTo
$('time').onclick = () => {
  if (!video.duration) return
  if ($('goto').hidden) openGoTo()
  else closeGoTo()
}
$('goto-text').addEventListener('input', () => drawGoToNote(false))
$('goto-text').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeGoTo()
  if (event.key !== 'Enter') return
  const moment = findMoment($('goto-text').value.trim().toLowerCase())
  if (moment === null) return drawGoToNote(true)
  closeGoTo()
  jumpTo(moment)
})

// ---- The tip above the bar (player.js places it) --------------------------------------------------
function fillTip(seconds) {
  if (!video.duration) return
  $('tip-time').textContent = clock(seconds)
  pictureAt = seconds
  showTipPicture()
  const game = gameAt(seconds)
  $('tip-game').textContent = game
  $('tip-game').hidden = !game
}

// ---- Its part of the player's menu (player.js, drawMenu) -----------------------------------------
function timelineMenu(row, title) {
  title(labels.barTitle)
  row(labels.gameChanges, showGames, () => {
    showGames = !showGames
    localStorage.setItem('player.gameChanges', showGames ? 1 : 0)
    drawMarks()
  })
}

// ---- Asking Twitch -------------------------------------------------------------------------------
async function askDetails(tries) {
  try {
    const response = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: DETAILS_QUERY, variables: { id: videoId } }),
    })
    if (!response.ok) throw new Error(`Twitch answered ${response.status}`)
    const details = (await response.json()).data?.video
    if (!details) return
    noteGames(details.moments?.edges || [])
    if (details.seekPreviewsURL) await askPreviews(details.seekPreviewsURL)
  } catch (error) {
    console.error(error)
    if (tries > 1) setTimeout(() => askDetails(tries - 1), DETAILS_AGAIN)
  }
}
askDetails(DETAILS_TRIES)
