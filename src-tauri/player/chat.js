// Chat replay beside the video (uses player.js's video, labels, icon, stored). Twitch only answers
// by position: about 59 messages around the moment asked, starting before it and ending after it,
// with nothing missing in between. Asking past the last message gives "service error".
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
const ASK_AGAIN = 20000 // ms after a failed answer
const ASK_AFTER_END = 60000 // ms: "service error" is normally the end, but could be a passing problem
const FILL = 50 // lines shown just before the moment jumped to
const LINES = 200 // lines kept in the page
const LINES_HELD = 1000 // the same while the user reads further up
const KEEP = 3000 // messages kept in memory
const EMOTES_WAIT = 2000 // ms the first messages wait for the emote services at most
const SPOTS = ['right', 'left', 'corner-right', 'corner-left'] // where it sits in full screen
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
    list.set(emote.name, { small: `${address}1x.webp`, big: `${address}2x.webp` })
  }
}
function addBttv(emotes, list) {
  for (const emote of emotes || []) {
    if (!emote?.id || !emote.code) continue
    const address = `https://cdn.betterttv.net/emote/${encodeURIComponent(emote.id)}/`
    list.set(emote.code, { small: `${address}1x`, big: `${address}2x` })
  }
}
const FFZ_IMAGES = 'https://cdn.frankerfacez.com/'
function addFfz(sets, list) {
  for (const set of sets) {
    for (const emote of set?.emoticons || []) {
      const small = emote?.urls?.['1']
      if (!emote?.name || !small?.startsWith(FFZ_IMAGES)) continue
      const big = emote.urls['2']
      list.set(emote.name, { small, big: big?.startsWith(FFZ_IMAGES) ? big : small })
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

function picture(className, source, double, text) {
  const image = document.createElement('img')
  image.className = className
  image.src = source
  image.srcset = `${source} 1x, ${double} 2x`
  image.alt = text
  image.title = text
  image.draggable = false
  image.referrerPolicy = 'no-referrer'
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
    line.append(picture('chat-emote', emote.small, emote.big, word))
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
    if (badge) line.append(picture('chat-badge', badge.imageURL, badge.imageURL.replace(/\/1$/, '/2'), badge.title || ''))
  }
  const name = document.createElement('span')
  name.className = 'chat-name'
  name.style.color = message.color
  name.textContent = message.name
  line.append(name, document.createTextNode(': '))
  for (const part of message.parts) {
    if (part.emote) {
      const address = `${IMAGES}emoticons/v2/${encodeURIComponent(part.emote)}/default/dark/`
      line.append(picture('chat-emote', `${address}1.0`, `${address}2.0`, part.text))
    } else addText(line, part.text)
  }
  return line
}

// Reading further up holds the chat in place until Back to latest or scrolling back down
let chatHeld = false
function toLatest() {
  chatList.scrollTop = chatList.scrollHeight
}
chatList.addEventListener('scroll', () => {
  chatHeld = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight > 40
  chatLatest.hidden = !chatHeld
})
chatLatest.onclick = () => {
  chatHeld = false
  chatLatest.hidden = true
  toLatest()
}
// Pictures arriving and a new width make the lines taller
chatList.addEventListener('load', () => { if (!chatHeld) toLatest() }, true)
new ResizeObserver(() => { if (!chatHeld) toLatest() }).observe(chatList)

function addLines(all) {
  const messages = all.filter(chatVisible)
  if (!messages.length) return
  chatList.append(...messages.map(chatLine))
  const limit = chatHeld ? LINES_HELD : LINES
  while (chatList.childElementCount > limit) chatList.firstElementChild.remove()
  if (!chatHeld) toLatest()
  showNote('')
}

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
  chatHeld = false
  chatLatest.hidden = true
  addLines(known.slice(0, shown).filter(chatVisible).slice(-FILL))
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
    askAfter = Date.now() + ASK_AGAIN
    if (!chatList.childElementCount) showNote(labels.chatFailed)
    return
  }
  asking = false
  const comments = answer.data?.video?.comments
  const edges = comments?.edges || []
  const messages = edges.map(readMessage).filter((message) => !knownIds.has(message.id) && message.at >= knownTo)
  messages.sort((a, b) => a.at - b.at)
  for (const message of messages) knownIds.add(message.id)
  known.push(...messages)
  if (fresh) knownFrom = messages.length ? Math.min(messages[0].at, position) : position
  // Nothing new though Twitch says there's more: moves on instead of asking the same again
  knownTo = messages.length ? Math.max(messages.at(-1).at, position) : position + ASK_AHEAD
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
let chatSpot = SPOTS.includes(localStorage.getItem('player.chatSpot')) ? localStorage.getItem('player.chatSpot') : SPOTS[0]

function placeChat() {
  const room = $('stage').clientWidth
  const full = !!document.fullscreenElement
  const fits = full || room >= CHAT_NEEDS // in full screen it goes over the video
  const showing = (full ? chatWantedFull : chatWanted) && fits
  const was = chatShowing()
  chatPanel.hidden = !showing
  chatPanel.className = full ? `over ${chatSpot}` : ''
  chatPanel.style.width = full ? '' : `${Math.round(Math.min(Math.max(chatWidth, CHAT_MIN), CHAT_MAX, Math.max(room - VIDEO_MIN, CHAT_MIN)))}px`
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
$('chat-button').innerHTML = '<svg viewBox="0 0 24 24"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/></svg>'
$('chat-button').onclick = toggleChat
chatLatest.textContent = labels.chatLatest
chatPanel.addEventListener('pointerdown', closeMenu)
// Over the video in full screen it covers the controls' place: moving on it brings them back
chatPanel.addEventListener('pointermove', () => { if (chatPanel.classList.contains('over')) wake() })
document.addEventListener('fullscreenchange', placeChat)
new ResizeObserver(placeChat).observe($('stage'))

// Dragging the left edge. The page's scale changes the numbers: its own width converts them.
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
  chatWidth = (box.right - event.clientX) * ($('stage').clientWidth / box.width)
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
  panel('chat', labels.chatTitle, '', (side) => drawChatPanel(side))
}
function drawChatPanel({ title, row, choices, element: menu }) {
  title(labels.chatSize)
  choices(CHAT_SIZES.map((size) => ({ value: size, text: `${Math.round(size * 100)}%` })), chatSize, (size) => {
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
  names.addEventListener('change', () => {
    ownBots = names.value.trim()
    localStorage.setItem('player.botNames', ownBots)
    readBotNames()
    redrawChat()
  })
  names.addEventListener('keydown', (event) => { if (event.key === 'Enter') names.blur() })
  menu.append(names)
  row(labels.chatTimes, showTimes, () => {
    showTimes = !showTimes
    localStorage.setItem('player.chatTimes', showTimes ? 1 : 0)
    redrawChat()
  })
  title(labels.chatFullTitle)
  const spotNames = { right: labels.chatRight, left: labels.chatLeft, 'corner-right': labels.chatCornerRight, 'corner-left': labels.chatCornerLeft }
  for (const spot of SPOTS) {
    row(spotNames[spot], spot === chatSpot, () => {
      chatSpot = spot
      localStorage.setItem('player.chatSpot', spot)
      placeChat()
    })
  }
}

drawChatSize()
placeChat()
