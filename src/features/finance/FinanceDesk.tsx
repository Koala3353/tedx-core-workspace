import {ReviewGate,type ReviewApplicability} from '../../components/ReviewGate'
import {refreshKey,settled} from '../shared/settled'
import {Status} from '../../components/Status'
import {useEffect,useState} from 'react'
import {Link,useRouteLoaderData,useSearchParams} from 'react-router'
import {PageHeading} from '../../components/Page'
import {LoadingState,ErrorState,EmptyState} from '../../components/FeedbackState'
import type {WorkspaceContext} from '../auth/gateway'
import type {FinanceApi,FinanceList} from './api'
import {HowThisWorks} from '../shared/HowThisWorks'
import {Pager} from '../shared/Pager'
import {useAutoRefresh} from '../shared/useAutoRefresh'
export function FinanceDesk({api}:{api:FinanceApi}){const c=useRouteLoaderData('workspace')as WorkspaceContext,[params,setParams]=useSearchParams(),page=/^[1-9][0-9]{0,3}$/.test(params.get('page')??'')?Number(params.get('page')):1,[reload,setReload]=useState(0),key=refreshKey(c.termId+('memberId'in c?c.memberId:c.guestAccessId)+':'+page,reload),[state,setState]=useState<{key:string;list:FinanceList|null;error:boolean}|null>(null);
 useEffect(()=>{let live=true;void api.list(c.termId,page).then(list=>{if(live)setState({key,list,error:false})}).catch(()=>{if(live)setState({key,list:null,error:true})});return()=>{live=false}},[api,c.termId,page,key]);const current=settled(state,key);useAutoRefresh(()=>setReload(n=>n+1));
 return <><PageHeading title="My finance plans" description="Your finance drafts and submitted plans. Spending needs FIN approval first, even at zero cost."/><p><Link to="/requests">Find the FIN service</Link></p><HowThisWorks><p>Only your own plans appear here. A FIN reviewer has to be assigned before a decision can be recorded.</p></HowThisWorks>{!current?<LoadingState/>:current.error?<ErrorState title="Couldn't load your finance plans" description="Check your connection, then refresh the page."/>:!current.list?.items.length?<EmptyState title="No finance plans yet" description="Start a draft from the FIN service in Ask a committee. Even zero-cost fundraising needs FIN review."/>:<><ul className="request-list">{current.list.items.map(r=><li key={r.id}><h2><Link to={'/finance/'+c.termId+'/'+r.id}>{r.trackingId??'Private draft'} · {r.title}</Link></h2><p><Status state={r.state}/> · Revision {r.revision}</p></li>)}</ul><Pager label="Finance pages" page={page} total={current.list.total} onMove={n=>setParams({page:String(n)})}/></>}</>
}
export function FinanceGate({api,term,id,applicability}:{api:FinanceApi;term:string;id:string;applicability?:ReviewApplicability}){const c=useRouteLoaderData('workspace')as WorkspaceContext,key=term+id+('memberId'in c?c.memberId:c.guestAccessId),[state,setState]=useState<{key:string;status:string|null}|null>(null);
 useEffect(()=>{let live=true;void api.gate(term,id).then(v=>{if(live)setState({key,status:v?.state??null})}).catch(()=>{if(live)setState({key,status:null})});return()=>{live=false}},[api,term,id,key]);return <ReviewGate title="Finance review (FIN)" status={state?.key===key?state.status:null} applicability={applicability} loading={state?.key!==key}/>}
