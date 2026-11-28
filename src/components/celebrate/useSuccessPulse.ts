import { useCallback, useRef } from 'react'
import { celebrate, type CelebrateKind } from './celebrate'

/**
 * Ref-based wrapper around celebrate() for a button you own:
 *
 *   const { ref, pulse } = useSuccessPulse()
 *   <button ref={ref} ...>
 *   if (result.ok) pulse('complete')
 */
export function useSuccessPulse<T extends HTMLElement = HTMLButtonElement>() {
  const ref = useRef<T>(null)
  const pulse = useCallback((kind: CelebrateKind = 'save') => celebrate(ref.current, kind), [])
  return { ref, pulse }
}
