// Chat replay beside the video (uses player.js's video, labels, icon, stored). Twitch only answers
// by position: about 59 messages around the moment asked, starting before it and ending after it.
// In busy moments an answer can leave some out (and the same question can get another answer), so
// the next answer's messages are kept as long as the video hasn't reached them, wherever they fall.
// Asking past the last message gives "service error".
// Chat comes from strangers: only ever text nodes and pictures from Twitch's address, never HTML.
const CHAT_QUERY = 'query($id: ID!, $offset: Int) { video(id: $id) { comments(contentOffsetSeconds: $offset) { edges { node { id contentOffsetSeconds commenter { login displayName } message { userColor userBadges { setID version } fragments { text emote { emoteID } } } } } pageInfo { hasNextPage } } } }'
const BADGES_QUERY = 'query($id: ID!) { badges { setID version title imageURL(size: NORMAL) } video(id: $id) { owner { id broadcastBadges { setID version title imageURL(size: NORMAL) } } } }'
const IMAGES = 'https://static-cdn.jtvnw.net/'
const CHAT_WIDTH = 340
const CHAT_MIN = 240
const CHAT_MAX = 600
const VIDEO_MIN = 360 // what dragging the chat's edge always leaves for the video
const CHAT_NEEDS = 700 // narrower than this: no chat, the video keeps its size
const ASK_AHEAD = 15 // seconds of messages ready ahead of the video
const JUMP_WAIT = 250 // ms: several jumps in a row only ask once
const ASK_SOON = 3000 // ms after a failed answer
const ASK_AGAIN = 20000 // ms after the next ones
const ASK_AFTER_END = 60000 // ms: "service error" is normally the end, but could be a passing problem
const FILL = 50 // lines shown just before the moment jumped to
const LINES = 200 // lines kept in the page
const LINES_HELD = 1000 // the same while the user reads further up
const KEEP = 3000 // messages kept in memory
const EMOTES_WAIT = 2000 // ms the first messages wait for the emote services at most
const SPOTS = ['right', 'left', 'top-right', 'top-left', 'bottom-right', 'bottom-left'] // where it sits in full screen
// Names in lower case. More can be added in the menu.
const KNOWN_BOTS = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'botisimo', 'coebot', 'phantombot', 'deepbot', 'ankhbot', 'sery_bot', 'soundalerts', 'pretzelrocks', 'blerp', 'kofistreambot', 'stay_hydrated_bot', 'streamstickers', 'tangiabot', 'lumiastream', 'creatisbot', 'songlistbot', 'own3d', 'playwithviewersbot', 'frostytoolsdotcom']
// Twitch's colors for people who didn't pick one
const NAME_COLORS = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F']

const chatPanel = $('chat')
const chatList = $('chat-list')
const chatNote = $('chat-note')
const chatLatest = $('chat-latest')

// ---- Readable name colors -----------------------------------------------------------------------
function linear(part) {
  return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
}
function hslToRgb(hue, saturation, lightness) {
  const part = (n) => {
    const k = (n + hue * 12) % 12
    const a = saturation * Math.min(lightness, 1 - lightness)
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [part(0), part(8), part(4)]
}
const brightness = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

const nameColors = new Map()
// Keeps the person's color, only lighter when it would be hard to read on the dark panel
function readable(color) {
  if (nameColors.has(color)) return nameColors.get(color)
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255)
  const high = Math.max(r, g, b)
  const low = Math.min(r, g, b)
  const range = high - low
  let hue = 0
  if (range) {
    if (high === r) hue = ((g - b) / range + 6) % 6
    else if (high === g) hue = (b - r) / range + 2
    else hue = (r - g) / range + 4
    hue /= 6
  }
  let lightness = (high + low) / 2
  const saturation = range ? range / (1 - Math.abs(2 * lightness - 1)) : 0
  let rgb = [r, g, b]
  while (brightness(rgb) < 0.22 && lightness < 0.95) {
    lightness += 0.03
    rgb = hslToRgb(hue, saturation, lightness)
  }
  const result = `rgb(${rgb.map((part) => Math.round(part * 255)).join(', ')})`
  nameColors.set(color, result)
  return result
}
function nameColor(color, login) {
  if (/^#[0-9a-f]{6}$/i.test(color || '')) return readable(color)
  let sum = 0
  for (const letter of login || '') sum += letter.charCodeAt(0)
  return readable(NAME_COLORS[sum % NAME_COLORS.length])
}

// ---- Asking Twitch ------------------------------------------------------------------------------
async function askChat(query, variables) {
  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) throw new Error(`Twitch answered ${response.status}`)
  return response.json()
}

// The channel's own badges win over Twitch's general ones. No badges isn't worth stopping the chat.
let channelId = ''
const badgesReady = (async () => {
  const badges = new Map()
  try {
    const { data } = await askChat(BADGES_QUERY, { id: videoId })
    channelId = data?.video?.owner?.id || ''
    for (const badge of [...(data?.badges || []), ...(data?.video?.owner?.broadcastBadges || [])]) {
      if (badge?.imageURL?.startsWith(IMAGES)) badges.set(`${badge.setID}/${badge.version}`, badge)
    }
  } catch (error) {
    console.error(error)
  }
  return badges
})()

// BTTV, FFZ and 7TV: words in the text that are emotes. Looked up in this order, channels first.
// A service that fails or doesn't know the channel only means its emotes stay words.
const emoteLists = []
function emoteList(address, read) {
  const list = new Map()
  emoteLists.push(list)
  return fetch(address)
    .then((response) => (response.ok ? response.json() : null))
    .then((answer) => { if (answer) read(answer, list) })
    .catch((error) => console.error(error))
}
function addSeven(emotes, list) {
  for (const emote of emotes || []) {
    if (!emote?.id || !emote.name) continue
    const address = `https://cdn.7tv.app/emote/${encodeURIComponent(emote.id)}/`
    list.set(emote.name, { small: `${address}1x.webp`, big: `${address}2x.webp`, tip: `${address}3x.webp`, source: '7TV' })
  }
}
function addBttv(emotes, list) {
  for (const emote of emotes || []) {
    if (!emote?.id || !emote.code) continue
    const address = `https://cdn.betterttv.net/emote/${encodeURIComponent(emote.id)}/`
    list.set(emote.code, { small: `${address}1x`, big: `${address}2x`, tip: `${address}3x`, source: 'BTTV' })
  }
}
const FFZ_IMAGES = 'https://cdn.frankerfacez.com/'
function addFfz(sets, list) {
  for (const set of sets) {
    for (const emote of set?.emoticons || []) {
      const small = emote?.urls?.['1']
      if (!emote?.name || !small?.startsWith(FFZ_IMAGES)) continue
      const [big, tip] = [emote.urls['2'], emote.urls['4']].map((address) => address?.startsWith(FFZ_IMAGES) ? address : null)
      list.set(emote.name, { small, big: big || small, tip: tip || big || small, source: 'FFZ' })
    }
  }
}
const emotesReady = badgesReady.then(() => {
  const asks = []
  if (channelId) {
    const id = encodeURIComponent(channelId)
    asks.push(
      emoteList(`https://7tv.io/v3/users/twitch/${id}`, (answer, list) => addSeven(answer.emote_set?.emotes, list)),
      emoteList(`https://api.betterttv.net/3/cached/users/twitch/${id}`, (answer, list) => {
        addBttv(answer.channelEmotes, list)
        addBttv(answer.sharedEmotes, list)
      }),
      emoteList(`https://api.frankerfacez.com/v1/room/id/${id}`, (answer, list) => addFfz(Object.values(answer.sets || {}), list)),
    )
  }
  asks.push(
    emoteList('https://7tv.io/v3/emote-sets/global', (answer, list) => addSeven(answer.emotes, list)),
    emoteList('https://api.betterttv.net/3/cached/emotes/global', (answer, list) => addBttv(answer, list)),
    emoteList('https://api.frankerfacez.com/v1/set/global', (answer, list) => addFfz((answer.default_sets || []).map((id) => answer.sets?.[id]), list)),
  )
  return Promise.all(asks)
})
const emotesOrWait = Promise.race([emotesReady, new Promise((done) => setTimeout(done, EMOTES_WAIT))])
function findEmote(word) {
  for (const list of emoteLists) {
    const emote = list.get(word)
    if (emote) return emote
  }
  return null
}

// ---- What to show -------------------------------------------------------------------------------
let hideBots = stored('player.hideBots', 1) === 1
let showTimes = stored('player.chatTimes', 0) === 1
const CHAT_SIZES = [1, 1.1, 1.25, 1.5]
let chatSize = CHAT_SIZES.includes(stored('player.chatSize', 1)) ? stored('player.chatSize', 1) : 1
let ownBots = localStorage.getItem('player.botNames') || ''
let botNames = new Set()
function readBotNames() {
  botNames = new Set([...KNOWN_BOTS, ...ownBots.toLowerCase().split(/[\s,]+/).filter(Boolean)])
}
readBotNames()
function chatVisible(message) {
  if (!hideBots) return true
  return !botNames.has(message.login) && !message.parts[0]?.text.trimStart().startsWith('!')
}

// ---- Drawing the messages -----------------------------------------------------------------------
let badgeList = new Map()

// tip: its bigger picture in the hover card; from: where an emote comes from (none on badges)
function picture(className, source, double, text, tip, from) {
  const image = document.createElement('img')
  image.className = className
  image.src = source
  image.srcset = `${source} 1x, ${double} 2x`
  image.alt = text
  image.dataset.tip = tip
  if (from) image.dataset.from = from
  image.draggable = false
  return image
}

// Text with the words that are emotes as pictures. Only ever text nodes for the rest.
function addText(line, text) {
  let plain = ''
  for (const word of text.split(/(\s+)/)) {
    const emote = word && findEmote(word)
    if (!emote) {
      plain += word
      continue
    }
    if (plain) line.append(document.createTextNode(plain))
    plain = ''
    line.append(picture('chat-emote', emote.small, emote.big, word, emote.tip, emote.source))
  }
  if (plain) line.append(document.createTextNode(plain))
}

function chatLine(message) {
  const line = document.createElement('div')
  line.className = 'chat-line'
  if (showTimes) {
    const time = document.createElement('span')
    time.className = 'chat-time'
    time.textContent = clock(message.at)
    line.append(time)
  }
  for (const seen of message.badges) {
    const badge = badgeList.get(`${seen.setID}/${seen.version}`)
    if (badge) line.append(picture('chat-badge', badge.imageURL, badge.imageURL.replace(/\/1$/, '/2'), badge.title || '', badge.imageURL.replace(/\/1$/, '/3')))
  }
  const name = document.createElement('span')
  name.className = 'chat-name'
  name.style.color = message.color
  name.textContent = message.name
  line.append(name, document.createTextNode(': '))
  for (const part of message.parts) {
    if (part.emote) {
      const address = `${IMAGES}emoticons/v2/${encodeURIComponent(part.emote)}/default/dark/`
      line.append(picture('chat-emote', `${address}1.0`, `${address}2.0`, part.text, `${address}3.0`, 'Twitch'))
    } else addText(line, part.text)
  }
  return line
}

// Reading further up holds the chat in place until Back to latest or scrolling back down
let chatHeld = false
function toLatest() {
  chatList.scrollTop = chatList.scrollHeight
}
// Lines removed at the top: the browser keeps the ones in view in place by scrolling itself, which
// isn't the user reading further up (it fires a scroll event within a frame)
let trimScroll = false
let trimTimer
function trimming() {
  trimScroll = true
  clearTimeout(trimTimer)
  trimTimer = setTimeout(() => { trimScroll = false }, 100)
}
chatList.addEventListener('scroll', () => {
  if (trimScroll) return void (trimScroll = false)
  chatHeld = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight > 40
  chatLatest.hidden = !chatHeld
})
chatLatest.onclick = () => {
  chatHeld = false
  chatLatest.hidden = true
  toLatest()
}
// The chat keeps following over the mouse; only an emote's or badge's hover card pauses it (new
// lines wait below, out of sight), and it catches up once the card goes (hideTip)
const follow = () => { if (!chatHeld && !tipOn) toLatest() }
chatList.addEventListener('pointerleave', () => hideTip())
// Pictures arriving and a new width make the lines taller
chatList.addEventListener('load', follow, true)
new ResizeObserver(follow).observe(chatList)

function addLines(all) {
  const messages = all.filter(chatVisible)
  if (!messages.length) return
  chatList.append(...messages.map(chatLine))
  // More kept while paused or read further up: they're removed only from far above
  const limit = chatHeld || tipOn ? LINES_HELD : LINES
  if (chatList.childElementCount > limit && !chatHeld) trimming()
  while (chatList.childElementCount > limit) chatList.firstElementChild.remove()
  follow()
  showNote('')
}

// ---- Hover card on emotes and badges: at once, unlike the browser's tooltip -----------------------
const tip = document.createElement('div')
tip.id = 'chat-tip'
tip.hidden = true
tip.innerHTML = '<img alt=""><div></div><div></div>'
const [tipPicture, tipName, tipFrom] = tip.children
chatPanel.append(tip)
let tipOn = null // the picture it's for
function placeTip() {
  if (!tipOn?.isConnected) return hideTip()
  // In the chat's own pixels: the app's scale is a zoom on the page, Chat size one on the lines
  const panel = chatPanel.getBoundingClientRect()
  const scale = panel.width / chatPanel.offsetWidth || 1
  const spot = tipOn.getBoundingClientRect()
  const center = (spot.left + spot.width / 2 - panel.left) / scale - chatPanel.clientLeft // its border on the video's side
  const left = Math.max(4, Math.min(center - tip.offsetWidth / 2, chatPanel.clientWidth - tip.offsetWidth - 4))
  let top = (spot.top - panel.top) / scale - tip.offsetHeight - 6
  if (top < 4) top = (spot.bottom - panel.top) / scale + 6 // no room above: below
  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
}
function showTip(image) {
  tipOn = image
  tipPicture.className = image.className === 'chat-badge' ? 'badge' : ''
  tipPicture.src = image.dataset.tip || image.src
  tipName.textContent = image.alt
  tipFrom.textContent = image.dataset.from || '' // i18n-ok (service names)
  tipFrom.hidden = !image.dataset.from
  tip.hidden = false
  placeTip()
}
function hideTip() {
  if (!tipOn) return
  tipOn = null
  tip.hidden = true
  follow() // the card paused the chat
}
tipPicture.addEventListener('load', placeTip) // its width is only known then
chatList.addEventListener('pointerover', (event) => {
  if (event.target.matches?.('.chat-emote, .chat-badge')) showTip(event.target)
})
chatList.addEventListener('pointerout', (event) => {
  if (event.target === tipOn && event.relatedTarget !== tipOn) hideTip()
})
chatList.addEventListener('scroll', () => { if (tipOn) placeTip() })

function showNote(text) {
  chatNote.textContent = text
  chatNote.hidden = !text
}

// ---- Following the video ------------------------------------------------------------------------
let known = [] // messages in order, nothing missing from knownFrom to knownTo
let knownFrom = 0
let knownTo = -1
let knownIds = new Set()
let shown = 0 // how many of known are on the page or passed
let chatEnded = false // Twitch has nothing after knownTo
let askEndAgain = false // that was "service error": probably the end, asked again a bit later
let askAfter = 0 // no new question before this time
let asking = false
let failures = 0 // failed answers in a row
let askTurn = 0 // a jump makes earlier answers useless
let jumpTimer

function readMessage(edge) {
  const node = edge.node
  const login = node.commenter?.login || ''
  return {
    id: node.id,
    at: node.contentOffsetSeconds,
    login: login.toLowerCase(),
    name: node.commenter?.displayName || login || '—',
    color: nameColor(node.message?.userColor, login),
    badges: (node.message?.userBadges || []).filter((badge) => badge?.setID),
    parts: (node.message?.fragments || []).map((part) => ({ text: part.text || '', emote: part.emote?.emoteID })),
  }
}

function forgetChat() {
  known = []
  knownIds = new Set()
  knownFrom = 0
  knownTo = -1
  shown = 0
  chatEnded = false
  askEndAgain = false
  askAfter = 0
}
const haveMoment = (moment) => knownTo >= 0 && moment >= knownFrom && (moment <= knownTo || chatEnded)

// Everything up to now, the last FILL lines of it
function drawFromKnown() {
  const now = video.currentTime
  shown = known.findIndex((message) => message.at > now)
  if (shown < 0) shown = known.length
  chatList.textContent = ''
  hideTip()
  chatHeld = false
  chatLatest.hidden = true
  addLines(known.slice(0, shown).filter(chatVisible).slice(-FILL))
  toLatest() // also under the mouse: these lines replace the others
  if (!chatList.childElementCount) showNote(labels.chatEmpty)
}

function keepNewLines() {
  const now = video.currentTime
  const from = shown
  while (shown < known.length && known[shown].at <= now) shown++
  addLines(known.slice(from, shown))
  const old = shown - LINES
  if (known.length > KEEP && old > 0) {
    for (const message of known.splice(0, old)) knownIds.delete(message.id)
    shown -= old
    knownFrom = known[0].at
  }
}

async function askAt(position, fresh) {
  const turn = askTurn
  asking = true
  let answer
  try {
    const [reply, badges] = await Promise.all([askChat(CHAT_QUERY, { id: videoId, offset: position }), badgesReady, emotesOrWait])
    if (turn !== askTurn) return
    answer = reply
    badgeList = badges
  } catch (error) {
    console.error(error)
    if (turn !== askTurn) return
    asking = false
    askAfter = Date.now() + (failures++ ? ASK_AGAIN : ASK_SOON)
    if (!chatList.childElementCount) showNote(labels.chatFailed)
    return
  }
  asking = false
  failures = 0
  const comments = answer.data?.video?.comments
  const edges = comments?.edges || []
  // New ones from where it got to, and ones an earlier answer left out that are still ahead
  const now = video.currentTime
  const messages = edges.map(readMessage).filter((message) => !knownIds.has(message.id) && (message.at >= knownTo || message.at > now))
  messages.sort((a, b) => a.at - b.at)
  for (const message of messages) knownIds.add(message.id)
  // The late ones go in their place, ahead of what's shown (all of that is at or before now)
  known.push(...messages)
  known.sort((a, b) => a.at - b.at)
  const onward = messages.filter((message) => message.at >= knownTo)
  if (fresh) knownFrom = messages.length ? Math.min(messages[0].at, position) : position
  // Nothing new though Twitch says there's more: moves on instead of asking the same again
  knownTo = onward.length ? Math.max(onward.at(-1).at, position) : position + ASK_AHEAD
  chatEnded = comments?.pageInfo?.hasNextPage === false || !edges.length
  askEndAgain = chatEnded && !!answer.errors?.length
  askAfter = askEndAgain ? Date.now() + ASK_AFTER_END : 0
  if (fresh) drawFromKnown()
  else keepNewLines()
  followVideo()
}

function askFresh() {
  forgetChat()
  askTurn++
  askAt(Math.floor(video.currentTime), true)
}

const chatShowing = () => !chatPanel.hidden

function followVideo() {
  if (!chatShowing() || !video.duration) return
  const now = video.currentTime
  if (haveMoment(now)) keepNewLines()
  if (asking || Date.now() < askAfter) return
  if (knownTo < 0 || now < knownFrom || now > knownTo + ASK_AHEAD && !chatEnded) return askFresh()
  if (chatEnded) {
    if (!askEndAgain || now >= video.duration - 5) return
    chatEnded = false
  }
  if (knownTo - now < ASK_AHEAD * video.playbackRate) askAt(Math.floor(knownTo) + 1, false)
}
video.addEventListener('timeupdate', followVideo)

// A jump, or the chat showing again: from what's there if it can, otherwise one question only
function chatJump() {
  if (!chatShowing() || !video.duration) return
  if (jumpTimer) {
    clearTimeout(jumpTimer)
    jumpTimer = null
    asking = false
  }
  if (haveMoment(video.currentTime)) return drawFromKnown()
  askTurn++
  asking = true // until the question goes out
  chatList.textContent = ''
  hideTip()
  chatHeld = false
  chatLatest.hidden = true
  showNote(labels.chatLoading)
  jumpTimer = setTimeout(() => {
    jumpTimer = null
    askFresh()
  }, JUMP_WAIT)
}
video.addEventListener('seeking', chatJump)
video.addEventListener('loadedmetadata', chatJump)

// ---- The panel: on or off, width -------------------------------------------------------------------
let chatWanted = stored('player.chat', 1) === 1
let chatWantedFull = stored('player.chatFull', 1) === 1
let chatWidth = stored('player.chatWidth', CHAT_WIDTH)
// The top corners were called corner-right / corner-left before the bottom ones came
const oldSpots = { 'corner-right': 'top-right', 'corner-left': 'top-left' }
const savedSpot = localStorage.getItem('player.chatSpot')
let chatSpot = SPOTS.includes(oldSpots[savedSpot] || savedSpot) ? oldSpots[savedSpot] || savedSpot : SPOTS[0]
// In the window: beside the video (left or right), or over it like in full screen (same spot)
let chatSide = localStorage.getItem('player.chatSide') === 'left' ? 'left' : 'right'
let chatOver = localStorage.getItem('player.chatOver') === '1'
const CHAT_OVER = 340 // its width over the video; in a small window at most 45 % of it
const CHAT_OVER_MIN = 220

function placeChat() {
  const room = $('stage').clientWidth
  const full = !!document.fullscreenElement
  const over = full || chatOver
  const fits = over || room >= CHAT_NEEDS // over the video it always fits
  const showing = (full ? chatWantedFull : chatWanted) && fits
  const was = chatShowing()
  chatPanel.hidden = !showing
  chatPanel.className = over ? `over ${chatSpot}` : `side ${chatSide}`
  $('stage').style.setProperty('--chat-over', `${Math.round(Math.min(CHAT_OVER, Math.max(CHAT_OVER_MIN, room * 0.45)))}px`)
  // What makes room for it (player.html): full height, the controls keep to the picture's part;
  // a top corner, the header stops before it; a bottom corner, the bar and what's above it
  for (const spot of SPOTS) $('stage').classList.toggle(`chat-${spot}`, over && showing && chatSpot === spot)
  setGlass(over && showing)
  chatPanel.style.width = over ? '' : `${Math.round(Math.min(Math.max(chatWidth, CHAT_MIN), CHAT_MAX, Math.max(room - VIDEO_MIN, CHAT_MIN)))}px`
  const button = $('chat-button')
  button.classList.toggle('on', showing)
  button.classList.toggle('off', !fits)
  button.title = !fits ? labels.chatNoRoom : showing ? labels.chatHide : labels.chatShow
  if (showing && !was) {
    showNote(labels.chatLoading)
    chatJump()
  }
}
function toggleChat() {
  if ($('chat-button').classList.contains('off')) return
  if (document.fullscreenElement) {
    chatWantedFull = !chatWantedFull
    localStorage.setItem('player.chatFull', chatWantedFull ? 1 : 0)
  } else {
    chatWanted = !chatWanted
    localStorage.setItem('player.chat', chatWanted ? 1 : 0)
  }
  placeChat()
}
$('chat-button').innerHTML = icon('chat')
$('chat-button').onclick = toggleChat
chatLatest.textContent = labels.chatLatest
chatPanel.addEventListener('pointerdown', closeMenu)
document.addEventListener('fullscreenchange', placeChat)
new ResizeObserver(placeChat).observe($('stage'))

// Dragging the edge next to the video. The page's scale changes the numbers: its own width converts them.
const edge = $('chat-edge')
edge.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  edge.setPointerCapture(event.pointerId)
  document.documentElement.classList.add('resizing')
  event.preventDefault()
})
edge.addEventListener('pointermove', (event) => {
  if (!edge.hasPointerCapture(event.pointerId)) return
  const box = $('stage').getBoundingClientRect()
  chatWidth = (chatSide === 'left' ? event.clientX - box.left : box.right - event.clientX) * ($('stage').clientWidth / box.width)
  chatWidth = Math.min(Math.max(chatWidth, CHAT_MIN), CHAT_MAX, Math.max($('stage').clientWidth - VIDEO_MIN, CHAT_MIN))
  placeChat()
})
const endResize = () => {
  document.documentElement.classList.remove('resizing')
  tellShape()
  localStorage.setItem('player.chatWidth', Math.round(chatWidth))
}
edge.addEventListener('pointerup', endResize)
edge.addEventListener('pointercancel', endResize)

// ---- Frosted glass behind the chat in full screen -----------------------------------------------
// A small blurred copy of the picture under the chat, redrawn at each new frame. Not CSS's
// backdrop blur: to blur the video behind it, the browser has to draw the video itself, which
// takes it off the graphics card's own path and turns off NVIDIA's upscaling (RTX Video Super
// Resolution). Here the video stays untouched; only its copy is blurred. The copy is 1/8 of the
// chat's size and reused, so the work per frame is tiny and the same after hours.
const GLASS_SCALE = 1 / 8
const GLASS_BLUR = 20 // CSS px, like the backdrop blur it replaces
const GLASS_TINT = 0.55 // --bg over the copy
const GLASS_MARGIN = Math.ceil(3 * GLASS_BLUR * GLASS_SCALE) // the picture around it that blurs in, copy px
const glass = document.createElement('canvas')
glass.id = 'chat-glass'
chatPanel.prepend(glass)
const glassPen = glass.getContext('2d', { alpha: false })
const glassSource = document.createElement('canvas') // the copy before blurring, with the margin
const sourcePen = glassSource.getContext('2d', { alpha: false })
let glassOn = false
let glassWaiting = false // a frame callback is asked for
let glassTint // --bg, read once (the page's colors don't change)

function setGlass(on) {
  glassOn = on
  if (!on) return
  drawGlass() // at once: paused, a new spot or size doesn't wait for a frame
  if (!glassWaiting) {
    glassWaiting = true
    video.requestVideoFrameCallback(glassFrame)
  }
}
// A jump while paused shows a new frame that the frame callback doesn't always report
video.addEventListener('seeked', () => { if (glassOn) drawGlass() })
// Once per new frame shown (none while paused), until the glass is off
function glassFrame() {
  glassWaiting = false
  if (!glassOn) return
  drawGlass()
  glassWaiting = true
  video.requestVideoFrameCallback(glassFrame)
}

// Everything in screen boxes (getBoundingClientRect), turned into copy pixels with `k`
function drawGlass() {
  // No frame to copy (while a jump loads, before the first one): keep the last copy, like the
  // video keeps its last picture. Drawing then gave a black flash at each ±5 s.
  if (video.readyState < 2 || video.seeking) return
  const box = chatPanel.getBoundingClientRect()
  if (!box.width || !box.height) return
  const width = Math.max(1, Math.round(chatPanel.offsetWidth * GLASS_SCALE))
  const height = Math.max(1, Math.round(chatPanel.offsetHeight * GLASS_SCALE))
  const sourceWidth = width + 2 * GLASS_MARGIN
  const sourceHeight = height + 2 * GLASS_MARGIN
  // Setting a canvas's size clears it: only when it changes
  if (glass.width !== width || glass.height !== height) {
    glass.width = width
    glass.height = height
    glassSource.width = sourceWidth
    glassSource.height = sourceHeight
  }
  const k = width / box.width
  const left = box.left - GLASS_MARGIN / k
  const top = box.top - GLASS_MARGIN / k
  // Black around the picture (the stage's), then the picture where object-fit: contain shows it
  sourcePen.fillStyle = '#000'
  sourcePen.fillRect(0, 0, sourceWidth, sourceHeight)
  if (video.videoWidth) {
    const shown = video.getBoundingClientRect()
    const fit = Math.min(shown.width / video.videoWidth, shown.height / video.videoHeight)
    const pictureWidth = video.videoWidth * fit
    const pictureHeight = video.videoHeight * fit
    const x = shown.left + (shown.width - pictureWidth) / 2
    const y = shown.top + (shown.height - pictureHeight) / 2
    sourcePen.drawImage(video, (x - left) * k, (y - top) * k, pictureWidth * k, pictureHeight * k)
  }
  // Past the screen's edges there's nothing to blur in: stretch the last line, like the backdrop
  // blur's edges (otherwise black would seep in along a chat touching the edge)
  const stage = $('stage').getBoundingClientRect()
  const gapLeft = Math.min(sourceWidth - 1, Math.max(0, Math.round((stage.left - left) * k)))
  const gapRight = Math.min(sourceWidth - 1, Math.max(0, Math.round((left - stage.right) * k + sourceWidth)))
  const gapTop = Math.min(sourceHeight - 1, Math.max(0, Math.round((stage.top - top) * k)))
  const gapBottom = Math.min(sourceHeight - 1, Math.max(0, Math.round((top - stage.bottom) * k + sourceHeight)))
  if (gapLeft) sourcePen.drawImage(glassSource, gapLeft, 0, 1, sourceHeight, 0, 0, gapLeft, sourceHeight)
  if (gapRight) sourcePen.drawImage(glassSource, sourceWidth - gapRight - 1, 0, 1, sourceHeight, sourceWidth - gapRight, 0, gapRight, sourceHeight)
  if (gapTop) sourcePen.drawImage(glassSource, 0, gapTop, sourceWidth, 1, 0, 0, sourceWidth, gapTop)
  if (gapBottom) sourcePen.drawImage(glassSource, 0, sourceHeight - gapBottom - 1, sourceWidth, 1, 0, sourceHeight - gapBottom, sourceWidth, gapBottom)
  // Blurred into the glass (the margin falls outside), then darkened with --bg
  glassPen.filter = `blur(${GLASS_BLUR * GLASS_SCALE}px)`
  glassPen.drawImage(glassSource, -GLASS_MARGIN, -GLASS_MARGIN)
  glassPen.filter = 'none'
  glassPen.globalAlpha = GLASS_TINT
  glassTint ??= getComputedStyle(chatPanel).getPropertyValue('--bg').trim() || '#161616'
  glassPen.fillStyle = glassTint
  glassPen.fillRect(0, 0, width, height)
  glassPen.globalAlpha = 1
}

// ---- Its part of the player's menu (player.js, drawMenu) -----------------------------------------
function redrawChat() {
  if (chatShowing() && knownTo >= 0) drawFromKnown()
}
function drawChatSize() {
  chatList.style.setProperty('--chat-size', chatSize)
  if (!chatHeld) toLatest()
}
// Its panel in the player's menu (controls.js, drawMenu)
function chatMenu({ panel }) {
  panel('chat', labels.chatTitle, '', (side) => drawChatPanel(side), 'chat')
}
function drawChatPanel({ title, row, choices, element: menu }) {
  title(labels.chatSize)
  choices(CHAT_SIZES.map((size) => ({ value: size, text: percentText(size) })), chatSize, (size) => {
    chatSize = size
    localStorage.setItem('player.chatSize', size)
    drawChatSize()
  })
  row(labels.chatHideBots, hideBots, () => {
    hideBots = !hideBots
    localStorage.setItem('player.hideBots', hideBots ? 1 : 0)
    redrawChat()
  })
  const names = document.createElement('input')
  names.id = 'bot-names'
  names.type = 'text'
  names.spellcheck = false
  names.placeholder = labels.chatBotNames
  names.title = labels.chatBotNames
  names.value = ownBots
  // Kept as typed: the box can go before it's left (another row's panel takes its place on hover)
  names.addEventListener('input', () => {
    ownBots = names.value.trim()
    localStorage.setItem('player.botNames', ownBots)
    readBotNames()
  })
  names.addEventListener('change', redrawChat)
  names.addEventListener('keydown', (event) => { if (event.key === 'Enter') names.blur() })
  menu.append(names)
  row(labels.chatTimes, showTimes, () => {
    showTimes = !showTimes
    localStorage.setItem('player.chatTimes', showTimes ? 1 : 0)
    redrawChat()
  })
  title(labels.chatWindowTitle)
  choices([{ value: false, text: labels.chatBeside }, { value: true, text: labels.chatOver }], chatOver, (on) => {
    chatOver = on
    localStorage.setItem('player.chatOver', on ? 1 : 0)
    sides.hidden = on
    overTitle.textContent = on ? labels.chatFullWindowTitle : labels.chatFullTitle
    placeChat()
  })
  const sides = spotPicker(menu, [STRIPS], { left: labels.chatSideLeft, right: labels.chatSideRight }, chatSide, (side) => {
    chatSide = side
    localStorage.setItem('player.chatSide', side)
    placeChat()
  })
  sides.hidden = chatOver
  // Over the video: full screen, and the window when chosen above (changed in place, no redraw)
  title(chatOver ? labels.chatFullWindowTitle : labels.chatFullTitle)
  const overTitle = menu.lastElementChild
  const spotNames = {
    right: labels.chatRight, left: labels.chatLeft, 'top-right': labels.chatTopRight, 'top-left': labels.chatTopLeft,
    'bottom-right': labels.chatBottomRight, 'bottom-left': labels.chatBottomLeft,
  }
  spotPicker(menu, [STRIPS, CORNERS], spotNames, chatSpot, (spot) => {
    chatSpot = spot
    localStorage.setItem('player.chatSpot', spot)
    placeChat()
  })
}

// Small screens to click where the chat goes: a strip on each side (full height) or one of four
// corners. The chosen part blue, the one under the mouse lighter, its name below. Changed in
// place (no menu redraw), so the mouse's part stays lit.
const STRIPS = ['left', null, 'right'] // null: the picture between them
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
function spotPicker(menu, screens, names, current, choose) {
  const box = document.createElement('div')
  box.className = 'spot-picker'
  const line = document.createElement('div')
  line.className = 'spot-screens'
  const name = document.createElement('div')
  name.className = 'spot-name'
  const show = (spot) => { name.textContent = names[spot] }
  const parts = []
  for (const spots of screens) {
    const screen = document.createElement('div')
    screen.className = `spot-screen ${spots === CORNERS ? 'corners' : 'strips'}`
    for (const spot of spots) {
      if (!spot) {
        screen.append(document.createElement('span'))
        continue
      }
      const part = document.createElement('button')
      part.classList.toggle('on', spot === current)
      part.setAttribute('aria-label', names[spot])
      part.onpointerenter = () => show(spot)
      part.onpointerleave = () => show(current)
      part.onclick = () => {
        current = spot
        parts.forEach((other) => other.classList.toggle('on', other === part))
        show(spot)
        choose(spot)
      }
      parts.push(part)
      screen.append(part)
    }
    line.append(screen)
  }
  show(current)
  box.append(line, name)
  menu.append(box)
  return box
}

drawChatSize()
placeChat()
