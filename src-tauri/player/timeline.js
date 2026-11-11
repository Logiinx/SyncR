// What the progress bar shows besides the time (uses player.js's video, labels, stored, jumpTo).
// Muted parts come from the playlist, previews, game changes and the start time from Twitch's
// answer about the video. If one of them can't be had, only that extra is missing: the video isn't affected.
const DETAILS_QUERY = 'query($id: ID!) { video(id: $id) { recordedAt seekPreviewsURL moments(first: 100, types: [GAME_CHANGE], momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { positionMilliseconds details { ... on GameChangeMomentDetails { game { displayName } } } } } } } }'
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

// ---- Drawn on the bar (controls.js): muted parts in color, game changes as gaps ---------------------
function drawMarks() {
  setMarked(mutedParts.map((part) => ({ ...part, color: 'var(--text-orange, #f0a052)' })))
  setGaps(gamesShown() ? games.map((game) => game.at) : [])
}

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
let streamStart = null // ms
let showDay = stored('player.timeOfDay', 0) === 1
const dayKnown = () => showDay && streamStart !== null
dayAt = (seconds) => (dayKnown() ? new Date(streamStart + seconds * 1000).toLocaleTimeString(data.locale || undefined, { hour: '2-digit', minute: '2-digit' }) : '')

function noteStart(recordedAt) {
  const start = Date.parse(recordedAt)
  streamStart = Number.isNaN(start) ? null : start
  drawTime()
}

// ---- Go to a time -------------------------------------------------------------------------------
// A place in the video: 23:45 or 1:23:45. With the time of day on, 21:30 means the time of day, so
// only 1:23:45 is a place. Answers in seconds, or null.
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
  const place = placeIn(text, dayKnown())
  if (place !== null && place < video.duration) return place
  return dayKnown() ? dayMoment(text) : null
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
function timelineMenu(row, title) {
  title(labels.barTitle)
  row(labels.gameChanges, showGames, () => {
    showGames = !showGames
    localStorage.setItem('player.gameChanges', showGames ? 1 : 0)
    drawMarks()
  })
  row(labels.timeOfDay, showDay, () => {
    showDay = !showDay
    localStorage.setItem('player.timeOfDay', showDay ? 1 : 0)
    drawTime()
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
    noteGames(details.moments?.edges || [])
    if (details.seekPreviewsURL) await askPreviews(details.seekPreviewsURL)
  } catch (error) {
    console.error(error)
    if (tries > 1) setTimeout(() => askDetails(tries - 1), DETAILS_AGAIN)
  }
}
askDetails(DETAILS_TRIES)
