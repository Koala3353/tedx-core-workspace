import { useEffect, useState } from 'react'

/** True once `active` has stayed true for `delayMs`; false again as soon as it ends. */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => setLate(true), delayMs)
    return () => { clearTimeout(timer); setLate(false) }
  }, [active, delayMs])
  return active && late
}
