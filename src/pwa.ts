import { isTauri } from '@tauri-apps/api/core'

// Phone / browser version only (the desktop app has its own updater, see updater.ts).
// Registers the service worker (src/sw.js) and calls onUpdate when a new version is ready.
// The new version starts only when apply() is called (the user taps "Reload").
export function registerServiceWorker(onUpdate: (apply: () => void) => void) {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD || isTauri()) return

  let applying = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Also fires on the very first install, where no reload is needed
    if (applying) location.reload()
  })

  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
    const offer = (worker: ServiceWorker) =>
      onUpdate(() => {
        applying = true
        worker.postMessage('skip-waiting')
      })

    // A new version was already downloaded earlier
    if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting)

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', () => {
        // "installed" with an existing controller = a new version, not the first install
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker)
      })
    })

    // Look for a new version whenever the app comes back to the foreground
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {})
    })
  })
}
