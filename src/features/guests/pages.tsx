import { appPath } from '../../lib/basePath'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLoaderData, useNavigate, useRouteLoaderData } from 'react-router'
import { PageHeading, Panel } from '../../components/Page'
import { TextField } from '../../components/TextField'
import { isGuest,type AuthGateway,type AuthResult,type WorkspaceContext } from '../auth/gateway'
import { formatDateTime } from '../shared/dates'
import { invitationUrl, readInvitationFragment, type GuestGateway, type GuestInvitation, type GuestWork } from './gateway'

export function SharedWork({api}:{api?:GuestGateway}) {
  const context=useRouteLoaderData('workspace') as WorkspaceContext|undefined
  return context&&isGuest(context)&&api?.listShared
    ?<SharedWorkList key={context.termId+':'+context.guestAccessId} api={api} term={context.termId}/>:null
}

function SharedWorkList({api,term}:{api:GuestGateway;term:string}) {
  const [page,setPage]=useState(1)
  const [revision,setRevision]=useState(0)
  const [loaded,setLoaded]=useState<{key:string;work:GuestWork|null}|null>(null)
  const key=term+':'+page+':'+revision
  useEffect(()=>{
    if(!api.listShared)return
    let active=true
    void api.listShared(term,page).then(work=>{if(active)setLoaded({key,work})})
      .catch(()=>{if(active)setLoaded({key,work:null})})
    return()=>{active=false}
  },[api,key,page,term])
  useEffect(()=>{
    const check=()=>{if(document.visibilityState!=='hidden')setRevision(value=>value+1)}
    window.addEventListener('focus',check)
    document.addEventListener('visibilitychange',check)
    return()=>{
      window.removeEventListener('focus',check)
      document.removeEventListener('visibilitychange',check)
    }
  },[])
  const current=loaded?.key===key?loaded:null
  return <Panel title="Shared work">
    {!current?<p role="status">Loading your shared work…</p>:current.work?<>{current.work.items.length?
      <ul className="guest-list">{current.work.items.map(item=><li key={item.id}>
        <Link className="button button--secondary" to={(item.kind==='task'?'/tasks/':'/deliverables/')+item.id}>{item.title}</Link>
      </li>)}</ul>:<p>Nothing has been shared with you yet. The organizer who invited you can share tasks or deliverables.</p>}
      {page>1||current.work.hasMore?<div className="auth-actions">
        {page>1?<button className="button button--secondary" type="button" onClick={()=>setPage(page-1)}>Previous</button>:null}
        {current.work.hasMore?<button className="button button--secondary" type="button" onClick={()=>setPage(page+1)}>Next</button>:null}
      </div>:null}
    </>:<><p role="alert">Couldn't load your shared work. Try again, or ask the organizer who invited you.</p>
      <button className="button button--secondary" type="button" onClick={()=>setRevision(value=>value+1)}>Try again</button>
    </>}
  </Panel>
}

export function SponsorPage({api}:{api:GuestGateway}) {
  const context=useRouteLoaderData('workspace') as WorkspaceContext
  const [items,setItems]=useState<GuestInvitation[]>([])
  const [email,setEmail]=useState('')
  const [days,setDays]=useState('14')
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [link,setLink]=useState('')
  const request=useRef<{key:string;id:string;expiry:string}|null>(null)
  useEffect(()=>{
    let active=true
    void api.list(context.termId).then(rows=>{if(active)setItems(rows)}).catch(()=>{if(active)setError('Couldn\'t load your invitations. Refresh the page to try again.')}).finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[api,context.termId])
  async function mutate(action:()=>Promise<void>) {
    setBusy(true);setError('');setNotice('');setLink('')
    try {await action();setItems(await api.list(context.termId))}
    catch {setError('We couldn\'t confirm that change. Refresh the page and try again. If it keeps failing, you may no longer be an access admin.')}
    finally {setBusy(false)}
  }
  async function create(event?:FormEvent,replaces?:GuestInvitation) {
    event?.preventDefault()
    if(!Number.isInteger(Number(days))||Number(days)<1||Number(days)>14){setError('Choose a whole number of days between 1 and 14.');return}
    const key=JSON.stringify([replaces?.id??'',replaces?.version??0,replaces?.email??email,days])
    if(request.current?.key!==key)request.current={key,id:crypto.randomUUID(),expiry:new Date(Date.now()+Number(days)*86400000).toISOString()}
    const current=request.current
    await mutate(async()=>{
      const result=await api.create(context.termId,replaces?.email??email,current.id,current.expiry,replaces)
      if(result.token)setLink(invitationUrl(window.location.origin,result.token))
      setNotice(result.token ? 'Invitation created. Copy the link now. You won\'t be able to see it again after you leave this page.' : 'This invitation was already created, but its link can\'t be shown again. Renew it to get a new link.')
      request.current=null
    })
  }
  return <>
    <PageHeading title="Guest invitations" description="Invite people outside the org to see specific tasks or deliverables. Only access admins can invite guests." />
    <Panel title="Invite a guest">
      <p>A new guest starts with nothing shared. Share each task or deliverable with them separately. Guests can't see the member directory or committee pages.</p>
      <form className="guest-form" onSubmit={event=>void create(event)}>
        <TextField id="guest-email" label="Guest Google email" type="email" required value={email} autoComplete="off" onChange={event=>setEmail(event.target.value)} hint="The email they'll sign in with. It doesn't have to be a school account." />
        <TextField id="guest-days" label="Days of access" type="number" min="1" max="14" required value={days} onChange={event=>setDays(event.target.value)} hint="Default 14 days. Renewing creates a new link and the old one stops working." />
        <button className={link?'button button--secondary':'button'} disabled={busy||loading}>Create invitation link</button>
      </form>
      <p className="muted">No email is sent. Share the copied link yourself. The guest must sign in with this exact Google account.</p>
    </Panel>
    {error?<p role="alert">{error}</p>:null}
    {notice?<p role="status">{notice}</p>:null}
    {link?<Panel title="Copy this invitation now"><div className="guest-link-copy"><p>This link disappears when you leave the page.</p><button className="button" onClick={()=>void navigator.clipboard.writeText(link).then(()=>setNotice('Invitation link copied.')).catch(()=>setError('Couldn\'t copy automatically. Select the link below and copy it.'))}>Copy invitation link</button><TextField id="invite-link" label="Invitation link" value={link} readOnly onFocus={event=>event.target.select()} /><button className="button button--secondary" onClick={()=>setLink('')}>Hide invitation link</button></div></Panel>:null}
    <Panel title="Your invitations">
      <p>See who has accepted and when their access ends.</p>
      {loading?<p role="status">Loading invitations…</p>:items.length===0?<p>No invitations yet.</p>:<ul className="guest-list">{items.map(item=><li key={item.id}>
        <h3>{item.email}</h3><p>{item.revokedAt?'Revoked':Date.parse(item.expiresAt)<=Date.now()?'Expired':item.redeemedAt?'Accepted':'Not accepted yet'} · Ends {formatDateTime(item.expiresAt)}</p>
        <p className="muted">{item.scopeMode === 'explicit_records' ? (item.sharedRecordCount === undefined ? 'Some work shared' : `${item.sharedRecordCount} ${item.sharedRecordCount === 1 ? 'item' : 'items'} shared`) : 'Nothing shared yet'}</p>
        {!item.revokedAt?<div className="auth-actions"><button className="button button--secondary" disabled={busy} onClick={()=>void create(undefined,item)}>Renew invitation for {item.email}</button><button className="button button--secondary" disabled={busy} onClick={()=>void mutate(async()=>{await api.revoke(item,crypto.randomUUID());setNotice('Access revoked. The guest is signed out of this invitation.')} )}>Revoke access for {item.email}</button></div>:null}
      </li>)}</ul>}
    </Panel>
  </>
}

export function RedeemPage({gateway}:{gateway:AuthGateway}) {
  const auth=useLoaderData() as AuthResult
  // Lazy state survives StrictMode replay; never persist the bearer through an OAuth redirect.
  const [token]=useState(()=>readInvitationFragment(window.location.hash))
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [otherShared,setOtherShared]=useState(()=>auth.state==='authorized'&&isGuest(auth))
  const navigate=useNavigate()
  useEffect(()=>{window.history.replaceState(window.history.state,'',appPath('/guest/redeem'))},[])
  async function redeem() {
    if(!token||!gateway.guests)return
    setBusy(true);setError('')
    try {await gateway.guests.redeem(token);await navigate('/my-part',{replace:true})}
    catch {
      setError('Couldn\'t accept this invitation. Make sure you\'re signed in with the Google account it was sent to. If the link expired or was already used, ask the organizer who invited you for a new one.')
      const current=await gateway.readContext().catch(()=>null)
      setOtherShared(current?.state==='authorized'&&isGuest(current))
      setBusy(false)
    }
  }
  async function signIn() {
    setBusy(true);setError('')
    try {await gateway.signOut();await gateway.beginGoogle('/guest/redeem')}
    catch {setError('Couldn\'t start Google sign-in. Try again, or ask the organizer who invited you.');setBusy(false)}
  }
  return <main className="standalone-page auth-page">
    <h1>Accept your guest invitation</h1>
    <p>Sign in with the Google account the invite was sent to. It doesn't have to be a school account.</p>
    <Panel title="What you'll be able to see"><p>Only the work shared with you, until your invitation ends.</p></Panel>
    <p>After signing in, open the invite link again and accept it here. Lost the link? Ask the organizer who invited you for a new one.</p>
    {auth.state==='unavailable'?<p role="status">Google sign-in isn't working right now. Ask the organizer who invited you.</p>:null}
    {error?<p role="alert">{error}</p>:null}
    <div className="auth-actions">
      {token?<button className="button" disabled={busy||!gateway.guests||['unavailable','signed_out','error'].includes(auth.state)}
        onClick={()=>void redeem()}>Accept invitation</button>:null}
      <button className="button button--secondary" disabled={busy||auth.state==='unavailable'} onClick={()=>void signIn()}>Sign in or switch Google account</button>
      {otherShared?<Link className="button button--secondary" to="/shared">Open work already shared with you</Link>:null}
    </div>
    <p>Can't use that Google account? Ask the organizer who invited you.</p>
    <Link className="button button--secondary" to="/login">Back to sign-in</Link>
  </main>
}
