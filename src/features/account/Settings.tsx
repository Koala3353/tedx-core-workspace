import { useId, type ReactNode } from 'react'
import { Check, MonitorSmartphone, Moon, Sun } from 'lucide-react'
import { setThemeChoice, useTheme, type ThemeChoice } from '../../app/shellServices'
import './settings.css'

/**
 * One Settings section: a heading and a line on what it is for, then its controls.
 * Side by side on wide screens, stacked on phones.
 */
export function SettingsSection({ id, title, lead, children }: { id?: string; title: string; lead?: ReactNode; children: ReactNode }) {
  const headingId = useId()
  return <section id={id} className="settings-section" aria-labelledby={headingId}>
    <div className="settings-section__head">
      <h2 id={headingId}>{title}</h2>
      {lead ? <p>{lead}</p> : null}
    </div>
    <div className="settings-section__body">{children}</div>
  </section>
}

const looks: { value: ThemeChoice; label: string; hint: string; icon: typeof Sun }[] = [
  { value: 'dark', label: 'Dark', hint: 'Easy on the eyes at night', icon: Moon },
  { value: 'light', label: 'Light', hint: 'Best in bright rooms', icon: Sun },
  { value: 'system', label: 'Match my device', hint: 'Follows your phone or computer', icon: MonitorSmartphone },
]

/** Theme choice. The same stored choice as the setup wizard and the account menu toggle; it applies right away. */
export function ThemeSettings() {
  const { choice } = useTheme()
  const name = useId()
  return <fieldset className="theme-choices">
    <legend className="visually-hidden">Theme</legend>
    {looks.map(look => <label key={look.value} className="theme-choice">
      <input type="radio" name={name} value={look.value} checked={choice === look.value} onChange={() => setThemeChoice(look.value)} />
      <span className={`theme-choice__swatch theme-choice__swatch--${look.value}`} aria-hidden="true"><span /><span /><span /></span>
      <span className="theme-choice__text">
        <span className="theme-choice__label"><look.icon className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />{look.label}</span>
        <span className="theme-choice__hint">{look.hint}</span>
      </span>
      <Check className="icon theme-choice__tick" size={18} strokeWidth={2} aria-hidden="true" />
    </label>)}
  </fieldset>
}
