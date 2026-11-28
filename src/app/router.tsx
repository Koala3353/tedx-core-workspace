import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { appPath, basePath, stripBase } from '../lib/basePath'
import { announceUpdate, chunkLoaded, reloadOnceForMissingChunk } from '../lib/appUpdate'
import { Countdown } from '../components/Countdown'
import { createBrowserRouter, Link, Navigate, redirect, useLocation, useRouteLoaderData, type RouteObject } from 'react-router'
import { readClientEnvironment, type ClientEnvironment } from '../lib/env'
import { PageHeading, Panel } from '../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../components/FeedbackState'
import { AppShell } from './AppShell'
import { SampleToday, canPreviewAsMember, isMemberPreviewPath, memberPreviewPath } from './MemberPreview'
import { deskCapabilities, navigationItems } from './navigation'
import { ShellServicesProvider } from './shellServices'
import { TodayPage } from '../features/today/Today'
import { BootScreen } from '../components/BrandLoader'
import { createAuthGateway, isGuest, type AuthGateway, type WorkspaceContext } from '../features/auth/gateway'
import { AccountPage, AuthRevalidator, CallbackPage, LoginPage, ProtectedShell } from '../features/auth/pages'
// Already in the first-load bundle through the shell (badge, hub card, account page),
// so these stay static imports.
import { Notifications } from '../features/notifications/Notifications'
import { DriveCallback } from '../features/integrations/drive/DriveSource'
import { forgetSession, hadSession, rememberSession, safeReturnPath, isDeliverablePath, isTaskPath, isAnnouncementPath, isPrivacyPath } from '../features/auth/redirects'
import { calendarCallback } from '../features/integrations/calendar/api'
import { installRoutePrefetch, type Preload } from './prefetch'
import { EmptyTasks } from '../components/illustrations'

/**
 * Route-level code splitting. Each feature page loads on first visit, inside its own
 * Suspense boundary. A failed chunk load means an old tab after a new deploy: the person is
 * opening this page right now, so reload once per build to pick up the current one. If that
 * was already tried, show the "new version" notice and let the route error page show.
 */
function lazyPage<C extends (props: never) => ReactNode>(load: () => Promise<C>): C & { preload: Preload } {
  // One download shared by prefetch and render. A failure is not cached, so the next try refetches.
  let loading: Promise<C> | undefined
  const fetchPage = () => loading ??= load().catch((error: unknown) => { loading = undefined; throw error })
  const Lazy = lazy(async () => {
    try {
      const component = await fetchPage()
      chunkLoaded()
      return { default: component as unknown as ComponentType<Record<string, unknown>> }
    } catch (error) {
      if (reloadOnceForMissingChunk()) return new Promise<never>(() => {})
      announceUpdate()
      throw error
    }
  })
  function LazyPage(props: Parameters<C>[0]) {
    return <Suspense fallback={<LoadingState />}><Lazy {...(props as Record<string, unknown>)} /></Suspense>
  }
  return Object.assign(LazyPage, { preload: fetchPage }) as unknown as C & { preload: Preload }
}

// The hubs and Team setup were first-load code; they now load on first visit like other pages.
const WorkHub = lazyPage(() => import('./hubs/Hubs').then(m => m.WorkHub))
const EventHub = lazyPage(() => import('./hubs/Hubs').then(m => m.EventHub))
const TeamHub = lazyPage(() => import('./hubs/Hubs').then(m => m.TeamHub))
const DeskHub = lazyPage(() => import('./hubs/Hubs').then(m => m.DeskHub))
const TeamSetupPage = lazyPage(() => import('../features/team-setup/TeamSetupPage').then(m => m.TeamSetupPage))
// Mirrors teamSetupCapabilities in TeamSetupPage.tsx (kept here so the loader gate doesn't pull that page
// into the entry chunk). The page re-checks with its own copy, and the server enforces both.
const teamSetupCapabilities = ['roles.manage', 'admin.configure'] as const

const ViewAsPage = lazyPage(() => import('../features/view-as/ViewAsPage').then(m => m.ViewAsPage))
const ArchivePage = lazyPage(() => import('../features/admin/turnover/ArchivePage').then(m => m.ArchivePage))
const TurnoverPage = lazyPage(() => import('../features/admin/turnover/TurnoverPage').then(m => m.TurnoverPage))
const PrivacyPage = lazyPage(() => import('../features/admin/privacy/Privacy').then(m => m.PrivacyPage))
const PrivacyRequestPage = lazyPage(() => import('../features/admin/privacy/Privacy').then(m => m.PrivacyRequestPage))
const PrivacyAdministration = lazyPage(() => import('../features/admin/privacy/Administration').then(m => m.PrivacyAdministration))
const RetentionPage = lazyPage(() => import('../features/admin/privacy/RetentionPage').then(m => m.RetentionPage))
const DispositionPage = lazyPage(() => import('../features/admin/privacy/DispositionPage').then(m => m.DispositionPage))
const BackupHealthPage = lazyPage(() => import('../features/admin/health/BackupHealthPage').then(m => m.BackupHealthPage))
const EmergencyPage = lazyPage(() => import('../features/admin/privacy/EmergencyPage').then(m => m.EmergencyPage))
const Announcements = lazyPage(() => import('../features/announcements/Reader').then(m => m.Announcements))
const AnnouncementDetail = lazyPage(() => import('../features/announcements/Reader').then(m => m.AnnouncementDetail))
const ContextAnnouncements = lazyPage(() => import('../features/announcements/Reader').then(m => m.ContextAnnouncements))
const AnnouncementPublisher = lazyPage(() => import('../features/announcements/Publisher').then(m => m.AnnouncementPublisher))
const ProcessPage = lazyPage(() => import('../features/admin/process/ProcessPage').then(m => m.ProcessPage))
const CurrentPhase = lazyPage(() => import('../features/admin/process/ProcessPage').then(m => m.CurrentPhase))
const Search = lazyPage(() => import('../features/search/Search').then(m => m.Search))
const Reports = lazyPage(() => import('../features/reports/Reports').then(m => m.Reports))
const CsvPreparation = lazyPage(() => import('../features/imports/CsvPreparation').then(m => m.CsvPreparation))
const LayoutsPage = lazyPage(() => import('../features/admin/layouts/LayoutsPage').then(m => m.LayoutsPage))
const ConfigurationPage = lazyPage(() => import('../features/admin/config/ConfigurationPage').then(m => m.ConfigurationPage))
const DataPage = lazyPage(() => import('../features/admin/data/DataPage').then(m => m.DataPage))
const AccessPage = lazyPage(() => import('../features/admin/access/Access').then(m => m.AccessPage))
const OrganizationPage = lazyPage(() => import('../features/admin/organization/Organization').then(m => m.OrganizationPage))
const ResourcesPage = lazyPage(() => import('../features/resources/Resources').then(m => m.ResourcesPage))
const CalendarPage = lazyPage(() => import('../features/calendar/Calendar').then(m => m.CalendarPage))
const InventoryPage = lazyPage(() => import('../features/inventory/InventoryPage').then(m => m.InventoryPage))
const GrowthPage = lazyPage(() => import('../features/growth/GrowthPage').then(m => m.GrowthPage))
const EvaluationsPage = lazyPage(() => import('../features/evaluations/EvaluationsPage').then(m => m.EvaluationsPage))
const PublicityDesk = lazyPage(() => import('../features/publicity/Publicity').then(m => m.PublicityDesk))
const PublicityPage = lazyPage(() => import('../features/publicity/Publicity').then(m => m.PublicityPage))
const FinanceReviewPage = lazyPage(() => import('../features/finance/FinanceReview').then(m => m.FinanceReviewPage))
const FinanceReviewQueue = lazyPage(() => import('../features/finance/FinanceReview').then(m => m.FinanceReviewQueue))
const FinanceCasePage = lazyPage(() => import('../features/finance/FinanceCasePage').then(m => m.FinanceCasePage))
const FinanceDesk = lazyPage(() => import('../features/finance/FinanceDesk').then(m => m.FinanceDesk))
const ReviewInbox = lazyPage(() => import('../features/approvals/ReviewInbox').then(m => m.ReviewInbox))
const ReviewPage = lazyPage(() => import('../features/approvals/ReviewScreens').then(m => m.ReviewPage))
const NewRequestPage = lazyPage(() => import('../features/requests/RequestPages').then(m => m.NewRequestPage))
const MyRequestsPage = lazyPage(() => import('../features/requests/RequestPages').then(m => m.MyRequestsPage))
const RequestDetailPage = lazyPage(() => import('../features/requests/RequestPages').then(m => m.RequestDetailPage))
const FormPreviewPage = lazyPage(() => import('../features/forms/FormPreviewPage').then(m => m.FormPreviewPage))
const CatalogPage = lazyPage(() => import('../features/requests/catalog/CatalogPage').then(m => m.CatalogPage))
const HandoffPage = lazyPage(() => import('../features/handoffs/HandoffScreens').then(m => m.HandoffPage))
const HandoffsPage = lazyPage(() => import('../features/handoffs/HandoffScreens').then(m => m.HandoffsPage))
const TimelinePage = lazyPage(() => import('../features/timeline/TimelinePage').then(m => m.TimelinePage))
const WorkingTogetherPage = lazyPage(() => import('../features/synergies/WorkingTogetherPage').then(m => m.WorkingTogetherPage))
const AgreementPage = lazyPage(() => import('../features/synergies/AgreementPage').then(m => m.AgreementPage))
const Overview = lazyPage(() => import('../features/overview/Overview').then(m => m.Overview))
const WarRoomPage = lazyPage(() => import('../features/war-room/WarRoomPage').then(m => m.WarRoomPage))
const WhoToAskPage = lazyPage(() => import('../features/who-to-ask/WhoToAskPage').then(m => m.WhoToAskPage))
const CommitteeIndexPage = lazyPage(() => import('../features/committee-pages/CommitteePages').then(m => m.CommitteeIndexPage))
const CommitteeOnePage = lazyPage(() => import('../features/committee-pages/CommitteePages').then(m => m.CommitteePage))
const MyPartPage = lazyPage(() => import('../features/speaker-portal/MyPartPage').then(m => m.MyPartPage))
const SpeakerTrackerPage = lazyPage(() => import('../features/speaker-portal/SpeakerTrackerPage').then(m => m.SpeakerTrackerPage))
const ContestBoardPage = lazyPage(() => import('../features/event-boards/EventBoard').then(m => m.ContestBoardPage))
const TedifyBoardPage = lazyPage(() => import('../features/event-boards/EventBoard').then(m => m.TedifyBoardPage))
const RunOfShowPage = lazyPage(() => import('../features/run-of-show/RunOfShowPage').then(m => m.RunOfShowPage))
const EventQrPage = lazyPage(() => import('../features/event-qr/EventQrPage').then(m => m.EventQrPage))
const CrewCheckInPage = lazyPage(() => import('../features/event-qr/CrewCheckInPage').then(m => m.CrewCheckInPage))
const CommitteePage = lazyPage(() => import('../features/committee/CommitteePage').then(m => m.CommitteePage))
const TaskDetail = lazyPage(() => import('../features/tasks/TaskDetail').then(m => m.TaskDetail))
const TasksPage = lazyPage(() => import('../features/tasks/TasksPage').then(m => m.TasksPage))
const RedeemPage = lazyPage(() => import('../features/guests/pages').then(m => m.RedeemPage))
const SharedWork = lazyPage(() => import('../features/guests/pages').then(m => m.SharedWork))
const SponsorPage = lazyPage(() => import('../features/guests/pages').then(m => m.SponsorPage))
const DeliverablesRoute = lazyPage(() => import('../features/deliverables/DeliverablesPage').then(m => m.DeliverablesRoute))
const DeliverablePage = lazyPage(() => import('../features/deliverables/DeliverablePage').then(m => m.DeliverablePage))
const DirectoryPage = lazyPage(() => import('../features/people/pages').then(m => m.DirectoryPage))
const CalendarSyncCallback = lazyPage(() => import('../features/integrations/calendar/CalendarSync').then(m => m.CalendarSyncCallback))

// Link intent (hover, focus, touch) warms the page a link opens. Paths are app paths; /preview/* is dev only.
const prefetchRules: ReadonlyArray<readonly [RegExp, Preload]> = [
  [/^(?:\/preview)?\/(?:work|event|team|desk)\/?$/, WorkHub.preload],
  [/^\/calendar\/?$/, CalendarPage.preload],
  [/^\/tasks\/?$/, TasksPage.preload],
  [/^\/tasks\/[^/]+\/?$/, TaskDetail.preload],
  [/^\/deliverables\/?$/, DeliverablesRoute.preload],
  [/^\/deliverables\/[^/]+\/?$/, DeliverablePage.preload],
  [/^\/working-together\/timeline\/?$/, TimelinePage.preload],
  [/^\/working-together\/handoffs/, HandoffsPage.preload],
  [/^\/working-together\/?$/, WorkingTogetherPage.preload],
  [/^\/announcements\/?$/, Announcements.preload],
  [/^\/announcements\/[^/]+\/?$/, AnnouncementDetail.preload],
  [/^\/requests\/?$/, CatalogPage.preload],
  [/^\/requests\/mine\/?$/, MyRequestsPage.preload],
  [/^\/reviews\/?$/, ReviewInbox.preload],
  [/^\/search\/?$/, Search.preload],
  [/^\/reports\/?$/, Reports.preload],
  [/^\/resources\/?$/, ResourcesPage.preload],
  [/^\/people\/?$/, DirectoryPage.preload],
  [/^\/committee\/?$/, CommitteePage.preload],
  [/^\/publicity\/?$/, PublicityDesk.preload],
  [/^\/finance\/?$/, FinanceDesk.preload],
  [/^\/inventory/, InventoryPage.preload],
  [/^\/mentoring\/?$/, GrowthPage.preload],
  [/^\/prism/, EvaluationsPage.preload],
  [/^\/my-part/, MyPartPage.preload],
  [/^\/shared\/?$/, SharedWork.preload],
  [/^\/guests\/?$/, SponsorPage.preload],
  [/^\/overview\/?$/, Overview.preload],
  [/^\/team\/setup\/?$/, TeamSetupPage.preload],
  [/^\/team\/ask\/?$/, WhoToAskPage.preload],
  [/^\/team\/committees/, CommitteeIndexPage.preload],
  [/^\/event\/war-room\/?$/, WarRoomPage.preload],
  [/^\/event\/speakers\/?$/, SpeakerTrackerPage.preload],
  [/^\/event\/(?:online-contest|tedify)\/?$/, ContestBoardPage.preload],
  [/^\/event\/run-of-show\/?$/, RunOfShowPage.preload],
  [/^\/event\/qr\/?$/, EventQrPage.preload],
  [/^\/admin\/?$/, OrganizationPage.preload],
  [/^\/admin\/config/, ConfigurationPage.preload],
  [/^\/admin\/data\/?$/, DataPage.preload],
  [/^\/admin\/access\/?$/, AccessPage.preload],
  [/^\/admin\/imports\/?$/, CsvPreparation.preload],
  [/^\/admin\/process\/?$/, ProcessPage.preload],
  [/^\/admin\/layouts\/?$/, LayoutsPage.preload],
  [/^\/admin\/announcements\/?$/, AnnouncementPublisher.preload],
  [/^\/admin\/privacy\/?$/, PrivacyAdministration.preload],
  [/^\/privacy\/?$/, PrivacyPage.preload],
]

function FoundationPage({ environment }: { environment: ClientEnvironment }) {
  return (
    <>
      <PageHeading title="Overview" description="Your work and the people you work with." />
      <Countdown variant="overview" />
      <div className="overview-layout">
      <Panel title={environment.state === 'not_configured' ? 'Setup needed' : 'Connected'}>
        {environment.state === 'not_configured' ? (
          <>
            <p>The workspace isn't connected to Supabase yet. You can keep setting up locally without signing in.</p>
            <ul>{environment.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          </>
        ) : (
          <p>The public settings look right. This preview doesn't sign in or load data.</p>
        )}
        <p className="muted">No real records are loaded here.</p>
      </Panel>
      <Panel title="Find your next step">
        <p className="muted">Look around while setup is in progress.</p>
        <ul className="resource-links">
          <li><Link to="/deliverables">Deliverables<span>What the event needs and who owns it</span></Link></li>
          <li><Link to="/working-together">Working together<span>Committee contributions and handoffs</span></Link></li>
          <li><Link to="/resources">Resources and start here<span>Process guides and who to ask</span></Link></li>
        </ul>
      </Panel>
      </div>
      <EmptyState illustration={<EmptyTasks />} title="Your work will appear here" description="Once you're signed in and have work assigned, your next steps show up here." />
    </>
  )
}

function RouteErrorPage() {
  return (
    <main className="standalone-page">
      <h1>Something went wrong</h1>
      <ErrorState title="This page didn't load" description="Go back to the start and try again. If it keeps happening, tell the workspace maintainer." action={<a className="button" href={appPath('/')}>Back to start</a>} />
    </main>
  )
}

/** Client-side redirect that keeps the query string, for renamed workspace addresses. */
function MovedPage({ to }: { to: string }) {
  const { search, hash } = useLocation()
  return <Navigate replace to={{ pathname: to, search, hash }} />
}

/** Budget: reviewers come here to review, so their queue leads; everyone else starts with their own plans. */
function FinanceRoute({ desk, reviews }: { desk: ReactNode; reviews: ReactNode }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  return context?.capabilities.includes('finance.review') ? <>{reviews}{desk}</> : <>{desk}{reviews}</>
}

function Unavailable({ title, description = 'Check your connection and try again.' }: { title: string; description?: string }) {
  return <><PageHeading title={title} /><EmptyState title="This page can't load right now" description={description} action={<Link className="button button--secondary" to="/">Back to Today</Link>} /></>
}

// Presentation gate only, so members without authority never see an admin shell.
// Every admin RPC still enforces authority on the server. Privacy custodian and
// announcement publishing authority is checked by those pages' own APIs.
function adminCapabilities(path: string): string[] | null {
  if (path === '/admin') return ['admin.configure']
  if (path === '/admin/access' || path === '/admin/imports') return ['admin.configure', 'roles.manage']
  if (/^\/admin\/(?:config|process|layouts)(?:\/|$)/.test(path)) return ['admin.configure', 'committee.manage']
  if (path === '/team/setup') return [...teamSetupCapabilities]
  return null
}

// Areas declared below as explicit routes; navigation items must not add a second route for them.
const explicitAreas = new Set(['/shared', '/search', '/reports', '/publicity', '/finance', '/prism', '/mentoring', '/committee', '/reviews', '/work', '/event', '/team', '/desk', '/announcements', '/working-together/timeline', '/inventory', '/my-part', '/my-part/info'])

// Search-param-only changes on the same page (filters, pagination, views) keep the
// workspace context. A different `term` changes the context, so it still reloads.
function shouldRevalidateWorkspace({ currentUrl, nextUrl }: { currentUrl: URL; nextUrl: URL }): boolean {
  return !(currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search
    && currentUrl.searchParams.get('term') === nextUrl.searchParams.get('term'))
}

function NotFoundPage() {
  return (
    <>
      <PageHeading title="Page not found" />
      <p>There's no page at this address.</p>
      <Link className="button" to="/">Back to start</Link>
    </>
  )
}

export function createAppRoutes(environment: ClientEnvironment, gateway: AuthGateway = createAuthGateway(environment, window.location.origin)): RouteObject[] {
  let lastContext: WorkspaceContext | null = null
  return [
    { element: <ShellServicesProvider gateway={gateway}><AuthRevalidator gateway={gateway} /></ShellServicesProvider>, errorElement: <RouteErrorPage />, hydrateFallbackElement: <BootScreen />, children: [
      { path: '/login', loader: async ({ request }) => {
        const returnTo=safeReturnPath(new URL(request.url).searchParams.get('returnTo'))
        const result = await gateway.readContext(request.signal,new URL(returnTo,request.url).searchParams.get('term')??undefined)
        const returnPath=new URL(returnTo,request.url).pathname
        return result.state === 'authorized' ? redirect(isGuest(result)&&!isDeliverablePath(returnPath)&&!isTaskPath(returnPath)&&!isAnnouncementPath(returnPath)&&!isPrivacyPath(returnPath)&&!navigationItems.some(item=>item.href===returnPath&&item.audiences.includes('guest'))?'/my-part':returnTo) : result
      }, element: <LoginPage gateway={gateway} /> },
      { path: '/auth/callback', element: <CallbackPage gateway={gateway} /> },
      ...(gateway.files?.drive ? [{path:'/integrations/drive/callback',element:<DriveCallback api={gateway.files.drive}/>}]:[]),
      ...(gateway.calendar?.sync ? [{path:calendarCallback,element:<CalendarSyncCallback api={gateway.calendar.sync}/>}]:[]),
      { path: '/guest/redeem', loader:({request})=>gateway.readContext(request.signal), element: <RedeemPage gateway={gateway} /> },
      ...(import.meta.env.DEV ? [{ path: '/preview', element: <AppShell />, children: [
        { index: true, element: <FoundationPage environment={environment} /> },
        // Development only: the new surfaces with sample data, without signing in.
        { path: 'today', element: <SampleToday /> },
        { path: 'work', element: <WorkHub /> }, { path: 'event', element: <EventHub /> }, { path: 'team', element: <TeamHub /> }, { path: 'desk', element: <DeskHub /> },
      ] }] : []),
      { id:'workspace', path: '/', element: <ProtectedShell notifications={gateway.notifications} gateway={gateway}/>, loader: async ({ request }) => {
        const term=new URL(request.url).searchParams.get('term')??undefined
        let result = await gateway.readContext(request.signal,term)
        // A check that failed or timed out (weak signal, waking tab) keeps the person on the page
        // with the access they already had. Every page RPC still checks access on the server.
        if (result.state === 'error' && lastContext && (!term || lastContext.termId === term) && Date.parse(lastContext.expiresAt) > Date.now()) result = lastContext
        if (result.state === 'authorized') {
          lastContext = result
          rememberSession()
          const path=stripBase(new URL(request.url).pathname)
          if(isGuest(result) && !isDeliverablePath(path) && !isTaskPath(path) && !isAnnouncementPath(path) && !isPrivacyPath(path) && !navigationItems.some(item=>item.href===path && item.audiences.includes('guest')))return redirect('/my-part')
          if (isMemberPreviewPath(path) && !canPreviewAsMember(result)) return redirect('/')
          if(path==='/guests' && !result.capabilities.includes('roles.manage'))return redirect(isGuest(result)?'/my-part':'/')
          if(path==='/desk' && !result.capabilities.some(capability=>(deskCapabilities as readonly string[]).includes(capability)))return redirect('/')
          const adminNeeds=adminCapabilities(path)
          if(adminNeeds && !adminNeeds.some(capability=>result.capabilities.includes(capability)))return redirect('/')
          // Data needs both: the page itself refuses anyone without Admin and Roles & access.
          if(path==='/admin/data' && !(['admin.configure','roles.manage'] as const).every(capability=>result.capabilities.includes(capability)))return redirect('/')
          return result
        }
        const url = new URL(request.url), appUrlPath = stripBase(url.pathname)
        const retained=/^\/(?:deliverables|tasks)\/([0-9a-f-]{36})\/?$/i.exec(appUrlPath)
        if(retained&&gateway.turnover){
          const current=await gateway.readContext(request.signal)
          if(current.state==='authorized'&&!isGuest(current)){
            try{if(await gateway.turnover.record(current.termId,retained[1])){const{archivePath}=await import('../features/admin/turnover/ArchivePage');return redirect(archivePath(current.termId,retained[1]))}}catch{/* The original denied result remains authoritative. */}
          }
        }
        // Only say a session ended when this browser actually had one; first visits get no notice.
        const reason = result.state === 'denied' ? 'denied' : result.state === 'signed_out' && hadSession() ? 'expired' : null
        lastContext = null
        if (result.state === 'signed_out') forgetSession()
        return redirect(`/login?${reason ? `reason=${reason}&` : ''}returnTo=${encodeURIComponent(safeReturnPath(appUrlPath+url.search))}`)
      // Page RPCs recheck scope themselves. Explicit focus/expiry checks and path changes still revalidate.
      }, shouldRevalidate: shouldRevalidateWorkspace, children: [
      {path:memberPreviewPath.slice(1)+'/*',element:<ViewAsPage api={gateway.viewAs}/>},
      { index: true, element: gateway.overview?<TodayPage/>:<Unavailable title="Today"/> },
      // The previous overview, with layouts, shortcuts and the phase banner. Linked from Today's Customize menu.
      { path: 'overview', element: gateway.overview?<><CurrentPhase api={gateway.process}/><Overview api={gateway.overview} announcements={gateway.announcements} canSearch={!!gateway.search} tasks={gateway.tasks} inventory={gateway.inventory} growth={gateway.growth} evaluations={gateway.evaluations} turnover={gateway.turnover}/></>:<Unavailable title="Classic overview"/> },
      { path: 'today', element: <MovedPage to="/"/> },
      { path: 'work', element: <WorkHub/> },
      { path: 'event', element: <EventHub/> },
      { path: 'team', element: <TeamHub/> },
      { path: 'desk', element: <DeskHub/> },
      // Team and Event pages. Each page also checks the viewer itself; the loader gates Team setup.
      { path: 'team/setup', element: gateway.teamSetup?<TeamSetupPage api={gateway.teamSetup}/>:<Unavailable title="Team setup"/> },
      { path: 'team/ask', element: <WhoToAskPage api={gateway.whoToAsk}/> },
      { path: 'team/committees', element: <CommitteeIndexPage api={gateway.committeePages}/> },
      { path: 'team/committees/:code', element: <CommitteeOnePage api={gateway.committeePages}/> },
      { path: 'my-part/:view?', element: <MyPartPage api={gateway.speakerPortal}/> },
      { path: 'event/war-room', element: <WarRoomPage api={gateway.warRoom}/> },
      { path: 'event/speakers', element: <SpeakerTrackerPage api={gateway.speakerPortal}/> },
      { path: 'event/online-contest', element: <ContestBoardPage api={gateway.eventBoards}/> },
      { path: 'event/tedify', element: <TedifyBoardPage api={gateway.eventBoards}/> },
      { path: 'event/run-of-show', element: gateway.runOfShow?<RunOfShowPage api={gateway.runOfShow}/>:<Unavailable title="Run of show"/> },
      { path: 'event/qr', element: <EventQrPage api={gateway.eventQr} inventory={gateway.inventory}/> },
      { path: 'event/check-in/:token', element: gateway.eventQr?<CrewCheckInPage api={gateway.eventQr}/>:<Unavailable title="Crew check-in"/> },
      ...(gateway.turnover?[{path:'archive/:archivedWorkId?',element:<ArchivePage api={gateway.turnover}/>},{path:'handover/:turnoverCaseId?',element:<TurnoverPage api={gateway.turnover}/>}]:[]),
      {path:'prism/:evaluationId?/:view?',element:gateway.evaluations?<EvaluationsPage api={gateway.evaluations}/>:<Unavailable title="Check-ins" description="Check-ins (PRISM) aren't turned on yet."/>},
      {path:'feedback',element:<MovedPage to="/prism"/>},
      {path:'department',element:<MovedPage to="/reviews"/>},
      {path:'committee',element:<CommitteePage tasks={gateway.tasks} deliverables={gateway.deliverables} handoffs={gateway.handoffs} links={gateway.committeePages}/>},
      {path:'mentoring',element:gateway.growth?<GrowthPage api={gateway.growth}/>:<Unavailable title="Mentoring" description="Mentoring isn't turned on yet."/>},
      ...(gateway.inventory?[{path:'inventory/:inventoryLoanId?',element:<InventoryPage api={gateway.inventory}/>}]:[]),
      {path:'announcements',element:gateway.announcements?<Announcements api={gateway.announcements}/>:<Unavailable title="Announcements"/>},
      {path:'privacy',element:gateway.privacy?<PrivacyPage api={gateway.privacy}/>:<Unavailable title="Privacy information"/>},
      {path:'privacy/requests/:privacyRequestId',element:gateway.privacy?<PrivacyRequestPage api={gateway.privacy}/>:<Unavailable title="Privacy request"/>},
      {path:'admin/privacy',element:gateway.privacy?<PrivacyAdministration api={gateway.privacy}/>:<Unavailable title="Privacy custodian tools"/>},
      {path:'admin/privacy/retention',element:gateway.privacy?.retention?<RetentionPage api={gateway.privacy.retention}/>:<Unavailable title="Retention tools"/>},
      {path:'admin/privacy/emergency',element:gateway.privacy?.emergency?<EmergencyPage api={gateway.privacy.emergency}/>:<Unavailable title="Temporary access"/>},
      {path:'admin/privacy/disposition',element:gateway.privacy?.retention?<DispositionPage api={gateway.privacy.retention}/>:<Unavailable title="Data sources"/>},
      {path:'admin/privacy/recovery',element:gateway.privacy?.backupHealth?<BackupHealthPage read={gateway.privacy.backupHealth}/>:<Unavailable title="Recovery status"/>},
      {path:'announcements/:announcementId',element:gateway.announcements?<AnnouncementDetail api={gateway.announcements} files={gateway.files}/>:<Unavailable title="Announcement"/>},
      {path:'admin/announcements',element:gateway.announcements?<AnnouncementPublisher api={gateway.announcements}/>:<Unavailable title="Publishing"/>},
      {path:'shared',element:<><PageHeading title="Shared with me" description="Work shared with you."/>
        <SharedWork api={gateway.guests}/><nav className="auth-actions" aria-label="Guest help"><Link className="button button--secondary" to="/account#guest-contacts">Find guest contacts</Link></nav><ContextAnnouncements api={gateway.announcements}/></>},
      {path:'admin/process',element:gateway.process?<ProcessPage api={gateway.process}/>:<Unavailable title="Process setup"/>},
      {path:'search',element:gateway.search?<Search api={gateway.search}/>:<Unavailable title="Search"/>},
      {path:'reports',element:gateway.reports?<Reports api={gateway.reports}/>:<Unavailable title="Reports"/>},
      {path:'admin/imports',element:<CsvPreparation api={gateway.taskImports} rosterApi={gateway.rosterImports}/>},
      {path:'admin/layouts',element:gateway.layouts?<LayoutsPage api={gateway.layouts}/>:<Unavailable title="Layout settings"/>},
      {path:'admin/data',element:gateway.adminData?<DataPage api={gateway.adminData}/>:<Unavailable title="Data"/>},
      {path:'admin/access',element:gateway.access?<AccessPage api={gateway.access}/>:<Unavailable title="Access check"/>},
      {path:'admin/config/:configurationType?',element:gateway.configuration?<ConfigurationPage api={gateway.configuration} catalog={gateway.catalog}/>:<Unavailable title="Service setup"/>},
      {path:'reviews',element:gateway.inbox?<ReviewInbox api={gateway.inbox}/>:<Unavailable title="Reviews"/>},
      {path:'publicity',element:gateway.publicity?<PublicityDesk api={gateway.publicity}/>:<Unavailable title="Publicity sign-off"/>},
      {path:'publicity/:publicityTerm/:publicityId',element:gateway.publicity&&gateway.requests?<PublicityPage api={gateway.publicity} requests={gateway.requests} forms={gateway.forms} files={gateway.files}/>:<Unavailable title="Publicity sign-off"/>},
      {path:'finance',element:gateway.finance?<FinanceRoute desk={<FinanceDesk api={gateway.finance}/>} reviews={gateway.finAuthority?<FinanceReviewQueue api={gateway.finAuthority}/>:null}/>:<Unavailable title="Budget"/>},
      {path:'finance/reviews/:finTerm/:finId',element:gateway.finAuthority?<FinanceReviewPage api={gateway.finAuthority} files={gateway.files} ledger={gateway.ledger}/>:<Unavailable title="FIN review"/>},
      {path:'finance/:financeTermId/:financeId',element:gateway.finance&&gateway.requests?<FinanceCasePage api={gateway.finance} requests={gateway.requests} files={gateway.files}/>:<Unavailable title="Budget"/>},
      {path:'reviews/:reviewTermId/:reviewId',element:gateway.inbox&&gateway.approvals?<ReviewPage api={gateway.approvals} inbox={gateway.inbox} files={gateway.files} roomBookings={gateway.roomBookings}/>:<Unavailable title="Review"/>},
      {path:'requests/mine',element:gateway.requests?<MyRequestsPage api={gateway.requests}/>:<Unavailable title="Requests"/>},
      {path:'requests/services/:typeId/new',element:gateway.requests&&gateway.catalog?<NewRequestPage api={gateway.requests} catalog={gateway.catalog}/>:<Unavailable title="Draft"/>},
      {path:'requests/:requestTermId/:requestId',element:gateway.requests&&gateway.forms?<RequestDetailPage api={gateway.requests} forms={gateway.forms} files={gateway.files} roomBookings={gateway.roomBookings}/>:<Unavailable title="Request"/>},
      {path:'requests/services/:typeId/preview',element:gateway.forms&&gateway.catalog?<FormPreviewPage api={gateway.forms} catalog={gateway.catalog} files={gateway.files}/>:<Unavailable title="Form"/>},
      {path:'requests/services/:typeId',element:gateway.catalog?<CatalogPage api={gateway.catalog} process={gateway.process}/>:<Unavailable title="Catalog"/>},
      {path:'working-together/handoffs',element:gateway.handoffs?<HandoffsPage api={gateway.handoffs}/>:<Unavailable title="Handoffs"/>},
      {path:'working-together/handoffs/:handoffId',element:gateway.handoffs?<HandoffPage api={gateway.handoffs} files={gateway.files}/>:<Unavailable title="Handoff"/>},
      {path:'working-together/timeline',element:gateway.timeline?<TimelinePage api={gateway.timeline}/>:<Unavailable title="Timeline"/>},
      {path:'working-together/:agreementId',element:gateway.synergies?<AgreementPage api={gateway.synergies}/>:<Unavailable title="Agreement"/>},
      {path:'tasks/:taskId',element:gateway.tasks?<TaskDetail process={gateway.process} publicity={gateway.publicity} finance={gateway.finance} handoffs={gateway.handoffs} timeline={gateway.timeline} dependencies={gateway.dependencies} api={gateway.tasks} comments={gateway.comments} files={gateway.files} synergies={gateway.synergies}/>:<Unavailable title="Task"/>},
      {path:'deliverables/:deliverableId',element:gateway.deliverables?<DeliverablePage process={gateway.process} readiness={gateway.readiness} publicity={gateway.publicity} finance={gateway.finance} timeline={gateway.timeline} api={gateway.deliverables} commands={gateway.deliverableCommands} comments={gateway.comments} files={gateway.files} synergies={gateway.synergies}/>:<Unavailable title="Deliverable"/>},
      ...navigationItems.filter((item) => item.href !== '/' && !explicitAreas.has(item.href)).map((item) => ({
        path: item.href.slice(1),
        element: item.id === 'admin' && gateway.organization ? <OrganizationPage api={gateway.organization} process={gateway.process}/> : item.id === 'resources' && gateway.resources ? <ResourcesPage api={gateway.resources} people={gateway.people}/> : item.id === 'calendar' && gateway.calendar ? <CalendarPage api={gateway.calendar}/> : item.id === 'notifications' ? <><Notifications/><ContextAnnouncements api={gateway.announcements}/></> : item.id === 'requests' && gateway.catalog ? <CatalogPage api={gateway.catalog} process={gateway.process}/> : item.href === '/working-together' && gateway.synergies ? <WorkingTogetherPage api={gateway.synergies}/> : item.id === 'tasks' && gateway.tasks ? <TasksPage api={gateway.tasks} exportCsv={gateway.exportOperationalWork} /> : item.id === 'deliverables' && gateway.deliverables ? <DeliverablesRoute api={gateway.deliverables} commands={gateway.deliverableCommands} exportCsv={gateway.exportOperationalWork} /> : item.id === 'people' && gateway.people ? <DirectoryPage api={gateway.people} /> : item.id === 'guests' && gateway.guests ? <SponsorPage api={gateway.guests} /> : item.id === 'account' ? <AccountPage gateway={gateway} /> : <Unavailable title={item.label} />,
        errorElement: <ErrorState title="This page didn't load" description="Go back to Today and try again. If it keeps happening, tell the workspace maintainer." action={<Link className="button" to="/">Back to Today</Link>} />,
      })),
      ] },
      { path: '*', element: <main className="standalone-page"><NotFoundPage /></main> },
    ] },
    {path:'/privacy-notice/:noticeRoute?',loader:()=>redirect('/login')},
  ]
}

export function createAppRouter() {
  // Read only these explicit public variables, never the entire environment object.
  const environment = readClientEnvironment({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_APP_ORIGIN: import.meta.env.VITE_APP_ORIGIN,
    VITE_DRIVE_PICKER_ENABLED: import.meta.env.VITE_DRIVE_PICKER_ENABLED,
    VITE_DRIVE_EVIDENCE_ENABLED: import.meta.env.VITE_DRIVE_EVIDENCE_ENABLED,
    VITE_CALENDAR_SYNC_ENABLED: import.meta.env.VITE_CALENDAR_SYNC_ENABLED,
    VITE_TELEGRAM_BOT_USERNAME: import.meta.env.VITE_TELEGRAM_BOT_USERNAME,
    VITE_EMAIL_DIGEST_ENABLED: import.meta.env.VITE_EMAIL_DIGEST_ENABLED,
  })
  const router = createBrowserRouter(createAppRoutes(environment), { basename: basePath || '/' })
  // From Today the likely next stops are the Work hub (all four hubs share a chunk) and Calendar.
  installRoutePrefetch(prefetchRules, [WorkHub.preload, CalendarPage.preload])
  return router
}
