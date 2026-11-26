// The app can be served from a subpath (GitHub Pages project sites serve from
// /<repository>/). Vite exposes the configured base as BASE_URL with a trailing
// slash. Router links handle it through the router basename; use these helpers
// for raw browser URLs (window.location, history, absolute links, sign-in).
const base = import.meta.env.BASE_URL || '/'

/** Base path without a trailing slash: '' at the domain root, '/Repo' on a subpath. */
export const basePath = base === '/' ? '' : base.replace(/\/$/, '')

/** Prefix an app path such as '/login' with the deployment base path. */
export function appPath(path: string): string {
  return basePath + (path.startsWith('/') ? path : '/' + path)
}

/** Remove the deployment base path from a browser pathname to get the app path. */
export function stripBase(pathname: string): string {
  if (!basePath) return pathname
  if (pathname === basePath) return '/'
  return pathname.startsWith(basePath + '/') ? pathname.slice(basePath.length) : pathname
}
