import { basePath } from '../../lib/basePath'
import {parseTimelineQuery,timelineSearch} from '../timeline/filters'
import { navigationItems } from '../../app/navigation'

export const authOrigins = ['http://127.0.0.1:5173', 'http://127.0.0.1:4173'] as const
const hasControl = (value: string) => Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)
export const isDeliverablePath = (path: string) => /^\/deliverables\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)
export const isTaskPath = (path: string) => /^\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)
export const isAnnouncementPath=(path:string)=>/^\/announcements(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i.test(path)
export const isPrivacyPath=(path:string)=>/^\/privacy(?:\/requests\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i.test(path)
export const isHandoffPath=(path:string)=>/^\/working-together\/handoffs(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i.test(path)
export const isAgreementPath = (path: string) => /^\/working-together\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)
export function callbackUrl(origin: string, configuredOrigin?: string): string | null {
  const allowed = configuredOrigin ? origin === configuredOrigin : authOrigins.some(value => value === origin)
  return allowed ? `${origin}${basePath}/auth/callback` : null
}

// Every in-app area a signed-out deep link may return to. Anything else falls back to the overview.
const knownRoots = new Set(['admin', 'requests', 'reviews', 'finance', 'publicity', 'prism', 'inventory', 'handover', 'archive', 'working-together', 'guests', 'guest', 'shared', 'account', 'notifications', 'calendar', 'people', 'resources', 'search', 'reports', 'committee', 'mentoring', 'privacy', 'tasks', 'deliverables', 'announcements', 'feedback', 'department', 'member-preview', 'work', 'event', 'team', 'desk', 'my-part', 'overview'])
const safeSegment = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]{0,127}$/
// Crew door QR codes: /event/check-in/<token>. Only this exact shape may survive sign-in.
const checkInPath = /^\/event\/check-in\/[A-Za-z0-9_-]{16,128}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Paths that keep a validated `term` (and, for People/Resources, one focus id) across sign-in.
function keepsQuery(path: string): boolean {
  const parts = path.split('/')
  const requestPath = parts.length === 4 && parts[1] === 'requests' && uuidPattern.test(parts[2]) && uuidPattern.test(parts[3])
  const inventoryPath = path === '/inventory' || parts.length === 3 && parts[1] === 'inventory' && uuidPattern.test(parts[2])
  return path === '/search' || path === '/reports' || path === '/people' || path === '/resources' || path === '/mentoring' || isTaskPath(path) || isDeliverablePath(path) || isAnnouncementPath(path) || isPrivacyPath(path) || requestPath || inventoryPath
}
function isKnownRoute(path: string): boolean {
  if (path === '/') return true
  if (path.length > 512) return false
  const segments = path.slice(1).split('/')
  if (segments.length > 6 || segments.some(segment => !safeSegment.test(segment) || segment === '.' || segment === '..')) return false
  if (path.endsWith('/')) return false
  const root = segments[0]
  if (root === 'guest') return path === '/guest/redeem'
  if (segments[1] === 'check-in') return root === 'event' && checkInPath.test(path)
  if (root === 'my-part') return path === '/my-part' || path === '/my-part/info'
  if (root === 'work' || root === 'desk' || root === 'overview') return segments.length === 1
  return knownRoots.has(root) || navigationItems.some(item => item.href !== '/' && (item.href === path || path.startsWith(item.href + '/')))
}

export function safeReturnPath(value: string | null): string {
  if(value?.startsWith('/working-together/timeline?')&&!/[\\#]/.test(value)&&!hasControl(value))return '/working-together/timeline'+timelineSearch(parseTimelineQuery(value.slice(value.indexOf('?'))))
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\%@]/.test(value) || hasControl(value)) return '/'
  const path = value.split(/[?#]/, 1)[0]
  if (!isKnownRoute(path)) return '/'
  if (!keepsQuery(path)) return path
  const input=new URLSearchParams(value.split('?')[1]?.split('#')[0]),kept=new URLSearchParams()
  const focus=path==='/resources'?'resource':path==='/people'?'contact':path==='/inventory'?'item':null
  if(focus&&input.getAll(focus).length===1&&uuidPattern.test(input.get(focus)!))kept.set(focus,input.get(focus)!)
  if(input.getAll('term').length===1&&uuidPattern.test(input.get('term')!))kept.set('term',input.get('term')!)
  return path+(kept.size?'?'+kept.toString():'')
}

// A content-free marker that this browser held a workspace session, so the sign-in page
// can say a session ended instead of greeting first-time visitors with an expiry notice.
const sessionMarkerKey = 'tedx-workspace-had-session'
export function rememberSession(): void { try { localStorage.setItem(sessionMarkerKey, '1') } catch { /* Storage optional. */ } }
export function forgetSession(): void { try { localStorage.removeItem(sessionMarkerKey) } catch { /* Storage optional. */ } }
export function hadSession(): boolean { try { return localStorage.getItem(sessionMarkerKey) === '1' } catch { return false } }

export function readCallback(search: string): string | null {
  const params = new URLSearchParams(search)
  if (params.has('error') || params.has('error_description') || params.getAll('code').length !== 1) return null
  const code = params.get('code')
  return code && code.length <= 2048 && !/\s/.test(code) && !hasControl(code) ? code : null
}
