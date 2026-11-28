import { useEffect, useState } from 'react'

/** Lists that only stagger the first time they appear in this session (pages people revisit often). */
const seen = new Set<string>()

/**
 * `.list-enter` stagger for a list that appears after a load, once per mount.
 * Returns the class while the list first appears, then drops it, so background refreshes,
 * re-renders and later additions never replay the cascade. Pass `ready` once the rows are in.
 * With `sessionKey`, the list staggers only on its first appearance this session: hubs and other
 * pages visited many times a day shouldn't animate on every visit.
 * Reduced motion is handled in motion.css (the animation is switched off there).
 */
export function useListEnter(ready: boolean, sessionKey?: string): string {
  const [phase, setPhase] = useState<'waiting' | 'entering' | 'done'>(() => sessionKey && seen.has(sessionKey) ? 'done' : 'waiting')
  if (ready && phase === 'waiting') {
    if (sessionKey) seen.add(sessionKey)
    setPhase('entering')
  }
  useEffect(() => {
    if (phase !== 'entering') return
    // Longest stagger delay (150ms) + rise (200ms), with room to spare.
    const timer = setTimeout(() => setPhase('done'), 500)
    return () => clearTimeout(timer)
  }, [phase])
  return phase === 'entering' ? 'list-enter' : ''
}
