import type { ReactNode } from 'react'
import type { NavigationCapability } from '../navigation'
import { TeamSetupCard } from '../../features/team-setup'
import { warRoomSlot } from '../../features/war-room'
import { whoToAskSlot } from '../../features/who-to-ask'
import { committeePagesSlot } from '../../features/committee-pages'
import { contestBoardSlot, tedifyBoardSlot } from '../../features/event-boards'

/**
 * Named places in the tab hubs. Empty slots render nothing. Each slot holds one entry or a
 * short list; an entry is a link (`href`), embedded content (`element`), or both.
 */
export type HubSlotName =
  | 'event.warRoom'
  | 'event.runOfShow'
  | 'event.contestBoard'
  | 'event.tedifyBoard'
  | 'team.setup'
  | 'team.whoToAsk'
  | 'team.committeePages'
  | 'desk.tools'

export type HubSlot = {
  label: string
  description: string
  href?: string
  /** Show only to people with this capability. */
  capability?: NavigationCapability
  /** Show to people with any one of these capabilities. */
  anyCapability?: readonly NavigationCapability[]
  /** Icon id from src/app/navIcons.ts; defaults to the slot name. */
  icon?: string
  element?: ReactNode
}

const rosterManagers = ['roles.manage', 'admin.configure'] as const

export const hubSlots: Partial<Record<HubSlotName, HubSlot | readonly HubSlot[]>> = {
  'event.warRoom': warRoomSlot,
  'event.runOfShow': { label: 'Run of show', description: 'The event-day running order, and the live stage view on the day.', href: '/event/run-of-show' },
  'event.contestBoard': contestBoardSlot,
  'event.tedifyBoard': tedifyBoardSlot,
  'team.setup': { label: 'Team setup', description: 'Who has signed in, installed the app and finished the tour.', anyCapability: rosterManagers, element: <TeamSetupCard /> },
  'team.whoToAsk': whoToAskSlot,
  'team.committeePages': committeePagesSlot,
  'desk.tools': [
    { label: 'Team setup', description: 'Add people, check who has signed in and send reminders', href: '/team/setup', anyCapability: rosterManagers, icon: 'team.setup' },
  ],
}

const allowed = (slot: HubSlot, capabilities: readonly string[]) =>
  (!slot.capability || capabilities.includes(slot.capability))
  && (!slot.anyCapability || slot.anyCapability.some(capability => capabilities.includes(capability)))

export function filledSlots(names: HubSlotName[], capabilities: readonly string[]): (HubSlot & { name: HubSlotName; key: string })[] {
  return names.flatMap(name => {
    const entry = hubSlots[name]
    const list: readonly HubSlot[] = !entry ? [] : Array.isArray(entry) ? entry : [entry as HubSlot]
    return list.flatMap((slot, index) => allowed(slot, capabilities) ? [{ ...slot, name, key: name + ':' + index }] : [])
  })
}
