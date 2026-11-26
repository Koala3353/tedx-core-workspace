import { useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { isUpdateReady, onUpdateReady } from '../lib/appUpdate'

/** "A new version is ready · Reload". The person decides when; nothing reloads on its own. */
export function UpdateToast() {
  const [ready, setReady] = useState(isUpdateReady)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => onUpdateReady(() => setReady(true)), [])
  if (!ready || dismissed) return null
  return <div className="update-toast" role="status">
    <span>A new version is ready</span>
    <button type="button" className="update-toast__reload" onClick={() => window.location.reload()}>
      <RotateCw className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Reload
    </button>
    <button type="button" className="update-toast__close" onClick={() => setDismissed(true)} aria-label="Hide this notice">Later</button>
  </div>
}
