import { useEffect, useState } from 'react'

type InstallPrompt = Event & {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// The install event can arrive before any screen that offers installation is open.
let availablePrompt: InstallPrompt | null = null
if (import.meta.env.PROD) {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    availablePrompt = event as InstallPrompt
    window.dispatchEvent(new Event('workspace-install-changed'))
  })
  window.addEventListener('appinstalled', () => {
    availablePrompt = null
    window.dispatchEvent(new Event('workspace-install-changed'))
  })
}

/** True when the workspace runs as an installed app (home-screen icon). */
export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch { return false }
}

export type InstallPlatform = 'prompt' | 'ios' | 'in-app' | 'manual'

/** How this browser installs apps: native prompt, iOS Share sheet, or an in-app browser that cannot. */
export function installPlatform(hasPrompt: boolean): InstallPlatform {
  const agent = navigator.userAgent
  if (/FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Line\/|MicroMessenger/i.test(agent)) return 'in-app'
  if (hasPrompt) return 'prompt'
  const ios = /iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios ? 'ios' : 'manual'
}

/** The captured native install prompt, if the browser offered one. */
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(availablePrompt)
  useEffect(() => {
    const update = () => setPrompt(availablePrompt)
    window.addEventListener('workspace-install-changed', update)
    return () => window.removeEventListener('workspace-install-changed', update)
  }, [])
  async function install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!prompt || availablePrompt !== prompt) return 'unavailable'
    availablePrompt = null
    setPrompt(null)
    try { return (await prompt.prompt()).outcome } catch { return 'unavailable' }
  }
  return { available: !!prompt, install }
}

/** Settings page "Install the app" section body. The Today banner (src/features/install) uses the same capture. */
export function InstallWorkspace() {
  const { available, install } = useInstallPrompt()
  const [status, setStatus] = useState('')

  async function start() {
    const outcome = await install()
    setStatus(outcome === 'accepted' ? 'Installing. Look for the TEDx icon on your home screen.'
      : outcome === 'dismissed' ? 'No problem. You can install later from here or your browser menu.'
        : 'Installation could not start. Check your browser menu for Install or Add to Home Screen.')
  }

  if (isStandalone()) return <p className="muted">You're using the installed app. Nothing to do here.</p>
  if (!import.meta.env.PROD) return <p className="muted">Installing works on the published workspace, not in local development.</p>
  const platform = installPlatform(available)
  return <>
    <p>Add the workspace to your home screen. It opens faster and can send reminders. You still need a connection to load work.</p>
    {platform === 'prompt' ? <button className="button button--secondary" onClick={() => void start()}>Install the app</button>
      : platform === 'ios' ? <p>In Safari, tap Share, then Add to Home Screen, then Add.</p>
        : platform === 'in-app' ? <p>Open this page in Safari or Chrome first. In-app browsers cannot install apps.</p>
          : <p>Look for Install or Add to Home Screen in your browser menu.</p>}
    <p role="status">{status}</p>
  </>
}
