import { emailCodeErrorFrom } from './EmailCodeSignIn'
import type { ViewAsApi } from '../view-as/api'
import type { TurnoverApi } from '../admin/turnover/api'
import {createPrivacyApi,type PrivacyApi} from '../admin/privacy/api'
import {createOperationalExport,type OperationalExport} from '../exports/operational'
import {createAnnouncementsApi,type AnnouncementsApi} from '../announcements/api'
import {createSiteWordingApi,type SiteWordingApi} from '../admin/site/wording-api'
import {createPublishedSiteApi,type PublishedSiteApi} from '../admin/site/published'
import type { TaskImportsApi } from '../imports/task-import-api'
import type { RosterImportsApi } from '../imports/roster-import-api'
import type { ProcessApi } from '../admin/process/api'
import {createSearchApi,type SearchApi} from '../search/api'
import type { ReportsApi } from '../reports/api'
import type { LayoutAdminApi } from '../admin/layouts/api'
import {createConfigurationApi,type ConfigurationApi} from '../admin/config/api'
import type { AccessApi } from '../admin/access/api'
import {createOrganizationApi,type OrganizationApi} from '../admin/organization/api'
import type { ResourcesApi } from '../resources/api'
import {createCalendarApi,type CalendarApi} from '../calendar/api'
import type { RoomBookingApi } from '../rooms/api'
import type { InventoryApi } from '../inventory/api'
import type { GrowthApi } from '../growth/api'
import type { EvaluationsApi } from '../evaluations/api'
import {createCalendarSyncApi} from '../integrations/calendar/api'
import {createNotificationsApi,type NotificationsApi} from '../notifications/api'
import {createTelegramApi} from '../integrations/telegram/api'
import {createEmailDigestApi} from '../integrations/email/api'
import type { ReadinessApi } from '../deliverables/readiness-api'
import type { PublicityApi } from '../publicity/api'
import type { LedgerApi } from '../finance/ledger-api'
import type { FinAuthorityApi } from '../finance/authority-api'
import type { FinanceApi } from '../finance/api'
import type { InboxApi } from '../approvals/inbox-api'
import type { ApprovalsApi } from '../approvals/api'
import {createRequestsApi,type RequestsApi} from '../requests/api'
import type { FormsApi } from '../forms/api'
import type { CatalogApi } from '../requests/catalog/api'
import type { TimelineApi } from '../timeline/api'
import type { HandoffsApi } from '../handoffs/api'
import type { DependenciesApi } from '../tasks/dependenciesApi'
import type { SynergiesApi } from '../synergies/api'
import {createOverviewApi,type OverviewApi} from '../overview/api'
import {createFilesApi,type FilesApi} from '../files/api'
import {createDriveApi} from '../integrations/drive/api'
import type { CommentsApi } from '../comments/api'
import {createClientStateApi,type ClientStateApi} from '../../lib/clientState'
import type { TeamSetupApi } from '../team-setup/api'
import type { WarRoomApi } from '../war-room/api'
import type { WhoToAskApi } from '../who-to-ask/api'
import type { DeveloperMessageApi } from '../developer-message/api'
import type { AdminDataApi } from '../admin/data/api'
import type { CommitteePagesApi } from '../committee-pages/api'
import type { SpeakerPortalApi } from '../speaker-portal/api'
import type { EventBoardsApi } from '../event-boards/api'
import type { RunOfShowApi } from '../run-of-show/api'
import type { EventQrApi } from '../event-qr/api'
import type { ClientEnvironment } from '../../lib/env'
import { announceUpdate } from '../../lib/appUpdate'
import { createSupabaseClient } from '../../lib/supabase'
import { callbackUrl, forgetSession, safeReturnPath } from './redirects'
import { createGuestGateway, type GuestGateway } from '../guests/gateway'
import type { PeopleGateway } from '../people/gateway'
import { createPeopleOptionsApi, type PeopleOptionsApi } from '../people/peopleOptions'
import type { ProfileGateway } from '../account/gateway'
import type { GuestContactGateway } from '../account/guestContacts'
import type { DeliverablesApi } from '../deliverables/api'
import type { DeliverableCommands } from '../deliverables/commands'
import { createTasksApi, type TasksApi } from '../tasks/api'

export type MemberContext = {
  state: 'authorized'; memberId: string; displayName: string; organizationId: string
  termId: string; termMembershipId: string; expiresAt: string; capabilities: string[]
}
export type GuestContext = {
  state: 'authorized'; audience: 'guest'; guestAccessId: string; displayName: string
  organizationId: string; termId: string; expiresAt: string; capabilities: string[]
}
export type WorkspaceContext = MemberContext | GuestContext
export const isGuest = (value: WorkspaceContext): value is GuestContext => 'audience' in value && value.audience === 'guest'
export type AuthResult = WorkspaceContext | { state: 'unavailable' | 'signed_out' | 'denied' | 'error' }
export interface AuthGateway {
  clientState?: ClientStateApi
  teamSetup?: TeamSetupApi
  warRoom?: WarRoomApi
  whoToAsk?: WhoToAskApi
  developerMessage?: DeveloperMessageApi
  adminData?: AdminDataApi
  committeePages?: CommitteePagesApi
  speakerPortal?: SpeakerPortalApi
  eventBoards?: EventBoardsApi
  runOfShow?: RunOfShowApi
  eventQr?: EventQrApi
  viewAs?: ViewAsApi
  turnover?: TurnoverApi
  privacy?: PrivacyApi
  exportOperationalWork?: OperationalExport
  announcements?: AnnouncementsApi
  siteWording?: SiteWordingApi
  site?: PublishedSiteApi
  taskImports?: TaskImportsApi
  rosterImports?: RosterImportsApi
  reports?: ReportsApi
  search?: SearchApi
  layouts?: LayoutAdminApi
  process?: ProcessApi
  configuration?: ConfigurationApi
  access?: AccessApi
  organization?: OrganizationApi
  resources?: ResourcesApi
  calendar?: CalendarApi
  roomBookings?: RoomBookingApi
  inventory?: InventoryApi
  growth?: GrowthApi
  evaluations?: EvaluationsApi
  notifications?: NotificationsApi
  readiness?: ReadinessApi
  publicity?: PublicityApi
  ledger?: LedgerApi
  finAuthority?: FinAuthorityApi
  finance?: FinanceApi
  catalog?: CatalogApi
  forms?: FormsApi
  requests?: RequestsApi
  inbox?: InboxApi
  approvals?: ApprovalsApi
  timeline?: TimelineApi
  handoffs?: HandoffsApi
  dependencies?: DependenciesApi
  synergies?: SynergiesApi
  overview?: OverviewApi
  files?: FilesApi
  comments?: CommentsApi
  tasks?: TasksApi
  deliverables?: DeliverablesApi
  deliverableCommands?: DeliverableCommands
  guestContacts?: GuestContactGateway
  profile?: ProfileGateway
  people?: PeopleGateway
  /** Committee and position labels for person pickers (read_people_options). */
  peopleOptions?: PeopleOptionsApi
  guests?: GuestGateway
  readContext: (signal?: AbortSignal,termId?:string) => Promise<AuthResult>
  beginGoogle: (returnTo: string) => Promise<void>
  requestEmailCode: (email: string) => Promise<void>
  verifyEmailCode: (email: string, code: string) => Promise<void>
  exchange: (code: string) => Promise<void>
  /** `everywhere` ends every session for this account (all devices), not just this browser's. */
  signOut: (options?: { everywhere?: boolean }) => Promise<void>
  onChange: (listener: () => void) => () => void
}

export function parseContext(input: unknown): WorkspaceContext | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  const keys = value.audience === 'guest' ? ['guestAccessId','displayName','organizationId','termId','expiresAt'] : ['memberId','displayName','organizationId','termId','termMembershipId','expiresAt']
  if (value.state !== 'authorized' || !keys.every((key) => typeof value[key] === 'string' && value[key] !== '')
    || !Array.isArray(value.capabilities) || !value.capabilities.every((entry) => typeof entry === 'string')
    || !Number.isFinite(Date.parse(value.expiresAt as string)) || Date.parse(value.expiresAt as string) <= Date.now()) return null
  if (value.audience === 'guest' && value.capabilities.length !== 0) return null
  return value as WorkspaceContext
}


// Long enough for a slow phone connection to refresh a token and read the context, short
// enough that a stuck check is reported instead of leaving the page waiting.
const contextTimeoutMs = 15_000

/** Resolves with the check's result, or { state: 'error' } after `ms` or when `signal` aborts. */
function settleWithin(check: Promise<AuthResult>, signal: AbortSignal | undefined, ms: number): Promise<AuthResult> {
  return new Promise(resolve => {
    let done = false
    const finish = (result: AuthResult) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); resolve(result) }
    const aborted = () => finish({ state: 'error' })
    const timer = setTimeout(() => finish({ state: 'error' }), ms)
    if (signal?.aborted) { aborted(); return }
    signal?.addEventListener('abort', aborted, { once: true })
    check.then(finish, () => finish({ state: 'error' }))
  })
}

function transientAuthError(error: { name?: string; status?: number }): boolean {
  return error.name === 'AuthRetryableFetchError' || (typeof error.status === 'number' && (error.status === 0 || error.status >= 500))
}

// Token refreshes and the first session read are routine; only real identity changes re-check access.
const accessEvents = new Set(['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'])

// Members a lazy API must never report: promise detection, serialisation and React internals.
const notApiMembers = new Set(['then', 'toJSON', '$$typeof', 'constructor'])

/**
 * A feature API whose module downloads on its first call instead of with the entry chunk.
 * Only for APIs whose members are all methods returning promises (checked by the types the
 * gateway declares): each call waits for the module, then calls the real method. Methods are
 * memoised so `api.method` stays referentially stable for effect dependencies.
 */
function lazyApi<T extends object>(load: () => Promise<T>): T {
  let pending: Promise<T> | undefined
  const ready = () => pending ??= load().catch((error: unknown) => {
    pending = undefined
    // A missing chunk after a deploy: offer the new version; the call itself fails as any RPC would.
    announceUpdate()
    throw error
  })
  const methods = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  return new Proxy({} as T, {
    get(_target, key) {
      if (typeof key !== 'string' || notApiMembers.has(key)) return undefined
      let method = methods.get(key)
      if (!method) {
        method = (...args) => ready().then(api => (api as Record<string, (...input: unknown[]) => Promise<unknown>>)[key](...args))
        methods.set(key, method)
      }
      return method
    },
  })
}

export const returnStorageKey = 'tedx.auth.return'
export function consumeReturnPath(): string {
  try { const path = safeReturnPath(sessionStorage.getItem(returnStorageKey)); sessionStorage.removeItem(returnStorageKey); return path } catch { return '/' }
}

export function createAuthGateway(environment: ClientEnvironment, origin: string): AuthGateway {
  const redirectTo = callbackUrl(origin, environment.state === 'configured' ? environment.appOrigin : undefined)
  const clientReady = redirectTo ? createSupabaseClient(environment).catch(() => null) : Promise.resolve(null)
  const privacy = createPrivacyApi(clientReady)
  let exchangeCode: string | undefined
  let exchangePromise: Promise<void> | undefined
  async function readContextOnce(signal?: AbortSignal, termId?: string): Promise<AuthResult> {
    const client = await clientReady
    if (!client || !redirectTo) return { state: 'unavailable' }
    try {
      // getSession() refreshes an expired access token itself, but a refresh that is still in
      // flight (tab waking up, another navigation racing it) can surface as a missing session or
      // a rejected token. Refresh once and re-check before deciding the person is signed out.
      // Every check below still has to pass with the refreshed session.
      let refreshed = false
      const refreshOnce = async () => {
        if (refreshed) return false
        refreshed = true
        const { data, error } = await client.auth.refreshSession()
        return !error && !!data.session
      }
      let { data: session, error: sessionError } = await client.auth.getSession()
      if (sessionError && await refreshOnce()) ({ data: session, error: sessionError } = await client.auth.getSession())
      if (sessionError || !session.session) return { state: 'signed_out' }
      const resolve = () => { const bootstrap = client.rpc('resolve_auth_context'); return signal ? bootstrap.abortSignal(signal) : bootstrap }
      // The user check (auth server) and the workspace context (database) are independent round
      // trips, so they run together; the context is only used once the user check has passed.
      const start = () => { const call = Promise.resolve(resolve()); call.catch(() => undefined); return call }
      let pending = start()
      let { data: identity, error: identityError } = await client.auth.getUser()
      if ((identityError || !identity.user) && await refreshOnce()) {
        ({ data: identity, error: identityError } = await client.auth.getUser())
        pending = start()
      }
      // A network failure is not a sign-out: keep the person signed in and report the check failed.
      if (identityError && transientAuthError(identityError)) return { state: 'error' }
      if (identityError || !identity.user) return { state: 'signed_out' }
      signal?.throwIfAborted()
      const first = await pending
      let { data, error } = first
      // An access token that expired between the checks above and this call: refresh and retry once.
      if (error && (first.status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') && await refreshOnce()) ({ data, error } = await resolve())
      if (error) return { state: 'error' }
      if(termId){
        const initial=parseContext(data);if(!initial)return{state:'denied'}
        if(isGuest(initial))return initial.termId===termId?initial:{state:'denied'}
        const scoped=client.rpc('read_search_term_context',{p_term_id:termId})
        ;({data,error}=await(signal?scoped.abortSignal(signal):scoped));if(error)return{state:error.code==='42501'?'denied':'error'}
      }
      const context=parseContext(data)
      return context&&(!termId||context.termId===termId)?context:{state:'denied'}
    } catch { return { state: 'error' } }
  }
  return {
    privacy,
    clientState: createClientStateApi(clientReady),
    teamSetup: lazyApi(() => import('../team-setup/api').then(m => m.createTeamSetupApi(clientReady))),
    warRoom: lazyApi(() => import('../war-room/api').then(m => m.createWarRoomApi(clientReady))),
    whoToAsk: lazyApi(() => import('../who-to-ask/api').then(m => m.createWhoToAskApi(clientReady))),
    developerMessage: lazyApi(() => import('../developer-message/api').then(m => m.createDeveloperMessageApi(clientReady))),
    adminData: lazyApi(() => import('../admin/data/api').then(m => m.createAdminDataApi(clientReady))),
    committeePages: lazyApi(() => import('../committee-pages/api').then(m => m.createCommitteePagesApi(clientReady))),
    speakerPortal: lazyApi(() => import('../speaker-portal/api').then(m => m.createSpeakerPortalApi(clientReady))),
    eventBoards: lazyApi(() => import('../event-boards/api').then(m => m.createEventBoardsApi(clientReady))),
    runOfShow: lazyApi(() => import('../run-of-show/api').then(m => m.createRunOfShowApi(clientReady))),
    eventQr: lazyApi(() => import('../event-qr/api').then(m => m.createEventQrApi(clientReady))),
    viewAs: lazyApi(() => import('../view-as/api').then(m => m.createViewAsApi(clientReady))),
    turnover: lazyApi(() => import('../admin/turnover/api').then(m => m.createTurnoverApi(clientReady))),
    announcements: createAnnouncementsApi(clientReady),
    site: createPublishedSiteApi(clientReady),
    siteWording: createSiteWordingApi(clientReady),
    process: lazyApi(() => import('../admin/process/api').then(m => m.createProcessApi(clientReady))),
    configuration: createConfigurationApi(clientReady),
    access: lazyApi(() => import('../admin/access/api').then(m => m.createAccessApi(clientReady))),
    organization: createOrganizationApi(clientReady),
    resources: lazyApi(() => import('../resources/api').then(m => m.createResourcesApi(clientReady))),
    calendar: createCalendarApi(clientReady,environment.state==='configured'&&environment.calendarSync&&environment.appOrigin===origin
      ?createCalendarSyncApi(clientReady,environment.appOrigin):undefined),
    roomBookings: lazyApi(() => import('../rooms/api').then(m => m.createRoomBookingApi(clientReady))),
    inventory: lazyApi(() => import('../inventory/api').then(m => m.createInventoryApi(clientReady))),
    growth: lazyApi(() => import('../growth/api').then(m => m.createGrowthApi(clientReady))),
    evaluations: lazyApi(() => import('../evaluations/api').then(m => m.createEvaluationsApi(clientReady))),
    notifications: createNotificationsApi(clientReady,
      environment.state==='configured'&&environment.telegramBot&&environment.appOrigin===origin
        ?createTelegramApi(clientReady,environment.appOrigin,environment.telegramBot):undefined,
      environment.state==='configured'&&environment.emailDigest&&environment.appOrigin===origin
        ?createEmailDigestApi(clientReady,environment.appOrigin):undefined),
    readiness: lazyApi(() => import('../deliverables/readiness-api').then(m => m.createReadinessApi(clientReady))),
    publicity: lazyApi(() => import('../publicity/api').then(m => m.createPublicityApi(clientReady))),
    ledger: lazyApi(() => import('../finance/ledger-api').then(m => m.createLedgerApi(clientReady))),
    finAuthority: lazyApi(() => import('../finance/authority-api').then(m => m.createFinAuthorityApi(clientReady))),
    finance: lazyApi(() => import('../finance/api').then(m => m.createFinanceApi(clientReady))),
    catalog: lazyApi(() => import('../requests/catalog/api').then(m => m.createCatalogApi(clientReady))),
    forms: lazyApi(() => import('../forms/api').then(m => m.createFormsApi(clientReady))),
    requests: createRequestsApi(clientReady),
    approvals: lazyApi(() => import('../approvals/api').then(m => m.createApprovalsApi(clientReady))),
    inbox: lazyApi(() => import('../approvals/inbox-api').then(m => m.createInboxApi(clientReady))),
    timeline: lazyApi(() => import('../timeline/api').then(m => m.createTimelineApi(clientReady))),
    handoffs: lazyApi(() => import('../handoffs/api').then(m => m.createHandoffsApi(clientReady))),
    dependencies: lazyApi(() => import('../tasks/dependenciesApi').then(m => m.createDependenciesApi(clientReady))),
    synergies: lazyApi(() => import('../synergies/api').then(m => m.createSynergiesApi(clientReady))),
    layouts: lazyApi(() => import('../admin/layouts/api').then(m => m.createLayoutAdminApi(clientReady))),
    search: createSearchApi(clientReady),
    reports: lazyApi(() => import('../reports/api').then(m => m.createReportsApi(clientReady))),
    exportOperationalWork: createOperationalExport(clientReady),
    taskImports: lazyApi(() => import('../imports/task-import-api').then(m => m.createTaskImportsApi(clientReady))),
    rosterImports: lazyApi(() => import('../imports/roster-import-api').then(m => m.createRosterImportsApi(clientReady))),
    overview: createOverviewApi(clientReady),
    files: createFilesApi(clientReady,environment.state==='configured'&&environment.drivePicker&&environment.appOrigin===origin
      ?createDriveApi(clientReady,environment.appOrigin,environment.driveEvidence):undefined),
    comments: lazyApi(() => import('../comments/api').then(m => m.createCommentsApi(clientReady))),
    tasks: createTasksApi(clientReady),
    deliverables: lazyApi(() => import('../deliverables/api').then(m => m.createDeliverablesApi(clientReady))),
    deliverableCommands: lazyApi(() => import('../deliverables/commands').then(m => m.createDeliverableCommands(clientReady))),
    guestContacts: lazyApi(() => import('../account/guestContacts').then(m => m.createGuestContactGateway(clientReady))),
    profile: lazyApi(() => import('../account/gateway').then(m => m.createProfileGateway(clientReady))),
    peopleOptions: createPeopleOptionsApi(clientReady),
    people: lazyApi(() => import('../people/gateway').then(m => m.createPeopleGateway(clientReady))),
    guests: createGuestGateway(clientReady),
    readContext(signal,termId) {
      // Every access check settles: a superseded navigation aborts it, and a check that hangs
      // (an auth lock held by a sleeping tab, a stalled token refresh, a dropped connection)
      // gives up after contextTimeoutMs, so "Checking access" can never stay on screen.
      return settleWithin(readContextOnce(signal,termId), signal, contextTimeoutMs)
    },
    async requestEmailCode(email) {
      const client = await clientReady
      if (!client) throw emailCodeErrorFrom(new Error('unavailable'))
      const { error } = await client.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } })
      if (error) throw emailCodeErrorFrom(error)
    },
    async verifyEmailCode(email, code) {
      const client = await clientReady
      if (!client) throw emailCodeErrorFrom(new Error('unavailable'))
      const { error } = await client.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' })
      if (error) throw emailCodeErrorFrom(error)
    },
    async beginGoogle(returnTo) {
      const client = await clientReady
      if (!client || !redirectTo) throw new Error('Sign-in is not configured for this address.')
      try { sessionStorage.setItem(returnStorageKey, safeReturnPath(returnTo)) } catch { /* Safe fallback is the overview. */ }
      try { const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: {
        redirectTo, scopes: 'openid email profile', queryParams: { prompt: 'select_account' },
      } })
        if (error) throw error
      } catch { throw new Error('Google sign-in could not start. Check provider setup or try again.') }
    },
    exchange(code) {
      // StrictMode can replay the callback effect. Exchange each code once per gateway instance.
      if (exchangeCode !== code) {
        exchangeCode = code
        exchangePromise = (async () => {
          const client = await clientReady
          if (!client || !redirectTo) throw new Error('Sign-in is not configured.')
          try { const { error } = await client.auth.exchangeCodeForSession(code); if (error) throw error }
          catch { throw new Error('Google sign-in could not be completed. Start sign-in again.') }
        })()
      }
      return exchangePromise!
    },
    async signOut(options) {
      const client = await clientReady
      if (!client) return
      const everywhere = options?.everywhere === true
      try {
        const { error } = await client.auth.signOut({ scope: everywhere ? 'global' : 'local' })
        if (error) {
          // Signing out everywhere must reach the server; a local-only clear isn't enough.
          if (everywhere) throw error
          const remaining = await client.auth.getSession()
          if (remaining.error || remaining.data.session) throw error
        }
      }
      catch { throw new Error(everywhere ? 'Couldn\'t sign out your other devices. Check your connection and try again.' : 'Couldn\'t confirm you\'re signed out. Try again.') }
      exchangeCode = undefined
      exchangePromise = undefined
      try { sessionStorage.removeItem(returnStorageKey) } catch { /* No application data is cached. */ }
      forgetSession()
    },
    onChange(listener) {
      let stopped = false
      let unsubscribe = () => undefined as void
      void clientReady.then((client) => {
        if (!client || stopped) return
        // Defer past supabase-js's auth lock: calling back into auth from inside this callback
        // (which a revalidation does through readContext) can deadlock on that lock.
        const { data } = client.auth.onAuthStateChange((event) => {
          if (!accessEvents.has(event)) return
          setTimeout(() => { if (!stopped) listener() }, 0)
        })
        unsubscribe = () => data.subscription.unsubscribe()
      })
      return () => { stopped = true; unsubscribe() }
    },
  }
}
