import { useId, type ReactNode } from 'react'
import { CircleDashed, TriangleAlert } from 'lucide-react'
import { SkeletonRows } from './BrandLoader'

type FeedbackProps = { title: string; description: string; action?: ReactNode }
type EmptyProps = FeedbackProps & {
  /** A spot illustration from components/illustrations, e.g. <EmptyTasks />. Without one, the small dashed icon shows. */
  illustration?: ReactNode
  /** Heading level for the title; use 3 inside a section that already has an h2. */
  level?: 2 | 3
}

/** Nothing here yet: what will appear, and the next step (or who to ask). */
export function EmptyState({ title, description, action, illustration, level = 2 }: EmptyProps) {
  const id = useId()
  const Heading = level === 3 ? 'h3' : 'h2'
  if (illustration) return <section className={`feedback-state feedback-state--illustrated${level === 3 ? ' feedback-state--section' : ''}`} aria-labelledby={id}>
    <div className="feedback-state__art">{illustration}</div>
    <Heading id={id}>{title}</Heading><p>{description}</p>{action}
  </section>
  return <section className="feedback-state" aria-labelledby={id}><CircleDashed className="icon" size={20} strokeWidth={1.5} aria-hidden="true" /><Heading id={id}>{title}</Heading><p>{description}</p>{action}</section>
}

export function ErrorState({ title, description, action }: FeedbackProps) {
  const id = useId()
  return <section className="feedback-state feedback-state--error" aria-labelledby={id} role="alert"><TriangleAlert className="icon" size={20} strokeWidth={1.5} aria-hidden="true" /><h2 id={id}>{title}</h2><p>{description}</p>{action}</section>
}

/** In-page loading: a short red line drawing beside the label, then skeleton rows. */
export function LoadingState({ title = 'Opening this page', rows = 3 }: { title?: string; rows?: number }) {
  return (
    <div className="feedback-state feedback-state--loading" role="status" aria-live="polite">
      <p className="loading-label"><span className="loading-line" aria-hidden="true" />{title}</p>
      <SkeletonRows rows={rows} />
    </div>
  )
}
