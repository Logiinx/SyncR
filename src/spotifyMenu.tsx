import { useState } from 'react'
import { AppWindow, Settings } from 'lucide-react'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { t } from './i18n'
import { SHOW_AS, type SpotifyMenuChoice, type SpotifySettings, storedSpotify } from './spotify'
import type { MenuProps } from './widgetMenu'

// The Spotify strip's and widget's right-click menu, in the widgets' menu page (widgetMenu.tsx):
// Show as, and Spotify settings… (the widget's own options come later). Each change goes to the
// main window, which saves it (spotify.ts).
export default function SpotifyMenu({ x, y, send, onClose }: MenuProps<SpotifyMenuChoice>) {
  const [settings, setSettings] = useState<SpotifySettings>(storedSpotify)
  const change = (part: Partial<SpotifySettings>) => {
    setSettings((now) => ({ ...now, ...part }))
    void send('choice', { change: part })
  }

  const items: MenuItem[] = [
    {
      label: t('Show as'),
      icon: AppWindow,
      submenu: {
        title: t('Show as'),
        items: SHOW_AS.map(([showAs, name]) => ({ label: name(), checked: settings.showAs === showAs, onClick: () => change({ showAs }) })),
      },
    },
    { label: t('Spotify settings…'), icon: Settings, divider: true, onClick: () => void send('settings') },
  ]
  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />
}
