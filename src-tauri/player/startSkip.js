// Spots the waiting screen ("starting soon") at a video's start and where the true start is, from
// its preview pictures. Shared by the own Twitch player (player.html) and YouTube's page
// (video-watch.js, same way as controls.js). No page or app parts: given pictures, it answers.
//
// How (measured on ~30 real streams, DECISIONS.md "VOD start skip"): the waiting screen keeps its
// layout (its colors can change, it can loop or swap between two cards), the true start looks
// clearly different and stays so. That alone can't tell a waiting screen from a face cam followed by
// a game, so each channel learns its own waiting screen's look once the button is used (looks):
// a face cam or a game never looks like the channel's card.
const SKIP = {
  width: 32, height: 18, // a picture as compared: tiny, so compression and small text don't count
  lookWidth: 16, lookHeight: 9, // a remembered look (432 bytes)
  alike: 0.5, // same layout: correlation of the brightness, colors ignored (0..1)
  close: 20, // or simply close colors (average difference per channel, 0..255)
  learnedLayout: 0.8, // a remembered look matches: layout this close (after the true start: ≤ 0.51 seen)
  learnedClose: 25, // and colors this close
  ahead: 90, // seconds that must stay different after the true start (2 pictures at least)
  within: 1800, // seconds searched (30 min)
  shortest: 60, // seconds: a shorter waiting screen isn't worth a button
  precision: 10, // seconds: refining stops there
  looksKept: 8, // remembered looks per channel (a new card per event: the oldest go)
  looksPerTime: 3, // looks taken from one video's waiting screen
  sameLook: 13, // two looks closer than this are one (colors + 100 × layout difference)
}

// A picture from a sheet or a video, as compared (RGBA, SKIP.width × SKIP.height)
function skipPicture(source, sx, sy, sw, sh) {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(SKIP.width, SKIP.height) : Object.assign(document.createElement('canvas'), { width: SKIP.width, height: SKIP.height })
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, sx, sy, sw, sh, 0, 0, SKIP.width, SKIP.height)
  return context.getImageData(0, 0, SKIP.width, SKIP.height).data
}

// Average difference per color channel (0..255). Both pictures the same size.
function skipColors(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
  return sum / ((a.length / 4) * 3)
}

// Brightness with its average and contrast taken out: compares the layout, not the colors
function skipBrightness(picture) {
  const values = []
  for (let i = 0; i < picture.length; i += 4) values.push(0.3 * picture[i] + 0.59 * picture[i + 1] + 0.11 * picture[i + 2])
  const mean = values.reduce((sum, one) => sum + one, 0) / values.length
  const spread = Math.sqrt(values.reduce((sum, one) => sum + (one - mean) ** 2, 0) / values.length) || 1
  return values.map((one) => (one - mean) / spread)
}
const skipLayouts = new WeakMap()
function skipLayout(a, b) {
  if (!skipLayouts.has(a)) skipLayouts.set(a, skipBrightness(a))
  if (!skipLayouts.has(b)) skipLayouts.set(b, skipBrightness(b))
  const x = skipLayouts.get(a)
  const y = skipLayouts.get(b)
  let sum = 0
  for (let i = 0; i < x.length; i++) sum += x[i] * y[i]
  return sum / x.length
}

const skipAlike = (a, b) => skipLayout(a, b) >= SKIP.alike || skipColors(a, b) <= SKIP.close

// The picture at the remembered looks' size (2 × 2 averaged)
function skipShrink(picture) {
  const small = new Uint8ClampedArray(SKIP.lookWidth * SKIP.lookHeight * 4)
  for (let y = 0; y < SKIP.lookHeight; y++) {
    for (let x = 0; x < SKIP.lookWidth; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) sum += picture[((y * 2 + dy) * SKIP.width + x * 2 + dx) * 4 + c]
        small[(y * SKIP.lookWidth + x) * 4 + c] = sum / 4
      }
    }
  }
  return small
}

// Remembered looks are kept as text (the channel's setting): RGB, base64
function skipLookText(small) {
  let bytes = ''
  for (let i = 0; i < small.length; i += 4) bytes += String.fromCharCode(small[i], small[i + 1], small[i + 2])
  return btoa(bytes)
}
function skipLookPicture(text) {
  try {
    const bytes = atob(text)
    if (bytes.length !== SKIP.lookWidth * SKIP.lookHeight * 3) return null
    const small = new Uint8ClampedArray(SKIP.lookWidth * SKIP.lookHeight * 4)
    for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4) {
      small[j] = bytes.charCodeAt(i)
      small[j + 1] = bytes.charCodeAt(i + 1)
      small[j + 2] = bytes.charCodeAt(i + 2)
      small[j + 3] = 255
    }
    return small
  } catch {
    return null
  }
}
const skipLooksOf = (texts) => (Array.isArray(texts) ? texts.map(skipLookPicture).filter(Boolean) : [])

function skipLearned(picture, looks) {
  if (!looks.length) return false
  const small = skipShrink(picture)
  return looks.some((look) => skipLayout(look, small) >= SKIP.learnedLayout && skipColors(look, small) <= SKIP.learnedClose)
}

// pictures: [{ at: seconds, picture }] from the start, in order; looks: the channel's remembered
// looks (text). Answers { from, to, run, learned }: the true start lies between the last waiting
// picture (from) and the first true one (to), run = the pictures before it, learned = it matches a
// remembered look (only then may it skip by itself). Null when there's no clear waiting screen.
function findWaiting(pictures, lookTexts) {
  const looks = skipLooksOf(lookTexts)
  if (pictures.length < 2) return null
  // The waiting screen's pictures (by index): those alike to it, from the first one on
  const run = [0]
  // Odd pictures in between (a second card, a flash): not the waiting screen until shown to be
  let odd = []
  const alike = (i, j) => skipAlike(pictures[i].picture, pictures[j].picture)
  const waiting = (i) => skipLearned(pictures[i].picture, looks) || run.some((j) => alike(i, j))
  const runBetween = (from, to) => run.some((j) => j > from && j < to)
  for (let k = 1; k < pictures.length; k++) {
    const candidate = pictures[k]
    if (candidate.at > SKIP.within) return null // still waiting after 30 min: not a waiting screen
    if (waiting(k)) {
      run.push(k)
      // A second card: an odd picture that came back with the waiting screen in between, both
      // times (card A, B, A, B, A). A flash seen once, or real content tried for a moment, doesn't.
      const back = odd.filter((p) => odd.some((q) => q > p && alike(p, q) && runBetween(p, q)))
      const cards = new Set(back.flatMap((p) => [p, ...odd.filter((q) => q > p && alike(p, q) && runBetween(p, q))]))
      run.push(...cards)
      odd = odd.filter((p) => !cards.has(p))
      continue
    }
    // Different from the waiting screen, and staying so: the next 2 pictures, and all of SKIP.ahead
    const after = []
    for (let i = k + 1; i < pictures.length && (after.length < 2 || pictures[i].at - candidate.at <= SKIP.ahead); i++) after.push(i)
    if (after.length < 2) return null // the video ends there, or not enough pictures given
    // A second card's last showing (card A, B, A, B, then the stream): it came back with the
    // waiting screen in between, and what follows doesn't look like it
    const earlier = odd.filter((p) => alike(p, k) && runBetween(p, k))
    if (earlier.length && after.every((i) => !alike(i, k))) {
      run.push(k, ...earlier)
      odd = odd.filter((p) => !earlier.includes(p))
      continue
    }
    if (after.every((i) => !waiting(i))) {
      // All before it is the waiting screen, odd pictures too: refining compares with all of them
      const before = pictures.slice(0, k)
      const learned = looks.length > 0 && before.filter((one) => skipLearned(one.picture, looks)).length * 2 >= before.length
      // A single picture can't show a waiting screen by itself, unless the channel's look says so
      if (before.length < 2 && !learned) return null
      return { from: before[before.length - 1].at, to: candidate.at, run: before.map((one) => one.picture), learned }
    }
    odd.push(k)
  }
  return null
}

// Narrows the true start between found.from and found.to with pictures asked for by time
// (pictureAt(seconds) → picture, or null when none could be had). Answers seconds: the first moment
// known to be past the waiting screen (never earlier, so no waiting screen is left at the jump).
async function refineStart(found, lookTexts, pictureAt) {
  const looks = skipLooksOf(lookTexts)
  let from = found.from
  let to = found.to
  while (to - from > SKIP.precision) {
    const middle = Math.round((from + to) / 2)
    const picture = await pictureAt(middle)
    if (!picture) break
    const waiting = skipLearned(picture, looks) || found.run.some((one) => skipAlike(picture, one))
    if (waiting) from = middle
    else to = middle
  }
  return to
}

// Is it worth a button? (too short, or past it already: none)
const skipWorthIt = (start, position) => start >= SKIP.shortest && start <= SKIP.within && position < start - 5

// The channel's looks after the button was used: up to SKIP.looksPerTime pictures of this waiting
// screen, the most different ones (a loop's or two cards' sides), new ones first; one already
// remembered isn't added twice.
function learnLooks(lookTexts, run) {
  const old = Array.isArray(lookTexts) ? lookTexts.filter((text) => skipLookPicture(text)) : []
  const oldLooks = old.map(skipLookPicture)
  // How far apart two looks are; under SKIP.sameLook they're the same (a still card, a loop's repeat)
  const distance = (a, b) => skipColors(a, b) + 100 * (1 - skipLayout(a, b))
  const candidates = run.map(skipShrink).filter((small) => !oldLooks.some((look) => distance(look, small) <= SKIP.sameLook))
  const picked = []
  while (candidates.length && picked.length < SKIP.looksPerTime) {
    // The farthest from those picked (the first one: the waiting screen's first picture)
    let best = 0
    let bestDistance = -1
    candidates.forEach((one, index) => {
      const away = picked.length ? Math.min(...picked.map((other) => distance(one, other))) : 0
      if (away > bestDistance) [best, bestDistance] = [index, away]
    })
    if (picked.length && bestDistance <= SKIP.sameLook) break
    picked.push(candidates.splice(best, 1)[0])
  }
  return [...picked.map(skipLookText), ...old].slice(0, SKIP.looksKept)
}
