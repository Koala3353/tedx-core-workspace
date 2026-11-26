import type { ReactNode } from 'react'
import './shared.css'

/** One collapsed place for rules and fine print, so pages lead with the work instead of disclaimers. */
export function HowThisWorks({ title = 'How this works', children }: { title?: string; children: ReactNode }) {
  return <details className="how-this-works"><summary>{title}</summary><div className="how-this-works__body">{children}</div></details>
}
