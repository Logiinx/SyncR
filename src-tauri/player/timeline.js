// What the progress bar shows besides the time (uses player.js's video, labels, stored, jumpTo).
// Muted parts come from the playlist, previews, game changes and the start time from Twitch's
// answer about the video. If one of them can't be had, only that extra is missing: the video isn't affected.
const DETAILS_QUERY = 'query($id: ID!) { video(id: $id) { recordedAt seekPreviewsURL game { displayName boxArtURL(width: 54, height: 72) } moments(first: 100, types: [GAME_CHANGE], momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { positionMilliseconds details { ... on GameChangeMomentDetails { game { displayName boxArtURL(width: 54, height: 72) } } } } } } } }'
const DETAILS_TRIES = 3
const DETAILS_AGAIN = 20000 // ms after a failed answer
const MUTED_GAP = 1 // seconds: parts closer than this count as one

// ---- Muted parts --------------------------------------------------------------------------------
let mutedParts = []
// video_window.rs and the stand-in rename "-unmuted" pieces, so they all end in "-muted" by now
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
let games = [] // { at: seconds, name, picture }, one per change: Twitch can list the same game twice in a row
let showGames = stored('player.gameChanges', 1) === 1
function noteGames(moments, videoGame) {
  const list = moments
    .map(({ node }) => ({ at: node.positionMilliseconds / 1000, name: node.details?.game?.displayName, picture: node.details?.game?.boxArtURL }))
    .filter((game) => game.name && game.at >= 0)
    .sort((a, b) => a.at - b.at)
  games = list.filter((game, index) => index === 0 || game.name !== list[index - 1].name)
  // A stream with one game has no changes: only the video's own game is known
  if (!games.length && videoGame?.displayName) games = [{ at: 0, name: videoGame.displayName, picture: videoGame.boxArtURL }]
  drawMarks()
  drawGamesButton()
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

// ---- Drawn on the bar (controls.js): muted parts in color, game changes as gaps ---------------------
function drawMarks() {
  setMarked(mutedParts.map((part) => ({ ...part, color: 'var(--text-orange, #f0a052)' })))
  setGaps(gamesShown() ? games.map((game) => game.at) : [])
}

// ---- The games button (left end of the bar) and its list: jump to where a game starts ------------
// Like Twitch's own player. Shown once Twitch has named a game, also when there's only one.
const GAMEPAD = '<svg viewBox="0 0 24 24"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>'
const gamesButton = document.createElement('button')
gamesButton.className = 'button'
gamesButton.id = 'games'
gamesButton.title = labels.games
gamesButton.hidden = true
$('bar').prepend(gamesButton)
// Bottoms in line with the ⚙️ menu's
const gamesBox = document.createElement('div')
gamesBox.id = 'games-box'
gamesBox.hidden = true
gamesBox.innerHTML = '<div id="games-list"></div>'
player.append(gamesBox)

let gameShown = -1 // the game the button shows (its index), so it's only drawn again when that changes
const gameIndexAt = (seconds) => {
  let found = 0
  games.forEach((game, index) => { if (game.at <= seconds) found = index })
  return found
}
// The box art, or the gamepad when Twitch has none (or it doesn't load)
function gamePicture(game) {
  const holder = document.createElement('span')
  holder.className = 'game-art'
  if (!game.picture) {
    holder.innerHTML = GAMEPAD
    return holder
  }
  const picture = document.createElement('img')
  picture.src = game.picture
  picture.alt = ''
  picture.onerror = () => { holder.innerHTML = GAMEPAD }
  holder.append(picture)
  return holder
}
// "2 h 05 min", "45 min", "< 1 min" (the same in English and French)
function playedFor(seconds) {
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return '< 1 min'
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`
}

function drawGamesButton() {
  gamesButton.hidden = !games.length
  if (!games.length) return closeGames()
  const index = gameIndexAt(video.currentTime)
  if (index === gameShown) return
  gameShown = index
  gamesButton.textContent = ''
  gamesButton.append(gamePicture(games[index]))
  if (!gamesBox.hidden) drawGamesList()
}

function drawGamesList() {
  const list = $('games-list')
  const scrolled = list.scrollTop
  list.textContent = ''
  const title = document.createElement('div')
  title.className = 'menu-title'
  title.textContent = labels.games
  list.append(title)
  const current = gameIndexAt(video.currentTime)
  games.forEach((game, index) => {
    const line = document.createElement('button')
    line.className = `menu-item game-line${index === current ? ' on' : ''}`
    const name = document.createElement('span')
    name.className = 'game-name'
    name.textContent = name.title = game.name
    const end = games[index + 1]?.at ?? video.duration
    const length = document.createElement('span')
    length.className = 'game-length'
    length.textContent = end > game.at ? playedFor(end - game.at) : ''
    line.append(gamePicture(game), name, length)
    line.onclick = () => {
      closeGames()
      jumpTo(game.at)
    }
    list.append(line)
  })
  list.scrollTop = scrolled
}

const gamesOpen = () => !gamesBox.hidden
function openGames() {
  closeMenu()
  closeGoTo()
  gamesBox.hidden = false
  gamesButton.classList.add('open')
  drawGamesList()
  $('games-list').querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  wake()
}
function closeGames() {
  gamesBox.hidden = true
  gamesButton.classList.remove('open')
}
gamesButton.onclick = () => (gamesOpen() ? closeGames() : openGames())
video.addEventListener('timeupdate', drawGamesButton)
video.addEventListener('seeking', drawGamesButton)
video.addEventListener('durationchange', () => { if (gamesOpen()) drawGamesList() })
addEventListener('keydown', (event) => { if (event.key === 'Escape') closeGames() })

// ---- Preview pictures ---------------------------------------------------------------------------
// Twitch's own list: about 200 small pictures per video, on sheets of a few rows and columns
let previews = null
// The picture at a moment, as controls.js shows it
function pictureAt(seconds) {
  if (!previews) return null
  const { interval, count, cols, rows, width, height, images, folder } = previews
  const index = Math.min(Math.floor(seconds / interval), count - 1)
  const perSheet = cols * rows
  const name = images[Math.floor(index / perSheet)]
  if (!name) return null
  const spot = index % perSheet
  return { address: `${folder}/${encodeURIComponent(name)}`, width, height, cols, column: spot % cols, row: Math.floor(spot / cols) }
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
}

// ---- Time of day -------------------------------------------------------------------------------
// The stream's start plus the position, in the PC's time zone. 24 hours, same as dates.ts.
// Always on: it slides out of the bar's time while hovered (controls.js), and shows in the tip.
let streamStart = null // ms
const dayKnown = () => streamStart !== null
dayAt = (seconds) => (dayKnown() ? new Date(streamStart + seconds * 1000).toLocaleTimeString(data.locale || undefined, { hour: '2-digit', minute: '2-digit' }) : '')

function noteStart(recordedAt) {
  const start = Date.parse(recordedAt)
  streamStart = Number.isNaN(start) ? null : start
  drawTime()
}

// ---- Go to a time -------------------------------------------------------------------------------
// A place in the video: 23:45 or 1:23:45. With the time of day known, 21:30 means the time of day
// first (a place only when that time isn't in the stream). Answers in seconds, or null.
function placeIn(text, needsHours) {
  const match = text.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/)
  if (!match || Number(match[3]) > 59) return null
  if (match[1] === undefined && needsHours) return null
  if (match[1] !== undefined && Number(match[2]) > 59) return null
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

// A time of day: 21:30, 21h30, 21h or 21:30:15. The first time it comes up during the stream, so
// past midnight it's the next day. Answers in seconds from the start, or null.
// On a clock change night, a time can come twice (winter time starts: both are tried) or not at
// all (summer time starts: the moment the clock jumped).
const HOUR = 3600 * 1000
const wallClock = (time) => {
  const date = new Date(time)
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
}
function dayMoment(text) {
  const match = text.match(/^(\d{1,2})(?:[:h](\d{2})?)?(?::(\d{2}))?$/)
  if (!match || (match[2] === undefined && !text.includes('h'))) return null
  const [hour, minute, second] = [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)]
  if (hour > 23 || minute > 59 || second > 59) return null
  const wanted = hour * 3600 + minute * 60 + second
  const start = new Date(streamStart)
  for (let day = 0; ; day++) {
    const guess = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day, hour, minute, second).getTime()
    let moments = [guess - HOUR, guess, guess + HOUR].filter((time) => wallClock(time) === wanted)
    if (!moments.length) {
      let jump = guess
      while (wallClock(jump - 60 * 1000) > wanted) jump -= 60 * 1000
      moments = [jump]
    }
    for (const time of moments) {
      const at = (time - streamStart) / 1000
      if (at >= video.duration) return null
      if (at >= 0) return at
      if (match[3] === undefined && at > -60) return 0 // the minute it started in
    }
  }
}

function findMoment(text) {
  const inside = (at) => (at !== null && at < video.duration ? at : null)
  return inside(placeIn(text, dayKnown())) ?? (dayKnown() ? dayMoment(text) : null) ?? inside(placeIn(text, false))
}

function drawGoToNote(wrong) {
  const note = $('goto-note')
  note.classList.toggle('wrong', wrong)
  note.textContent = wrong ? labels.goToWrong : dayKnown() ? labels.goToHintDay : labels.goToHint
}
function closeGoTo() {
  $('goto').hidden = true
  $('time').classList.remove('open')
  if (document.activeElement === $('goto-text')) $('goto-text').blur()
}
function openGoTo() {
  closeMenu()
  closeGames()
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
  const day = dayAt(seconds)
  $('tip-time').textContent = day ? `${clock(seconds)} · ${day}` : clock(seconds)
  showPicture(pictureAt(seconds))
  tipLines(gameAt(seconds), null)
}

// ---- Its part of the player's menu (player.js, drawMenu) -----------------------------------------
function timelineMenu({ row, title }) {
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
    noteStart(details.recordedAt)
    noteGames(details.moments?.edges || [], details.game)
    if (details.seekPreviewsURL) await askPreviews(details.seekPreviewsURL)
  } catch (error) {
    console.error(error)
    if (tries > 1) setTimeout(() => askDetails(tries - 1), DETAILS_AGAIN)
  }
}
askDetails(DETAILS_TRIES)
