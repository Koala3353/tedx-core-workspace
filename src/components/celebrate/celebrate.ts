import './celebrate.css'

/**
 * Success feedback. Call it only after the server confirmed the command (never optimistically):
 *
 *   const result = await api.execute(input, key)
 *   if (result.ok) celebrate(button, 'complete')
 *
 * - save:     the button squashes, morphs to a drawn check, with a soft ripple.
 * - create:   the same, plus a small spark of particles.
 * - send:     the same, plus a confetti burst and a light haptic tap.
 * - complete: the same, plus a bigger confetti burst and a light haptic tap.
 *
 * The check is drawn on a stand-in laid exactly over the button in the top layer, so the real
 * button's width never changes and the feedback still plays when the success re-renders the
 * page or closes a dialog. Reduced motion: no squash, ripple or confetti; the check shows,
 * holds, then fades. Every call also announces the outcome to screen readers.
 *
 * Returns a promise that resolves once the check has landed (about 380ms). Await it only when
 * a dialog would otherwise close over the button.
 */
export type CelebrateKind = 'complete' | 'create' | 'send' | 'save'

type Profile = { particles: number; spread: number; speed: [number, number]; life: [number, number]; size: number; haptic: boolean; label: string }
const profiles: Record<CelebrateKind, Profile> = {
  save: { particles: 0, spread: 0, speed: [0, 0], life: [0, 0], size: 1, haptic: false, label: 'Saved' },
  create: { particles: 16, spread: 75, speed: [320, 620], life: [0.55, 0.75], size: 0.8, haptic: false, label: 'Created' },
  send: { particles: 40, spread: 58, speed: [600, 1100], life: [0.85, 1.1], size: 1, haptic: true, label: 'Sent' },
  complete: { particles: 56, spread: 66, speed: [650, 1200], life: [0.9, 1.15], size: 1, haptic: true, label: 'Done' },
}

const LANDED_MS = 380
const ORPHAN_HOLD_MS = 440
const MAX_PARTICLES = 160
const GRAVITY = 1400
const DRAG = 2.2
const easeOut = 'cubic-bezier(0.23, 1, 0.32, 1)'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function celebrate(target: Element | null | undefined, kind: CelebrateKind = 'save'): Promise<void> {
  const profile = profiles[kind]
  const reduced = reducedMotion()
  const el = target instanceof HTMLElement && target.isConnected ? target : null
  announce(el, profile.label)
  if (profile.haptic && !reduced) haptic()
  if (el) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      ghost(el, rect, kind, reduced)
      if (!reduced && profile.particles) burst(rect, profile)
    }
  }
  return new Promise(resolve => setTimeout(resolve, el ? LANDED_MS : 0))
}

/** The button that submitted a form, for use in an onSubmit handler. */
export function submitterOf(event: { nativeEvent: Event; currentTarget: EventTarget | null }): HTMLElement | null {
  const submitter = (event.nativeEvent as SubmitEvent).submitter
  if (submitter instanceof HTMLElement) return submitter
  const form = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null
  return form?.querySelector<HTMLElement>('button[type=submit], button:not([type])') ?? null
}

/* ----- top layer ----- */

function lift(node: HTMLElement) {
  document.body.append(node)
  if (typeof node.showPopover === 'function') {
    node.popover = 'manual'
    try { node.showPopover(); return } catch { /* fall through to z-index */ }
  }
  node.style.zIndex = '2147483000'
}

function drop(node: HTMLElement) {
  try { if (node.matches(':popover-open')) node.hidePopover() } catch { /* already hidden */ }
  node.remove()
}

/* ----- the check morph ----- */

type Ghost = { node: HTMLElement; target: HTMLElement; start: number; exitAt: number; exit: Animation | null; orphaned: boolean }
const ghosts = new Set<Ghost>()

function ghost(target: HTMLElement, rect: DOMRect, kind: CelebrateKind, reduced: boolean) {
  const style = getComputedStyle(target)
  const node = document.createElement('div')
  node.className = 'celebrate-ghost'
  node.setAttribute('aria-hidden', 'true')
  Object.assign(node.style, {
    left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px',
    borderRadius: style.borderRadius, borderWidth: style.borderTopWidth, borderColor: style.borderTopColor,
    background: opaqueBackground(target), color: style.color,
  })
  const diameter = Math.hypot(rect.width, rect.height) * 1.1
  node.innerHTML = `<span class="celebrate-ghost__ripple" style="width:${diameter}px;height:${diameter}px"></span>`
    + '<svg class="celebrate-ghost__check" viewBox="0 0 24 24"><path d="M5 12.75l4.5 4.5L19 7.5"/></svg>'
  lift(node)
  const entry: Ghost = { node, target, start: performance.now(), exitAt: Infinity, exit: null, orphaned: false }
  ghosts.add(entry)
  tick()
  if (reduced) {
    entry.orphaned = true
    const finish = () => { ghosts.delete(entry); drop(node) }
    node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, delay: 900, easing: 'ease-out', fill: 'forwards' }).finished.then(finish, finish)
    return
  }
  const big = kind === 'complete' || kind === 'send'
  const hold = big ? 860 : 720
  // Squash on arrival, then settle: the button "takes" the press.
  node.animate([
    { opacity: 0, transform: 'scale(1)', filter: 'blur(2px)' },
    { opacity: 1, transform: 'scale(0.94)', filter: 'blur(0px)', offset: 0.35 },
    { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
  ], { duration: 340, easing: easeOut })
  node.querySelector('.celebrate-ghost__ripple')?.animate([
    { opacity: 0.16, transform: 'translate(-50%, -50%) scale(0.1)' },
    { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
  ], { duration: 520, easing: easeOut, fill: 'forwards' })
  const check = node.querySelector('svg')
  check?.animate([{ opacity: 0, transform: 'scale(0.7)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 220, delay: 60, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)', fill: 'backwards' })
  const path = check?.querySelector('path')
  if (path) {
    // Measured rather than pathLength="1": Chrome doesn't scale CSS dash values by pathLength.
    const length = path.getTotalLength()
    path.style.strokeDasharray = String(length)
    path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration: 260, delay: 90, easing: easeOut, fill: 'backwards' })
  }
  schedule(entry, hold)
}

/** (Re)schedule the exit, which is faster than the entry. */
function schedule(entry: Ghost, delay: number) {
  entry.exit?.cancel()
  entry.exitAt = performance.now() + delay
  const exit = entry.node.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.98)' }], { duration: 180, delay, easing: easeOut, fill: 'forwards' })
  entry.exit = exit
  exit.finished.then(() => { ghosts.delete(entry); drop(entry.node) }, () => { /* rescheduled */ })
}

function alpha(color: string) {
  if (color === 'transparent') return 0
  const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/)
  if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1])
  const rgba = color.match(/^rgba\((?:[^,]+,){3}\s*([\d.]+)\s*\)$/)
  return rgba ? Number(rgba[1]) : 1
}

function opaqueBackground(from: HTMLElement) {
  for (let node: HTMLElement | null = from; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor
    if (alpha(color) >= 0.95) return color
  }
  return getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim() || '#111111'
}

/* ----- confetti ----- */

type Particle = { x: number; y: number; vx: number; vy: number; age: number; life: number; w: number; h: number; spin: number; angle: number; flip: number; flipRate: number; color: string; round: boolean }
const particles: Particle[] = []
let layer: HTMLCanvasElement | null = null
let frame = 0
let last = 0

function palette() {
  const match = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)
  const [r, g, b] = match ? match.slice(0, 3).map(Number) : [17, 17, 17]
  const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5
  return light ? ['#eb0028', '#eb0028', '#eb0028', '#111111', '#5f605c', '#b8b9b4'] : ['#eb0028', '#eb0028', '#eb0028', '#ffffff', '#d8dad3', '#8a8b86']
}

function burst(rect: DOMRect, profile: Profile) {
  const colors = palette()
  const room = Math.max(0, MAX_PARTICLES - particles.length)
  const count = Math.min(profile.particles, room)
  const rand = (min: number, max: number) => min + Math.random() * (max - min)
  for (let i = 0; i < count; i++) {
    const angle = (-90 + rand(-profile.spread, profile.spread)) * Math.PI / 180
    const speed = rand(profile.speed[0], profile.speed[1])
    const round = Math.random() < 0.25
    const size = rand(6, 11) * profile.size
    particles.push({
      x: rect.left + rect.width * rand(0.2, 0.8), y: rect.top + rect.height * 0.4,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      age: 0, life: rand(profile.life[0], profile.life[1]),
      w: round ? size * 0.6 : size, h: round ? size * 0.6 : size * 0.45,
      angle: rand(0, Math.PI * 2), spin: rand(-10, 10), flip: rand(0, Math.PI * 2), flipRate: rand(8, 16),
      color: colors[(Math.random() * colors.length) | 0], round,
    })
  }
  if (!count) return
  if (!layer) {
    layer = document.createElement('canvas')
    layer.className = 'celebrate-layer'
    layer.setAttribute('aria-hidden', 'true')
    lift(layer)
  }
  resize(layer)
  tick()
}

function resize(canvas: HTMLCanvasElement) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const w = Math.round(window.innerWidth * ratio), h = Math.round(window.innerHeight * ratio)
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0)
}

/* ----- one frame loop for everything ----- */

function tick() {
  if (frame) return
  last = performance.now()
  frame = requestAnimationFrame(step)
}

function step(now: number) {
  frame = 0
  const dt = Math.min((now - last) / 1000, 1 / 30)
  last = now
  // Keep each check over its button while the page scrolls; if the button is gone, stay put.
  for (const entry of ghosts) {
    const { node, target } = entry
    if (!target.isConnected) {
      // The success swapped the view (result screen, closed form): let the check land, then go.
      if (!entry.orphaned) {
        entry.orphaned = true
        const orphanAt = entry.start + ORPHAN_HOLD_MS
        if (orphanAt < entry.exitAt) schedule(entry, Math.max(0, orphanAt - now))
      }
      continue
    }
    const rect = target.getBoundingClientRect()
    if (rect.width > 0) { node.style.left = rect.left + 'px'; node.style.top = rect.top + 'px' }
  }
  if (layer) {
    const ctx = layer.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const drag = Math.exp(-DRAG * dt)
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.age += dt
        if (p.age >= p.life) { particles.splice(i, 1); continue }
        p.vx *= drag
        p.vy = p.vy * drag + GRAVITY * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.angle += p.spin * dt
        p.flip += p.flipRate * dt
        const fade = p.age / p.life
        ctx.globalAlpha = fade > 0.65 ? 1 - (fade - 0.65) / 0.35 : 1
        ctx.fillStyle = p.color
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        ctx.scale(1, p.round ? 1 : Math.cos(p.flip))
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill() }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
      ctx.globalAlpha = 1
    }
    if (!particles.length) { drop(layer); layer = null }
  }
  if (ghosts.size || particles.length) frame = requestAnimationFrame(step)
}

/* ----- announcement and haptics ----- */

function announce(from: HTMLElement | null, label: string) {
  // Inside an open modal dialog the rest of the page is inert, so announce from within it.
  const host = from?.closest('dialog[open], [aria-modal="true"]') ?? document.body
  const region = document.createElement('div')
  region.className = 'celebrate-sr'
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', 'polite')
  host.append(region)
  setTimeout(() => { region.textContent = label }, 60)
  setTimeout(() => region.remove(), 3000)
}

function haptic() {
  try {
    if (typeof navigator.vibrate === 'function' && matchMedia('(pointer: coarse)').matches) navigator.vibrate(12)
  } catch { /* unsupported */ }
}
