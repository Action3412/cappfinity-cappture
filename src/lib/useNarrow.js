import { useEffect, useState } from 'react'
// True below the phone breakpoint. Shared by My week and the Reports drill-down.
export default function useNarrow(px = 720) {
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${px}px)`).matches)
  useEffect(() => { const mq = window.matchMedia(`(max-width: ${px}px)`); const h = (e) => setN(e.matches); mq.addEventListener('change', h); return () => mq.removeEventListener('change', h) }, [px])
  return n
}
