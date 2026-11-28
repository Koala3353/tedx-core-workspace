import {useEffect,useState} from 'react'
import {Link,useParams,useRouteLoaderData} from 'react-router'
import {PageHeading,Panel} from '../../components/Page'
import {EmptyState,ErrorState,LoadingState} from '../../components/FeedbackState'
import type {WorkspaceContext} from '../auth/gateway'
import {formatDay,formatDateTime} from '../shared/dates'
import {useAutoRefresh} from '../shared/useAutoRefresh'
import {HowThisWorks} from '../shared/HowThisWorks'
import {agreementStateLabel,type AgreementView,type SynergiesApi} from './api'
import {SynergyForm} from './SynergyForm'
import { NoAccess } from '../../components/illustrations'

export function AgreementPage({api}:{api:SynergiesApi}){
 const {agreementId=''}=useParams(),context=useRouteLoaderData('workspace') as WorkspaceContext
 return <AgreementBody key={context.termId+('memberId'in context?context.memberId:context.guestAccessId)+agreementId} api={api} id={agreementId}/>
}
function AgreementBody({api,id}:{api:SynergiesApi;id:string}){
 const [item,setItem]=useState<AgreementView|null>(),[error,setError]=useState(false),[reload,setReload]=useState(0),[saved,setSaved]=useState(''),[savingEpoch,setSavingEpoch]=useState(0),[pendingForm,setPendingForm]=useState(''),[responseSeen,setResponseSeen]=useState(false)
 useEffect(()=>{let live=true;void api.read(id).then(a=>{if(live){setItem(a);if(a?.interface.actions.length)setResponseSeen(true);setError(false)}}).catch(()=>{if(live){setError(true)}});return()=>{live=false}},[api,id,reload])
 const refresh=()=>setReload(n=>n+1)
 useAutoRefresh(refresh,{paused:!!pendingForm})
 const ui=item?.interface,active=item?.revisions.find(r=>r.revision===item.activeRevision)
 return <><Link className="button button--secondary" to="/working-together">Working together</Link>{saved?<p role="status">{saved}</p>:null}{error?<ErrorState title="Couldn't load this agreement" description="Check your connection and try again." action={!item?<button className="button button--secondary" disabled={!!pendingForm} onClick={refresh}>Try again</button>:undefined}/>:null}{item===undefined&&!error?<LoadingState title="Loading agreement"/>:item===undefined?null:!item?<EmptyState illustration={<NoAccess />} title="You can't open this agreement" description="It may have been removed, or it isn't shared with you."/>:<>
 <PageHeading title={item.terms.output} description={`${ui?.requesterUnitName??'Requesting committee'} → ${ui?.receiverUnitName??'Receiving committee'}`}/>
 <p>{agreementStateLabel(item.state)} · Asked by {item.requesterName}</p><HowThisWorks><p>One head asks, the other committee's head accepts, declines or suggests changes. Once accepted, the named owner gets a task for the work.</p><p>If new terms are being discussed, the earlier agreed version still applies until both heads accept the new one.</p><p>Finishing the task doesn't accept the deliverable or replace FIN or MCD approval.</p></HowThisWorks>
 <Panel title="Latest proposal"><p>{ui?.pendingWith?`Waiting on ${ui.pendingWith==='requester'?ui.requesterUnitName:ui.receiverUnitName} head`:'Not waiting on anyone'}</p><p>Version {item.revision} · Proposed deadline: {formatDay(item.terms.dueOn)} · Effort: {item.terms.effort}</p><p className="record-text">{item.terms.criteria}</p><p>Owner: {ui?.ownerName??'Not named yet. The receiving head picks one.'}</p>{active?<p>Agreed deadline: {formatDay(active.dueOn)} · Agreed version {item.activeRevision}. {item.activeRevision!==item.revision?'The earlier agreed version still applies until the new one is accepted.':''}</p>:<p>Nothing agreed yet.</p>}{item.contributionId?<p><Link className="button button--secondary" to={'/tasks/'+item.contributionId}>Open task</Link></p>:null}{item.parentId?<p><Link to={'/deliverables/'+item.parentId}>Open the deliverable</Link></p>:<p>The deliverable isn't shared with you.</p>}{item.sources.length?<p>Shared files: {item.sources.map(id=>ui?.sourceOptions.find(s=>s.id===id)?.name??'Finalized files').join('; ')}</p>:null}</Panel>
 {responseSeen?<Panel title="Respond"><SynergyForm key={'response'+savingEpoch} api={api} agreement={item} blocked={!!pendingForm&&pendingForm!=='response'} onPendingChange={p=>setPendingForm(p?'response':'')} onRefresh={refresh} onSaved={r=>{setResponseSeen(false);setSaved(`Response saved: ${r.state}, version ${r.revision}.`);setSavingEpoch(n=>n+1);refresh()}}/></Panel>:null}
 {ui?.canAmend&&item.parentId?<details className="panel"><summary>Suggest new terms</summary><SynergyForm key={'amend'+savingEpoch} api={api} parentId={item.parentId} agreement={item} amend blocked={!!pendingForm&&pendingForm!=='amend'} onPendingChange={p=>setPendingForm(p?'amend':'')} onRefresh={refresh} onSaved={r=>{setSaved(`New terms sent: version ${r.revision}.`);setSavingEpoch(n=>n+1);refresh()}}/></details>:null}
 <Panel title="History"><ol>{item.revisions.map(r=><li key={r.revision}><h3>Version {r.revision} · {r.side}</h3><p className="record-text">{r.output}</p><p className="record-text">{r.criteria}</p><p>Proposed deadline: {formatDay(r.dueOn)} · {r.effort} · Sent {formatDateTime(r.recordedAt)}</p><p className="record-text">Reason: {r.reason}</p></li>)}</ol><h3>Confirmations and decisions</h3><ul>{item.confirmations.map((c,i)=><li key={i}>Version {c.revision} · {c.side} · {c.decision} · {formatDateTime(c.recordedAt)}<p className="record-text">{c.reason}</p></li>)}</ul></Panel>
 </>}</>
}
