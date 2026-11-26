/* global self, caches, fetch, Request, Response, URL */
const prefix = 'tedx-public-shell-'
const cacheName = prefix + '3'
// The worker is registered at <base>/workspace-sw.js, so its scope is the deployment base
// ('/' at a domain root, '/<repository>/' on a GitHub Pages project site).
const base = new URL(self.registration.scope).pathname
const offlinePath = base + 'offline/'
const publicFiles = [offlinePath, base + 'manifest.webmanifest', base + 'workspace-192.png', base + 'workspace-512.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(publicFiles.map(path =>
    new Request(path, { cache: 'reload', credentials: 'omit', redirect: 'error' }),
  ))))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith(prefix) && name !== cacheName)
      .map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization')) return

  if (!url.search && publicFiles.includes(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(url.pathname)) || fetch(request)))
    return
  }

  const appNavigation = /^\/(?:$|(?:login|auth|shared|account|announcements|privacy|privacy-notice|tasks|deliverables|working-together|requests|reviews|finance|publicity|resources|calendar|people|committee|department|reports|search|notifications|guests|guest|admin|inventory|mentoring|prism|feedback|archive|handover|work|event|team|desk|overview|today|member-preview)(?:\/[\w/-]*)?$)/
  const appPath = url.pathname.startsWith(base) ? '/' + url.pathname.slice(base.length) : null
  if (request.mode === 'navigate' && appPath !== null && appNavigation.test(appPath)) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(async () =>
      (await (await caches.open(cacheName)).match(offlinePath)) || Response.error(),
    ))
  }
})
