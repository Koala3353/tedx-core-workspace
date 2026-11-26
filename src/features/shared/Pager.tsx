import './shared.css'

/** "Previous / Next". Hidden when everything fits on one page. */
export function Pager({ label, page, total, pageSize = 20, onMove }: { label: string; page: number; total: number; pageSize?: number; onMove: (page: number) => void }) {
  if (total <= pageSize && page <= 1) return null
  return <nav className="pager" aria-label={label}>
    <button type="button" className="button button--secondary" disabled={page <= 1} onClick={() => onMove(page - 1)}>Previous</button>
    <span className="muted">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
    <button type="button" className="button button--secondary" disabled={page * pageSize >= total} onClick={() => onMove(page + 1)}>Next</button>
  </nav>
}
