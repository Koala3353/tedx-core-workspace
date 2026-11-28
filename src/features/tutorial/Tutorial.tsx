import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate, useNavigation, useRevalidator, useRouteLoaderData } from 'react-router'
import { RotateCcw } from 'lucide-react'
import { useShellServices } from '../../app/shellServices'
import { installPlatform, isStandalone, useInstallPrompt } from '../../app/InstallWorkspace'
import { safeStorage } from '../../lib/clientState'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import { InstallSheet } from '../install/InstallBanner'
import { onSetupGate, readSetupGate } from '../setup-wizard/gate'
import { replayEvent, replayTour, setTourActive, setTourSettled, tutorialVersion } from './events'
import './tutorial.css'

type Stop = { id: string; anchor: string; path?: string; title: string; body: string; capability?: string; optional?: boolean }

// About two minutes. Anchors are data-tour attributes on real elements in the shell and pages.
const allStops: Stop[] = [
  { id: 'today', path: '/', anchor: 'today-list', title: 'This is Today', body: 'Everything you owe, approvals waiting on you and announcements to read land here. Start your day on this screen.' },
  { id: 'verb', path: '/', anchor: 'today-verb', optional: true, title: 'One button per row', body: 'Each row has one button: Open, Review or Acknowledge. Finish the work and it leaves your list. Your head sees the progress.' },
  { id: 'ask', path: '/work', anchor: 'work-ask', title: 'Need something from another committee?', body: 'Work holds your tasks and deliverables. Ask a committee when you need a room, budget, a poster or a hand from another team.' },
  { id: 'team', path: '/team', anchor: 'team-people', title: 'Not sure who to ask?', body: 'Team has every committee and who is on point, plus the Start here guides.' },
  { id: 'committee', path: '/team', anchor: 'team-committee', capability: 'committee.manage', title: 'Your committee', body: 'As a head, My committee shows what your members owe and what other committees asked of you.' },
  { id: 'desk', path: '/desk', anchor: 'desk-admin', capability: 'admin.configure', title: 'Your desk', body: 'Admin tools live under Desk, away from everyday work: roles, imports, services and site setup.' },
  { id: 'bell', anchor: 'bell', title: 'Updates and reminders', body: 'The bell shows new assignments, approvals and mentions. Turn on reminders so deadlines reach your phone.' },
]

const localKey = 'tedx-tour'
type LocalProgress = { step: number; done: boolean; version: number }
function readLocal(): LocalProgress | null {
  try { const value = JSON.parse(safeStorage.get(localKey) ?? 'null'); return value && typeof value.step === 'number' ? value : null } catch { return null }
}
function writeLocal(value: LocalProgress) { safeStorage.set(localKey, JSON.stringify(value)) }

/** First visible element carrying the anchor (the sidebar and the phone bar both exist in the DOM). */
function findAnchor(anchor: string): HTMLElement | null {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`))) {
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return element
  }
  return null
}

const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

/** The interactive first-run tour. Mounted once in the signed-in shell. */
export function Tutorial() {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  if (!context || isGuest(context)) return null
  return <TutorialBody key={context.termId + context.memberId} capabilities={context.capabilities} />
}

function TutorialBody({ capabilities }: { capabilities: string[] }) {
  const { clientState } = useShellServices()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const navigation = useNavigation()
  const { state: revalidation } = useRevalidator()
  // Stable between renders: the stop effect below depends on it, and a new array every render
  // re-ran that effect on every navigation tick, calling navigate() again and aborting the
  // page's access check each time (the tour hung on "Checking access").
  const capabilityKey = capabilities.join(',')
  const stops = useMemo(() => allStops.filter(stop => !stop.capability || capabilityKey.split(',').includes(stop.capability)), [capabilityKey])
  const requested = useRef<number | null>(null)
  const settled = navigation.state === 'idle' && revalidation === 'idle'
  const [index, setIndex] = useState<number | null>(null)
  const [pending, setPending] = useState<number | null>(null)
  // The stop the tour still has to start from, once known; null while checking or when done.
  const [needed, setNeeded] = useState<number | null>(null)
  const started = useRef(false)
  const direction = useRef<1 | -1>(1)

  const save = useCallback((step: number, done: boolean) => {
    writeLocal({ step, done, version: tutorialVersion })
    void clientState?.record(done ? { tutorialStep: step, tutorialDone: true, tutorialVersion } : { tutorialStep: step, tutorialVersion })
  }, [clientState])

  // The tour comes first; the setup wizard opens once it settles (see tourSettled). While setup is
  // still to come, the last stop hands over to it.
  const gate = useSyncExternalStore(onSetupGate, readSetupGate)
  useEffect(() => { setTourActive(index !== null || pending !== null) }, [index, pending])
  useEffect(() => () => { setTourActive(false); setTourSettled(false) }, [])
  // Finished, skipped, or gave up on a stop that never appeared: setup can open.
  useEffect(() => { if (started.current && index === null && pending === null) setTourSettled(true) }, [index, pending])

  // Progress comes from the server, else this browser. Checked on any page, so a member who
  // finished the tour gets their setup wherever they land.
  useEffect(() => {
    let live = true
    void (async () => {
      const server = clientState ? await clientState.read().catch(() => null) : null
      const local = readLocal()
      const done = server ? server.tutorialDone && server.tutorialVersion >= tutorialVersion : !!local?.done && local.version >= tutorialVersion
      if (!live) return
      if (done) { setTourSettled(true); return }
      setNeeded(Math.min(Math.max(server?.tutorialStep ?? local?.step ?? 0, 0), stops.length - 1))
    })()
    return () => { live = false }
  }, [clientState, stops.length])

  // First signed-in visit: the tour starts on Today, after a short beat.
  useEffect(() => {
    if (needed === null || started.current || pathname !== '/') return
    setTourActive(true)
    const timer = window.setTimeout(() => { started.current = true; setPending(needed) }, 700)
    return () => { clearTimeout(timer); if (!started.current) setTourActive(false) }
  }, [needed, pathname])

  useEffect(() => {
    const replay = () => { started.current = true; setIndex(null); setPending(0) }
    window.addEventListener(replayEvent, replay)
    return () => window.removeEventListener(replayEvent, replay)
  }, [])

  // Move to a stop: open its page, then wait for its anchor (skip optional stops that never appear).
  useEffect(() => {
    if (pending === null) { requested.current = null; return }
    const stop = stops[pending]
    if (!stop) { setPending(null); return }
    // Open the stop's page once, then wait for that navigation (and any access check) to finish
    // before looking for the anchor. If the page never opens (blocked by unsaved edits, or the
    // check failed), give up on this stop instead of waiting forever.
    if (stop.path && pathname !== stop.path) {
      if (requested.current !== pending) { requested.current = pending; void navigate(stop.path) }
      if (!settled) return
      const giveUp = window.setTimeout(() => { setPending(null); setIndex(null) }, 4000)
      return () => clearTimeout(giveUp)
    }
    if (!settled) return
    let frame = 0
    const started = performance.now()
    // Optional stops (e.g. a row's button on an empty Today list) are skipped almost at once;
    // required ones get a little longer for the page to render.
    const patience = stop.optional ? 500 : 3000
    const look = () => {
      if (findAnchor(stop.anchor)) { setIndex(pending); setPending(null); save(pending, false); return }
      if (performance.now() - started > patience) {
        const skipTo = pending + direction.current
        if (skipTo >= 0 && skipTo < stops.length) setPending(skipTo)
        else { setPending(null); setIndex(null) }
        return
      }
      frame = requestAnimationFrame(look)
    }
    frame = requestAnimationFrame(look)
    return () => cancelAnimationFrame(frame)
  }, [pending, pathname, navigate, stops, save, settled])

  function finish(step: number) { setIndex(null); setPending(null); save(step, true) }
  // Hide the current bubble while the next stop is located, so it never looks frozen
  // and repeated clicks cannot restart the search.
  function go(next: number) {
    if (next < 0 || next >= stops.length || index === null) return
    direction.current = next > index ? 1 : -1
    setIndex(null)
    setPending(next)
  }

  if (index === null || !stops[index]) return null
  return <CoachMark key={stops[index].id} stop={stops[index]} position={index} total={stops.length} setupNext={gate.status === 'open'}
    onBack={() => go(index - 1)} onNext={() => go(index + 1)} onClose={() => finish(index)} />
}

const setupBody = 'The bell shows new assignments, approvals and mentions. Next, a one-minute setup so reminders reach your email and this device.'

type Box = { top: number; left: number; width: number; height: number }

function CoachMark({ stop, position, total, setupNext, onBack, onNext, onClose }: {
  stop: Stop; position: number; total: number
  /** First run: setup (with the notification settings) opens right after this tour. */
  setupNext: boolean
  onBack: () => void; onNext: () => void; onClose: () => void
}) {
  const titleId = useId(), bodyId = useId()
  const bubble = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const spot = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState(false)
  const [sheet, setSheet] = useState(false)
  const last = position === total - 1
  const { available, install } = useInstallPrompt()
  const platform = installPlatform(available)

  // Track the anchor through scrolling, resizing and layout changes.
  useEffect(() => {
    const target = findAnchor(stop.anchor)
    if (!target) return
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const element = findAnchor(stop.anchor) ?? target
        if (!element.isConnected) { setBox(null); return }
        const r = element.getBoundingClientRect()
        setBox({ top: r.top, left: r.left, width: r.width, height: r.height })
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [stop.anchor])

  // Place the bubble below the anchor, else above; on narrow screens it docks to the bottom (CSS).
  // Positions are written straight to the elements: styles set from script are allowed by the CSP.
  useLayoutEffect(() => {
    const element = bubble.current, ring = spot.current
    if (!box || !element) return
    const pad = 6
    if (ring) {
      ring.style.transform = `translate(${box.left - pad}px, ${box.top - pad}px)`
      ring.style.width = `${box.width + pad * 2}px`
      ring.style.height = `${box.height + pad * 2}px`
    }
    const vw = window.innerWidth, vh = window.innerHeight, gap = 14, margin = 16
    if (vw < 640) element.style.removeProperty('transform')
    else {
      const { width, height } = element.getBoundingClientRect()
      const below = box.top + box.height + gap
      const top = below + height <= vh - margin ? below : Math.max(margin, box.top - gap - height)
      const left = Math.min(Math.max(margin, box.left), vw - width - margin)
      element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
    }
    setPlaced(true)
  }, [box])

  useEffect(() => { bubble.current?.querySelector<HTMLElement>('[data-tour-primary]')?.focus({ preventScroll: true }) }, [])

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab' || !bubble.current) return
    const focusable = Array.from(bubble.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
    const first = focusable[0], end = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); end?.focus() }
    else if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); first?.focus() }
  }

  async function startInstall() {
    if (platform === 'prompt' && (await install()) !== 'unavailable') return
    setSheet(true)
  }

  return <>
    {box ? <div className="tour-spot" aria-hidden="true" ref={spot} /> : null}
    <div ref={bubble} className={`tour-bubble${placed ? ' is-placed' : ''}`}
      role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={bodyId} onKeyDown={keys}>
      <p className="tour-bubble__step">{position + 1} of {total}</p>
      <h2 className="tour-bubble__title" id={titleId}>{stop.title}</h2>
      <p className="tour-bubble__body" id={bodyId}>{last && setupNext ? setupBody : stop.body}</p>
      {last && !setupNext ? <div className="tour-bubble__extras">
        <Link className="button button--secondary" to="/notifications" onClick={onClose}>Turn on reminders</Link>
        {!isStandalone() ? <button className="button button--secondary" type="button" onClick={() => void startInstall()}>Install the app</button> : null}
      </div> : null}
      <div className="tour-bubble__controls">
        {last && setupNext ? <span /> : <button className="tour-bubble__skip" type="button" onClick={onClose}>{last ? 'Close' : 'Skip tour'}</button>}
        <span className="tour-bubble__nav">
          {position > 0 ? <button className="button button--secondary" type="button" onClick={onBack}>Back</button> : null}
          <button className="button" type="button" data-tour-primary onClick={last ? onClose : onNext}>{last ? setupNext ? 'Set up notifications' : 'Finish' : 'Next'}</button>
        </span>
      </div>
    </div>
    {sheet ? <InstallSheet platform={platform} onClose={() => setSheet(false)} /> : null}
  </>
}

/** "Replay tour" for Account or any menu. Starts the tour again from Today. */
export function ReplayTourButton({ className = 'button button--secondary' }: { className?: string }) {
  return <button className={className} type="button" onClick={replayTour}>
    <RotateCcw className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Replay the tour
  </button>
}
