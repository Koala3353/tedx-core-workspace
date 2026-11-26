import { useCallback, useEffect, useRef, useState } from 'react'
import { BoardUnavailable, type Board } from './board'
import { useAutoRefresh } from '../shared/useAutoRefresh'

export type BoardState = { board: Board | null; error: string | null; unavailable: boolean; loading: boolean; reload: () => void }

/**
 * Loads the coordination board and keeps the last good copy on screen while refreshing,
 * so the projector view never flashes empty. Refreshes on focus like other pages.
 */
export function useBoard(load: ((termId: string) => Promise<Board>) | undefined, termId: string | null): BoardState {
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const latest = useRef(0)
  const reload = useCallback(() => setTick(n => n + 1), [])
  useAutoRefresh(reload)
  useEffect(() => {
    if (!load || !termId) { setLoading(false); setUnavailable(true); return }
    const call = ++latest.current
    setLoading(true)
    load(termId).then(
      value => { if (call === latest.current) { setBoard(value); setError(null); setUnavailable(false); setLoading(false) } },
      (e: unknown) => {
        if (call !== latest.current) return
        setLoading(false)
        if (e instanceof BoardUnavailable) setUnavailable(true)
        else setError(e instanceof Error ? e.message : 'This view could not load.')
      },
    )
  }, [load, termId, tick])
  return { board, error, unavailable, loading, reload }
}
