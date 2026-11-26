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
