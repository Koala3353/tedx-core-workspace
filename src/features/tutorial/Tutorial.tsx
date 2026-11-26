import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate, useRouteLoaderData } from 'react-router'
import { RotateCcw } from 'lucide-react'
import { useShellServices } from '../../app/shellServices'
import { installPlatform, isStandalone, useInstallPrompt } from '../../app/InstallWorkspace'
import { safeStorage } from '../../lib/clientState'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import { InstallSheet } from '../install/InstallBanner'
import { replayEvent, replayTour, tutorialVersion } from './events'
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
  const stops = allStops.filter(stop => !stop.capability || capabilities.includes(stop.capability))
  const [index, setIndex] = useState<number | null>(null)
  const [pending, setPending] = useState<number | null>(null)
  const checked = useRef(false)

  const save = useCallback((step: number, done: boolean) => {
    writeLocal({ step, done, version: tutorialVersion })
    void clientState?.record(done ? { tutorialStep: step, tutorialDone: true, tutorialVersion } : { tutorialStep: step, tutorialVersion })
  }, [clientState])

  // First signed-in visit: start on Today. Progress comes from the server, else this browser.
  useEffect(() => {
    if (checked.current || pathname !== '/') return
    checked.current = true
    let live = true
    void (async () => {
      const server = clientState ? await clientState.read() : null
      const local = readLocal()
      const done = server ? server.tutorialDone && server.tutorialVersion >= tutorialVersion : !!local?.done && local.version >= tutorialVersion
      if (!live || done) return
      const step = Math.min(Math.max(server?.tutorialStep ?? local?.step ?? 0, 0), stops.length - 1)
      window.setTimeout(() => { if (live) setPending(step) }, 700)
    })()
    return () => { live = false }
  }, [pathname, clientState, stops.length])

  useEffect(() => {
    const replay = () => { setIndex(null); setPending(0) }
    window.addEventListener(replayEvent, replay)
    return () => window.removeEventListener(replayEvent, replay)
  }, [])

  // Move to a stop: open its page, then wait for its anchor (skip optional stops that never appear).
  useEffect(() => {
    if (pending === null) return
    const stop = stops[pending]
    if (!stop) { setPending(null); return }
    if (stop.path && pathname !== stop.path) { void navigate(stop.path); return }
    let frame = 0
    const started = performance.now()
    const look = () => {
      if (findAnchor(stop.anchor)) { setIndex(pending); setPending(null); save(pending, false); return }
      if (performance.now() - started > 4000) {
        setPending(null)
        if (pending + 1 < stops.length) setPending(pending + 1)
        else setIndex(null)
        return
      }
      frame = requestAnimationFrame(look)
    }
    frame = requestAnimationFrame(look)
    return () => cancelAnimationFrame(frame)
  }, [pending, pathname, navigate, stops, save])

  function finish(step: number) { setIndex(null); setPending(null); save(step, true) }
  function go(next: number) { if (next >= 0 && next < stops.length) setPending(next) }

  if (index === null || !stops[index]) return null
  return <CoachMark key={stops[index].id} stop={stops[index]} position={index} total={stops.length}
    onBack={() => go(index - 1)} onNext={() => go(index + 1)} onClose={() => finish(index)} />
}

type Box = { top: number; left: number; width: number; height: number }

function CoachMark({ stop, position, total, onBack, onNext, onClose }: { stop: Stop; position: number; total: number; onBack: () => void; onNext: () => void; onClose: () => void }) {
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
      <p className="tour-bubble__body" id={bodyId}>{stop.body}</p>
      {last ? <div className="tour-bubble__extras">
        <Link className="button button--secondary" to="/notifications" onClick={onClose}>Turn on reminders</Link>
        {!isStandalone() ? <button className="button button--secondary" type="button" onClick={() => void startInstall()}>Install the app</button> : null}
      </div> : null}
      <div className="tour-bubble__controls">
        <button className="tour-bubble__skip" type="button" onClick={onClose}>{last ? 'Close' : 'Skip tour'}</button>
        <span className="tour-bubble__nav">
          {position > 0 ? <button className="button button--secondary" type="button" onClick={onBack}>Back</button> : null}
          <button className="button" type="button" data-tour-primary onClick={last ? onClose : onNext}>{last ? 'Finish' : 'Next'}</button>
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
