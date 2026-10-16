import { useEffect, useState } from 'react'

// True on a phone-sized screen (same breakpoint as the CSS), updated when the window is resized
export function useNarrow() {
  const query = '(max-width: 699px)'
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const update = () => setNarrow(list.matches)
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [])
  return narrow
}
