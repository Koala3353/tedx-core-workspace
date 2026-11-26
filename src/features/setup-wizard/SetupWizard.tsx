import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useRouteLoaderData } from 'react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useShellServices } from '../../app/shellServices'
import { isStandalone } from '../../app/InstallWorkspace'
import { safeStorage, type ClientStateApi } from '../../lib/clientState'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import type { ProfileGateway } from '../account/gateway'
import type { NotificationsApi } from '../notifications/api'
import { markTourDone } from '../tutorial/Tutorial'
import { replayTour } from '../tutorial/events'
import { openSetup, readSetupGate, setSetupGate, setupOpenEvent, type SetupGate } from './gate'
import { DoneStep, InstallStep, LookStep, ProfileStep, RemindersStep, WelcomeStep, type Commit } from './steps'
import './setup-wizard.css'

/** Canonical order. The saved step is an index into this list, so hidden steps keep their number. */
const order = ['welcome', 'profile', 'reminders', 'look', 'install', 'done'] as const
type StepId = typeof order[number]

type Local = { step: number; done: boolean }
const localKey = (who: string) => 'tedx-setup:' + who
const laterKey = (who: string) => 'tedx-setup-later:' + who
function readLocal(who: string): Local | null {
  try {
    const value = JSON.parse(safeStorage.get(localKey(who)) ?? 'null') as Local | null
    return value && Number.isSafeInteger(value.step) && typeof value.done === 'boolean' ? value : null
  } catch { return null }
}

type Identity = { who: string; name: string; guest: boolean; termId?: string; committee?: string | null; position?: string | null }

/**
 * First-run setup, shown once per member before the tour. Mounted in the signed-in shell for
 * core members and guests. On the development /preview shell it opens with ?setup=1 and saves
 * nothing.
 */
export function SetupWizard({ preview = false }: { preview?: boolean }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  const { search } = useLocation()
  if (preview) return import.meta.env.DEV && new URLSearchParams(search).get('setup') === '1' ? <PreviewWizard key={search} /> : null
  if (!context) return null
  const guest = isGuest(context)
  return <SetupGateKeeper key={context.termId + (guest ? context.guestAccessId : context.memberId)}
    identity={{ who: guest ? 'guest:' + context.guestAccessId : context.memberId, name: context.displayName, guest, termId: context.termId }} />
}

/** Development only: /preview?setup=1 shows the wizard with sample data and saves nothing. */
function PreviewWizard() {
  const [open, setOpen] = useState(true)
  return open ? <Wizard identity={{ who: 'preview', name: 'Sample member', guest: false, committee: 'Sample committee', position: 'Sample position' }}
    preview startAt={0} onClose={() => setOpen(false)} /> : null
}

function SetupGateKeeper({ identity }: { identity: Identity }) {
  const { clientState } = useShellServices()
  const [open, setOpen] = useState<{ startAt: number; reopened: SetupGate | null } | null>(null)
  const [info, setInfo] = useState<{ committee?: string | null; position?: string | null }>({})

  // Done on the server or in this browser closes the gate; otherwise open where they left off,
  // unless they chose "Finish later" earlier in this browser session.
  useEffect(() => {
    let live = true
    void (async () => {
      const server = !identity.guest && clientState ? await clientState.read() : null
      if (!live) return
      if (server) setInfo({ committee: server.committee, position: server.position })
      const local = readLocal(identity.who)
      const done = server?.setupDone === true || !!local?.done
      if (done) { setSetupGate({ status: 'closed', tour: 'auto' }); return }
      setSetupGate({ status: 'open', tour: 'auto' })
      if (safeStorage.session.get(laterKey(identity.who))) return
      setOpen({ startAt: Math.max(server?.setupStep ?? 0, local?.step ?? 0), reopened: null })
    })()
    return () => { live = false }
  }, [clientState, identity.guest, identity.who])

  useEffect(() => {
    const reopen = () => setOpen(current => current ?? { startAt: 0, reopened: readSetupGate() })
    window.addEventListener(setupOpenEvent, reopen)
    return () => window.removeEventListener(setupOpenEvent, reopen)
  }, [])

  if (!open) return null
  return <Wizard identity={{ ...identity, ...info }} startAt={open.startAt} clientState={identity.guest ? undefined : clientState}
    onClose={reason => {
      // "Finish later" after "Set up again" puts things back as they were.
      if (reason === 'later' && open.reopened?.status === 'closed') setSetupGate(open.reopened)
      setOpen(null)
    }} />
}

function Wizard({ identity, startAt, preview = false, clientState, onClose }: {
  identity: Identity; startAt: number; preview?: boolean; clientState?: ClientStateApi; onClose: (reason: 'later' | 'done') => void
}) {
  const { gateway } = useShellServices()
  const live = !preview
  const profile: ProfileGateway | undefined = live && !identity.guest ? gateway?.profile : undefined
  const notifications: NotificationsApi | undefined = live && !identity.guest ? gateway?.notifications : undefined
  const steps = order.filter(id => !(identity.guest && (id === 'profile' || id === 'reminders')) && !(id === 'install' && isStandalone()))
  const first = Math.max(0, steps.findIndex(id => order.indexOf(id) >= Math.min(startAt, order.length - 1)))
  const [index, setIndex] = useState(first)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [busy, setBusy] = useState(false)
  const commit = useRef<Commit | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<Element | null>(null)
  const headingId = useId()
  const step: StepId = steps[index] ?? 'done'
  const registerCommit = useCallback((next: Commit | null) => { commit.current = next }, [])

  const save = useCallback((stepId: StepId, done = false) => {
    if (preview) return
    const position = order.indexOf(stepId)
    safeStorage.set(localKey(identity.who), JSON.stringify({ step: position, done } satisfies Local))
    void clientState?.recordSetup(done ? { step: position, done: true } : { step: position })
  }, [clientState, identity.who, preview])

  // Focus: remember what had it, lock the page behind, return it on close.
  useEffect(() => {
    returnFocus.current = document.activeElement
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    return () => {
      root.style.overflow = previous
      if (returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected) returnFocus.current.focus({ preventScroll: true })
    }
  }, [])
  // Each step moves focus to its heading so the new content is announced.
  useEffect(() => { document.getElementById(headingId)?.focus({ preventScroll: true }) }, [headingId, step])

  async function go(next: number) {
    if (busy || next < 0 || next >= steps.length) return
    if (next > index && commit.current) {
      setBusy(true)
      const ok = await commit.current()
      setBusy(false)
      if (!ok) return
    }
    setDirection(next > index ? 'forward' : 'back')
    setIndex(next)
    if (steps[next]) save(steps[next])
  }

  function later() {
    save(step)
    if (!preview) safeStorage.session.set(laterKey(identity.who), '1')
    onClose('later')
  }

  function finish(tour: boolean) {
    save('done', true)
    if (!preview) {
      if (!tour && !identity.guest) markTourDone(clientState)
      setSetupGate({ status: 'closed', tour: tour ? 'start' : 'skip' })
      if (tour) replayTour()
    }
    onClose('done')
  }

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); later(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]'))
      .filter(element => element.offsetParent !== null || element === document.activeElement)
    const firstEl = focusable[0], lastEl = focusable[focusable.length - 1]
    if (!firstEl || !lastEl) return
    if (event.shiftKey && (document.activeElement === firstEl || !dialog.current.contains(document.activeElement))) { event.preventDefault(); lastEl.focus() }
    else if (!event.shiftKey && document.activeElement === lastEl) { event.preventDefault(); firstEl.focus() }
  }

  const props = { headingId, registerCommit }
  const last = step === 'done'
  return <div className="setup-scrim" role="presentation">
    <div ref={dialog} className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={keys}>
      <header className="setup-head">
        <div className="setup-progress">
          <ol className="setup-dots" aria-hidden="true">
            {steps.map((id, i) => <li key={id} data-state={i < index ? 'done' : i === index ? 'current' : 'todo'} />)}
          </ol>
          <span className="setup-count">Step {index + 1} of {steps.length}</span>
        </div>
        {!last ? <button type="button" className="setup-later" onClick={later} aria-keyshortcuts="Escape">Finish later</button> : null}
      </header>
      <div className="setup-body">
        <section key={step} className="setup-step" data-direction={direction} aria-labelledby={headingId}>
          {step === 'welcome' ? <WelcomeStep {...props} name={identity.name} committee={identity.committee} position={identity.position} guest={identity.guest} />
            : step === 'profile' ? <ProfileStep {...props} api={profile} termId={identity.termId} />
              : step === 'reminders' ? <RemindersStep {...props} api={notifications} termId={identity.termId} />
                : step === 'look' ? <LookStep {...props} />
                  : step === 'install' ? <InstallStep {...props} />
                    : <DoneStep {...props} guest={identity.guest} />}
        </section>
      </div>
      <footer className={`setup-foot${last ? ' setup-foot--final' : ''}`}>
        {index > 0 ? <button type="button" className="button button--secondary setup-back" disabled={busy} onClick={() => void go(index - 1)}>
          <ArrowLeft className="icon" size={18} strokeWidth={1.75} aria-hidden="true" /><span>Back</span>
        </button> : <span />}
        <span className="setup-foot__end">
          {last ? identity.guest
            ? <button type="button" className="button" onClick={() => finish(false)}>Open the workspace</button>
            : <>
              <button type="button" className="setup-skip" onClick={() => finish(false)}>Skip tour</button>
              <button type="button" className="button" onClick={() => finish(true)}>Take the 2-minute tour</button>
            </>
            : <>
              {index > 0 ? <button type="button" className="setup-skip" disabled={busy} onClick={() => { commit.current = null; void go(index + 1) }}>Skip</button> : null}
              <button type="button" className="button setup-next" disabled={busy} onClick={() => void go(index + 1)}>
                <span>{busy ? 'Saving…' : index === 0 ? 'Get started' : 'Next'}</span>
                {!busy ? <ArrowRight className="icon" size={18} strokeWidth={1.75} aria-hidden="true" /> : null}
              </button>
            </>}
        </span>
      </footer>
    </div>
  </div>
}

/** "Set up again" for the Account page. Reopens the wizard from the first step. */
export function SetupAgainButton({ className = 'button button--secondary' }: { className?: string }) {
  return <button className={className} type="button" onClick={openSetup}>Set up again</button>
}
