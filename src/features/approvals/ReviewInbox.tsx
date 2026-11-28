import {useEffect,useState} from 'react'
import {Link,useRouteLoaderData,useSearchParams} from 'react-router'
import {PageHeading} from '../../components/Page'
import {LoadingState,ErrorState,EmptyState} from '../../components/FeedbackState'
import {EmptyResults,ListToolbar} from '../../components/list'
import type {WorkspaceContext} from '../auth/gateway'
import {requestDate} from '../requests/Payload'
import '../requests/requests.css'
import {refreshKey,settled} from '../shared/settled'
import {MY_COMMITTEE,committeeChips,resolveUnits,toolbarState,useMyUnits,useServerFilters,type ServerFilters} from '../shared/serverList'
import {ViewTabs} from '../shared/ViewTabs'
import {Pager} from '../shared/Pager'
import {useAutoRefresh} from '../shared/useAutoRefresh'
import type {InboxApi,InboxLane,InboxResult} from './inbox-api'
import { EmptyInbox, EmptySearch, NoAccess } from '../../components/illustrations'

const identity=(c:WorkspaceContext)=>c.termId+('memberId'in c?c.memberId:c.guestAccessId)
const inboxLanes=[['all','All'],['unassigned','Needs a reviewer'],['assigned','Assigned'],['aging','Reminder due'],['revision','Waiting on requester']] as const
const filterKeys=['unit'] as const

/** Requests waiting on the viewer, searchable on the server. Committee heads start on their own committee's requests. */
export function ReviewInbox({api}:{api:InboxApi}){
 const c=useRouteLoaderData('workspace')as WorkspaceContext,[params,setParams]=useSearchParams(),raw=params.get('view'),view:InboxLane=['unassigned','assigned','aging','revision'].includes(raw??'')?raw as InboxLane:'all',page=Math.min(10000,Math.max(1,Number(params.get('page'))||1)),[reload,setReload]=useState(0)
 const myUnits=useMyUnits(api.myUnits,c.termId)
 const filter=useServerFilters({storageKey:'inbox:'+c.termId,keys:filterKeys,ready:myUnits.ready,defaults:myUnits.units.some(u=>u.head)?{unit:MY_COMMITTEE}:{}})
 const filters:ServerFilters={q:filter.query,units:resolveUnits(filter.values.unit,myUnits.units)}
 const signature=JSON.stringify(filters)
 const key=refreshKey(identity(c)+view+':'+page+':'+signature,reload)
 const waiting=filter.pending||filter.values.unit===MY_COMMITTEE&&!myUnits.ready
 const[state,setState]=useState<{key:string;result:InboxResult|null;error:boolean}|null>(null)
 const[counts,setCounts]=useState<InboxResult['counts']|null>(null)
 useAutoRefresh(()=>setReload(n=>n+1))
 useEffect(()=>{if(waiting)return;let live=true;void api.list(c.termId,view,page,JSON.parse(signature) as ServerFilters).then(result=>{if(live){setState({key,result,error:false});if(result)setCounts(result.counts)}}).catch(()=>{if(live)setState({key,result:null,error:true})});return()=>{live=false}},[api,c.termId,view,page,key,signature,waiting])
 const current=settled(state,key)
 const result=current?.result??null
 const showLane=(v:InboxLane)=>setParams(prev=>{const next=new URLSearchParams(prev);next.set('view',v);next.delete('page');return next})
 const move=(p:number)=>setParams(prev=>{const next=new URLSearchParams(prev);next.set('view',view);next.set('page',String(p));return next})
 const toolbar=toolbarState(filter,[committeeChips(result?.facets?.units,myUnits.units,filter.values.unit)])
 return <><PageHeading title="Inbox" description="Requests waiting for your review."/>
 <ViewTabs label="Inbox views" value={view} onChange={showLane} tabs={inboxLanes.map(([value,label])=>({value,label,count:counts?counts[value]:null}))}/>
 {current&&!current.error&&!current.result?null:<ListToolbar filter={toolbar} label="Search the inbox" placeholder="Search by title, tracking ID, service or requester" noun={['request','requests']} count={result?{shown:result.total,total:result.unfilteredTotal??result.total}:undefined}/>}
 {!current?<LoadingState title="Loading your inbox"/>:current.error?<ErrorState title="Couldn't load your inbox" description="Check your connection and try again." action={<button className="button button--secondary" onClick={()=>setReload(n=>n+1)}>Try again</button>}/>:!current.result?<EmptyState illustration={<NoAccess />} title="The inbox isn't available to you" description="Only core members on this term's roster have an inbox."/>:<>
 {!current.result.items.length?current.result.total?<EmptyState illustration={<EmptySearch />} title="Nothing on this page" description="The inbox changed while you were browsing." action={<button className="button button--secondary" onClick={()=>move(1)}>Go to the first page</button>}/>:filter.active?<EmptyResults query={filter.query} noun="requests" onClear={()=>filter.clear()}/>:<EmptyState illustration={<EmptyInbox />} title={view==='all'?'Nothing to review right now':'Nothing here'} description={view==='all'?'Requests assigned to you or your committee show up here.':'Try another tab.'}/>:<ul className="guest-list">{current.result.items.map(r=><li key={r.id}><h2><Link to={'/reviews/'+r.termId+'/'+r.id}>{r.trackingId} · {r.title}</Link></h2><p>{r.serviceLabel} · {r.state.replaceAll('_',' ')} · {r.stageLabel}</p><p>Reviewer: {r.owner} · Next: {r.nextAction}</p><p className="muted">Needed by {requestDate(r.requestedOn)}{r.acceptedOn?' · Agreed for '+requestDate(r.acceptedOn):''} · Sent {requestDate(r.submittedAt)}{r.aging?' · Reminder due':''}</p></li>)}</ul>}
 <Pager label="Inbox pages" page={page} total={current.result.total} onMove={move}/></>}
 </>
}
