import { EmailCodeSignIn } from './EmailCodeSignIn'
import '../shared/shared.css'
import { appPath } from '../../lib/basePath'
import { ChevronRight, LogOut, MessageSquareText, TriangleAlert } from 'lucide-react'
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
import { Link, Outlet, useLoaderData, useLocation, useNavigate, useNavigation, useRevalidator, useRouteLoaderData } from 'react-router'
import { onPageReturn } from '../../lib/pageReturn'
import { pollDelay } from '../shared/useAutoRefresh'
import { useDelayedFlag } from '../../lib/useDelayedFlag'
import { ProfileEditor } from '../account/ProfileEditor'
import { SettingsSection, ThemeSettings } from '../account/Settings'
import { PageHeading } from '../../components/Page'
import { DeveloperMessageDialog } from '../developer-message/DeveloperMessageDialog'
import { GuestContactEditor } from '../account/GuestContactEditor'
import { LoadingState } from '../../components/FeedbackState'
import { Pending } from '../../components/PendingButton'
import { Reveal } from '../../components/Reveal'
import { AppShell } from '../../app/AppShell'
import { canPreviewAsMember, isMemberPreviewPath, memberPreviewPath } from '../../app/MemberPreview'
import { InstallWorkspace } from '../../app/InstallWorkspace'
import { ReplayTourButton } from '../tutorial/Tutorial'
import { RecommendedAlerts } from '../notifications/RecommendedAlerts'
import { SetupAgainButton } from '../setup-wizard/SetupWizard'
import { DriveConnection } from '../integrations/drive/DriveSource'
import { DevicePush } from '../notifications/DevicePush'
import type { NavigationCapability } from '../../app/navigation'
import type { AuthGateway, AuthResult, WorkspaceContext } from './gateway'
import { consumeReturnPath, isGuest } from './gateway'
import { readCallback, safeReturnPath } from './redirects'
import {ScheduleDrafts} from '../timeline/ScheduleDrafts'

export function AuthRevalidator({ gateway }: { gateway: AuthGateway }) {
  const { revalidate, state } = useRevalidator()
  const navigation = useNavigation()
  const location = useLocation()
  const workspace=useRouteLoaderData('workspace') as WorkspaceContext|undefined
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const [signingOut, setSigningOut] = useState(false)
  const [offlineError, setOfflineError] = useState('')
  const offlineHeading = useRef<HTMLHeadingElement>(null)
  const draftIdentity=workspace?JSON.stringify([workspace.termId,isGuest(workspace)?'guest:'+workspace.guestAccessId:'core:'+workspace.memberId,[...(workspace.capabilities??[])].sort()]):'signed-out'
  useEffect(() => { if (offline) offlineHeading.current?.focus() }, [offline])
  // Access checks run in the background and never remount the page. A return to the tab
  // (focus and visibility fire together) is one check; the timer only runs while visible.
  const navigationRef = useRef(navigation.state)
  const lastCheck = useRef(0)
  useEffect(() => { navigationRef.current = navigation.state }, [navigation.state])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible' || window.location.pathname === appPath('/auth/callback')) return
      // A navigation already re-checks access in its loader; a second check would interrupt it.
      if (navigationRef.current !== 'idle') return
      // Returning to the tab can fire focus, visibility and a recovered-session event together.
      const now = Date.now()
      if (now - lastCheck.current < 3_000) return
      lastCheck.current = now
      void revalidate()
    }
    const stop = gateway.onChange(refresh)
    const stopReturn = onPageReturn(refresh, { minGapMs: 10_000 })
    // About once a minute while in use; jittered so 60+ open tabs don't check in lockstep, and
    // slower while the person is idle (see pollDelay).
    let timer = 0
    const tick = () => { refresh(); timer = window.setTimeout(tick, pollDelay(60_000)) }
    timer = window.setTimeout(tick, pollDelay(60_000))
    return () => { stop(); stopReturn(); clearTimeout(timer) }
  }, [gateway, revalidate])
  // Only a check that takes a noticeable time pauses the page; quick ones stay invisible, so
  // typing is never interrupted (inert would also drop focus and close the phone keyboard).
  const slowCheck = useDelayedFlag(state === 'loading', 800)
  useEffect(() => {
    const disconnected = () => setOffline(true)
    const reconnected = () => { void revalidate().then(() => setOffline(!navigator.onLine)) }
    const hide = () => { document.documentElement.classList.add('leaving-workspace') }
    // Back/forward cache restore (common on phones): keep the page hidden until access is
    // re-checked in place, instead of reloading the whole app.
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      void revalidate().finally(() => document.documentElement.classList.remove('leaving-workspace'))
    }
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
    <div hidden={offline} inert={offline||slowCheck&&!!workspace}>{state === 'loading' && !workspace && location.pathname !== '/auth/callback' ? <main className="standalone-page"><LoadingState /></main> : <Outlet />}</div>
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
    <div className="stage-identity"><Countdown variant="hero" /></div>
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
      {!guestEntry ? <EmailCodeSignIn requestCode={email => gateway.requestEmailCode(email)} verifyCode={(email, code) => gateway.verifyEmailCode(email, code)}
        onSignedIn={() => window.location.replace(appPath(returnTo))} /> : null}
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
  const [busy, setBusy] = useState<'' | 'switch' | 'out' | 'everywhere'>('')
  const [confirmEverywhere, setConfirmEverywhere] = useState(false)
  const [messaging, setMessaging] = useState(false)
  const guest = !!context && isGuest(context)
  async function leave(how: 'switch' | 'out' | 'everywhere') {
    setBusy(how); setError('')
    try { await gateway.signOut({ everywhere: how === 'everywhere' }); if (how === 'switch') await gateway.beginGoogle('/'); else window.location.replace(appPath('/login')) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Couldn\'t sign you out. Try again.'); setBusy('') }
  }
  return <div className="settings">
    <PageHeading title="Settings" description={guest ? 'Your access comes from your invitation and ends when it expires.' : 'Your access comes from your committee role. Everything here only changes things for you.'} />
    {context && !guest && gateway.profile ? <SettingsSection id="profile" title="Profile" lead="Optional. Core members see what you add, so they can reach you.">
      <ProfileEditor key={context.memberId + context.termId} api={gateway.profile} termId={context.termId} bare />
    </SettingsSection> : null}
    {context && isGuest(context) && gateway.guestContacts ? <SettingsSection id="guest-contacts" title="Your contacts" lead="Your own details and the contacts the organizer shared with you.">
      <GuestContactEditor key={context.guestAccessId} api={gateway.guestContacts} termId={context.termId} bare />
    </SettingsSection> : null}
    <SettingsSection id="appearance" title="Appearance" lead="Changes right away, on this device only.">
      <ThemeSettings />
    </SettingsSection>
    <SettingsSection id="alerts" title="Alerts and reminders" lead="Updates always show in the app. This is about extra nudges.">
      {context && !guest && gateway.notifications ? <RecommendedAlerts key={context.memberId + context.termId} api={gateway.notifications} term={context.termId} /> : null}
      <Link className="settings-link" to="/notifications">
        <span className="settings-link__text"><span className="settings-link__label">Alert settings</span><span className="settings-link__hint">Right away, a daily digest or off. Email and Telegram live here too.</span></span>
        <ChevronRight className="icon" size={18} strokeWidth={1.75} aria-hidden="true" />
      </Link>
      {context && !guest && gateway.notifications?.push ? <DevicePush key={context.memberId + context.termId} api={gateway.notifications.push}
        term={context.termId} canManage={context.capabilities.includes('admin.configure')} /> : null}
    </SettingsSection>
    <SettingsSection id="install" title="Install the app" lead="Open it from your home screen like any other app.">
      <InstallWorkspace />
    </SettingsSection>
    {context ? <SettingsSection id="tour" title="Getting started" lead={guest ? 'Run the short setup again: theme, reminders and the app.' : 'A short walk through Today, Work, Event, Team and search, or the setup steps again.'}>
      <div className="auth-actions">{!guest ? <ReplayTourButton /> : null}<SetupAgainButton /></div>
    </SettingsSection> : null}
    {context && !guest && gateway.files?.drive ? <SettingsSection id="connections" title="Connections" lead="Link your Google Drive to attach files from it.">
      <DriveConnection key={context.memberId+context.termId} api={gateway.files.drive} term={context.termId} />
    </SettingsSection> : null}
    <SettingsSection id="privacy" title="Privacy and your data" lead="What the workspace keeps about you, and how to ask for a copy or a correction.">
      <Link className="settings-link" to="/privacy">
        <span className="settings-link__text"><span className="settings-link__label">Privacy notice and requests</span><span className="settings-link__hint">Read the notice or make a data request.</span></span>
        <ChevronRight className="icon" size={18} strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </SettingsSection>
    {gateway.developerMessage ? <SettingsSection id="help" title="Help" lead="Something broken or confusing? Tell the developer directly.">
      <div className="auth-actions"><button type="button" className="button button--secondary" onClick={() => setMessaging(true)}><MessageSquareText className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Message the developer</button></div>
    </SettingsSection> : null}
    <SettingsSection id="session" title="Signed in" lead={context?.displayName ? <>As <strong>{context.displayName}</strong>.</> : undefined}>
      <div className="auth-actions">
        <button className="button button--secondary" disabled={!!busy} aria-busy={busy === 'switch' || undefined} onClick={() => void leave('switch')}><Pending when={busy === 'switch'} label="Opening Google…">Switch Google account</Pending></button>
        <button className="button button--quiet" disabled={!!busy} aria-busy={busy === 'out' || undefined} onClick={() => void leave('out')}><Pending when={busy === 'out'} label="Signing out…"><LogOut className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Sign out</Pending></button>
        <button className="button button--quiet" disabled={!!busy} aria-expanded={confirmEverywhere} aria-controls="sign-out-everywhere" onClick={() => setConfirmEverywhere(open => !open)}>Sign out of all devices</button>
      </div>
      {confirmEverywhere ? <Reveal className="settings-confirm"><div id="sign-out-everywhere">
        <p data-reveal-focus>This signs you out on every phone, tablet and computer, including this one. Use it if you lost a device or signed in somewhere shared.</p>
        <div className="auth-actions">
          <button className="button" disabled={!!busy} aria-busy={busy === 'everywhere' || undefined} onClick={() => void leave('everywhere')}><Pending when={busy === 'everywhere'} label="Signing out everywhere…">Sign out everywhere</Pending></button>
          <button className="button button--secondary" disabled={busy === 'everywhere'} onClick={() => setConfirmEverywhere(false)}>Cancel</button>
        </div>
      </div></Reveal> : null}
      {error ? <p role="alert">{error}</p> : null}
    </SettingsSection>
    {messaging && gateway.developerMessage ? <DeveloperMessageDialog api={gateway.developerMessage} onClose={() => setMessaging(false)} /> : null}
  </div>
}
