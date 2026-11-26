/**
 * Shared first-run state between the setup wizard, the tour and the install banner.
 *
 * - 'unknown': the wizard has not checked yet. The tour waits.
 * - 'open': the wizard is showing, or was put off with "Finish later". The tour waits.
 * - 'closed': setup is done or skipped. `tour` says what the member picked on the last step:
 *   'start' (take the tour now), 'skip' (no tour) or 'auto' (setup was already done earlier,
 *   so the tour follows its own saved progress).
 */
export type SetupGate = { status: 'unknown' | 'open' | 'closed'; tour: 'start' | 'skip' | 'auto' }

const changeEvent = 'workspace-setup-gate'
const openEvent = 'workspace-setup-open'
let gate: SetupGate = { status: 'unknown', tour: 'auto' }

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
