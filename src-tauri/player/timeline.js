// What the progress bar shows besides the time (uses player.js's video, labels, stored, jumpTo).
// Muted parts come from the playlist, previews, game changes and the start time from Twitch's
// answer about the video. If one of them can't be had, only that extra is missing: the video isn't affected.
// The title, game and game changes: also asked again while the stream is still live (LIVE_QUERY)
const GAMES_PART = 'title game { displayName boxArtURL(width: 54, height: 72) } moments(first: 100, types: [GAME_CHANGE], momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { positionMilliseconds details { ... on GameChangeMomentDetails { game { displayName boxArtURL(width: 54, height: 72) } } } } } }'
const DETAILS_QUERY = `query($id: ID!) { video(id: $id) { recordedAt seekPreviewsURL owner { displayName profileImageURL(width: 70) } ${GAMES_PART} } }`
const LIVE_QUERY = `query($id: ID!) { video(id: $id) { ${GAMES_PART} } }`
const LIVE_AGAIN = 120000 // ms: a stream still live, for its title and new games (the header, the bar)
const DETAILS_TRIES = 3
const DETAILS_AGAIN = 20000 // ms after a failed answer
// Muted parts closer than this count as one (on the bar, in its tip and for the skip button), even
// when the bit between still has its sound: 0.2% of the video's length (about a pixel on the bar),
// at least 10 s and at most 60 s. 1 h → 10 s, 5 h → 36 s, 10 h → 60 s.
const mutedGap = (length) => Math.min(60, Math.max(10, length * 0.002))

// ---- Muted parts --------------------------------------------------------------------------------
let mutedParts = []
let borrowedParts = [] // muted parts playing with another quality's sound (player.js, DONORS)
const MUTED_COLOR = 'var(--text-red, #f0716b)' // on the bar and in its tip
const BORROWED_COLOR = 'var(--text-green, #7ccb8c)' // the same, for parts with another quality's sound
// Pieces close together as parts (mutedGap), never across one of walls (other parts). video_window.rs
// and the stand-in rename "-unmuted" pieces, so they all end in "-muted" by now (.ts in older
// videos, .mp4 in newer ones)
function partsOf(pieces, gap, walls = []) {
  const parts = []
  for (const piece of pieces) {
    if (!/-muted\.(ts|mp4)$/.test(piece.relurl ?? '')) continue
    const last = parts[parts.length - 1]
    const end = piece.start + piece.duration
    const walled = last && walls.some((wall) => wall.start >= last.end && wall.start < piece.start)
    if (last && !walled && piece.start - last.end <= gap) last.end = end
    else parts.push({ start: piece.start, end })
  }
  return parts
}
// pieces: silent ones; borrowed: those with another quality's sound. One inside a muted part
// counts as muted, like a bit with its own sound there; a muted part cuts them in two.
function noteMutedParts(pieces, length, borrowed = []) {
  const gap = mutedGap(length || 0)
  mutedParts = partsOf(pieces, gap)
  const inMuted = (piece) => mutedParts.some((part) => piece.start >= part.start && piece.start < part.end)
  borrowedParts = partsOf(borrowed.filter((piece) => !inMuted(piece)), gap, mutedParts)
  drawMarks()
  drawSkip()
}

const mutedHere = () => mutedParts.find((part) => video.currentTime >= part.start - 0.01 && video.currentTime < part.end - 0.25)
// "Skip muted part" at first; after SKIP_OFFER seconds watched in the part, a countdown to the
// sound instead (still skips when clicked). A jump starts the SKIP_OFFER over.
const SKIP_OFFER = 5 // seconds
let mutedSince = null // where the muted part was reached, in the video's seconds
function drawSkip() {
  const part = mutedHere()
  $('skip').hidden = !part
  if (!part) return void (mutedSince = null)
  mutedSince ??= video.currentTime
  const counting = video.currentTime - mutedSince >= SKIP_OFFER
  $('skip').classList.toggle('counting', counting)
  $('skip').title = counting ? labels.skipMuted : ''
  // Real time left: at 2x it comes twice as fast
  const left = Math.ceil((part.end - video.currentTime) / (video.playbackRate || 1))
  $('skip').textContent = counting ? (labels.soundBack || '{time}').replace('{time}', clock(left)) : labels.skipMuted
}
video.addEventListener('timeupdate', drawSkip)
video.addEventListener('ratechange', drawSkip)
video.addEventListener('seeking', () => {
  mutedSince = null
  drawSkip()
})
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
  setMarked([
    ...mutedParts.map((part) => ({ ...part, color: MUTED_COLOR, name: labels.mutedPart })),
    ...borrowedParts.map((part) => ({ ...part, color: BORROWED_COLOR, name: labels.borrowedPart })),
  ])
  setGaps(gamesShown() ? games.map((game) => game.at) : [])
}

// ---- The games button (right of the time, where YouTube's chapter is) and its list: jump to where a game starts ------------
// Like Twitch's own player. Shown once Twitch has named a game, also when there's only one.
const GAMEPAD = '<svg viewBox="0 0 24 24"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>'
const gamesButton = document.createElement('button')
gamesButton.className = 'button'
gamesButton.id = 'games'
gamesButton.title = labels.games
gamesButton.hidden = true
$('time').after(gamesButton)
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
function drawGamesButton() {
  gamesButton.hidden = !games.length
  if (!games.length) {
    setHeader({ game: '' })
    return closeGames()
  }
  const index = gameIndexAt(video.currentTime)
  // The full-screen header's game, at this moment (also with one game, and with the bar's game changes off)
  setHeader({ game: games[index].name })
  if (index === gameShown) return
  gameShown = index
  gamesButton.textContent = ''
  gamesButton.append(gamePicture(games[index]))
  if (gamesOpen()) drawPartsList()
}

// The list: the controls' shared one (controls.js), with the box art
const gamesOpen = () => partsOpen(gamesButton)
const closeGames = () => { if (gamesOpen()) closeParts() }
function openGames() {
  closeGoTo()
  openParts({ button: gamesButton, title: labels.games, parts: games, picture: gamePicture })
}
gamesButton.onclick = () => (gamesOpen() ? closeGames() : openGames())
video.addEventListener('timeupdate', drawGamesButton)
video.addEventListener('seeking', drawGamesButton)

// ---- Preview pictures ---------------------------------------------------------------------------
// Twitch's own list: about 200 small pictures per video, on sheets of a few rows and columns.
// Twitch makes it once a stream is over: until then (or if it has none) previews.js makes its own.
let previews = null
let previewsKnown = false // Twitch answered (or couldn't): without its list, previews.js's own
let previewsAddress = null
// The picture at a moment, as controls.js shows it
function pictureAt(seconds) {
  if (!previews) return previewsKnown ? ownPictureAt(seconds) : null
  const { interval, count, cols, rows, width, height, images, folder } = previews
  const index = Math.min(Math.floor(seconds / interval), count - 1)
  const perSheet = cols * rows
  const name = images[Math.floor(index / perSheet)]
  if (!name) return null
  const spot = index % perSheet
  return { address: `${folder}/${encodeURIComponent(name)}`, width, height, cols, column: spot % cols, row: Math.floor(spot / cols) }
}

async function askPreviews(url) {
  previewsAddress = url
  const place = new URL(url)
  const folder = `/v/${place.host}${place.pathname.slice(0, place.pathname.lastIndexOf('/'))}`
  const response = await fetch(`/v/${place.host}${place.pathname}`)
  // Not made yet (a stream still live answers 403) or none: not a hiccup to try again
  if (response.status === 403 || response.status === 404) return
  if (!response.ok) throw new Error(`Previews answered ${response.status}`)
  const list = await response.json()
  const best = list.find((one) => one.quality === 'high') || list[0]
  const usable = best && best.interval > 0 && best.count > 0 && best.cols > 0 && best.rows > 0 && best.width > 0 && best.height > 0 && Array.isArray(best.images)
  if (!usable) return
  previews = { ...best, folder }
  dropOwnPictures()
  checkStart(list, folder).catch((error) => console.error(error))
}

// ---- The waiting screen at the start (startSkip.js) ---------------------------------------------
// Twitch's smallest pictures of the first 30 min (its "low" list: all on one sheet), then our own
// pictures to narrow it to ~10 s (previews.js). Once per video, when Twitch's list is there: a live
// stream gets it only after its end (no own pictures in the background, DECISIONS "VOD start skip").
let startChecked = false
const startSkip = data.startSkip || {} // this video's search: see skipShow (startSkip.js)
const startOpenedAt = Math.max(Number(params.get('t')) || 0, 0) // seconds
let startPictures = null // a promise of Twitch's small pictures of the first 30 min: [{ at, picture }]
const loadSheet = (address) => new Promise((done, failed) => {
  const image = new Image()
  image.onload = () => done(image)
  image.onerror = () => failed(new Error(`Sheet ${address} didn't load`))
  image.src = address
})
async function loadStartPictures(low, folder) {
  const perSheet = low.cols * low.rows
  const count = Math.min(low.count, Math.ceil((SKIP.within + SKIP.ahead) / low.interval) + 3)
  const sheets = new Map()
  const pictures = []
  for (let i = 0; i < count; i++) {
    const name = low.images[Math.floor(i / perSheet)]
    if (!name) break
    if (!sheets.has(name)) sheets.set(name, await loadSheet(`${folder}/${encodeURIComponent(name)}`))
    const spot = i % perSheet
    pictures.push({ at: i * low.interval, picture: skipPicture(sheets.get(name), (spot % low.cols) * low.width, Math.floor(spot / low.cols) * low.height, low.width, low.height) })
  }
  return pictures
}
const startHere = () => (video.duration ? video.currentTime : position)
async function checkStart(list, folder) {
  if (startChecked || startSkip.off) return
  startChecked = true
  const low = list.find((one) => one.quality === 'low') || list[0]
  if (!low?.interval || !Array.isArray(low.images)) return
  if (startHere() >= SKIP.within) return
  startPictures = loadStartPictures(low, folder)
  const looks = startSkip.looks || []
  const found = findWaiting(await startPictures, looks)
  if (!found || startHere() >= found.to) return
  const start = await refineStart(found, looks, ownSkipPicture)
  if (!skipWorthIt(start, startHere())) return
  // Twitch's first picture at or after it (the one before can still be the waiting screen)
  const shown = previews ? pictureAt(Math.min(Math.ceil(start / previews.interval), previews.count - 1) * previews.interval) : null
  skipShow(controls, videoId, startSkip, found, start, shown, startOpenedAt, startHere)
}
// The right-click menu's "Remember as waiting screen" (player.js): Twitch's pictures up to here,
// or without them yet, our own picture of this moment
function rememberStart() {
  const pictures = async () => {
    const listed = startPictures ? await startPictures.catch(() => []) : []
    if (listed.length) return listed
    const own = await ownSkipPicture(startHere())
    return own ? [own] : []
  }
  return skipRemember(controls, videoId, startSkip, labels, startHere(), live, pictures)
}

// The stream is over (player.js): Twitch makes its list in the next minutes
const PREVIEWS_AFTER_END = [30, 120, 300, 600] // seconds after the end
function streamOver() {
  for (const after of PREVIEWS_AFTER_END) {
    setTimeout(async () => {
      if (previews) return
      try {
        const url = previewsAddress || (await askTwitch('query($id: ID!) { video(id: $id) { seekPreviewsURL } }'))?.seekPreviewsURL
        if (url) await askPreviews(url)
      } catch (error) {
        console.error(error)
      }
    }, after * 1000)
  }
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
  // Over a muted part (red on the bar) or one with another quality's sound (green): its name and
  // length, in its color
  const part = markedAt(seconds)
  tipLines(gameAt(seconds), part && { color: part.color, text: `${part.name} · ${clock(part.end - part.start)}` })
}

// ---- Its part of the player's menu (player.js, drawMenu): a Miscellaneous row under Chat --------
function timelineMenu({ panel }) {
  panel('misc', labels.miscTitle, '', ({ row, title }) => {
    title(labels.barTitle)
    row(labels.gameChanges, showGames, () => {
      showGames = !showGames
      localStorage.setItem('player.gameChanges', showGames ? 1 : 0)
      drawMarks()
    })
  }, 'misc')
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
    if (!details) return void (previewsKnown = true)
    noteStart(details.recordedAt)
    noteGames(details.moments?.edges || [], details.game)
    noteHeader(details)
    setTimeout(askLiveDetails, LIVE_AGAIN)
    if (details.seekPreviewsURL) await askPreviews(details.seekPreviewsURL)
    previewsKnown = true
  } catch (error) {
    console.error(error)
    if (tries > 1) setTimeout(() => askDetails(tries - 1), DETAILS_AGAIN)
    else previewsKnown = true
  }
}
askDetails(DETAILS_TRIES)

// The header (controls.js): Twitch's title (a stream still live can change it), and its channel
// when the app didn't know it (a pasted link of a channel not followed)
function noteHeader(details) {
  const owner = details.owner
  setHeader({
    ...(details.title && { title: details.title }),
    ...(!data.header?.channel && owner?.displayName && { channel: owner.displayName }),
    ...(!data.header?.picture && owner?.profileImageURL && { picture: owner.profileImageURL }),
  })
}
// Every 2 minutes while still live; a failed answer just waits for the next time
async function askLiveDetails() {
  if (!live) return
  try {
    const details = await askTwitch(LIVE_QUERY)
    if (details) {
      noteGames(details.moments?.edges || [], details.game)
      noteHeader(details)
    }
  } catch (error) {
    console.error(error)
  }
  setTimeout(askLiveDetails, LIVE_AGAIN)
}
