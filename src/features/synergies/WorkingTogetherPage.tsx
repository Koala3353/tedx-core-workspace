import {stateLabel} from '../../components/Status'
import {useEffect,useState} from 'react'
import {refreshKey,settled} from '../shared/settled'
import {Link,useRouteLoaderData,useSearchParams} from 'react-router'
import {PageHeading,Panel} from '../../components/Page'
import {EmptyState,ErrorState,LoadingState} from '../../components/FeedbackState'
import type {WorkspaceContext} from '../auth/gateway'
import {formatDay} from '../shared/dates'
import {useAutoRefresh} from '../shared/useAutoRefresh'
import {agreementStateLabel,type SynergiesApi,type SynergyList} from './api'

export function CommitteeWork({api,termId,view,parentId}:{api:SynergiesApi;termId:string;view:string;parentId?:string}){
 const [params,setParams]=useSearchParams(),[reload,setReload]=useState(0)
 const n=Number(params.get('page')??1),page=Number.isInteger(n)&&n>=1&&n<=10000?n:1,key=refreshKey(termId+view+parentId+':'+page,reload)
 const [state,setState]=useState<{key:string;result:SynergyList|null;error:boolean}|null>(null)
 useEffect(()=>{let live=true;void api.list(termId,view,parentId,page).then(result=>{if(live)setState({key,result,error:false})}).catch(()=>{if(live)setState({key,result:null,error:true})});return()=>{live=false}},[api,termId,view,parentId,page,key])
 const current=settled(state,key)
 useAutoRefresh(()=>setReload(n=>n+1))
 return <>{!current?<LoadingState title="Loading"/>:current.error?<ErrorState title="Couldn't load agreements" description="Check your connection and try again." action={<button className="button button--secondary" type="button" onClick={()=>setReload(n=>n+1)}>Try again</button>}/>:!current.result?<EmptyState title="Nothing to show" description="You can't see agreements here. Ask your committee head if that seems wrong."/>:<>
 {!current.result.agreements.length&&!current.result.contributions.length?<EmptyState title="No agreements yet" description="Ask another committee for help from any deliverable. Agreements show up here."/>:null}
 <ul className="guest-list">{current.result.agreements.map(a=><li key={a.id}><h3><Link to={'/working-together/'+a.id}>{a.terms.output}</Link></h3><p>{a.interface?.requesterUnitName} → {a.interface?.receiverUnitName} · {agreementStateLabel(a.state)} · Version {a.revision}</p><p>Proposed deadline: {formatDay(a.terms.dueOn)} · {a.interface?.pendingWith?`Waiting on ${a.interface.pendingWith==='requester'?a.interface.requesterUnitName:a.interface.receiverUnitName} head`:'Not waiting on anyone'}</p>{a.activeRevision?<p>Agreed version: {a.activeRevision} · Agreed deadline: {formatDay(a.revisions.find(r=>r.revision===a.activeRevision)?.dueOn??null)}. {a.activeRevision!==a.revision?'The earlier agreed version still applies while the new one is discussed.':''}</p>:null}</li>)}</ul>
 <ul className="guest-list">{current.result.contributions.map(c=><li key={c.id}><h3><Link to={'/tasks/'+c.id}>{c.output}</Link></h3><p>Agreed deadline: {formatDay(c.dueOn)} · Owner: {c.ownerName} · {stateLabel(c.task.state)}</p><p className="record-text">Done when: {c.criteria}</p><p>Effort: {c.effort}</p><p>{c.task.dependencyBlocked?'Blocked: an earlier task has to finish first.':'Ready to work on.'}</p><p>Agreed version {c.revision} · <Link to={'/tasks/'+c.id}>Open task</Link></p></li>)}</ul>
 {page>1||current.result.hasMore?<nav className="pager" aria-label="Agreement pages"><button className="button button--secondary" disabled={page===1} onClick={()=>setParams(p=>{p.set('page',String(page-1));return p})}>Previous</button><span className="muted">Page {page}</span><button className="button button--secondary" disabled={!current.result.hasMore} onClick={()=>setParams(p=>{p.set('page',String(page+1));return p})}>Next</button></nav>:null}
 </>}</>
}
export function WorkingTogetherPage({api}:{api:SynergiesApi}){
 const context=useRouteLoaderData('workspace') as WorkspaceContext,[params,setParams]=useSearchParams(),view=['outgoing','incoming','contributions'].includes(params.get('view')??'')?params.get('view')!:'outgoing'
 return <><PageHeading title="Working together" description="Get help from another committee, and track what you've promised others."/><p><Link className="button button--secondary" to="/deliverables">Choose a deliverable</Link> <Link className="button button--secondary" to="/working-together/handoffs">Handoffs</Link> <Link className="button button--secondary" to="/working-together/timeline">Committee timeline</Link></p><p className="muted">To ask another committee for help, open the deliverable you need help with and choose Ask another committee for help. For a room, budget or poster, use <Link to="/requests">Ask a committee</Link> instead.</p><div className="deliverable-editor form-field"><label htmlFor="synergy-view">Show</label><select id="synergy-view" value={view} onChange={e=>setParams({view:e.target.value})}><option value="outgoing">Help we asked for</option><option value="incoming">Help others asked us for</option><option value="contributions">Work I'm doing for others</option></select></div><Panel title={view==='contributions'?'Work I agreed to do':'Agreements'}><CommitteeWork key={context.termId+('memberId'in context?context.memberId:context.guestAccessId)} api={api} termId={context.termId} view={view}/></Panel></>
}
