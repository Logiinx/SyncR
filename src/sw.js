// SyncR service worker (phone / browser version only, not the desktop app).
// Keeps the app's files on the device, so the installed app opens without internet.
// Not used as-is: the build turns it into dist/sw.js with VERSION and FILES filled in
// (see serviceWorker() in vite.config.ts).

const VERSION = '__VERSION__'
const FILES = __FILES__
const CACHE = `syncr-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)))
  // No skipWaiting() here: a new version waits until the user taps "Reload" (see pwa.ts)
})

self.addEventListener('activate', (event) => {
  // Remove the files of older versions
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('syncr-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  // Dropbox and other sites: always straight to the network
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return

  if (request.mode === 'navigate') {
    // Opening the app (also coming back from the Dropbox sign-in with ?code=…): the saved app
    const index = new URL('index.html', self.registration.scope).href
    event.respondWith(caches.match(index, { ignoreVary: true }).then((cached) => cached ?? fetch(request)))
    return
  }
  // ignoreVary: the saved copy fits even if the server said it depends on request headers
  event.respondWith(caches.match(request, { ignoreVary: true }).then((cached) => cached ?? fetch(request)))
})
