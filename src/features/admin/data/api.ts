import type { createSupabaseClient } from '../../../lib/supabase'

// Read-only datasets for the admin Data page (public.read_admin_dataset). Full admins only, checked on the server.

export const datasets = [
  { id: 'people', label: 'People' },
  { id: 'committees', label: 'Committees' },
  { id: 'positions', label: 'Positions' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'deliverables', label: 'Deliverables' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'activity', label: 'Activity' },
] as const
export type DatasetId = typeof datasets[number]['id']
export type ColumnType = 'text' | 'number' | 'bool' | 'date' | 'datetime'
export type Column = { key: string; label: string; type: ColumnType }
export type Cell = string | number | boolean | null
export type Dataset = { dataset: DatasetId; columns: Column[]; rows: Record<string, Cell>[]; truncated: boolean; readAt: string }
export type DataFailure = 'denied' | 'unavailable'
export class DataError extends Error {
  readonly code: DataFailure
  constructor(code: DataFailure) { super(code); this.name = 'DataError'; this.code = code }
}
export interface AdminDataApi { read(termId: string, dataset: DatasetId): Promise<Dataset> }

const types: readonly ColumnType[] = ['text', 'number', 'bool', 'date', 'datetime']
const isCell = (v: unknown): v is Cell => v === null || ['string', 'number', 'boolean'].includes(typeof v)

export function parseDataset(value: unknown, wanted: DatasetId): Dataset | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.dataset !== wanted || !Array.isArray(v.columns) || !Array.isArray(v.rows) || typeof v.truncated !== 'boolean' || typeof v.readAt !== 'string') return null
  const columns = v.columns as Column[]
  if (!columns.every(c => c && typeof c.key === 'string' && typeof c.label === 'string' && types.includes(c.type))) return null
  const keys = columns.map(c => c.key)
  const rows: Record<string, Cell>[] = []
  for (const raw of v.rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const row: Record<string, Cell> = {}
    for (const key of keys) {
      const cell = (raw as Record<string, unknown>)[key]
      if (cell !== undefined && !isCell(cell)) return null
      row[key] = cell ?? null
    }
    rows.push(row)
  }
  return { dataset: wanted, columns, rows, truncated: v.truncated, readAt: v.readAt }
}

export function createAdminDataApi(ready: ReturnType<typeof createSupabaseClient> | Promise<null>): AdminDataApi {
  return {
    async read(termId, dataset) {
      const client = await ready
      if (!client) throw new DataError('unavailable')
      // Newer than the generated database types, so call it untyped (as team-setup does).
      const rpc = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>
      const { data, error } = await rpc('read_admin_dataset', { p_term_id: termId, p_dataset: dataset })
      if (error) throw new DataError(error.code === '42501' || /permission/.test(error.message) ? 'denied' : 'unavailable')
      const parsed = parseDataset(data, dataset)
      if (!parsed) throw new DataError('unavailable')
      return parsed
    },
  }
}
