import type { createSupabaseClient } from '../../lib/supabase'
import { createCalendarApi, type CalendarEvent } from '../calendar/api'
import { createResourcesApi, type Resource } from '../resources/api'
import { addDays } from '../war-room/model'
import { createBoardReader, type Board } from './board'
import { createCommitteeLinksApi, type CommitteeLinksApi } from '../committee-links/api'

/** Includes the committee quick-links methods (flat, so the lazy gateway proxy can forward them). */
export interface CommitteePagesApi extends CommitteeLinksApi {
  /** Committees, people, deliverables and open asks. Throws BoardUnavailable until deployed. */
  board(termId: string): Promise<Board>
  /** The next few calendar items for one committee (its own and workspace-wide), from today. */
  upcoming(termId: string, unitId: string, today: string): Promise<CalendarEvent[]>
  /** Guides pinned to one committee, essential ones first. */
  pinned(termId: string, unitId: string): Promise<Resource[]>
}

const start = (e: CalendarEvent) => e.startsAt ?? (e.startOn ? e.startOn + 'T00:00:00+08:00' : '')

export function createCommitteePagesApi(ready: ReturnType<typeof createSupabaseClient>): CommitteePagesApi {
  const calendar = createCalendarApi(ready)
  const resources = createResourcesApi(ready)
  return {
    ...createCommitteeLinksApi(ready),
    board: createBoardReader(ready),
    async upcoming(termId, unitId, today) {
      const result = await calendar.read(termId, today, addDays(today, 60), unitId, 1)
      return result.items
        .filter(e => e.state === 'confirmed' && (e.unitId === unitId || e.unitId === null))
        .sort((a, b) => start(a).localeCompare(start(b)))
        .slice(0, 5)
    },
    async pinned(termId, unitId) {
      const page = await resources.read(termId)
      return page.items.filter(r => r.unitId === unitId)
        .sort((a, b) => Number(b.essential) - Number(a.essential) || a.label.localeCompare(b.label))
        .slice(0, 6)
    },
  }
}
