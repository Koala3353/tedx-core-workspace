export { WarRoomPage } from './WarRoomPage'
export { createWarRoomApi, type WarRoomApi } from './api'
export { buildWarRoom, health, milestones, eventDay } from './model'

/** Hub slot entry for `event.warRoom` (src/app/hubs/slots.tsx). */
export const warRoomSlot = { label: 'War room', description: 'Every deliverable at risk, by committee and week.', href: '/event/war-room' } as const
