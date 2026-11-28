import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { createAppRouter } from './app/router'
import { UpdateToast } from './components/UpdateToast'
import { watchForStaleBuild } from './lib/appUpdate'
import { stripBase } from './lib/basePath'
import './lib/fonts.css'
import './styles/tokens.css'
import './styles/global.css'
import './styles/controls.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Registration is optional. Online access works even if the browser blocks installation.
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}workspace-sw.js`, { updateViaCache: 'none' }).catch(() => {})
}

watchForStaleBuild()

// Static hosts such as GitHub Pages cannot send frame-ancestors or X-Frame-Options.
// Refuse to render inside another site's frame to prevent clickjacking.
if (window.top !== window.self) {
  throw new Error('The workspace cannot be displayed inside a frame.')
}

const root = document.getElementById('root')
if (!root) throw new Error('The application root is missing from index.html.')

const router = createAppRouter()

// A tapped device notification focuses an open window and asks it to show the linked page.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    const data = event.data as { type?: unknown; url?: unknown } | null
    if (data?.type !== 'workspace-navigate' || typeof data.url !== 'string') return
    try {
      const url = new URL(data.url)
      if (url.origin === window.location.origin) void router.navigate(stripBase(url.pathname))
    } catch { /* Ignore malformed messages. */ }
  })
}

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
    <UpdateToast />
  </StrictMode>,
)
