// SyncR's loading icon: a turning blue ring with a gap, like the cloud button's while syncing
// (SyncButton.tsx). Use it wherever something is loading.
function Spinner({ size = 15, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label}>
      <circle cx="8" cy="8" r="5.5" />
    </svg>
  )
}

export default Spinner
