import type { ReactNode } from 'react'
import { useRevealOnMount } from './useReveal'

/**
 * Wrap a panel/editor that is rendered conditionally after a click. When it mounts it fades in,
 * scrolls into view if it opened off-screen, and takes focus on its heading; when it unmounts,
 * focus goes back to the button that opened it.
 */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRevealOnMount<HTMLDivElement>()
  return <div ref={ref} className={`reveal-enter ${className}`.trim()}>{children}</div>
}
