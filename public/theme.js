/* global window, document */
// Applies the saved theme before the first paint to avoid a flash of the wrong theme.
// Order: stored choice, then the system preference, then dark. Loaded as an external
// file because the Content Security Policy does not allow inline scripts.
(function () {
  var theme = 'dark'
  var stored = null
  try { stored = window.localStorage.getItem('tedx-workspace-theme') } catch { /* Storage optional. */ }
  if (stored === 'light' || stored === 'dark') theme = stored
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light'
  document.documentElement.setAttribute('data-theme', theme)
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#111111' : '#ffffff')
})()
