/** Fired to start the first-run tour again from step one. */
export const replayEvent = 'workspace-tour-replay'

export function replayTour(): void { window.dispatchEvent(new Event(replayEvent)) }

/** Bump when the stops change enough that everyone should see the tour again. */
export const tutorialVersion = 1
