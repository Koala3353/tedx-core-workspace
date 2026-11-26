import { useEffect, useId, useRef, useState } from 'react'
import { Check, Compass, Share, Smartphone, SquarePlus, X } from 'lucide-react'
import { installPlatform, isStandalone, useInstallPrompt } from '../../app/InstallWorkspace'
import { useShellServices } from '../../app/shellServices'
import { safeStorage } from '../../lib/clientState'
import './install.css'

const visitsKey = 'tedx-workspace-visits'
const visitSessionKey = 'tedx-workspace-visit-counted'
const snoozeKey = 'tedx-install-snoozed-until'
const installedKey = 'tedx-install-reported'
const snoozeDays = 14

/** Counts one visit per browser session. Call once from the signed-in shell. */
export function countVisit(): number {
  const current = Number(safeStorage.get(visitsKey)) || 0
  if (safeStorage.session.get(visitSessionKey)) return current
  safeStorage.session.set(visitSessionKey, '1')
  safeStorage.set(visitsKey, String(current + 1))
  return current + 1
}

/**
 * Reports installed state once per browser when the app runs from the home screen.
 * Errors are ignored: the server function may not exist yet.
 */
export function useInstalledReport() {
  const { clientState } = useShellServices()
  useEffect(() => {
    if (!isStandalone() || safeStorage.get(installedKey)) return
    void clientState?.record({ installed: true }).then(result => { if (result) safeStorage.set(installedKey, '1') })
  }, [clientState])
}

function shouldOffer(): boolean {
  if (!import.meta.env.PROD && !safeStorage.get('tedx-install-preview')) return false
  if (isStandalone()) return false
  if ((Number(safeStorage.get(visitsKey)) || 0) < 2) return false
  const until = Number(safeStorage.get(snoozeKey))
  return !(until && until > Date.now())
}

/** Today banner from the second visit until installed or dismissed (snoozes 14 days). */
export function InstallBanner() {
  const { available, install } = useInstallPrompt()
  const [visible, setVisible] = useState(shouldOffer)
  const [sheet, setSheet] = useState(false)
  const [status, setStatus] = useState('')
  const platform = installPlatform(available)

  function dismiss() {
    safeStorage.set(snoozeKey, String(Date.now() + snoozeDays * 86_400_000))
    setVisible(false)
  }

  async function start() {
    if (platform !== 'prompt') { setSheet(true); return }
    const outcome = await install()
    if (outcome === 'accepted') setVisible(false)
    else if (outcome === 'unavailable') setSheet(true)
    else setStatus('You can install any time from Account.')
  }

  if (!visible) return null
  return <>
    <aside className="install-banner" aria-label="Install the app">
      <Smartphone className="icon install-banner__icon" size={20} strokeWidth={1.5} aria-hidden="true" />
      <div className="install-banner__text">
        <strong>Get the TEDx app on your home screen</strong>
        <span>{status || 'Opens faster and sends reminders'}</span>
      </div>
      <button className="button button--secondary install-banner__go" type="button" onClick={() => void start()}>{platform === 'in-app' ? 'How to install' : 'Install'}</button>
      <button className="icon-button install-banner__close" type="button" aria-label="Not now" title="Not now" onClick={dismiss}><X className="icon" size={18} strokeWidth={1.5} aria-hidden="true" /></button>
    </aside>
    {sheet ? <InstallSheet platform={platform} onClose={() => setSheet(false)} /> : null}
  </>
}

/** Bottom sheet with install steps for iPhone Safari, in-app browsers and other browsers. */
export function InstallSheet({ platform, onClose }: { platform: ReturnType<typeof installPlatform>; onClose: () => void }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<Element | null>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])

  useEffect(() => {
    returnFocus.current = document.activeElement
    panel.current?.querySelector<HTMLElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button, a[href]'))
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus()
    }
  }, [])

  const steps = platform === 'in-app'
    ? [
      { icon: Compass, title: 'Open in Safari or Chrome', body: 'Tap the menu (··· or the share arrow) and choose Open in browser. Apps like Messenger and Instagram cannot install.' },
      { icon: Share, title: 'Tap Share', body: 'In Safari it is the square with an arrow. In Chrome, open the ⋮ menu.' },
      { icon: SquarePlus, title: 'Add to Home Screen', body: 'Then tap Add. The TEDx icon appears with your other apps.' },
    ]
    : platform === 'ios'
      ? [
        { icon: Share, title: 'Tap Share', body: 'The square with an arrow, at the bottom of Safari (top on iPad).' },
        { icon: SquarePlus, title: 'Tap Add to Home Screen', body: 'Scroll the list if you do not see it right away.' },
        { icon: Check, title: 'Tap Add', body: 'The TEDx icon appears on your home screen. Open the workspace from there.' },
      ]
      : [
        { icon: Compass, title: 'Open your browser menu', body: 'The ⋮ or ··· button beside the address bar.' },
        { icon: SquarePlus, title: 'Choose Install or Add to Home Screen', body: 'The name depends on your browser.' },
        { icon: Check, title: 'Confirm', body: 'Open the workspace from the new icon next time.' },
      ]

  return <div className="install-sheet" role="presentation" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="install-sheet__panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="install-sheet__head">
        <h2 id={titleId}>{platform === 'in-app' ? 'Open in Safari or Chrome first' : 'Add the app to your home screen'}</h2>
        <button className="icon-button" type="button" aria-label="Close" onClick={onClose}><X className="icon" size={20} strokeWidth={1.5} aria-hidden="true" /></button>
      </div>
      <ol className="install-steps">
        {steps.map((step, index) => <li key={step.title}>
          <span className="install-steps__art" aria-hidden="true"><step.icon size={22} strokeWidth={1.5} /><span className="install-steps__n">{index + 1}</span></span>
          <span><strong>{step.title}</strong><span>{step.body}</span></span>
        </li>)}
      </ol>
      <button className="button button--secondary" type="button" onClick={onClose}>Done</button>
    </div>
  </div>
}
