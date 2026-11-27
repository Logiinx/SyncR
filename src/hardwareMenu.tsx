import { useEffect, useRef, useState } from 'react'
import { Blend, EyeOff, Flame, RotateCcw, LayoutList, ListChecks, Lock, MousePointerClick, Palette, Pin, Scaling, Settings, Square, Thermometer, Timer } from 'lucide-react'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { decimal, percentText, t } from './i18n'
import { BACKGROUNDS, CLICK_THROUGH, FRAMES, type HardwareSettings, LOOKS, type MenuChoice, SIZES, SPEEDS, THEMES, WIDGET_GROUPS, clickThroughAbout, groupName, peaksAbout, sensorLabel, storedHardware } from './hardware'
import type { MenuProps } from './widgetMenu'

// The Hardware widget's right-click menu, in the widgets' menu page (widgetMenu.tsx). It reads the
// settings saved on this device (same origin as the main window) and sends each change to the
// main window, which saves it (hardware.ts).
export default function HardwareMenu({ x, y, send, onClose }: MenuProps<MenuChoice>) {
  const [settings, setSettings] = useState<HardwareSettings>(storedHardware)

  const change = (part: Partial<HardwareSettings>) => {
    setSettings((now) => ({ ...now, ...part }))
    void send('choice', { change: part })
  }
  // A look, theme, frame, background or size under the mouse shows on the widget at once. Leaving waits a moment, so
  // going from one to the next doesn't flash the saved one in between.
  const back = useRef<number | undefined>(undefined)
  const preview = (part: Partial<HardwareSettings>) => (on: boolean) => {
    clearTimeout(back.current)
    if (on) void send('choice', { preview: part })
    else back.current = window.setTimeout(() => void send('choice', { preview: null }), 100)
  }
  useEffect(() => () => clearTimeout(back.current), [])

  // Every reading, under its hardware's name, as in Settings → Hardware
  const shown = WIDGET_GROUPS.flatMap(({ icon, sensors }) =>
    sensors.map((sensor, index): MenuItem => ({
      label: sensorLabel(sensor),
      section: index === 0 ? groupName(icon) : undefined,
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
    { label: t('Hot colors'), icon: Flame, checked: settings.hot, onClick: () => change({ hot: !settings.hot }) },
    { label: t('Reset peaks'), icon: RotateCcw, hint: peaksAbout(), onClick: () => void send('choice', { resetPeaks: true }) },
    {
      label: t('Look'),
      icon: LayoutList,
      divider: true,
      submenu: {
        title: t('Look'),
        items: LOOKS.map(([look, label]) => ({
          label: label(),
          checked: settings.look === look,
          onPreview: preview({ look }),
          onClick: () => change({ look }),
        })),
      },
    },
    {
      label: t('Theme'),
      icon: Palette,
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

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />
}
