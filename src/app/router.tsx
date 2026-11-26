import { appPath, basePath, stripBase } from '../lib/basePath'
import { Countdown } from '../components/Countdown'
import {ArchivePage,archivePath} from '../features/admin/turnover/ArchivePage'
import {TurnoverPage} from '../features/admin/turnover/TurnoverPage'
import {PrivacyPage,PrivacyRequestPage} from '../features/admin/privacy/Privacy'
import {PrivacyAdministration} from '../features/admin/privacy/Administration'
import {RetentionPage} from '../features/admin/privacy/RetentionPage'
import {DispositionPage} from '../features/admin/privacy/DispositionPage'
import {BackupHealthPage} from '../features/admin/health/BackupHealthPage'
import {EmergencyPage} from '../features/admin/privacy/EmergencyPage'
import {Announcements,AnnouncementDetail,ContextAnnouncements} from '../features/announcements/Reader'
import {AnnouncementPublisher} from '../features/announcements/Publisher'
import {ProcessPage,CurrentPhase} from '../features/admin/process/ProcessPage'
import {Search} from '../features/search/Search'
import {Reports} from '../features/reports/Reports'
import {CsvPreparation} from '../features/imports/CsvPreparation'
import {LayoutsPage} from '../features/admin/layouts/LayoutsPage'
import {ConfigurationPage} from '../features/admin/config/ConfigurationPage'
import {AccessPage} from '../features/admin/access/Access'
import {OrganizationPage} from '../features/admin/organization/Organization'
import {ResourcesPage} from '../features/resources/Resources'
import {CalendarPage} from '../features/calendar/Calendar'
import {InventoryPage} from '../features/inventory/InventoryPage'
import {GrowthPage} from '../features/growth/GrowthPage'
import {EvaluationsPage} from '../features/evaluations/EvaluationsPage'
import {Notifications} from '../features/notifications/Notifications'
import {PublicityDesk,PublicityPage} from '../features/publicity/Publicity'
import {FinanceReviewPage,FinanceReviewQueue} from '../features/finance/FinanceReview'
import {FinanceCasePage} from '../features/finance/FinanceCasePage'
import {FinanceDesk} from '../features/finance/FinanceDesk'
import {ReviewInbox,ReviewPage} from '../features/approvals/ReviewScreens'
import {NewRequestPage,MyRequestsPage,RequestDetailPage} from '../features/requests/RequestPages'
import {FormPreviewPage} from '../features/forms/FormPreviewPage'
import {CatalogPage} from '../features/requests/catalog/CatalogPage'
import {HandoffPage,HandoffsPage} from '../features/handoffs/HandoffScreens'
import {TimelinePage} from '../features/timeline/TimelinePage'
import {WorkingTogetherPage} from '../features/synergies/WorkingTogetherPage'
import {AgreementPage} from '../features/synergies/AgreementPage'
import {Overview} from '../features/overview/Overview'
import { createBrowserRouter, Link, Navigate, redirect, useLocation, type RouteObject } from 'react-router'
import { CommitteePage } from '../features/committee/CommitteePage'
import { readClientEnvironment, type ClientEnvironment } from '../lib/env'
import { PageHeading, Panel } from '../components/Page'
import { EmptyState, ErrorState } from '../components/FeedbackState'
import { AppShell } from './AppShell'
import { MemberPreview, canPreviewAsMember, isMemberPreviewPath, memberPreviewPath } from './MemberPreview'
import { TaskDetail } from '../features/tasks/TaskDetail'
import { TasksPage } from '../features/tasks/TasksPage'
import { navigationItems } from './navigation'
import { createAuthGateway, isGuest, type AuthGateway } from '../features/auth/gateway'
import { RedeemPage, SharedWork, SponsorPage } from '../features/guests/pages'
import { AccountPage, AuthRevalidator, CallbackPage, LoginPage, ProtectedShell } from '../features/auth/pages'
import { forgetSession, hadSession, rememberSession, safeReturnPath, isDeliverablePath, isTaskPath, isAnnouncementPath, isPrivacyPath } from '../features/auth/redirects'
import { DeliverablesRoute } from '../features/deliverables/DeliverablesPage'
import { DeliverablePage } from '../features/deliverables/DeliverablePage'
import { LoadingState } from '../components/FeedbackState'
import { DirectoryPage } from '../features/people/pages'
import { DriveCallback } from '../features/integrations/drive/DriveSource'
import { CalendarSyncCallback } from '../features/integrations/calendar/CalendarSync'
import { calendarCallback } from '../features/integrations/calendar/api'

function FoundationPage({ environment }: { environment: ClientEnvironment }) {
  return (
    <>
      <PageHeading title="Overview" description="A focused view of your work and the people moving it forward." />
      <Countdown variant="overview" />
      <div className="overview-layout">
      <Panel title={environment.state === 'not_configured' ? 'Setup needed' : 'Configuration present'}>
        {environment.state === 'not_configured' ? (
          <>
            <p>The workspace is not connected to Supabase yet. You can continue local setup without signing in.</p>
            <ul>{environment.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          </>
        ) : (
          <p>Public configuration is valid. Sign-in and data access have not been implemented or verified.</p>
        )}
        <p className="muted">No member, task, financial or feedback records are being loaded.</p>
      </Panel>
      <Panel title="Find your next step">
        <p className="muted">Explore the workspace structure while setup is in progress.</p>
        <ul className="resource-links">
          <li><Link to="/deliverables">Core deliverables<span>Event outputs and accountable owners</span></Link></li>
          <li><Link to="/working-together">Working together<span>Committee contributions and handoffs</span></Link></li>
          <li><Link to="/resources">Resources & Start Here<span>Process guides and who to ask</span></Link></li>
        </ul>
      </Panel>
      </div>
      <EmptyState title="Your work will appear here" description="Once your account is connected and work is assigned, this overview will show your next actions. No sample tasks or metrics are shown." />
    </>
  )
}

function RouteErrorPage() {
  return (
    <main className="standalone-page">
      <h1>The workspace could not open</h1>
      <ErrorState title="This page could not be displayed" description="Try returning to the start. If this continues, contact the workspace maintainer." action={<a className="button" href={appPath('/')}>Return to start</a>} />
    </main>
  )
}

/** Client-side redirect that keeps the query string, for renamed workspace addresses. */
function MovedPage({ to }: { to: string }) {
  const { search, hash } = useLocation()
  return <Navigate replace to={{ pathname: to, search, hash }} />
}

function Unavailable({ title }: { title: string }) {
  return <><PageHeading title={title} /><EmptyState title={title + ' unavailable'} description="This area is not available on the current workspace connection." action={<Link className="button button--secondary" to="/">Return to overview</Link>} /></>
}

// Presentation gate only, so members without authority never see an admin shell.
// Every admin RPC still enforces authority on the server. Privacy custodian and
// announcement publishing authority is checked by those pages' own APIs.
function adminCapabilities(path: string): string[] | null {
  if (path === '/admin') return ['admin.configure']
  if (path === '/admin/access' || path === '/admin/imports') return ['admin.configure', 'roles.manage']
  if (/^\/admin\/(?:config|process|layouts)(?:\/|$)/.test(path)) return ['admin.configure', 'committee.manage']
  return null
}

// Areas declared below as explicit routes; navigation items must not add a second route for them.
const explicitAreas = new Set(['/shared', '/search', '/reports', '/publicity', '/finance', '/prism', '/mentoring', '/committee', '/reviews'])

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
      <p>This address does not point to a workspace page.</p>
      <Link className="button" to="/">Return to start</Link>
    </>
  )
}

export function createAppRoutes(environment: ClientEnvironment, gateway: AuthGateway = createAuthGateway(environment, window.location.origin)): RouteObject[] {
  return [
    { element: <AuthRevalidator gateway={gateway} />, errorElement: <RouteErrorPage />, hydrateFallbackElement: <main className="standalone-page"><LoadingState /></main>, children: [
      { path: '/login', loader: async ({ request }) => {
        const returnTo=safeReturnPath(new URL(request.url).searchParams.get('returnTo'))
        const result = await gateway.readContext(request.signal,new URL(returnTo,request.url).searchParams.get('term')??undefined)
        const returnPath=new URL(returnTo,request.url).pathname
        return result.state === 'authorized' ? redirect(isGuest(result)&&!isDeliverablePath(returnPath)&&!isTaskPath(returnPath)&&!isAnnouncementPath(returnPath)&&!isPrivacyPath(returnPath)?'/shared':returnTo) : result
      }, element: <LoginPage gateway={gateway} /> },
      { path: '/auth/callback', element: <CallbackPage gateway={gateway} /> },
      ...(gateway.files?.drive ? [{path:'/integrations/drive/callback',element:<DriveCallback api={gateway.files.drive}/>}]:[]),
      ...(gateway.calendar?.sync ? [{path:calendarCallback,element:<CalendarSyncCallback api={gateway.calendar.sync}/>}]:[]),
      { path: '/guest/redeem', loader:({request})=>gateway.readContext(request.signal), element: <RedeemPage gateway={gateway} /> },
      ...(import.meta.env.DEV ? [{ path: '/preview', element: <AppShell />, children: [{ index: true, element: <FoundationPage environment={environment} /> }] }] : []),
      { id:'workspace', path: '/', element: <ProtectedShell notifications={gateway.notifications} gateway={gateway}/>, loader: async ({ request }) => {
        const result = await gateway.readContext(request.signal,new URL(request.url).searchParams.get('term')??undefined)
        if (result.state === 'authorized') {
          rememberSession()
          const path=stripBase(new URL(request.url).pathname)
          if(isGuest(result) && !isDeliverablePath(path) && !isTaskPath(path) && !isAnnouncementPath(path) && !isPrivacyPath(path) && !navigationItems.some(item=>item.href===path && item.audiences.includes('guest')))return redirect('/shared')
          if (isMemberPreviewPath(path) && !canPreviewAsMember(result)) return redirect('/')
          if(path==='/guests' && !result.capabilities.includes('roles.manage'))return redirect(isGuest(result)?'/shared':'/')
          const adminNeeds=adminCapabilities(path)
          if(adminNeeds && !adminNeeds.some(capability=>result.capabilities.includes(capability)))return redirect('/')
          return result
        }
        const url = new URL(request.url), appUrlPath = stripBase(url.pathname)
        const retained=/^\/(?:deliverables|tasks)\/([0-9a-f-]{36})\/?$/i.exec(appUrlPath)
        if(retained&&gateway.turnover){
          const current=await gateway.readContext(request.signal)
          if(current.state==='authorized'&&!isGuest(current)){
            try{if(await gateway.turnover.record(current.termId,retained[1]))return redirect(archivePath(current.termId,retained[1]))}catch{/* The original denied result remains authoritative. */}
          }
        }
        // Only say a session ended when this browser actually had one; first visits get no notice.
        const reason = result.state === 'denied' ? 'denied' : result.state === 'signed_out' && hadSession() ? 'expired' : null
        if (result.state === 'signed_out') forgetSession()
        return redirect(`/login?${reason ? `reason=${reason}&` : ''}returnTo=${encodeURIComponent(safeReturnPath(appUrlPath+url.search))}`)
      // Page RPCs recheck scope themselves. Explicit focus/expiry checks and path changes still revalidate.
      }, shouldRevalidate: shouldRevalidateWorkspace, children: [
      {path:memberPreviewPath.slice(1)+'/*',element:<MemberPreview/>},
      { index: true, element: gateway.overview?<><CurrentPhase api={gateway.process}/><Overview api={gateway.overview} announcements={gateway.announcements} canSearch={!!gateway.search} tasks={gateway.tasks} inventory={gateway.inventory} growth={gateway.growth} evaluations={gateway.evaluations} turnover={gateway.turnover}/></>:<><PageHeading title="Overview"/><EmptyState title="Overview unavailable" description="The workspace connection is unavailable."/></> },
      ...(gateway.turnover?[{path:'archive/:archivedWorkId?',element:<ArchivePage api={gateway.turnover}/>},{path:'handover/:turnoverCaseId?',element:<TurnoverPage api={gateway.turnover}/>}]:[]),
      {path:'prism/:evaluationId?/:view?',element:gateway.evaluations?<EvaluationsPage api={gateway.evaluations}/>:<Unavailable title="PRISM desk"/>},
      {path:'feedback',element:<MovedPage to="/prism"/>},
      {path:'department',element:<MovedPage to="/reviews"/>},
      {path:'committee',element:<CommitteePage tasks={gateway.tasks} deliverables={gateway.deliverables} handoffs={gateway.handoffs}/>},
      {path:'mentoring',element:gateway.growth?<GrowthPage api={gateway.growth}/>:<Unavailable title="Mentoring"/>},
      ...(gateway.inventory?[{path:'inventory/:inventoryLoanId?',element:<InventoryPage api={gateway.inventory}/>}]:[]),
      {path:'announcements',element:gateway.announcements?<Announcements api={gateway.announcements}/>:<EmptyState title="Announcements unavailable" description="Check the workspace connection."/>},
      {path:'privacy',element:gateway.privacy?<PrivacyPage api={gateway.privacy}/>:<EmptyState title="Privacy information unavailable" description="Check the workspace connection."/>},
      {path:'privacy/requests/:privacyRequestId',element:gateway.privacy?<PrivacyRequestPage api={gateway.privacy}/>:<EmptyState title="Privacy request unavailable" description="Check the workspace connection."/>},
      {path:'admin/privacy',element:gateway.privacy?<PrivacyAdministration api={gateway.privacy}/>:<EmptyState title="Privacy custodian tools unavailable" description="Check the workspace connection."/>},
      {path:'admin/privacy/retention',element:gateway.privacy?.retention?<RetentionPage api={gateway.privacy.retention}/>:<EmptyState title="Retention tools unavailable" description="Check the workspace connection."/>},
      {path:'admin/privacy/emergency',element:gateway.privacy?.emergency?<EmergencyPage api={gateway.privacy.emergency}/>:<EmptyState title="Temporary access unavailable" description="Check the workspace connection."/>},
      {path:'admin/privacy/disposition',element:gateway.privacy?.retention?<DispositionPage api={gateway.privacy.retention}/>:<EmptyState title="Disposition review unavailable" description="Check the workspace connection."/>},
      {path:'admin/privacy/recovery',element:gateway.privacy?.backupHealth?<BackupHealthPage read={gateway.privacy.backupHealth}/>:<EmptyState title="Recovery status unavailable" description="Check the workspace connection."/>},
      {path:'announcements/:announcementId',element:gateway.announcements?<AnnouncementDetail api={gateway.announcements} files={gateway.files}/>:<EmptyState title="Announcement unavailable" description="Check the workspace connection."/>},
      {path:'admin/announcements',element:gateway.announcements?<AnnouncementPublisher api={gateway.announcements}/>:<EmptyState title="Publishing unavailable" description="Check the workspace connection."/>},
      {path:'shared',element:<><PageHeading title="Shared with me" description="Work and decisions explicitly shared with your guest account."/>
        <SharedWork api={gateway.guests}/><nav className="auth-actions" aria-label="Guest help"><Link className="button button--secondary" to="/account#guest-contacts">Find guest contacts</Link></nav><ContextAnnouncements api={gateway.announcements}/></>},
      {path:'admin/process',element:gateway.process?<ProcessPage api={gateway.process}/>:<EmptyState title="Process configuration unavailable" description="Current connection unavailable."/>},
      {path:'search',element:gateway.search?<Search api={gateway.search}/>:<EmptyState title="Search unavailable" description="Current connection unavailable."/>},
      {path:'reports',element:gateway.reports?<Reports api={gateway.reports}/>:<EmptyState title="Reports unavailable" description="Current connection unavailable."/>},
      {path:'admin/imports',element:<CsvPreparation api={gateway.taskImports} rosterApi={gateway.rosterImports}/>},
      {path:'admin/layouts',element:gateway.layouts?<LayoutsPage api={gateway.layouts}/>:<EmptyState title="Layout settings unavailable" description="Current connection unavailable."/>},
      {path:'admin/access',element:gateway.access?<AccessPage api={gateway.access}/>:<EmptyState title="Access inspection unavailable" description="The connection is unavailable."/>},
      {path:'admin/config/:configurationType?',element:gateway.configuration?<ConfigurationPage api={gateway.configuration}/>:<EmptyState title="Configuration unavailable" description="The connection is unavailable."/>},
      {path:'reviews',element:gateway.inbox?<ReviewInbox api={gateway.inbox}/>:<EmptyState title="Reviews unavailable" description="The connection is unavailable."/>},
      {path:'publicity',element:gateway.publicity?<PublicityDesk api={gateway.publicity}/>:<EmptyState title="Publicity unavailable" description="The connection is unavailable."/>},
      {path:'publicity/:publicityTerm/:publicityId',element:gateway.publicity&&gateway.requests?<PublicityPage api={gateway.publicity} requests={gateway.requests} forms={gateway.forms} files={gateway.files}/>:<EmptyState title="Publicity unavailable" description="The connection is unavailable."/>},
      {path:'finance',element:gateway.finance?<><FinanceDesk api={gateway.finance}/>{gateway.finAuthority?<FinanceReviewQueue api={gateway.finAuthority}/>:null}</>:<EmptyState title="Finance unavailable" description="The connection is unavailable."/>},
      {path:'finance/reviews/:finTerm/:finId',element:gateway.finAuthority?<FinanceReviewPage api={gateway.finAuthority} files={gateway.files} ledger={gateway.ledger}/>:<EmptyState title="FIN review unavailable" description="The connection is unavailable."/>},
      {path:'finance/:financeTermId/:financeId',element:gateway.finance&&gateway.requests?<FinanceCasePage api={gateway.finance} requests={gateway.requests} files={gateway.files}/>:<EmptyState title="Finance unavailable" description="The connection is unavailable."/>},
      {path:'reviews/:reviewTermId/:reviewId',element:gateway.inbox&&gateway.approvals?<ReviewPage api={gateway.approvals} inbox={gateway.inbox} files={gateway.files} roomBookings={gateway.roomBookings}/>:<EmptyState title="Review unavailable" description="The connection is unavailable."/>},
      {path:'requests/mine',element:gateway.requests?<MyRequestsPage api={gateway.requests}/>:<EmptyState title="Requests unavailable" description="The connection is unavailable."/>},
      {path:'requests/services/:typeId/new',element:gateway.requests&&gateway.catalog?<NewRequestPage api={gateway.requests} catalog={gateway.catalog}/>:<EmptyState title="Draft unavailable" description="The connection is unavailable."/>},
      {path:'requests/:requestTermId/:requestId',element:gateway.requests&&gateway.forms?<RequestDetailPage api={gateway.requests} forms={gateway.forms} files={gateway.files} roomBookings={gateway.roomBookings}/>:<EmptyState title="Request unavailable" description="The connection is unavailable."/>},
      {path:'requests/services/:typeId/preview',element:gateway.forms&&gateway.catalog?<FormPreviewPage api={gateway.forms} catalog={gateway.catalog} files={gateway.files}/>:<EmptyState title="Form unavailable" description="The connection is unavailable."/>},
      {path:'requests/services/:typeId',element:gateway.catalog?<CatalogPage api={gateway.catalog} process={gateway.process}/>:<EmptyState title="Catalog unavailable" description="The connection is unavailable."/>},
      {path:'working-together/handoffs',element:gateway.handoffs?<HandoffsPage api={gateway.handoffs}/>:<EmptyState title="Handoffs unavailable" description="The connection is unavailable."/>},
      {path:'working-together/handoffs/:handoffId',element:gateway.handoffs?<HandoffPage api={gateway.handoffs} files={gateway.files}/>:<EmptyState title="Handoff unavailable" description="The connection is unavailable."/>},
      {path:'working-together/timeline',element:gateway.timeline?<TimelinePage api={gateway.timeline}/>:<EmptyState title="Timeline unavailable" description="The connection is unavailable."/>},
      {path:'working-together/:agreementId',element:gateway.synergies?<AgreementPage api={gateway.synergies}/>:<EmptyState title="Agreement unavailable" description="The connection is unavailable."/>},
      {path:'tasks/:taskId',element:gateway.tasks?<TaskDetail process={gateway.process} publicity={gateway.publicity} finance={gateway.finance} handoffs={gateway.handoffs} timeline={gateway.timeline} dependencies={gateway.dependencies} api={gateway.tasks} comments={gateway.comments} files={gateway.files} synergies={gateway.synergies}/>:<EmptyState title="Task unavailable" description="The connection is unavailable."/>},
      {path:'deliverables/:deliverableId',element:gateway.deliverables?<DeliverablePage process={gateway.process} readiness={gateway.readiness} publicity={gateway.publicity} finance={gateway.finance} timeline={gateway.timeline} api={gateway.deliverables} commands={gateway.deliverableCommands} comments={gateway.comments} files={gateway.files} synergies={gateway.synergies}/>:<EmptyState title="Deliverable unavailable" description="The workspace connection is unavailable."/>},
      ...navigationItems.filter((item) => item.href !== '/' && !explicitAreas.has(item.href)).map((item) => ({
        path: item.href.slice(1),
        element: item.id === 'admin' && gateway.organization ? <OrganizationPage api={gateway.organization}/> : item.id === 'resources' && gateway.resources ? <ResourcesPage api={gateway.resources} people={gateway.people}/> : item.id === 'calendar' && gateway.calendar ? <CalendarPage api={gateway.calendar}/> : item.id === 'notifications' ? <><Notifications/><ContextAnnouncements api={gateway.announcements}/></> : item.id === 'requests' && gateway.catalog ? <CatalogPage api={gateway.catalog} process={gateway.process}/> : item.href === '/working-together' && gateway.synergies ? <WorkingTogetherPage api={gateway.synergies}/> : item.id === 'tasks' && gateway.tasks ? <TasksPage api={gateway.tasks} exportCsv={gateway.exportOperationalWork} /> : item.id === 'deliverables' && gateway.deliverables ? <DeliverablesRoute api={gateway.deliverables} commands={gateway.deliverableCommands} exportCsv={gateway.exportOperationalWork} /> : item.id === 'people' && gateway.people ? <DirectoryPage api={gateway.people} /> : item.id === 'guests' && gateway.guests ? <SponsorPage api={gateway.guests} /> : item.id === 'account' ? <AccountPage gateway={gateway} /> : <Unavailable title={item.label} />,
        errorElement: <ErrorState title="This page could not open" description="Return to the overview and try again. If it keeps happening, contact the workspace maintainer." action={<Link className="button" to="/">Return to overview</Link>} />,
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
  return createBrowserRouter(createAppRoutes(environment), { basename: basePath || '/' })
}
