import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { Blend, EyeOff, ListChecks, Lock, MousePointerClick, Palette, Pin, Scaling, Settings, Square, Thermometer, Timer } from 'lucide-react'
import './index.css'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { animationsOn, startClosingAnimations, TIMING } from './animations'
import { applyAppearance, loadAppearance } from './appearance'
import { decimal, percentText, t, useLanguage } from './i18n'
import { BACKGROUNDS, CLICK_THROUGH, FRAMES, type HardwareSettings, type MenuChoice, SIZES, SPEEDS, THEMES, WIDGET_GROUPS, clickThroughAbout, sensorLabel, storedHardware } from './hardware'

// The Hardware widget's right-click menu: a page of its own in a see-through window over the
// whole monitor, made when the widget is right-clicked and removed when the menu closes
// (open_menu in hardware_widget.rs). The app's own menu (ContextMenu), so it looks and behaves
// the same. It reads the settings saved on this device (same origin as the main window) and
// sends each change to the main window, which saves it (hardware.ts).

// The mouse, and the window's final size, in screen pixels (from the address)
const query = new URLSearchParams(location.search)
const number = (name: string) => Number(query.get(name)) || 0
const [mouseX, mouseY, width, height] = [number('x'), number('y'), number('w'), number('h')]

const send = async (action: string, choice?: MenuChoice) => {
  if (isTauri()) await invoke('hardware_menu', { action, choice }).catch(console.error)
}

// The window is made small, then given the monitor's size: the menu is placed once it has it
// (it keeps itself inside the window), or after a second whatever happens, so it always shows
const sized = () => Math.abs(innerWidth * devicePixelRatio - width) <= 2 && Math.abs(innerHeight * devicePixelRatio - height) <= 2

function HardwareMenu() {
  useLanguage()
  const [settings, setSettings] = useState<HardwareSettings>(storedHardware)
  const [ready, setReady] = useState(sized)

  useEffect(() => {
    if (ready) return
    const check = () => sized() && setReady(true)
    const late = setTimeout(() => setReady(true), 1000)
    addEventListener('resize', check)
    return () => {
      clearTimeout(late)
      removeEventListener('resize', check)
    }
  }, [ready])
  // Shown once drawn
  useEffect(() => {
    if (ready) requestAnimationFrame(() => void send('ready'))
  }, [ready])

  // Closing: the menu's closing animation, then the window goes. Another window taking the
  // focus (a click on another monitor, Alt+Tab) closes it too.
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (!closing) return
    const done = setTimeout(() => void send('close'), animationsOn() ? TIMING.closeSmall : 0)
    return () => clearTimeout(done)
  }, [closing])
  useEffect(() => {
    const close = () => setClosing(true)
    addEventListener('blur', close)
    return () => removeEventListener('blur', close)
  }, [])

  const change = (part: Partial<HardwareSettings>) => {
    setSettings((now) => ({ ...now, ...part }))
    void send('choice', { change: part })
  }
  // A theme, frame, background or size under the mouse shows on the widget at once. Leaving waits a moment, so
  // going from one to the next doesn't flash the saved one in between.
  const back = useRef<number | undefined>(undefined)
  const preview = (part: Partial<HardwareSettings>) => (on: boolean) => {
    clearTimeout(back.current)
    if (on) void send('choice', { preview: part })
    else back.current = window.setTimeout(() => void send('choice', { preview: null }), 100)
  }
  useEffect(() => () => clearTimeout(back.current), [])

  // Every reading, under its hardware's name, as in the settings window
  const shown = WIDGET_GROUPS.flatMap(({ icon, sensors }) =>
    sensors.map((sensor, index): MenuItem => ({
      label: sensorLabel(sensor),
      section: index === 0 ? (icon === 'cpu' ? t('CPU') : icon === 'gpu' ? t('GPU') : t('Memory')) : undefined,
      checked: settings.shown.includes(sensor),
      stayOpen: true, // several are often ticked in a row
      onClick: () =>
        change({ shown: settings.shown.includes(sensor) ? settings.shown.filter((s) => s !== sensor) : [...settings.shown, sensor] }),
    })),
  )
  const items: MenuItem[] = [
    { label: t('Always on top'), icon: Pin, checked: settings.onTop, onClick: () => change({ onTop: !settings.onTop }) },
    { label: t('Lock position and size'), icon: Lock, checked: settings.locked, onClick: () => change({ locked: !settings.locked }) },
    {
      label: t('Click-through'),
      icon: MousePointerClick,
      submenu: {
        title: t('Click-through'),
        items: CLICK_THROUGH.map(([clickThrough, label]) => ({
          label: label(),
          hint: clickThrough === 'off' ? undefined : clickThroughAbout(),
          checked: settings.clickThrough === clickThrough,
          onClick: () => change({ clickThrough }),
        })),
      },
    },
    { label: t('What to show'), icon: ListChecks, divider: true, submenu: { title: t('What to show'), items: shown } },
    {
      label: t('Update every'),
      icon: Timer,
      submenu: {
        title: t('Update every'),
        items: SPEEDS.map((ms) => ({
          label: t('{n} s', { n: decimal(ms / 1000, ms < 1000 ? 1 : 0) }),
          checked: settings.everyMs === ms,
          onClick: () => change({ everyMs: ms }),
        })),
      },
    },
    {
      label: t('Temperatures in'),
      icon: Thermometer,
      submenu: {
        title: t('Temperatures in'),
        items: [
          { label: t('Celsius (°C)'), checked: !settings.fahrenheit, onClick: () => change({ fahrenheit: false }) },
          { label: t('Fahrenheit (°F)'), checked: settings.fahrenheit, onClick: () => change({ fahrenheit: true }) },
        ],
      },
    },
    {
      label: t('Theme'),
      icon: Palette,
      divider: true,
      submenu: {
        title: t('Theme'),
        items: THEMES.map(([theme, label]) => ({
          label: label(),
          checked: settings.theme === theme,
          onPreview: preview({ theme }),
          onClick: () => change({ theme }),
        })),
      },
    },
    {
      label: t('Frame'),
      icon: Square,
      submenu: {
        title: t('Frame'),
        items: FRAMES.map(([frame, label]) => ({
          label: label(),
          checked: settings.frame === frame,
          onPreview: preview({ frame }),
          onClick: () => change({ frame }),
        })),
      },
    },
    {
      label: t('Background'),
      icon: Blend,
      submenu: {
        title: t('Background'),
        items: BACKGROUNDS.map((background) => ({
          label: percentText(background),
          checked: settings.background === background,
          onPreview: preview({ background }),
          onClick: () => change({ background }),
        })),
      },
    },
    {
      label: t('Size'),
      icon: Scaling,
      submenu: {
        title: t('Size'),
        items: SIZES.map((size) => ({
          label: percentText(size),
          checked: settings.size === size,
          onPreview: preview({ size }),
          onClick: () => change({ size }),
        })),
      },
    },
    { label: t('Hardware settings…'), icon: Settings, divider: true, onClick: () => void send('settings') },
    { label: t('Hide widget'), icon: EyeOff, onClick: () => void send('choice', { hide: true }) },
  ]

  if (!ready || closing) return null
  return <ContextMenu x={mouseX / devicePixelRatio} y={mouseY / devicePixelRatio} items={items} onClose={() => setClosing(true)} />
}

applyAppearance(loadAppearance()) // the app's scale, font and animations setting
startClosingAnimations()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HardwareMenu />
  </StrictMode>,
)
