import { useEffect, useRef, useState } from 'react'
import { AppWindow, Blend, EyeOff, Fullscreen, Lock, MoveHorizontal, Palette, Pin, Scaling, Settings, SunDim } from 'lucide-react'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { SIZES } from './hardware'
import { percentText, t } from './i18n'
import { BACKGROUNDS, SHOW_AS, type SpotifyMenuChoice, type SpotifySettings, storedSpotify } from './spotify'
import type { MenuProps } from './widgetMenu'

// The Spotify strip's and widget's right-click menu, in the widgets' menu page (widgetMenu.tsx).
// The strip's: Show as, and Spotify settings…. The widget's adds its own options in titled groups
// (Window, Appearance: .claude/mockups/spotify-menu.html, B), with the Hardware widget's words and
// order where they match. Each change goes to the main window, which saves it
// (spotify.ts).
export default function SpotifyMenu({ x, y, send, onClose, widget }: MenuProps<SpotifyMenuChoice> & { widget: boolean }) {
  const [settings, setSettings] = useState<SpotifySettings>(storedSpotify)
  const change = (part: Partial<SpotifySettings>) => {
    setSettings((now) => ({ ...now, ...part }))
    void send('choice', { change: part })
  }
  // A background or size under the mouse shows on the widget at once. Leaving waits a moment, so
  // going from one to the next doesn't flash the saved one in between.
  const back = useRef<number | undefined>(undefined)
  const preview = (part: Partial<SpotifySettings>) => (on: boolean) => {
    clearTimeout(back.current)
    if (on) void send('choice', { preview: part })
    else back.current = window.setTimeout(() => void send('choice', { preview: null }), 100)
  }
  useEffect(() => () => clearTimeout(back.current), [])

  const showAs: MenuItem = {
    label: t('Show as'),
    icon: AppWindow,
    submenu: {
      title: t('Show as'),
      items: SHOW_AS.map(([showAs, name]) => ({ label: name(), checked: settings.showAs === showAs, onClick: () => change({ showAs }) })),
    },
  }
  const spotifySettings: MenuItem = { label: t('Spotify settings…'), icon: Settings, divider: true, onClick: () => void send('settings') }
  const items: MenuItem[] = !widget
    ? [showAs, spotifySettings]
    : [
        showAs,
        { label: t('Always on top'), icon: Pin, divider: true, section: t('Window'), checked: settings.onTop, onClick: () => change({ onTop: !settings.onTop }) },
        { label: t('Hide during full screen'), icon: Fullscreen, disabled: !settings.onTop, hint: settings.onTop ? undefined : t('Only when it’s always on top'), checked: settings.hideFullScreen, onClick: () => change({ hideFullScreen: !settings.hideFullScreen }) },
        { label: t('Lock position and size'), icon: Lock, checked: settings.locked, onClick: () => change({ locked: !settings.locked }) },
        { label: t('Fade when paused'), icon: SunDim, checked: settings.fadePaused, onClick: () => change({ fadePaused: !settings.fadePaused }) },
        { label: t('Colors from the cover'), icon: Palette, divider: true, section: t('Appearance'), checked: settings.coverColors, onClick: () => change({ coverColors: !settings.coverColors }) },
        { label: t('Scroll long names'), icon: MoveHorizontal, checked: settings.scrollNames, onClick: () => change({ scrollNames: !settings.scrollNames }) },
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
        spotifySettings,
        { label: t('Hide widget'), icon: EyeOff, onClick: () => void send('choice', { hide: true }) },
      ]
  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />
}
