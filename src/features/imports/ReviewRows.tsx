import type { ReactNode } from 'react'
import { EmptyResults, ListToolbar, useListFilter } from '../../components/list'

type Row = { record: number; operation: string; errors: string[] }

/**
 * An import preview can run to hundreds of rows. Search them, show only rows with problems,
 * or only one kind of change. Small previews (10 rows or fewer) render as a plain list.
 */
export function ReviewRows<T extends Row>({ rows, text, operationLabel, render }: {
  rows: T[]
  text: (row: T) => (string | null | undefined)[]
  operationLabel: (operation: string) => string
  render: (row: T) => ReactNode
}) {
  const list = useListFilter(rows, {
    text: row => ['row ' + row.record, ...text(row), ...row.errors],
    filters: [
      { key: 'errors', label: 'Problems', get: row => row.errors.length ? 'errors' : 'ok', options: [{ value: 'errors', label: 'Rows with errors' }, { value: 'ok', label: 'Rows without errors' }] },
      { key: 'operation', label: 'Change', get: row => row.operation, options: [...new Set(rows.map(row => row.operation))].map(value => ({ value, label: operationLabel(value) })) },
    ],
  })
  if (rows.length <= 10) return <ol>{rows.map(render)}</ol>
  return <>
    <ListToolbar filter={list} label="Search import rows" placeholder="Search a name, email, title or row number" noun={['row', 'rows']} sticky={false} />
    {list.results.length ? <ol>{list.results.map(render)}</ol> : <EmptyResults query={list.query} noun="rows" onClear={list.clear} />}
  </>
}
