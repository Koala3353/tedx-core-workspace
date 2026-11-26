import {useEffect,useRef,useState} from 'react'
import {Check,Minus,X} from 'lucide-react'
import {Status} from '../../../components/Status'
import {formatDateTime} from '../../shared/dates'
import type {CatalogApi} from '../../requests/catalog/api'
import '../../shared/shared.css'
import './config.css'
import {Link,useParams,useRouteLoaderData} from 'react-router'
import {PageHeading} from '../../../components/Page'
import {ErrorState,LoadingState} from '../../../components/FeedbackState'
import type {WorkspaceContext} from '../../auth/gateway'
import {forgetRecordDrafts} from '../../auth/draftScope'
import {ConfigurationEditor} from './ConfigurationEditor'
import {ConfigurationReadError,type ConfigurationApi,type ConfigurationData,type ServiceProblem,type ServiceSetup} from './api'

export function ConfigurationPage({api,catalog}:{api:ConfigurationApi;catalog?:CatalogApi}){
 const c=useRouteLoaderData('workspace')as WorkspaceContext,{configurationType}=useParams(),identity='memberId'in c?c.memberId:c.guestAccessId
 return <ConfigurationHub key={c.termId+identity+(configurationType??'')} api={api} term={c.termId} identity={identity} type={configurationType} catalog={catalog}/>
}
export function ConfigurationHub({api,term,identity,type,catalog}:{api:ConfigurationApi;term:string;identity:string;type?:string;catalog?:CatalogApi}){
 const[epoch,setEpoch]=useState(0),[state,setState]=useState<{epoch:number;data:ConfigurationData|null;items:{id:string;label:string;governedKind:string}[];error:boolean}|null>(null)
 useEffect(()=>{let live=true;const read=async()=>{
  try{const[data,items]=type?[await api.read(type),[]]as const:[null,await api.list(term)]as const
   if(!live)return
   if(data&&data.termId!==term){forgetRecordDrafts(type!);throw new ConfigurationReadError(true)}
   setState({epoch,data,items:[...items],error:false})
  }catch(error){if(live){if(type&&error&&typeof error==='object'&&'denied'in error&&error.denied===true)forgetRecordDrafts(type);setState({epoch,data:null,items:[],error:true})}}
 };void read();return()=>{live=false}},[api,term,type,identity,epoch])
 useEffect(()=>{const check=()=>{if(document.visibilityState!=='hidden')setEpoch(n=>n+1)};window.addEventListener('focus',check);const timer=setInterval(check,30000);return()=>{window.removeEventListener('focus',check);clearInterval(timer)}},[])
 const current=state?.epoch===epoch?state:null
 return <><PageHeading title={current?.data?.typeLabel??'Service setup'} description={type?'Edit a draft, check it, then publish. Requests already sent keep the version they were sent with.':'Each service needs a receiving committee, a contact, a lead time, a form and a workflow before members can send requests.'}/>
 <nav className="page-actions" aria-label="Service setup"><Link className="button button--quiet" to={type?'/admin/config':'/admin'}>{type?'All services':'Admin'}</Link><Link className="button button--quiet" to="/requests">Member view</Link></nav>
 {!current?<LoadingState/>:current.error?<ErrorState title="Couldn't load service setup" description="Check your connection and try again. Anything you typed is kept." action={<button className="button button--secondary" onClick={()=>setEpoch(n=>n+1)}>Try again</button>}/>:current.data?<><p>Receiving committee: {current.data.serviceLabel??<>Not set. <Link to="/admin/process">Set it in Phases, statuses and services</Link></>}{current.data.governedKind!=='general'?' · Budget and Publicity services are published from their own setup.':''}</p><ConfigurationEditor key={epoch} api={api} data={current.data} identity={identity} refreshed={()=>setEpoch(n=>n+1)}/></>:current.items.length?<ServiceReadiness api={api} term={term} catalog={catalog} items={current.items} epoch={epoch}/>:<p>No services you can set up. Ask a workspace admin.</p>}</>
}
type ReadinessRow={id:string;checks:[string,boolean|null][];needsProcess:boolean;setup:ServiceSetup|null}
function ServiceReadiness({api,term,catalog,items,epoch}:{api:ConfigurationApi;term:string;catalog?:CatalogApi;items:{id:string;label:string;governedKind:string}[];epoch:number}){
 const[rows,setRows]=useState<{epoch:number;value:Record<string,ReadinessRow>}|null>(null)
 useEffect(()=>{let live=true;void(async()=>{
  const entries=await catalog?.read(term).catch(()=>null)??null
  const value:Record<string,ReadinessRow>={}
  await Promise.all(items.slice(0,30).map(async item=>{
   const data=await api.read(item.id).catch(()=>null),entry=entries?.find(e=>e.id===item.id)
   const committee=data?!!data.serviceLabel:entry?!!entry.receivingUnit:null,contact=entry?!!entry.primaryContact:null,lead=entry?entry.leadTimeDays!==null:null
   const setup=await api.serviceSetup?.(item.id).catch(()=>null)??null
   value[item.id]={id:item.id,setup,needsProcess:committee===false||contact===false||lead===false,checks:[['Receiving committee',committee],['Contact',contact],['Lead time',lead],['Form',data?data.formDefinition.fields.length>0:entry?!!entry.form:null],['Workflow',data?data.workflowDefinition.stages.length>0:null]]}
  }))
  if(live)setRows({epoch,value})
 })();return()=>{live=false}},[api,catalog,term,items,epoch])
 return <ul className="service-cards">{items.map(item=>{const row=rows?.value[item.id],missing=row?.checks.filter(([,ok])=>ok===false).length??0;return <li key={item.id}><article className="panel service-card"><h2><Link to={'/admin/config/'+item.id}>{item.label}</Link></h2>
  {!row?<p className="muted">Checking setup…</p>:<ul className="setup-checklist" aria-label={'Setup for '+item.label}>{row.checks.map(([label,ok])=><li key={label} className={ok?'setup-checklist__done':ok===false?'setup-checklist__missing':'muted'}>{ok?<Check size={16} aria-hidden="true"/>:ok===false?<X size={16} aria-hidden="true"/>:<Minus size={16} aria-hidden="true"/>}{label}<span className="visually-hidden">{ok?' done':ok===false?' missing':' unknown'}</span></li>)}</ul>}
  {row?.setup?<ServiceSwitch api={api} label={item.label} setup={row.setup} onChange={setup=>setRows(r=>r&&r.epoch===epoch?{epoch,value:{...r.value,[item.id]:{...row,setup}}}:r)}/>:null}
  {row?missing?<Link className="button button--secondary" to={row.needsProcess?'/admin/process':'/admin/config/'+item.id}>Finish setup</Link>:row.setup?null:<p className="muted">Ready for requests.</p>:null}
  {item.governedKind!=='general'?<p className="muted">{item.governedKind==='fin'?'Budget (FIN)':'Publicity sign-off'} service</p>:null}
 </article></li>})}</ul>
}

const problemText:Record<ServiceProblem,string>={
 committee:'Pick the committee that receives these requests.',
 review_service:'Let the receiving committee take requests in Organization.',
 contacts:'Add two different contacts from the receiving committee.',
 lead_time:'Set how many days ahead people should ask.',
 form:'Publish the request form.',
 reviewer:'The receiving committee needs a head (or FIN or MCD member) who can review.',
 finance_privacy:'Finance privacy rules were set up but are no longer valid. Fix them in Privacy settings first.',
}
function ServiceSwitch({api,label,setup,onChange}:{api:ConfigurationApi;label:string;setup:ServiceSetup;onChange:(setup:ServiceSetup)=>void}){
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef<{open:boolean;key:string}|null>(null)
 async function change(open:boolean){
  if(!api.setServiceOpen)return
  if(!open&&!window.confirm('Close '+label+'? People can\'t send new requests until you open it again. Requests already sent stay as they are.'))return
  const request=pending.current?.open===open?pending.current:{open,key:crypto.randomUUID()};pending.current=request
  setBusy(true);setError('')
  const result=await api.setServiceOpen(setup.typeId,open,open?'Opened from Service setup':'Closed from Service setup',request.key)
  setBusy(false)
  if(!result.ok){setError(result.error.retryable?result.error.message:'Couldn\'t change this service. '+result.error.message);if(!result.error.retryable)pending.current=null;return}
  pending.current=null;onChange(result.value)
  if(open&&!result.value.open)setError('Not opened yet. Finish the steps below first.')
 }
 const last=setup.lastChange
 return <div className="service-switch">
  <p><Status state={setup.open?'open':'draft'} label={setup.open?'Open for requests':'Not open yet'}/></p>
  {setup.open&&setup.reviewerName?<p className="muted">First reviewer: {setup.reviewerName}</p>:null}
  {last?<p className="muted">{last.action==='service_opened'?'Opened':'Closed'} by {last.by??'an admin'}, {formatDateTime(last.at)}</p>:null}
  {!setup.open&&setup.problems.length?<ul className="service-switch__todo" aria-label={'Before opening '+label}>{setup.problems.map(p=><li key={p}>{problemText[p]}</li>)}</ul>:null}
  {setup.open
   ?<button type="button" className="button button--quiet" disabled={busy||!api.setServiceOpen} onClick={()=>void change(false)}>{busy?'Closing…':'Close service'}</button>
   :<button type="button" className="button button--secondary" disabled={busy||!api.setServiceOpen||setup.problems.length>0} onClick={()=>void change(true)}>{busy?'Opening…':'Open service'}</button>}
  {!setup.open&&!setup.problems.length?<p className="muted">Opening lets members send requests and puts the reviewer in charge. You can close it again any time.</p>:null}
  {error?<p role="alert">{error}</p>:null}
 </div>
}
