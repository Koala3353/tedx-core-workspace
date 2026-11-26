import type { createSupabaseClient } from '../../lib/supabase'
import { createProcessApi } from '../admin/process/api'
import { createBoardReader, type Board } from '../committee-pages/board'

export interface WarRoomApi {
  /** Throws BoardUnavailable until the coordination migration is deployed. */
  board(termId: string): Promise<Board>
  /** The workspace's current phase title, or null when none is set or it cannot load. */
  phase(termId: string): Promise<string | null>
}

export function createWarRoomApi(ready: ReturnType<typeof createSupabaseClient>): WarRoomApi {
  const process = createProcessApi(ready)
  return {
    board: createBoardReader(ready),
    async phase(termId) {
      try { return (await process.summary(termId)).phase?.title ?? null } catch { return null }
    },
  }
}
