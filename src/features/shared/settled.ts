/**
 * Stale-while-refresh for pages that load into `{key, ...}` state.
 *
 * Build the load key with `refreshKey(scope, counter)`, where `scope` holds everything that
 * decides *what* is shown (term, identity, record, page, filters) and `counter` is the refresh
 * epoch. `settled(state, key)` then keeps showing the last result while a refresh of the same
 * scope is in flight, instead of swapping the whole page for a skeleton (which unmounted open
 * editors, lost scroll and swallowed clicks). A change of scope still shows the loading state.
 */
export const refreshKey = (scope: string, counter: number) => scope + '#' + counter

const scopeOf = (key: string) => key.slice(0, key.lastIndexOf('#'))

export function settled<T extends { key: string }>(state: T | null | undefined, key: string): T | null {
  if (!state) return null
  if (state.key === key) return state
  return key.includes('#') && state.key.includes('#') && scopeOf(state.key) === scopeOf(key) ? state : null
}
