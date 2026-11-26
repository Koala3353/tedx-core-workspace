import { useCallback, useEffect, useRef, useState } from 'react'
import { safeStorage } from '../../lib/clientState'
import { validRunOfShow, type RunOfShow, type RunOfShowApi } from './api'

// Live state arrives by polling every 5 seconds while the page is visible. Supabase Realtime is not
// used: the app's Content-Security-Policy allows the Supabase origin over https only, not wss.
const POLL_MS = 5000
const cacheKey = (term: string) => `tedx.runOfShow.${term}`

type Cached = { show: RunOfShow; savedAt: number }
function readCache(term: string): Cached | null {
  try {
    const value = JSON.parse(safeStorage.get(cacheKey(term)) ?? 'null') as Cached | null
    return value && Number.isFinite(value.savedAt) && validRunOfShow(value.show) ? value : null
  } catch { return null }
}

export type RunOfShowSource = {
  show: RunOfShow | null
  /** Milliseconds to add to Date.now() to get the server's clock. */
  skew: number
  /** When the shown data was last confirmed by the server. */
  savedAt: number | null
  status: 'loading' | 'live' | 'offline' | 'unavailable' | 'failed'
  reload: () => void
  accept: (show: RunOfShow) => void
}

export function useRunOfShow(api: RunOfShowApi, term: string): RunOfShowSource {
  const cached = useRef(readCache(term))
  const [show, setShow] = useState<RunOfShow | null>(cached.current?.show ?? null)
  const [savedAt, setSavedAt] = useState<number | null>(cached.current?.savedAt ?? null)
  const [skew, setSkew] = useState(0)
  const [status, setStatus] = useState<RunOfShowSource['status']>('loading')
  const generation = useRef(0)

  const accept = useCallback((next: RunOfShow) => {
    const at = Date.now()
    setShow(next); setSavedAt(at); setSkew(Date.parse(next.serverNow) - at); setStatus('live')
    safeStorage.set(cacheKey(term), JSON.stringify({ show: next, savedAt: at }))
  }, [term])

  const load = useCallback(async () => {
    const current = ++generation.current
    try {
      const next = await api.read(term)
      if (current !== generation.current) return
      if (next === null) { setStatus('unavailable'); return }
      accept(next)
    } catch {
      if (current !== generation.current) return
      setStatus(cached.current || show ? 'offline' : 'failed')
    }
  }, [api, term, accept, show])

  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  useEffect(() => {
    const check = () => { if (document.visibilityState !== 'hidden') void loadRef.current() }
    check()
    const timer = window.setInterval(check, POLL_MS)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      generation.current++
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [term])

  return { show, skew, savedAt, status, reload: () => void loadRef.current(), accept }
}

/** A clock that ticks twice a second while `active`, corrected by the server skew. */
export function useNow(active: boolean, skew: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [active])
  return now + skew
}

/** Keeps the screen awake while `active`. Rejection (battery saver, unsupported) is reported, not thrown. */
export function useWakeLock(active: boolean): 'on' | 'off' | 'unsupported' {
  const [state, setState] = useState<'on' | 'off' | 'unsupported'>('off')
  useEffect(() => {
    if (!active) return
    type Sentinel = { release: () => Promise<void>; addEventListener: (t: 'release', f: () => void) => void }
    const lock = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock
    if (!lock) { queueMicrotask(() => setState('unsupported')); return }
    let sentinel: Sentinel | null = null, alive = true
    const request = () => {
      if (document.visibilityState !== 'visible') return
      lock.request('screen').then(s => {
        if (!alive) { void s.release().catch(() => undefined); return }
        sentinel = s; setState('on')
        s.addEventListener('release', () => { if (alive) setState('off') })
      }).catch(() => { if (alive) setState('off') })
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', request)
      if (sentinel) void sentinel.release().catch(() => undefined)
    }
  }, [active])
  return state
}
