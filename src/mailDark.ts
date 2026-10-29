// Dark mode for HTML mails (MailReader.tsx). The frame first asks the mail for its own dark
// version (prefers-color-scheme: dark, via the frame's color-scheme). Then every color still
// light is turned dark, one element at a time, keeping its hue: light backgrounds and borders
// become dark, dark text becomes light. What is already dark (a mail designed dark, or its own
// dark version) stays as the sender made it; colored buttons keep their color; images and
// background pictures are never touched.

type Rgba = [number, number, number, number] // 0-255, alpha 0-1

const parse = (css: string): Rgba | null => {
  const n = css.match(/[\d.]+/g)?.map(Number)
  if (!n || n.length < 3) return null
  return [n[0], n[1], n[2], n[3] ?? 1]
}

// How bright it looks (0 = black, 1 = white)
function luminance([r, g, b]: Rgba) {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function toHsl([r, g, b]: Rgba): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

const hsl = (h: number, s: number, l: number, a: number) =>
  `hsl(${h.toFixed(0)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}% / ${a})`

// The app's own colors, so white becomes the app's background and black its text
function appLightness(variable: string) {
  const probe = document.createElement('div')
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(variable)
  document.body.append(probe)
  const color = parse(getComputedStyle(probe).color)
  probe.remove()
  return color ? toHsl(color)[2] : 0.5
}

const SIDES = ['top', 'right', 'bottom', 'left']

// Returns how many elements were changed (0: the mail was already dark)
export function darkenMail(doc: Document): number {
  const bgL = appLightness('--bg-raised')
  const textL = appLightness('--text')

  // Light → dark, keeping the hue: white becomes the app's background, light grays a bit lighter.
  // Near white and near black, the hue is only a hint (#fffffe, #000001): it fades out there, or
  // it would become a strong color.
  const darkBg = (c: Rgba) => {
    const [h, s, l] = toHsl(c)
    return hsl(h, s * 0.8 * Math.min(1, (1 - l) * 4), bgL + (1 - l) * 0.5, c[3])
  }
  // Dark → light: black becomes the app's text color, dark colors their light version
  const lightText = (c: Rgba) => {
    const [h, s, l] = toHsl(c)
    return hsl(h, s * Math.min(1, l * 4), textL - l * 0.4, c[3])
  }
  const isLight = (c: Rgba) => luminance(c) > 0.4
  const isDark = (c: Rgba) => luminance(c) < 0.18

  // First read every color, then change them (changing a parent first would change what its
  // children report). The background each element ends up on decides its text.
  // The visible page only (not <head>, <style>…). <html> itself: only its background counts.
  const elements = [doc.documentElement, doc.body, ...doc.body.querySelectorAll<HTMLElement>('*')]
  const changes: [HTMLElement, string, string][] = []
  const finalBgDark = new Map<Element, boolean>()
  for (const el of elements) {
    if (!(el instanceof doc.defaultView!.HTMLElement) || el.tagName === 'IMG') continue
    const style = doc.defaultView!.getComputedStyle(el)
    const bg = parse(style.backgroundColor)
    let onDark: boolean
    if (bg && bg[3] > 0) {
      // Light: turned dark below. Mid tones (a gray, a yellow button) keep their dark text.
      onDark = isLight(bg) || isDark(bg)
      if (isLight(bg)) changes.push([el, 'background-color', darkBg(bg)])
    } else {
      // See-through: on its parent's background (the page is dark unless the mail makes it light)
      onDark = el.parentElement ? finalBgDark.get(el.parentElement) ?? true : true
    }
    finalBgDark.set(el, onDark)
    if (el === doc.documentElement) continue

    const color = parse(style.color)
    if (color && onDark && isDark(color)) changes.push([el, 'color', lightText(color)])
    for (const side of SIDES) {
      if (parseFloat(style.getPropertyValue(`border-${side}-width`)) === 0) continue
      const border = parse(style.getPropertyValue(`border-${side}-color`))
      if (border && border[3] > 0 && isLight(border)) changes.push([el, `border-${side}-color`, darkBg(border)])
    }
  }
  // Inline + important: beats the mail's own rules, even its "!important" ones
  for (const [el, property, value] of changes) el.style.setProperty(property, value, 'important')
  return new Set(changes.map(([el]) => el)).size
}
