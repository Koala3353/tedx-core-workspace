/** Fired to start the first-run tour again from step one. */
export const replayEvent = 'workspace-tour-replay'

export function replayTour(): void { window.dispatchEvent(new Event(replayEvent)) }

/** Bump when the stops change enough that everyone should see the tour again. */
export const tutorialVersion = 1

/** Whether a tour bubble is showing or about to. The phone install banner waits for it. */
const activeEvent = 'workspace-tour-active'
let active = false
export function tourActive(): boolean { return active }
export function setTourActive(value: boolean): void {
  if (active === value) return
  active = value
  window.dispatchEvent(new Event(activeEvent))
}
export function onTourActive(listener: () => void): () => void {
  window.addEventListener(activeEvent, listener)
  return () => window.removeEventListener(activeEvent, listener)
}

/**
 * Whether the first-run tour is out of the way for now: already done, just finished or skipped,
 * or it couldn't run. A member's first-run setup wizard opens once this is true.
 */
const settledEvent = 'workspace-tour-settled'
let settled = false
export function tourSettled(): boolean { return settled }
export function setTourSettled(value: boolean): void {
  if (settled === value) return
  settled = value
  window.dispatchEvent(new Event(settledEvent))
}
export function onTourSettled(listener: () => void): () => void {
  window.addEventListener(settledEvent, listener)
  return () => window.removeEventListener(settledEvent, listener)
}
