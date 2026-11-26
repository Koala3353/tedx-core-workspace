import type { HubSlot } from '../../app/hubs/slots'

/** Ready-made Event hub entries. Integrator: hubSlots['event.contestBoard'] = contestBoardSlot, etc. */
export const contestBoardSlot: HubSlot = {
  label: 'Online contest',
  description: 'Feb 28 to Mar 12. What\'s due, who runs it, and the run checklist.',
  href: '/event/online-contest',
}
export const tedifyBoardSlot: HubSlot = {
  label: 'TEDify',
  description: 'Mar 20. Breakout sessions, what\'s due and the run checklist.',
  href: '/event/tedify',
}
