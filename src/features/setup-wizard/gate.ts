/**
 * Shared first-run state between the setup wizard, the tour and the install banner.
 * First run is: tour, then setup (the wizard waits for the tour, see tutorial/events).
 *
 * - 'unknown': the wizard has not checked yet.
 * - 'open': setup isn't finished: it is waiting for the tour, showing, or put off with "Finish later".
 *   The tour's last stop then points to setup, and the install banner waits.
 * - 'closed': setup is done.
 */
export type SetupGate = { status: 'unknown' | 'open' | 'closed' }

const changeEvent = 'workspace-setup-gate'
const openEvent = 'workspace-setup-open'
let gate: SetupGate = { status: 'unknown' }

export function readSetupGate(): SetupGate { return gate }

export function setSetupGate(next: SetupGate): void {
  gate = next
  window.dispatchEvent(new Event(changeEvent))
}

export function onSetupGate(listener: () => void): () => void {
  window.addEventListener(changeEvent, listener)
  return () => window.removeEventListener(changeEvent, listener)
}

/** "Set up again" from the avatar menu or Account. */
export function openSetup(): void { window.dispatchEvent(new Event(openEvent)) }
export const setupOpenEvent = openEvent
