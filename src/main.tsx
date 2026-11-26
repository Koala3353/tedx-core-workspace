import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { createAppRouter } from './app/router'
import './lib/fonts.css'
import './styles/tokens.css'
import './styles/global.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Registration is optional. Online access works even if the browser blocks installation.
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}workspace-sw.js`, { updateViaCache: 'none' }).catch(() => {})
}

// Static hosts such as GitHub Pages cannot send frame-ancestors or X-Frame-Options.
// Refuse to render inside another site's frame to prevent clickjacking.
if (window.top !== window.self) {
  throw new Error('The workspace cannot be displayed inside a frame.')
}

const root = document.getElementById('root')
if (!root) throw new Error('The application root is missing from index.html.')

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
)
