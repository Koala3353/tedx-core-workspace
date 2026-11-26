import type { createSupabaseClient } from '../../lib/supabase'
import { createBoardReader, findUnit, type Board, type BoardService, type BoardUnit } from '../committee-pages/board'
import type { Need } from './topics'

export interface WhoToAskApi {
  /** Committees with their heads, contacts and ready request services. Throws BoardUnavailable until deployed. */
  board(termId: string): Promise<Board>
}

export function createWhoToAskApi(ready: ReturnType<typeof createSupabaseClient>): WhoToAskApi {
  return { board: createBoardReader(ready) }
}

/** The live committee for a need: the first of its codes that exists this term. */
export function resolveNeed(need: Need, units: readonly BoardUnit[]): BoardUnit | null {
  return findUnit(units, need.codes)
}

/** The committee's request service that best fits the need (by keyword), else its first one. */
export function bestService(unit: BoardUnit, keywords: readonly string[]): BoardService | null {
  if (!unit.services.length) return null
  const text = (s: BoardService) => (s.label + ' ' + s.need).toLowerCase()
  return unit.services.find(s => keywords.some(k => text(s).includes(k.toLowerCase()))) ?? unit.services[0]
}
