/* global self, caches, fetch, Request, Response, URL, clients */
const prefix = 'tedx-public-shell-'
const cacheName = prefix + '6'
// Build output under <base>/assets/ has content hashes in its names, so a cached copy never goes
// stale. GitHub Pages only sends max-age=600; this cache makes repeat visits load from disk.
const assetPrefix = 'tedx-assets-'
const assetCacheName = assetPrefix + '1'
const assetLimit = 300
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
    await Promise.all(names.filter(name => (name.startsWith(prefix) && name !== cacheName) || (name.startsWith(assetPrefix) && name !== assetCacheName))
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

  // Hashed build files: cache first. Only plain same-origin successes are stored, never
  // opaque, redirected or partial responses, and never anything sent with credentials headers.
  const assetsPath = base + 'assets/'
  if (!url.search && url.pathname.startsWith(assetsPath) && request.mode !== 'navigate') {
    event.respondWith(caches.open(assetCacheName).then(async cache => {
      const cached = await cache.match(url.pathname)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok && response.status === 200 && response.type === 'basic' && !response.redirected) {
        event.waitUntil(cache.put(url.pathname, response.clone()).then(() => trimAssets(cache)))
      }
      return response
    }))
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

// Old builds' files pile up across deploys; drop the oldest entries past the limit.
async function trimAssets(cache) {
  const keys = await cache.keys()
  if (keys.length > assetLimit) await Promise.all(keys.slice(0, keys.length - assetLimit).map(key => cache.delete(key)))
}

// Device notifications (Web Push). The payload is a small JSON object made by the server:
// { title, body, url, tag, ts }. url is an app route such as /tasks/<id>, resolved inside the scope.
const iconPath = base + 'brand/icons/icon-192.png'
const badgePath = base + 'brand/icons/badge-96.png'

function scopedUrl(path) {
  const route = typeof path === 'string' && /^\/[A-Za-z0-9/_-]{0,200}$/.test(path) ? path.slice(1) : ''
  return new URL(base + route, self.location.origin).href
}

self.addEventListener('push', event => {
  let data
  try { data = (event.data && event.data.json()) || {} } catch { data = {} }
  const text = (value, fallback, max) => typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback
  const title = text(data.title, 'TEDx workspace', 120)
  const options = {
    body: text(data.body, 'Open the workspace to see what changed.', 240),
    icon: iconPath,
    badge: badgePath,
    tag: text(data.tag, 'tedx-update', 200),
    renotify: true,
    timestamp: Number.isFinite(data.ts) ? data.ts : Date.now(),
    data: { url: scopedUrl(data.url) },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = event.notification.data && typeof event.notification.data.url === 'string' ? event.notification.data.url : scopedUrl('/')
  const scope = self.registration.scope
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find(client => client.url.startsWith(scope))
    if (open) {
      // The open app moves with its own router, then comes to the front.
      open.postMessage({ type: 'workspace-navigate', url: target })
      await open.focus().catch(() => undefined)
      return
    }
    await clients.openWindow(target)
  })())
})

// The browser rotated the subscription. Subscribe again with the same server key; the app saves
// the new endpoint to the workspace the next time it opens (it compares with what it last saved).
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey
    if (!key) return
    try {
      await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) client.postMessage({ type: 'push-subscription-changed' })
    } catch { /* Permission was withdrawn; the app shows notifications as off. */ }
  })())
})
