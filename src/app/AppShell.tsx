import { NotificationBadge } from '../features/notifications/Notifications'
import { ChevronLeft, CircleUser, LogOut, Moon, PenLine, RotateCcw, Search, Sun, UserRound } from 'lucide-react'
import { TedxLockup, licenseLine } from '../components/TedxLockup'
import { CountdownChip } from '../components/Countdown'
import { Menu, type MenuEntry } from '../components/Menu'
import { navIcon, tabIcon } from './navIcons'
import { applyNavigationPresentation, validSitePresentation, type SitePresentation } from '../features/admin/site/presentation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigation, useRevalidator } from 'react-router'
import { getGuestNavigation, getTabItems, getVisibleNavigation, getVisibleTabs, setupNavigation, tabForPath, type NavigationContext, type NavigationItem, type TabId } from './navigation'
import { pageTitleFor } from './pageTitle'
import { useShellServices } from './shellServices'
import { appPath } from '../lib/basePath'
import { CommandPalette, openPalette } from '../features/palette/Palette'
import { Tutorial } from '../features/tutorial/Tutorial'
import { replayTour } from '../features/tutorial/events'
import { countVisit, useInstalledReport } from '../features/install/InstallBanner'

type AppShellProps = {
  context?: NavigationContext
  identity?: { displayName: string; unitName?: string }
  content?: ReactNode
  preview?: boolean
  sitePresentation?: SitePresentation
  siteEditor?: ReactNode
  siteLogo?: ReactNode
  siteUnavailable?: boolean
  memberPreviewPath?: string
  headerAction?: ReactNode
}

// Matches public/theme.js, which applies the same choice before first paint:
// stored choice, then the system preference, then dark.
const shortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'

function readInitialTheme(): 'dark' | 'light' {
  const applied = document.documentElement.dataset.theme
  if (applied === 'light' || applied === 'dark') return applied
  try {
    const stored = window.localStorage.getItem('tedx-workspace-theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* Storage optional. */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function SubLink({ item }: { item: NavigationItem }) {
  const Icon = navIcon(item.id)
  return <NavLink className="nav-link nav-link--sub" to={item.href} end={item.href === '/' || item.href === '/publicity'}>
    <Icon className="icon" size={16} strokeWidth={1.5} aria-hidden="true" />
    <span className="nav-link__label">{item.label}</span>
  </NavLink>
}

function TabLink({ id, label, href, active, compact = false }: { id: TabId; label: string; href: string; active: boolean; compact?: boolean }) {
  const Icon = tabIcon(id)
  return <Link className={`nav-link nav-link--tab${active ? ' active' : ''}`} to={href} aria-current={active ? 'page' : undefined} data-tour={'tab-' + id}>
    <Icon className="icon" size={compact ? 22 : 18} strokeWidth={active ? 2 : 1.5} aria-hidden="true" />
    <span className="nav-link__label">{label}</span>
  </Link>
}

function PlainLink({ item, compact = false }: { item: NavigationItem; compact?: boolean }) {
  const Icon = navIcon(item.id)
  return <NavLink className="nav-link" to={item.href} end={item.href === '/'}>
    <Icon className="icon" size={compact ? 22 : 18} strokeWidth={1.5} aria-hidden="true" />
    <span className="nav-link__label">{item.label}</span>
  </NavLink>
}

export function AppShell({ context = setupNavigation, identity, content, preview = true, sitePresentation, siteUnavailable = false, siteEditor, siteLogo, memberPreviewPath, headerAction }: AppShellProps) {
  const location = useLocation()
  const navigation = useNavigation()
  const { state: revalidation } = useRevalidator()
  const { gateway } = useShellServices()
  const [theme, setTheme] = useState<'dark' | 'light'>(readInitialTheme)
  const [siteEditing, setSiteEditing] = useState(false)
  const [signOutError, setSignOutError] = useState(false)
  const themeChosen = useRef(false)
  const mainRef = useRef<HTMLElement>(null)
  const siteSlot = useRef<HTMLDivElement>(null)
  const previousPath = useRef(location.pathname)
  const live = !preview && !memberPreviewPath
  const guest = context.audience === 'guest'

  const destination = (href: string) => memberPreviewPath ? memberPreviewPath + (href === '/' ? '' : href) : href
  const path = memberPreviewPath && location.pathname.toLowerCase().startsWith(memberPreviewPath)
    ? location.pathname.slice(memberPreviewPath.length) || '/' : location.pathname
  const visible = getVisibleNavigation(context)
  const presentation = validSitePresentation(sitePresentation) ? sitePresentation : undefined
  const worded = presentation ? applyNavigationPresentation(visible, presentation) : visible
  const items = worded.map(item => memberPreviewPath ? { ...item, href: destination(item.href) } : item)
  const blocks = presentation?.blocks.filter(b => b.kind === 'text' || visible.some(item => item.href === b.href)) ?? []
  const showGuidance = ['/', '/shared', '/resources'].includes(path)
  const tabs = getVisibleTabs(context)
  const activeTab = tabForPath(path)
  const subItems = activeTab ? getTabItems(context, activeTab, items) : []
  const guestItems = guest ? getGuestNavigation(context).map(item => items.find(x => x.id === item.id) ?? item) : []
  const title = pageTitleFor(path, worded)
  const admin = context.capabilities.includes('admin.configure')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#111111' : '#ffffff')
    // Only an explicit toggle is remembered, so the system preference keeps applying until then.
    if (themeChosen.current) try { window.localStorage.setItem('tedx-workspace-theme', theme) } catch { /* Storage optional. */ }
  }, [theme])

  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      previousPath.current = location.pathname
      setSiteEditing(false)
      mainRef.current?.focus({ preventScroll: true })
    }
  }, [location.pathname])

  useEffect(() => { document.title = `${title.title} · TEDx workspace` }, [title.title])
  useEffect(() => { if (live) countVisit() }, [live])
  useInstalledReport()

  // "Edit site wording" lives in the avatar menu; its editor opens above the page content.
  useEffect(() => {
    if (!siteEditing) return
    siteSlot.current?.querySelector<HTMLButtonElement>('.site-wording-mode > button')?.click()
    siteSlot.current?.scrollIntoView({ block: 'start' })
  }, [siteEditing])

  async function signOut() {
    setSignOutError(false)
    try { await gateway?.signOut(); window.location.replace(appPath('/login')) }
    catch { setSignOutError(true) }
  }

  const accountMenu: MenuEntry[] = [
    { kind: 'label', label: <><strong>{identity?.displayName ?? 'Not signed in'}</strong>{identity?.unitName ? <span>{identity.unitName}</span> : null}</> },
    { kind: 'link', label: 'Account', to: destination('/account'), icon: <UserRound size={16} strokeWidth={1.75} /> },
    ...(!guest && !memberPreviewPath ? [{ kind: 'action' as const, label: 'Replay the tour', icon: <RotateCcw size={16} strokeWidth={1.75} />, onSelect: replayTour }] : []),
    { kind: 'action', label: theme === 'dark' ? 'Light theme' : 'Dark theme', icon: theme === 'dark' ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />, onSelect: () => { themeChosen.current = true; setTheme(current => current === 'dark' ? 'light' : 'dark') } },
    ...(admin && siteEditor && live ? [{ kind: 'action' as const, label: 'Edit site wording', icon: <PenLine size={16} strokeWidth={1.75} />, onSelect: () => setSiteEditing(true) }] : []),
    ...(live && gateway ? [{ kind: 'separator' as const }, { kind: 'action' as const, label: 'Sign out', quiet: true, icon: <LogOut size={16} strokeWidth={1.75} />, onSelect: () => void signOut() }] : []),
  ]

  const breadcrumb = <span className="current-location">
    {title.parent ? <><Link className="current-location__parent" to={destination(title.parent.href)}>{title.parent.label}</Link><span className="current-location__sep" aria-hidden="true">/</span></> : null}
    <span aria-current="page">{title.title}</span>
  </span>

  return (
    <div className={presentation?.accent === '#252624' ? 'site-theme--ink' : 'site-theme--default'}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {preview ? <div className="preview-notice">Development shell preview <span>Destinations require sign-in</span></div> : null}
      {memberPreviewPath && <div className="preview-notice" role="status">Member view <span>Read-only preview with sample data</span></div>}
      <div className="workspace-shell">
        <aside className="sidebar" aria-label="Workspace sidebar">
          <div className="workspace-identity">
            {siteLogo}
            <TedxLockup to={destination('/')} />
            <p>Core workspace</p>
          </div>
          <nav aria-label="Workspace" className="desktop-navigation">
            {guest ? <ul className="navigation-group">{guestItems.map(item => <li key={item.id}><PlainLink item={item} /></li>)}</ul>
              : <ul className="navigation-group navigation-tabs">{tabs.map(tab => <li key={tab.id}>
                <TabLink id={tab.id} label={tab.label} href={destination(tab.href)} active={activeTab === tab.id} />
                {activeTab === tab.id && subItems.length ? <ul className="navigation-sub" aria-label={tab.label + ' pages'}>{subItems.map(item => <li key={item.id}><SubLink item={item} /></li>)}</ul> : null}
              </li>)}</ul>}
          </nav>
          <div className="sidebar-footer"><p className="license-line">{licenseLine}</p></div>
        </aside>
        <div className="workspace-body">
          <header className="workspace-header">
            <div className="location-heading">
              {title.parent ? <Link className="mobile-back" to={destination(title.parent.href)}><ChevronLeft className="icon" size={20} strokeWidth={1.75} aria-hidden="true" /><span>{title.parent.label}</span></Link> : null}
              <span className={`mobile-identity${title.parent ? ' has-back' : ''}`}><TedxLockup to={destination('/')} /></span>
              {breadcrumb}
            </div>
            <div className="account-summary">
              {revalidation === 'loading' && live ? <span className="access-check" aria-hidden="true"><span className="access-check__line" />Checking access</span> : null}
              {/* The one spoken announcement for the session check; the visual chip above is hidden from screen readers. */}
              {live ? <span className="visually-hidden" role="status">{revalidation === 'loading' ? 'Checking current access. Your edits stay here while actions are paused.' : ''}</span> : null}
              {signOutError ? <span className="access-check access-check--error" role="alert">Sign-out failed. Try again from Account.</span> : null}
              <CountdownChip className="header-countdown" />
              {headerAction}
              {!memberPreviewPath ? <button className="header-search" type="button" onClick={() => openPalette()} aria-label={`Find or add (${shortcut})`} aria-keyshortcuts="Meta+K Control+K" data-tour="search">
                <Search className="icon" size={18} strokeWidth={1.75} aria-hidden="true" /><span className="header-search__label">Find</span><kbd className="header-search__kbd">{shortcut}</kbd>
              </button> : null}
              {!memberPreviewPath ? <span className="bell" data-tour="bell"><NotificationBadge /></span> : null}
              <Menu label="Account menu" tour="account-menu" className="account-menu" entries={accountMenu}
                trigger={<CircleUser className="icon" size={22} strokeWidth={1.5} aria-hidden="true" />} />
            </div>
          </header>
          <main className="workspace-main" id="main-content" tabIndex={-1} ref={mainRef} aria-busy={navigation.state !== 'idle'}>
            {/* The current page stays mounted while the next one loads, so filters, scroll and drafts survive. */}
            {navigation.state !== 'idle' ? <div className="route-progress" role="progressbar" aria-label="Opening page" /> : null}
            {siteEditor ? <div className="site-editor-slot" ref={siteSlot} hidden={!siteEditing}
              onClickCapture={event => { if (event.target instanceof Element && event.target.closest('[data-discard-edits]')) window.setTimeout(() => setSiteEditing(false)) }}>{siteEditor}</div> : null}
            <div key={location.pathname} className="view-enter">{content ?? <Outlet />}</div>
            {showGuidance && (blocks.length > 0 || siteUnavailable) ? <details className="site-guidance"><summary>Workspace guidance</summary>
              {siteUnavailable ? <p className="muted">Couldn't apply the site settings, so you're seeing the standard menus. Your work is all still here.</p> : null}
              {blocks.map(block => <section key={block.id} className={block.kind === 'card' ? 'panel site-guidance-card' : 'site-guidance-block'}>
                <h2>{block.kind === 'text' ? block.title : <Link to={block.href!}>{block.title}</Link>}</h2><p>{block.body}</p>
              </section>)}
            </details> : null}
          </main>
        </div>
      </div>
      <nav className={`mobile-navigation${guest ? ' mobile-navigation--guest' : ''}`} aria-label="Workspace tabs">
        {guest ? guestItems.map(item => <PlainLink key={item.id} item={item} compact />)
          : tabs.map(tab => <TabLink key={tab.id} id={tab.id} label={tab.label} href={destination(tab.href)} active={activeTab === tab.id} compact />)}
      </nav>
      {!memberPreviewPath ? <CommandPalette items={items.filter(item => item.href !== '/account' || !guest)} /> : null}
      {live && !guest ? <Tutorial /> : null}
    </div>
  )
}

