import {useAutoRefresh} from '../shared/useAutoRefresh'
import {formatDateTime,formatDay,formatDue} from '../shared/dates'
const modeLabels={immediate:'Right away',digest:'Daily digest',mute:'Off'} as const
import{createContext,useCallback,useContext,useEffect,useState,type ReactNode}from 'react'
import{Link,useLocation,useRouteLoaderData}from 'react-router'
import{Bell}from 'lucide-react'
import type{WorkspaceContext}from '../auth/gateway'
import {SavedNotificationRules} from '../admin/notifications/SavedRules'
import{PageHeading,Panel}from '../../components/Page'
import{LoadingState,ErrorState}from '../../components/FeedbackState'
import{TextField}from '../../components/TextField'
import{useFinDecision}from '../finance/DecisionMemory'
import type{NotificationsApi,NotificationPage,NotificationCommand,NotificationRow,Failure}from './api'
import {ProposalEditor} from '../admin/notifications/ProposalEditor'
import {TelegramPreferences} from '../integrations/telegram/TelegramPreferences'
import {EmailDigest} from '../integrations/email/EmailDigest'
import '../overview/overview.css'
type Center={api:NotificationsApi;term:string;page:number;setPage:(v:number)=>void;value:NotificationPage|null;error:boolean;refresh:()=>void}
const Context=createContext<Center|null>(null)
export function NotificationCenter({api,term,identity,children}:{api?:NotificationsApi;term:string;identity:string;children:ReactNode}){return api?<CenterBody key={term+identity} api={api} term={term}>{children}</CenterBody>:children}
function CenterBody({api,term,children}:{api:NotificationsApi;term:string;children:ReactNode}){const[page,setPage]=useState(1),[epoch,setEpoch]=useState(0),[state,setState]=useState<{key:string;value:NotificationPage|null;error:boolean}|null>(null),location=useLocation(),key=term+':'+page+':'+epoch+':'+location.pathname,refresh=useCallback(()=>setEpoch(n=>n+1),[]);
 useEffect(()=>{let live=true;void api.read(term,page).then(value=>{if(live)setState({key,value,error:false})}).catch(()=>{if(live)setState({key,value:null,error:true})});return()=>{live=false}},[api,key,page,term]);useEffect(()=>{const check=()=>{if(document.visibilityState!=='hidden')refresh()};window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);window.addEventListener('notifications-changed',check);const timer=setInterval(check,20000);return()=>{clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('notifications-changed',check);document.removeEventListener('visibilitychange',check)}},[refresh]);const current=state?.key===key?state:null;return <Context.Provider value={{api,term,page,setPage,value:current?.value??null,error:current?.error??false,refresh}}>{children}</Context.Provider>
}
/** Unread count from the already-loaded notification page; null when unavailable. No extra request. */
export function useUnreadCount():number|null{const c=useContext(Context);return c?.value?.unread??null}
export function NotificationBadge(){const c=useContext(Context);if(!c)return null;const unread=c.value?.unread
 return <Link className="icon-button" to="/notifications" aria-label={c.value?`Notifications · ${c.value.unread} unread`:'Notifications'} title="Notifications"><Bell className="icon" size={20} strokeWidth={1.5} aria-hidden="true"/>{unread?<span className="icon-button__count" aria-hidden="true">{unread>99?'99+':unread}</span>:null}</Link>}
export function Notifications(){
 const c=useContext(Context),workspace=useRouteLoaderData('workspace') as WorkspaceContext|undefined
 const optional=c&&workspace&&'memberId' in workspace&&c.term===workspace.termId?c.api:undefined
 const telegram=optional?.telegram
 useAutoRefresh(()=>c?.refresh())
 return <>
  <PageHeading title="Notifications" description="Updates about your work."/>
  {c?<>
    {c.error?<ErrorState title="Couldn't load notifications" description="Check your connection and try again." action={<button className="button button--secondary" onClick={c.refresh}>Try again</button>}/>:
      !c.value?<LoadingState title="Loading notifications"/>:
      <Inbox key={c.term} center={c} value={c.value} showPreferences={!telegram}/>}
    {telegram?<TelegramPreferences api={telegram} notifications={c.api} term={c.term}
      preference={c.value?.preference} refresh={c.refresh}/>:null}
    {optional?.email?<EmailDigest api={optional.email} term={c.term} scopeReady={!!c.value}/>:null}
  </>:<ErrorState title="Notifications aren't available" description="Couldn't connect. Try again later."/>}
  {c?.api.rules&&workspace&&c.term===workspace.termId?<SavedNotificationRules api={c.api.rules} context={workspace}/>:null}
 </>
}
function Inbox({center:c,value:v,showPreferences}:{center:Center;value:NotificationPage;showPreferences:boolean}){const m=useFinDecision(c.api,'notifications:'+c.term,{mode:v.preference.mode,reason:''}),[failures,setFailures]=useState<Failure[]|null>(null),[failureError,setFailureError]=useState(false);
 async function run(command?:NotificationCommand){const result=await m.run(command);if(result||!m.pending)c.refresh()}
 return <><Panel title="Your updates"><p role="status" className="muted">{v.unread} unread</p>{m.error?<p role="alert">{m.error}</p>:null}{m.pending?<><p>We couldn't confirm that change. Try again.</p><button className="button button--secondary" disabled={m.busy} onClick={()=>void run()}>Try again</button></>:null}{v.items.length?<GroupedUpdates items={v.items} locked={m.locked} read={n=>void run({kind:'read',id:n.id,read:!n.read,version:n.version,snapshot:n.snapshot})}/>:<p>You're all caught up.</p>}{c.page>1||v.hasMore?<div className="pager"><button className="button button--secondary" disabled={m.locked||c.page===1} onClick={()=>c.setPage(c.page-1)}>Previous</button><button className="button button--secondary" disabled={m.locked||!v.hasMore} onClick={()=>c.setPage(c.page+1)}>Next</button></div>:null}</Panel>
 {showPreferences?<Panel title="How you get alerts"><p className="muted">Updates always show here in the app. This controls extra alerts.</p><label htmlFor="notification-mode">Send me alerts</label><select className="fin-authority-select" id="notification-mode" disabled={m.locked} value={m.fields.mode} onChange={e=>m.change({...m.fields,mode:e.target.value})}>{(['immediate','digest','mute'] as const).map(mode=><option key={mode} value={mode}>{modeLabels[mode]}</option>)}</select><button className="button" disabled={m.locked} onClick={()=>void run({kind:'preference',term:c.term,mode:m.fields.mode,version:v.preference.version})}>Save</button></Panel>:null}
 {v.canManage?<ProposalEditor/>:null}
 {v.canManage?<details className="how-this-works"><summary>Delivery problems (admins)</summary><div className="how-this-works__body"><p>Shows up to 50 alerts that are waiting or failed to send. No message content is shown.</p><button className="button button--secondary" onClick={()=>{setFailures(null);setFailureError(false);void c.api.failures(c.term).then(setFailures).catch(()=>setFailureError(true))}}>Check delivery failures</button>{failureError?<p role="alert">Couldn't load delivery problems. Try again.</p>:null}{failures?<><TextField id="notification-retry-reason" label="Why are you retrying?" value={m.fields.reason} maxLength={1000} disabled={m.locked} onChange={e=>m.change({...m.fields,reason:e.target.value})}/><ul>{failures.map(j=><li key={j.id}>{j.state} · {j.attempts} attempts · {j.code??'waiting'}{j.state==='failed'?<button className="button button--secondary" disabled={m.locked||!m.fields.reason.trim()} onClick={()=>{void run({kind:'retry',term:c.term,id:j.id,version:j.version,reason:m.fields.reason});setFailures(null)}}>Retry</button>:null}</li>)}</ul></>:null}</div></details>:null}</>
}

function GroupedUpdates({items,locked,read}:{items:NotificationRow[];locked:boolean;read:(n:NotificationRow)=>void}){
 const groups=new Map<string,NotificationRow[]>()
 for(const n of items){const key=n.digestDay??'other';groups.set(key,[...(groups.get(key)??[]),n])}
 return <>{[...groups].map(([day,rows])=><section key={day}><h3>{day==='other'?'Recent':`Daily digest · ${formatDay(day)}`}</h3><ul className="notification-list">{rows.map(n=><li key={n.id}><h4>{n.subject??n.label}{n.reference?` · ${n.reference}`:''}</h4>{n.owner?<p>Owner: {n.owner}{n.dueOn?` · ${formatDue(n.dueOn)}`:''}</p>:null}<Link className="button button--secondary" to={n.href}>{n.action??'Open'}</Link><p className="muted">{n.label}{(n.count??1)>1?` · ${n.count} updates`:''}{n.actionable?' · Needs your action':''} · {n.read?'Read':'Unread'}</p><p><time dateTime={n.at}>{formatDateTime(n.at)}</time></p><button className="button button--secondary" disabled={locked} onClick={()=>read(n)}>{n.read?'Mark unread':'Mark read'}</button></li>)}</ul></section>)}</>
}
