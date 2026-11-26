/**
 * New-build handling for a static host. GitHub Pages serves index.html with max-age=600 and
 * every deploy renames the hashed chunks, so a tab opened before a deploy can ask for a chunk
 * that no longer exists. The page never reloads on its own for that: it shows a small
 * "A new version is ready" notice and the person chooses when to reload.
 *
 * The one exception is opening a page whose code is missing: the person is already moving,
 * so one reload is allowed, at most once per build (keyed by this module's hashed URL).
 */
const updateEvent = 'tedx:update-ready'
// This module's URL carries the build's content hash in production, so it changes per deploy.
const buildId = import.meta.url
const reloadKey = 'tedx.chunk-reload:' + buildId
let ready = false

export function isUpdateReady(): boolean { return ready }

/** Show the "new version" notice. Safe to call more than once. */
export function announceUpdate(): void {
  if (ready) return
  ready = true
  window.dispatchEvent(new Event(updateEvent))
}

export function onUpdateReady(listener: () => void): () => void {
  window.addEventListener(updateEvent, listener)
  return () => window.removeEventListener(updateEvent, listener)
}

/** One reload per build for a missing page chunk during navigation. Returns false when already used. */
export function reloadOnceForMissingChunk(): boolean {
  try {
    if (sessionStorage.getItem(reloadKey) === '1') return false
    sessionStorage.setItem(reloadKey, '1')
  } catch { return false }
  window.location.reload()
  return true
}

/** A chunk loaded fine, so this build works; a later missing chunk may reload once again. */
export function chunkLoaded(): void {
  try { sessionStorage.removeItem(reloadKey) } catch { /* Storage is optional. */ }
}

/** Vite reports failed preloads of dynamic imports here. Show the notice instead of failing hard. */
export function watchForStaleBuild(): void {
  window.addEventListener('vite:preloadError', event => { event.preventDefault(); announceUpdate() })
}
