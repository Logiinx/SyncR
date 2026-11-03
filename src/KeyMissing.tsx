import Dialog from './Dialog'
import { startFresh } from './localDb'

// Shown instead of the app when the notes on this PC are sealed (sealing.ts) but Windows didn't
// give back their key (localDb.ts), e.g. after Windows was reinstalled. "Try again" (or closing it) reloads.
function KeyMissing() {
  let starting = false
  return (
    <Dialog
      request={{
        title: "Notes on this PC can't be opened",
        message:
          "Windows didn't give back the key that unlocks SyncR's notes on this PC (for example after Windows was reinstalled). " +
          'Your synced notes are safe in Dropbox: "Start fresh" downloads them again, but changes that weren\'t synced yet are lost.',
        cancelLabel: 'Try again',
        confirmLabel: 'Start fresh',
        danger: true,
        onConfirm: () => {
          starting = true
          void startFresh().finally(() => location.reload())
        },
      }}
      onClose={() => !starting && location.reload()}
    />
  )
}

export default KeyMissing
