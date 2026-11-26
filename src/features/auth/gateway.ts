import {createTurnoverApi,type TurnoverApi} from '../admin/turnover/api'
import {createPrivacyApi,type PrivacyApi} from '../admin/privacy/api'
import {createOperationalExport,type OperationalExport} from '../exports/operational'
import {createAnnouncementsApi,type AnnouncementsApi} from '../announcements/api'
import {createSiteWordingApi,type SiteWordingApi} from '../admin/site/wording-api'
import {createPublishedSiteApi,type PublishedSiteApi} from '../admin/site/published'
import {createTaskImportsApi,type TaskImportsApi} from '../imports/task-import-api'
import {createRosterImportsApi,type RosterImportsApi} from '../imports/roster-import-api'
import {createProcessApi,type ProcessApi} from '../admin/process/api'
import {createSearchApi,type SearchApi} from '../search/api'
import {createReportsApi,type ReportsApi} from '../reports/api'
import {createLayoutAdminApi,type LayoutAdminApi} from '../admin/layouts/api'
import {createConfigurationApi,type ConfigurationApi} from '../admin/config/api'
import {createAccessApi,type AccessApi} from '../admin/access/api'
import {createOrganizationApi,type OrganizationApi} from '../admin/organization/api'
import {createResourcesApi,type ResourcesApi} from '../resources/api'
import {createCalendarApi,type CalendarApi} from '../calendar/api'
import {createRoomBookingApi,type RoomBookingApi} from '../rooms/api'
import {createInventoryApi,type InventoryApi} from '../inventory/api'
import {createGrowthApi,type GrowthApi} from '../growth/api'
import {createEvaluationsApi,type EvaluationsApi} from '../evaluations/api'
import {createCalendarSyncApi} from '../integrations/calendar/api'
import {createNotificationsApi,type NotificationsApi} from '../notifications/api'
import {createTelegramApi} from '../integrations/telegram/api'
import {createEmailDigestApi} from '../integrations/email/api'
import {createReadinessApi,type ReadinessApi} from '../deliverables/readiness-api'
import {createPublicityApi,type PublicityApi} from '../publicity/api'
import {createLedgerApi,type LedgerApi} from '../finance/ledger-api'
import {createFinAuthorityApi,type FinAuthorityApi} from '../finance/authority-api'
import {createFinanceApi,type FinanceApi} from '../finance/api'
import {createInboxApi,type InboxApi} from '../approvals/inbox-api'
import {createApprovalsApi,type ApprovalsApi} from '../approvals/api'
import {createRequestsApi,type RequestsApi} from '../requests/api'
import {createFormsApi,type FormsApi} from '../forms/api'
import {createCatalogApi,type CatalogApi} from '../requests/catalog/api'
import {createTimelineApi,type TimelineApi} from '../timeline/api'
import {createHandoffsApi,type HandoffsApi} from '../handoffs/api'
import {createDependenciesApi,type DependenciesApi} from '../tasks/dependenciesApi'
import {createSynergiesApi,type SynergiesApi} from '../synergies/api'
import {createOverviewApi,type OverviewApi} from '../overview/api'
import {createFilesApi,type FilesApi} from '../files/api'
import {createDriveApi} from '../integrations/drive/api'
import {createCommentsApi,type CommentsApi} from '../comments/api'
import {createClientStateApi,type ClientStateApi} from '../../lib/clientState'
import {createTeamSetupApi,type TeamSetupApi} from '../team-setup/api'
import {createWarRoomApi,type WarRoomApi} from '../war-room/api'
import {createWhoToAskApi,type WhoToAskApi} from '../who-to-ask/api'
import {createCommitteePagesApi,type CommitteePagesApi} from '../committee-pages/api'
import {createSpeakerPortalApi,type SpeakerPortalApi} from '../speaker-portal/api'
import {createEventBoardsApi,type EventBoardsApi} from '../event-boards/api'
import {createRunOfShowApi,type RunOfShowApi} from '../run-of-show/api'
import {createEventQrApi,type EventQrApi} from '../event-qr/api'
import type { ClientEnvironment } from '../../lib/env'
import { createSupabaseClient } from '../../lib/supabase'
import { callbackUrl, forgetSession, safeReturnPath } from './redirects'
import { createGuestGateway, type GuestGateway } from '../guests/gateway'
import { createPeopleGateway, type PeopleGateway } from '../people/gateway'
import { createProfileGateway, type ProfileGateway } from '../account/gateway'
import { createGuestContactGateway, type GuestContactGateway } from '../account/guestContacts'
import { createDeliverablesApi, type DeliverablesApi } from '../deliverables/api'
import { createDeliverableCommands, type DeliverableCommands } from '../deliverables/commands'

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
  committeePages?: CommitteePagesApi
  speakerPortal?: SpeakerPortalApi
  eventBoards?: EventBoardsApi
  runOfShow?: RunOfShowApi
  eventQr?: EventQrApi
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
  guests?: GuestGateway
  readContext: (signal?: AbortSignal,termId?:string) => Promise<AuthResult>
  beginGoogle: (returnTo: string) => Promise<void>
  exchange: (code: string) => Promise<void>
  signOut: () => Promise<void>
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
  return {
    privacy,
    clientState: createClientStateApi(clientReady),
    teamSetup: createTeamSetupApi(clientReady),
    warRoom: createWarRoomApi(clientReady),
    whoToAsk: createWhoToAskApi(clientReady),
    committeePages: createCommitteePagesApi(clientReady),
    speakerPortal: createSpeakerPortalApi(clientReady),
    eventBoards: createEventBoardsApi(clientReady),
    runOfShow: createRunOfShowApi(clientReady),
    eventQr: createEventQrApi(clientReady),
    turnover: createTurnoverApi(clientReady),
    announcements: createAnnouncementsApi(clientReady),
    site: createPublishedSiteApi(clientReady),
    siteWording: createSiteWordingApi(clientReady),
    process: createProcessApi(clientReady),
    configuration: createConfigurationApi(clientReady),
    access: createAccessApi(clientReady),
    organization: createOrganizationApi(clientReady),
    resources: createResourcesApi(clientReady),
    calendar: createCalendarApi(clientReady,environment.state==='configured'&&environment.calendarSync&&environment.appOrigin===origin
      ?createCalendarSyncApi(clientReady,environment.appOrigin):undefined),
    roomBookings: createRoomBookingApi(clientReady),
    inventory: createInventoryApi(clientReady),
    growth: createGrowthApi(clientReady),
    evaluations: createEvaluationsApi(clientReady),
    notifications: createNotificationsApi(clientReady,
      environment.state==='configured'&&environment.telegramBot&&environment.appOrigin===origin
        ?createTelegramApi(clientReady,environment.appOrigin,environment.telegramBot):undefined,
      environment.state==='configured'&&environment.emailDigest&&environment.appOrigin===origin
        ?createEmailDigestApi(clientReady,environment.appOrigin):undefined),
    readiness: createReadinessApi(clientReady),
    publicity: createPublicityApi(clientReady),
    ledger: createLedgerApi(clientReady),
    finAuthority: createFinAuthorityApi(clientReady),
    finance: createFinanceApi(clientReady),
    catalog: createCatalogApi(clientReady),
    forms: createFormsApi(clientReady),
    requests: createRequestsApi(clientReady),
    approvals: createApprovalsApi(clientReady),
    inbox: createInboxApi(clientReady),
    timeline: createTimelineApi(clientReady),
    handoffs: createHandoffsApi(clientReady),
    dependencies: createDependenciesApi(clientReady),
    synergies: createSynergiesApi(clientReady),
    layouts: createLayoutAdminApi(clientReady),
    search: createSearchApi(clientReady),
    reports: createReportsApi(clientReady),
    exportOperationalWork: createOperationalExport(clientReady),
    taskImports: createTaskImportsApi(clientReady),
    rosterImports: createRosterImportsApi(clientReady),
    overview: createOverviewApi(clientReady),
    files: createFilesApi(clientReady,environment.state==='configured'&&environment.drivePicker&&environment.appOrigin===origin
      ?createDriveApi(clientReady,environment.appOrigin,environment.driveEvidence):undefined),
    comments: createCommentsApi(clientReady),
    tasks: createTasksApi(clientReady),
    deliverables: createDeliverablesApi(clientReady),
    deliverableCommands: createDeliverableCommands(clientReady),
    guestContacts: createGuestContactGateway(clientReady),
    profile: createProfileGateway(clientReady),
    people: createPeopleGateway(clientReady),
    guests: createGuestGateway(clientReady),
    async readContext(signal,termId) {
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
        let { data: identity, error: identityError } = await client.auth.getUser()
        if ((identityError || !identity.user) && await refreshOnce()) ({ data: identity, error: identityError } = await client.auth.getUser())
        if (identityError || !identity.user) return { state: 'signed_out' }
        signal?.throwIfAborted()
        const resolve = () => { const bootstrap = client.rpc('resolve_auth_context'); return signal ? bootstrap.abortSignal(signal) : bootstrap }
        const first = await resolve()
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
    async signOut() {
      const client = await clientReady
      if (!client) return
      try {
        const { error } = await client.auth.signOut({ scope: 'local' })
        if (error) {
          const remaining = await client.auth.getSession()
          if (remaining.error || remaining.data.session) throw error
        }
      }
      catch { throw new Error('Couldn\'t confirm you\'re signed out. Try again.') }
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
        const { data } = client.auth.onAuthStateChange(() => { queueMicrotask(() => { if (!stopped) listener() }) })
        unsubscribe = () => data.subscription.unsubscribe()
      })
      return () => { stopped = true; unsubscribe() }
    },
  }
}
