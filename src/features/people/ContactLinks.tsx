import { MessageCircle, Send } from 'lucide-react'
import './people.css'
import { contactHandle, contactText, contactUrl, type ContactKind } from './contacts'

const labels: Record<ContactKind, string> = { messenger: 'Messenger', telegram: 'Telegram' }
const icons = { messenger: MessageCircle, telegram: Send } as const

/**
 * Tap-to-open Messenger and Telegram links (m.me and t.me). Renders nothing when neither is set.
 * Accepts stored handles or older free text; anything that isn't a handle is left out.
 */
export function ContactLinks({ name, messenger, telegram }: { name: string; messenger?: string | null; telegram?: string | null }) {
  const items = (['messenger', 'telegram'] as const)
    .map(kind => ({ kind, handle: contactHandle(kind, kind === 'messenger' ? messenger : telegram) }))
    .filter((item): item is { kind: ContactKind; handle: string } => item.handle !== null)
  if (!items.length) return null
  return <span className="contact-links">
    {items.map(({ kind, handle }) => {
      const Icon = icons[kind]
      return <a key={kind} className="button button--secondary contact-link" href={contactUrl(kind, handle)} target="_blank" rel="noopener noreferrer"
        aria-label={`${labels[kind]}: message ${name} (${contactText(kind, handle)})`}>
        <Icon className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />{labels[kind]}
      </a>
    })}
  </span>
}
