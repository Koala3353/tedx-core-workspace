import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import './shared.css'

/** Secondary actions (exports, alternate views) tucked behind a "More" disclosure. */
export function OverflowMenu({ label = 'More actions', children }: { label?: string; children: ReactNode }) {
  return <details className="overflow-menu"><summary className="icon-button" aria-label={label} title={label}><MoreHorizontal size={18} strokeWidth={1.75} aria-hidden="true" /></summary><div className="overflow-menu__items">{children}</div></details>
}
