// A short message in SyncR's own window (Dialog with OK), for code outside React (image errors,
// a link to a deleted note). The main window's App shows it; elsewhere (no App listening) the
// browser's own box is the fallback.

type Show = (title: string, message: string) => void
let shower: Show | null = null

export function onAppMessage(show: Show) {
  shower = show
  return () => {
    if (shower === show) shower = null
  }
}

export function showAppMessage(title: string, message: string) {
  if (shower) shower(title, message)
  else window.alert(message)
}
