import {useEffect,useState} from 'react'
import {refreshKey,settled} from '../shared/settled'
import {Link,useParams,useRouteLoaderData,useSearchParams} from 'react-router'
import {PageHeading,Panel} from '../../components/Page'
import {EmptyState,LoadingState,ErrorState} from '../../components/FeedbackState'
import type {WorkspaceContext} from '../auth/gateway'
import type {RequestsApi} from '../requests/api'
import {useRequestMemory} from '../requests/Memory'
import {requestDate} from '../requests/Payload'
import type {FilesApi} from '../files/api'
import {Files} from '../files/Files'
import {emptyPlan,phpText,quantityText,showPhp} from './intake'
import type {FinanceApi,FinanceIntake} from './api'
import {useFinanceMemory} from './Memory'
import {FinanceRequestForm} from './FinanceRequestForm'
import {HowThisWorks} from '../shared/HowThisWorks'
import {useAutoRefresh} from '../shared/useAutoRefresh'
import {RefreshButton} from '../shared/RefreshButton'
import './finance.css'
export function FinanceCasePage({api,requests,files}:{api:FinanceApi;requests:RequestsApi;files?:FilesApi}){
 const context=useRouteLoaderData('workspace')as WorkspaceContext,{financeTermId='',financeId=''}=useParams(),[params,setParams]=useSearchParams(),rev=params.get('revision'),revision=rev&&/^[1-9][0-9]{0,2}$/.test(rev)?Number(rev):undefined,[reload,setReload]=useState(0),key=refreshKey(financeTermId+financeId+revision+':'+('memberId'in context?context.memberId:context.guestAccessId),reload);
 const[state,setState]=useState<{key:string;data:FinanceIntake|null;error:boolean}|null>(null);
 useEffect(()=>{let live=true;void api.read(financeTermId,financeId,revision).then(data=>{if(live)setState({key,data,error:false})}).catch(()=>{if(live)setState({key,data:null,error:true})});return()=>{live=false}},[api,financeTermId,financeId,revision,key]);
 useAutoRefresh(()=>setReload(n=>n+1));
 const current=settled(state,key);
 return <><PageHeading title="Finance plan" description="Your plan, its evidence and where it is in FIN review."/><p><Link to="/finance">My finance plans</Link> · <Link to="/requests">Ask a committee</Link> <RefreshButton onRefresh={()=>setReload(n=>n+1)}/></p>
 {!current?<LoadingState/>:current.error?<ErrorState title="Couldn't load this finance plan" description="Check your connection, then refresh the page. What you typed is kept."/>:!current.data?<EmptyState title="You can't open this finance plan" description="It isn't shared with your account. Ask the person who sent you the link."/>:<FinanceBody key={financeTermId+financeId+revision+current.data.request.version} data={current.data} api={api} requests={requests} files={files} member={'memberId'in context?context.memberId:''} historical={revision!==undefined} refresh={()=>setReload(n=>n+1)} select={n=>setParams(n?{revision:String(n)}:{})}/>}
 </>
}
function FinanceBody({data,api,requests,files,member,historical,refresh,select}:{data:FinanceIntake;api:FinanceApi;requests:RequestsApi;files?:FilesApi;member:string;historical:boolean;refresh:()=>void;select:(n:number|undefined)=>void}){
 const r=data.request,f=data.finance,plan=f?{kind:f.kind,purpose:f.purpose,fundSource:f.fundSource,beneficiaryMemberId:f.beneficiaryMemberId,relatedDeliverableId:f.relatedDeliverableId??'',plannedOn:f.plannedOn??'',termsRisks:f.termsRisks,price:f.pricing?phpText(f.pricing.unitPriceCentavos):'',forecastQuantity:f.pricing?quantityText(f.pricing.forecastQuantityMilli):'',lines:f.lines.map(l=>({description:l.description,quantity:quantityText(l.quantityMilli),amount:phpText(l.unitAmountCentavos)}))}:emptyPlan(member),m=useFinanceMemory(api,r.id,{plan,title:r.title,requestedOn:r.draft?.requestedOn??'',ack:false}),actions=useRequestMemory(requests,'finance-actions:'+r.id,{reason:''}),[fileError,setFileError]=useState('');
 async function download(id:string){if(!files||m.locked||actions.locked)return;setFileError('');try{const blob=await files.download(r.id,id),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=f?.files.find(v=>v.id===id)?.name??'finance-evidence';a.click();setTimeout(()=>URL.revokeObjectURL(url),0)}catch{setFileError('Couldn\'t download the file. Refresh the page and try again.')}}
 async function action(kind:'begin'|'cancel'){const result=await actions.run({kind,id:r.id,version:r.version,reason:actions.fields.reason});if(result)refresh();else if(!actions.pending)refresh()}
 return <>
 <Panel title={r.trackingId??'Finance draft'}><p role="status">{r.state==='paused'?'Submitted · FIN review paused':r.state.replaceAll('_',' ')}</p><dl className="request-payload"><div><dt>Submitted requested total</dt><dd>{f?showPhp(f.requestedTotalCentavos):'Not submitted yet'}</dd></div><div><dt>Submitted forecast revenue</dt><dd>{f?.pricing?showPhp(f.pricing.forecastRevenueCentavos):'No sales forecast'}</dd></div><div><dt>Spending limit</dt><dd>{f?.authorization?showPhp(f.authorization.ceilingCentavos)+' · '+f.authorization.state.replaceAll('_',' '):'Not issued'}</dd></div><div><dt>Recorded amounts</dt><dd>Only FIN can see these</dd></div></dl><p>Original requested date: {requestDate(r.originalRequestedOn)} · Accepted service date: {r.acceptedOn?requestDate(r.acceptedOn):'Not agreed'}</p></Panel>
 {m.error?<p role="alert">{m.error}</p>:null}{m.pending?<Panel title="Finish sending your plan"><p>We couldn't confirm your plan was sent. Your inputs are locked until you retry.</p><button className="button" disabled={m.busy} onClick={()=>void m.run().then(result=>{if(result)refresh()})}>Retry sending</button></Panel>:null}
 {r.canEdit&&!historical?<div inert={actions.locked}><FinanceRequestForm data={data} m={m} refresh={refresh}/></div>:null}
 {(r.canEdit||f?.authorization?.state==='valid')&&!historical&&files?<div inert={m.locked||actions.locked}><Files api={files} workId={r.id} uploadsOnly={!r.canEdit}/></div>:null}
 {r.revisionHeaders.length?<Panel title="Plan history"><div className="form-field"><label htmlFor="finance-history">Submitted revision</label><select id="finance-history" value={historical?r.selected?.revision:r.revision} onChange={e=>select(Number(e.target.value))}>{r.revisionHeaders.map(h=><option key={h.revision} value={h.revision}>Revision {h.revision}</option>)}</select></div>{historical?<button className="button button--secondary" onClick={()=>select(undefined)}>Back to current version</button>:null}
 {f?<><h3>{r.selected?.title??r.title}</h3><p>{f.kind} · {f.purpose}</p><p>Fund source: {f.fundSource}</p>{f.authorization?<><p>Approval status: {f.authorization.state.replaceAll('_',' ')}</p><p>Conditions: {f.authorization.conditions}</p><p>School approval: {f.authorization.externalOutcome.replaceAll('_',' ')}</p></>:null}<p>Terms, risks and school requirements: {f.termsRisks}</p><p>Planned date: {requestDate(f.plannedOn)}</p><ol>{f.lines.map((l,i)=><li key={i}>{l.description} · {quantityText(l.quantityMilli)} × {showPhp(l.unitAmountCentavos)} = {showPhp(l.totalCentavos)}</li>)}</ol><p className="record-text">Plan checksum (SHA-256): <code>{f.payloadHash}</code></p><p className="record-text">Evidence checksum (SHA-256): <code>{f.manifestHash}</code></p><ul>{f.files.map(v=><li key={v.id}><button className="button button--secondary" disabled={!files||m.locked} onClick={()=>void download(v.id)}>Download {v.name}</button></li>)}</ul>{fileError?<p role="alert">{fileError}</p>:null}</>:<p>This version has no itemized plan. Start a revision to add one.</p>}
 </Panel>:null}
 <Panel title="Your actions">{actions.error?<p role="alert">{actions.error}</p>:null}{actions.pending?<button className="button" disabled={actions.busy||m.locked} onClick={()=>void actions.run().then(result=>{if(result)refresh()})}>Retry last action</button>:null}
 {r.canRevise?<button className="button button--secondary" disabled={historical||m.locked||actions.locked} onClick={()=>void action('begin')}>Start a revision</button>:null}
 {r.canCancel?<><TextFieldForCancel value={actions.fields.reason} locked={m.locked||actions.locked} change={reason=>actions.change({reason})}/><button className="button button--secondary" disabled={historical||m.locked||actions.locked||!actions.fields.reason.trim()} onClick={()=>void action('cancel')}>Cancel finance request</button></>:null}</Panel>
 <HowThisWorks><p>FIN approval covers the exact plan, conditions and expiry. Submitting or approving a plan never records a payment.</p><p>New receipt uploads don't change the approved plan. FIN records each actual expense separately.</p><p>Cancelling keeps earlier revisions and tracking IDs. School requirements still apply.</p></HowThisWorks>
 </>
}
function TextFieldForCancel({value,locked,change}:{value:string;locked:boolean;change:(value:string)=>void}){return <div className="form-field"><label htmlFor="finance-cancel">Cancellation reason</label><input id="finance-cancel" maxLength={2000} value={value} disabled={locked} onChange={e=>change(e.target.value)}/></div>}
