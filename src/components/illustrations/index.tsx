import type { ReactNode } from 'react'
import './illustrations.css'

/**
 * Spot illustrations for empty states. Line art in currentColor (muted grey from the parent),
 * one small accent in the brand red. Decorative only: always aria-hidden.
 */
export type IllustrationProps = { size?: number; className?: string }

function Art({ size = 112, className, children }: IllustrationProps & { children: ReactNode }) {
  return <svg className={`illo${className ? ' ' + className : ''}`} viewBox="0 0 120 96" width={size} height={Math.round(size * 0.8)}
    fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path className="illo-soft" d="M18 88h84" />
    {children}
  </svg>
}
/** Zero-length strokes with round caps draw as dots. */
const Dots = ({ d, className }: { d: string; className?: string }) => <path className={className} d={d} strokeWidth={3.5} />

export const EmptyInbox = (p: IllustrationProps) => <Art {...p}>
  <path d="M24 54 36 28h48l12 26v20a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4Z" />
  <path d="M24 54h20l4 8h24l4-8h20" />
  <circle className="illo-dot" cx="92" cy="22" r="4" />
</Art>

export const EmptyCalendar = (p: IllustrationProps) => <Art {...p}>
  <rect x="22" y="22" width="76" height="58" rx="5" />
  <path d="M22 36h76M40 16v12M80 16v12" />
  <Dots d="M36 48h0M48 48h0M60 48h0M72 48h0M84 48h0M36 60h0M48 60h0M60 60h0M72 60h0M84 60h0M36 72h0M48 72h0M60 72h0" />
  <path className="illo-accent" d="M74 68l8 8m0-8-8 8" />
</Art>

export const EmptyTasks = (p: IllustrationProps) => <Art {...p}>
  <rect x="32" y="18" width="56" height="66" rx="5" />
  <rect x="48" y="13" width="24" height="10" rx="3" />
  <rect x="42" y="34" width="8" height="8" rx="2" /><rect x="42" y="50" width="8" height="8" rx="2" /><rect x="42" y="66" width="8" height="8" rx="2" />
  <path d="M56 38h22M56 54h18M56 70h12" />
  <path className="illo-accent" d="M96 66v12m-6-6h12" />
</Art>

export const EmptyLinks = (p: IllustrationProps) => <Art {...p}>
  <rect x="30" y="48" width="36" height="16" rx="8" transform="rotate(-45 48 56)" />
  <rect x="52" y="26" width="36" height="16" rx="8" transform="rotate(-45 70 34)" />
  <path className="illo-accent" d="M96 66v12m-6-6h12" />
</Art>

export const EmptySearch = (p: IllustrationProps) => <Art {...p}>
  <circle cx="52" cy="44" r="22" />
  <path d="m68 60 18 18" strokeWidth={3} />
  <path className="illo-accent" d="m46 38 12 12m0-12-12 12" />
</Art>

export const EmptyPeople = (p: IllustrationProps) => <Art {...p}>
  <circle cx="48" cy="38" r="10" />
  <path d="M30 78a18 18 0 0 1 36 0" />
  <circle cx="77" cy="46" r="8" />
  <path d="M68 66a12 12 0 0 1 20 12" />
  <circle className="illo-dot" cx="94" cy="28" r="3.5" />
</Art>

export const EmptyBoard = (p: IllustrationProps) => <Art {...p}>
  <rect x="18" y="18" width="84" height="62" rx="5" />
  <path d="M46 18v62M74 18v62M24 28h14M52 28h14M80 28h14" />
  <rect x="24" y="36" width="16" height="12" rx="2" strokeDasharray="3 3" />
  <rect className="illo-accent" x="52" y="36" width="16" height="12" rx="2" strokeDasharray="3 3" />
  <rect x="80" y="36" width="16" height="12" rx="2" strokeDasharray="3 3" />
</Art>

export const AllDone = (p: IllustrationProps) => <Art {...p}>
  <circle cx="60" cy="46" r="28" />
  <path className="illo-accent" d="m47 47 9 9 17-18" strokeWidth={2.25} />
</Art>

export const NothingShared = (p: IllustrationProps) => <Art {...p}>
  <path d="M22 30a4 4 0 0 1 4-4h18l6 7h44a4 4 0 0 1 4 4v39a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4Z" />
  <path d="M22 42h76" />
  <path className="illo-accent" d="M50 62h20m-7-7 7 7-7 7" />
</Art>

export const NotSwitchedOn = (p: IllustrationProps) => <Art {...p}>
  <rect x="30" y="34" width="60" height="28" rx="14" />
  <circle cx="44" cy="48" r="9" />
  <circle className="illo-dot" cx="76" cy="48" r="3" />
</Art>

export const EmptyStage = (p: IllustrationProps) => <Art {...p}>
  <rect x="54" y="10" width="12" height="8" rx="2" />
  <path className="illo-accent" d="M56 20 42 70m22-50 14 50" />
  <ellipse className="illo-accent" cx="60" cy="72" rx="18" ry="3" />
  <path d="M14 80h92" />
</Art>

export const EmptyAnnouncements = (p: IllustrationProps) => <Art {...p}>
  <path d="M30 44v14a3 3 0 0 0 3 3h7l30 14V27L40 41h-7a3 3 0 0 0-3 3Z" />
  <path d="m44 61 4 16h7l-3-14" />
  <path className="illo-accent" d="M80 42a12 12 0 0 1 0 18m6-24a20 20 0 0 1 0 30" />
</Art>

export const EmptyNotifications = (p: IllustrationProps) => <Art {...p}>
  <path d="M42 64V46a18 18 0 0 1 36 0v18l6 8H36Z" />
  <path d="M54 76a6 6 0 0 0 12 0M60 22v6" />
  <circle className="illo-dot" cx="80" cy="30" r="4" />
</Art>

export const EmptyFiles = (p: IllustrationProps) => <Art {...p}>
  <path d="M40 14h28l16 16v50a4 4 0 0 1-4 4H40a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z" />
  <path d="M68 14v16h16M44 46h28M44 56h28" />
  <path className="illo-accent" d="M44 66h14" />
</Art>

export const EmptyComments = (p: IllustrationProps) => <Art {...p}>
  <path d="M24 26a6 6 0 0 1 6-6h52a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H48L36 70V60h-6a6 6 0 0 1-6-6Z" />
  <Dots d="M44 40h0M56 40h0" />
  <Dots className="illo-accent" d="M68 40h0" />
</Art>

export const NoAccess = (p: IllustrationProps) => <Art {...p}>
  <rect x="38" y="42" width="44" height="36" rx="5" />
  <path d="M46 42v-8a14 14 0 0 1 28 0v8" />
  <path className="illo-accent" d="M60 56v8" strokeWidth={2.5} />
</Art>

/** Every illustration, for the contact sheet. */
export const illustrations = { EmptyInbox, EmptyCalendar, EmptyTasks, EmptyLinks, EmptySearch, EmptyPeople, EmptyBoard, AllDone, NothingShared, NotSwitchedOn, EmptyStage, EmptyAnnouncements, EmptyNotifications, EmptyFiles, EmptyComments, NoAccess }
