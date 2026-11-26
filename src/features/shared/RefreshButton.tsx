import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { formatTime } from './dates'
import './shared.css'

/** The one remaining manual refresh: a small quiet icon button. Its title carries the last-updated time. */
export function RefreshButton({ onRefresh, disabled = false, updatedAt }: { onRefresh: () => void; disabled?: boolean; updatedAt?: Date | string | number | null }) {
  const [clickedAt, setClickedAt] = useState<number | null>(null)
  const stamp = updatedAt ?? clickedAt
  const title = stamp ? `Refresh · updated ${formatTime(stamp)}` : 'Refresh'
  return <button type="button" className="icon-button refresh-button" aria-label="Refresh" title={title} disabled={disabled} onClick={() => { setClickedAt(Date.now()); onRefresh() }}><RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" /></button>
}
