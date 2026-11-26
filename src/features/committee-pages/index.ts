export { CommitteeIndexPage, CommitteePage, CommitteePage as CommitteeOnePage } from './CommitteePages'
export { createCommitteePagesApi, type CommitteePagesApi } from './api'
export { committeeContent, contentForCode, type CommitteeContent } from './content'
export { createBoardReader, BoardUnavailable, type Board, type BoardUnit, type BoardDeliverable, type BoardAsk } from './board'

/** Hub slot entry for `team.committeePages` (src/app/hubs/slots.tsx). */
export const committeePagesSlot = { label: 'Committees', description: 'What each committee does, who leads it and what it is working on.', href: '/team/committees' } as const
