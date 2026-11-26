import '../shared/shared.css'
import { appPath } from '../../lib/basePath'
import { TriangleAlert } from 'lucide-react'
import { TedxLockup, licenseLine } from '../../components/TedxLockup'
import { Countdown } from '../../components/Countdown'
import {SiteLogo} from '../admin/site/SiteLogo'
import {SiteEditMode} from '../admin/site/SiteEditMode'
import {usePublishedSite} from '../admin/site/usePublishedSite'
import {CurrentRecordScope} from './RecordScope'
import {EditSafety} from '../../components/EditSafety'
import {NotificationCenter} from '../notifications/Notifications'
import type {NotificationsApi} from '../notifications/api'
import {FinDecisionMemory} from '../finance/DecisionMemory'
import {FinanceMemory} from '../finance/Memory'
import {ReviewMemory} from '../approvals/Memory'
import {RequestMemory} from '../requests/Memory'
import {FormDrafts} from '../forms/Drafts'
import {HandoffDrafts} from '../handoffs/Drafts'
import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLoaderData, useLocation, useNavigate, useRevalidator, useRouteLoaderData } from 'react-router'
import { ProfileEditor } from '../account/ProfileEditor'
import { GuestContactEditor } from '../account/GuestContactEditor'
import { LoadingState } from '../../components/FeedbackState'
import { AppShell } from '../../app/AppShell'
import { canPreviewAsMember, isMemberPreviewPath, memberPreviewPath } from '../../app/MemberPreview'
import { InstallWorkspace } from '../../app/InstallWorkspace'
import { ReplayTourButton } from '../tutorial/Tutorial'
import { DriveConnection } from '../integrations/drive/DriveSource'
import type { NavigationCapability } from '../../app/navigation'
import type { AuthGateway, AuthResult, WorkspaceContext } from './gateway'
import { consumeReturnPath, isGuest } from './gateway'
import { readCallback, safeReturnPath } from './redirects'
import {ScheduleDrafts} from '../timeline/ScheduleDrafts'

export function AuthRevalidator({ gateway }: { gateway: AuthGateway }) {
  const { revalidate, state } = useRevalidator()
  const location = useLocation()
  const workspace=useRouteLoaderData('workspace') as WorkspaceContext|undefined
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const [signingOut, setSigningOut] = useState(false)
  const [offlineError, setOfflineError] = useState('')
  const offlineHeading = useRef<HTMLHeadingElement>(null)
  const draftIdentity=workspace?JSON.stringify([workspace.termId,isGuest(workspace)?'guest:'+workspace.guestAccessId:'core:'+workspace.memberId,[...(workspace.capabilities??[])].sort()]):'signed-out'
  useEffect(() => { if (offline) offlineHeading.current?.focus() }, [offline])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && window.location.pathname !== appPath('/auth/callback')) void revalidate() }
    const stop = gateway.onChange(refresh)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, 30_000)
    return () => { stop(); clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [gateway, revalidate])
  useEffect(() => {
    const disconnected = () => setOffline(true)
    const reconnected = () => { void revalidate().then(() => setOffline(!navigator.onLine)) }
    const hide = () => { document.documentElement.classList.add('leaving-workspace') }
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload() }
    window.addEventListener('offline', disconnected)
    window.addEventListener('online', reconnected)
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', restore)
    return () => {
      window.removeEventListener('offline', disconnected)
      window.removeEventListener('online', reconnected)
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', restore)
    }
  }, [revalidate])

  async function leaveOffline() {
    setSigningOut(true)
    setOfflineError('')
    try {
      await gateway.signOut()
      window.location.replace(appPath('/login'))
    } catch {
      setSigningOut(false)
      setOfflineError('Couldn\'t sign you out. Check your connection and try again.')
    }
  }

  return <FinDecisionMemory identity={draftIdentity}><FinanceMemory identity={draftIdentity}><ReviewMemory identity={draftIdentity}><RequestMemory identity={draftIdentity}><FormDrafts identity={draftIdentity}><ScheduleDrafts identity={draftIdentity}><HandoffDrafts identity={draftIdentity}><EditSafety key={draftIdentity}>
    {offline?<main className="standalone-page"><h1 ref={offlineHeading} tabIndex={-1}>You’re offline</h1><p role="status">Reconnect to check your current access and resume work. If you tried to save just before the connection dropped, check the result before trying again.</p>{workspace?<button className="button button--secondary" disabled={signingOut} onClick={()=>void leaveOffline()}>Sign out of this browser</button>:null}{offlineError?<p role="alert">{offlineError}</p>:null}</main>:null}
    <div hidden={offline} inert={offline||state==='loading'&&!!workspace}>{state === 'loading' && !workspace && location.pathname !== '/auth/callback' ? <main className="standalone-page"><LoadingState /></main> : <Outlet />}</div>
  </EditSafety></HandoffDrafts></ScheduleDrafts></FormDrafts></RequestMemory></ReviewMemory></FinanceMemory></FinDecisionMemory>
}

export function ProtectedShell({notifications,gateway}:{notifications?:NotificationsApi;gateway?:AuthGateway}) {
  const member = useLoaderData() as WorkspaceContext
  const[siteEpoch,setSiteEpoch]=useState(0)
  const { pathname } = useLocation()
  const memberPreview = isMemberPreviewPath(pathname)
  const { revalidate,state } = useRevalidator()
  const siteScope=JSON.stringify([member.organizationId,member.termId,isGuest(member)?'guest:'+member.guestAccessId:'core:'+member.memberId,[...member.capabilities].sort()])
  const site=usePublishedSite(memberPreview ? undefined : gateway?.site,member.termId,siteScope,state,member,siteEpoch)
  useEffect(() => {
    const timer = window.setTimeout(() => void revalidate(), Math.min(2_147_483_647, Math.max(0, Date.parse(member.expiresAt) - Date.now())))
    return () => clearTimeout(timer)
  }, [member.expiresAt, revalidate])
  if (memberPreview) return <Outlet />
  return <NotificationCenter api={notifications} term={member.termId} identity={'memberId'in member?member.memberId:member.guestAccessId}><AppShell context={{ audience: isGuest(member) ? 'guest' : 'core', capabilities: member.capabilities as NavigationCapability[], connected: [...(gateway?.growth ? ['mentoring'] : []), ...(gateway?.inventory ? ['inventory'] : [])] }} identity={{ displayName: member.displayName }} preview={false} headerAction={canPreviewAsMember(member)?<Link className="button button--secondary" to={memberPreviewPath}>View as member</Link>:undefined} sitePresentation={site.presentation} siteUnavailable={site.unavailable} siteLogo={gateway?.site&&site.presentation?.logo?<SiteLogo api={gateway.site} term={member.termId} scope={siteScope} asset={site.presentation.logo.assetId} approval={site.presentation.logo.approvalId}/>:undefined} siteEditor={gateway?.siteWording?<SiteEditMode api={gateway.siteWording} context={member} onPublished={()=>setSiteEpoch(n=>n+1)}/>:undefined} content={gateway?<CurrentRecordScope gateway={gateway}><Outlet /></CurrentRecordScope>:undefined} /></NotificationCenter>
}

export function LoginPage({ gateway }: { gateway: AuthGateway }) {
  const result = useLoaderData() as AuthResult
  const location = useLocation()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const denied = result.state === 'denied' || new URLSearchParams(location.search).get('reason') === 'denied'
  const returnTo=safeReturnPath(new URLSearchParams(location.search).get('returnTo'))
  const guestEntry=returnTo==='/shared'||returnTo==='/my-part'||returnTo==='/guest/redeem'
  async function start(switchAccount = false) {
    setBusy(true); setError('')
    try {
      if (switchAccount) await gateway.signOut()
      await gateway.beginGoogle(returnTo)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in could not start.'); setBusy(false) }
  }
  return <div className="stage">
  <main className="stage-main">
    <div className="stage-lockup"><TedxLockup size="lg" /></div>
    <div className="stage-identity">
      <p className="stage-kicker">Core workspace</p>
      <Countdown variant="hero" />
    </div>
    <div className="stage-panel auth-panel">
    <h1>Sign in to your workspace</h1>
    {new URLSearchParams(safeReturnPath(new URLSearchParams(location.search).get('returnTo')).split('?')[1]).has('term')?<p>The selected term could not be opened. You can <Link to="/search">return to current workspace search</Link> or retry sign-in for the selected term below.</p>:null}
    {guestEntry?<p>Use the Google account your invite was sent to. If your invite expired, ask the organizer who sent it for a new link.</p>:
      <p>Sign in with your <strong>student.ateneo.edu</strong> Google account. Only organizers on this term's roster can get in. Not on it yet? Ask your committee head.</p>}
    {new URLSearchParams(location.search).get('reason') === 'expired' ? <p role="status">Your previous session has ended. Sign in again to continue where you left off.</p> : null}
    {result.state === 'unavailable' ? <section className="feedback-state feedback-state--error"><TriangleAlert className="icon" size={20} strokeWidth={1.5} aria-hidden="true" /><h2>Setup needed</h2><p>Sign-in isn't set up for this address yet.</p></section> : <>
      {denied ? <p role="alert">{guestEntry?'We couldn\'t confirm your guest invite. Make sure you\'re using the Google account it was sent to, or ask the organizer who invited you.':
        'This account isn\'t on this term\'s roster. Try another account or ask your committee head to add you.'}</p> : null}
      {result.state === 'error' ? <p role="alert">We couldn't check your access. Try again in a moment.</p> : null}
      <button className="button" disabled={busy} onClick={() => void start(denied)}>{busy ? 'Opening Google…' : denied ? 'Use another Google account' : 'Continue with Google'}</button>
    </>}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <p className="muted">Guest? Open the invite link an organizer sent you. Use the Google account it was sent for.</p>
    {import.meta.env.DEV ? <Link className="button button--secondary" to="/preview">View development shell preview</Link> : null}
    </div>
  </main>
  <footer className="stage-footer"><p className="license-line">{licenseLine}</p></footer>
  </div>
}

export function CallbackPage({ gateway }: { gateway: AuthGateway }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)
  const [retryPath,setRetryPath]=useState('/')
  const recovered=useRef<string|null>(null)
  useEffect(() => {
    let active = true
    const code = readCallback(location.search)
    window.history.replaceState(window.history.state, '', appPath('/auth/callback'))
    const fail=()=>{
      if(!active)return
      recovered.current??=consumeReturnPath()
      setRetryPath(recovered.current)
      setFailed(true)
    }
    if (!code) { fail(); return }
    void gateway.exchange(code).then(() => { if (active) void navigate(consumeReturnPath(), { replace: true }) }).catch(fail)
    return () => { active = false }
  }, [gateway, location.search, navigate])
  return <main className="standalone-page">{failed ? <><h1>Sign-in didn't finish</h1><p>Google sign-in was cancelled or timed out. Try again. Guests can ask the organizer who invited them.</p>
    <Link className="button" to={retryPath==='/'?'/login':'/login?returnTo='+encodeURIComponent(retryPath)}>Start sign-in again</Link></> : <LoadingState />}</main>
}

export function AccountPage({ gateway }: { gateway: AuthGateway }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function leave(switchAccount: boolean) {
    setBusy(true); setError('')
    try { await gateway.signOut(); if (switchAccount) await gateway.beginGoogle('/'); else window.location.replace(appPath('/login')) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Couldn\'t sign you out. Try again.'); setBusy(false) }
  }
  return <><h1>Your account</h1><p className="muted">{context && isGuest(context) ? 'Your access comes from your invitation and ends when it expires.' : 'Your access comes from your committee role.'}</p>
  {context && !isGuest(context) && gateway.profile ? <ProfileEditor key={context.memberId + context.termId} api={gateway.profile} termId={context.termId} /> : null}
  {context && isGuest(context) && gateway.guestContacts ? <GuestContactEditor key={context.guestAccessId} api={gateway.guestContacts} termId={context.termId} /> : null}
  <InstallWorkspace />
  {context && !isGuest(context) ? <section className="account-tour" aria-labelledby="account-tour-title"><h2 id="account-tour-title">Workspace tour</h2><p className="muted">A short walk through Today, Work, Event, Team and the search.</p><ReplayTourButton /></section> : null}
  {context && !isGuest(context) && gateway.files?.drive ? <DriveConnection key={context.memberId+context.termId} api={gateway.files.drive} term={context.termId} /> : null}
  <p><Link to="/privacy">Privacy notice and requests</Link></p>
  <div className="auth-actions">
    <button className="button button--quiet" disabled={busy} onClick={() => void leave(true)}>Switch Google account</button>
    <button className="button button--quiet" disabled={busy} onClick={() => void leave(false)}>Sign out</button>
  </div>{error ? <p role="alert">{error}</p> : null}</>
}
