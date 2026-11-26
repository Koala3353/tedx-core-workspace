import { needs, topicGroups } from './topics'

export { WhoToAskPage } from './WhoToAskPage'
export { createWhoToAskApi, resolveNeed, bestService, type WhoToAskApi } from './api'
export { needs, topicGroups, matchTopics } from './topics'

/** Hub slot entry for `team.whoToAsk` (src/app/hubs/slots.tsx). */
export const whoToAskSlot = { label: 'Who do I ask?', description: 'Find the committee and person for a poster, a room, money and more.', href: '/team/ask' } as const

export type WhoToAskEntry = { id: string; group: 'Who do I ask'; label: string; detail: string; keywords: string; href: string }

/**
 * Entries for the ⌘K palette: one per "I need…" chip and one per committee topic list.
 * Map each to the palette's Option with `run: () => navigate(entry.href)`.
 */
export function whoToAskEntries(): WhoToAskEntry[] {
  return [
    ...needs.map(n => ({ id: 'ask:' + n.id, group: 'Who do I ask' as const, label: 'I need ' + n.label, detail: 'Who do I ask', keywords: n.keywords.join(' '), href: '/team/ask?need=' + n.id })),
    ...topicGroups.map(g => ({ id: 'ask-topic:' + g.name.toLowerCase(), group: 'Who do I ask' as const, label: 'Ask ' + g.name, detail: g.keywords.slice(0, 4).join(', '), keywords: g.keywords.join(' '), href: '/team/ask?q=' + encodeURIComponent(g.keywords[0]) })),
  ]
}
