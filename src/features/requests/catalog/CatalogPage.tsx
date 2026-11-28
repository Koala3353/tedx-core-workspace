import {CurrentPhase} from '../../admin/process/ProcessPage'
import type {ProcessApi} from '../../admin/process/api'
import {useEffect,useState} from 'react'
import {Link,useParams,useRouteLoaderData} from 'react-router'
import {PageHeading} from '../../../components/Page'
import {useAutoRefresh} from '../../shared/useAutoRefresh'
import {refreshKey,settled} from '../../shared/settled'
import {useListEnter} from '../../../components/useListEnter'
import '../../shared/shared.css'
import {EmptyState,ErrorState,LoadingState} from '../../../components/FeedbackState'
import type {WorkspaceContext} from '../../auth/gateway'
import type {CatalogApi,CatalogEntry} from './api'
import { EmptyInbox, EmptySearch, NoAccess } from '../../../components/illustrations'

export function CatalogPage({api,process}:{api:CatalogApi;process?:ProcessApi}){
 const context=useRouteLoaderData('workspace') as WorkspaceContext,{typeId}=useParams(),[retry,setRetry]=useState(0),[search,setSearch]=useState('');
 const identity=context.termId+('memberId'in context?context.memberId:context.guestAccessId),key=refreshKey(identity+':'+(typeId??''),retry);
 const[state,setState]=useState<{key:string;rows:CatalogEntry[]|null;error:boolean}|null>(null);
 useAutoRefresh(()=>setRetry(n=>n+1));
 useEffect(()=>{let live=true;void api.read(context.termId,typeId).then(rows=>{if(live)setState({key,rows,error:false})}).catch(()=>{if(live)setState({key,rows:null,error:true})});return()=>{live=false}},[api,context.termId,typeId,key]);
 const current=settled(state,key),rows=current?.rows?.filter(r=>typeId||[r.label,r.need,r.receivingUnit??''].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 const admin=context.capabilities.some(c=>c==='admin.configure');
 const entry=typeId?rows?.[0]:undefined,enter=useListEnter(!typeId&&!!rows?.length);
 return <><CurrentPhase api={process}/><PageHeading title={typeId?entry?.label??'Service':'Ask a committee'} description={typeId?entry?.need:'Pick what you need. Each service shows who handles it and how long it usually takes.'}/>
 <nav className="page-actions" aria-label="Requests">{typeId?<Link className="button button--quiet" to="/requests">All services</Link>:null}<Link className="button button--secondary" to="/requests/mine">My requests</Link></nav>
 {!typeId?<div className="form-field"><label htmlFor="service-search">What do you need help with?</label><input id="service-search" type="search" maxLength={100} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Try: sponsors, budget, posters"/></div>:null}
 {!current?<LoadingState title="Loading services"/>:current.error?<ErrorState title="Couldn't load services" description="Check your connection and try again." action={<button className="button button--secondary" onClick={()=>setRetry(n=>n+1)}>Try again</button>}/>:current.rows===null?<EmptyState illustration={<NoAccess />} title="Services aren't available to you" description="Only organizers on this term's roster can make requests. Ask your committee head."/>:!rows?.length?<EmptyState illustration={search?<EmptySearch />:<EmptyInbox />} title={search?'No services match':'No services yet'} description={search?'Try another word, or ask your committee head who handles it.':'Committees haven\'t opened any request services yet.'} action={search?<button className="button button--secondary" type="button" onClick={()=>{setSearch('');document.getElementById('service-search')?.focus()}}>Clear search</button>:undefined}/>:typeId&&entry?<ServiceDetail r={entry} admin={admin}/>:<ul className={('service-cards '+enter).trim()}>{rows.map(r=><li key={r.id}><ServiceCard r={r}/></li>)}</ul>}
 </>
}
const ready=(r:CatalogEntry)=>r.liveEnabled&&r.serviceReady
const leadTime=(r:CatalogEntry)=>r.leadTimeDays===null?'Lead time not set':r.leadTimeDays===1?'Usually 1 day':`Usually ${r.leadTimeDays} days`
const contactLine=(r:CatalogEntry)=>r.primaryContact&&r.primaryContactId?<Link to={'/people?contact='+r.primaryContactId}>{r.primaryContact}</Link>:r.primaryContact??'Not assigned yet'
function ServiceCard({r}:{r:CatalogEntry}){
 return <article className="panel service-card"><h2><Link to={'/requests/services/'+r.id}>{r.label}</Link></h2><p>{r.need}</p>
  <p className="muted">{r.receivingUnit??'Committee not set'} · {leadTime(r)} · Contact: {contactLine(r)}</p>
  {ready(r)?<Link className="button button--secondary" to={'/requests/services/'+r.id+'/new'}>Start request</Link>:<p className="muted">Not open yet. {r.receivingUnit??'The committee'} is setting this up.</p>}
 </article>
}
function ServiceDetail({r,admin}:{r:CatalogEntry;admin:boolean}){
 return <>
  <div className="page-actions">{ready(r)?<Link className="button" to={'/requests/services/'+r.id+'/new'}>Start request</Link>:<p>Not open yet. {r.receivingUnit??'The committee'} is setting this up.{admin?<> <Link to={'/admin/config'}>Finish setup</Link></>:null}</p>}{r.form?<Link className="button button--quiet" to={'/requests/services/'+r.id+'/preview'}>Preview the form</Link>:null}</div>
  <dl className="detail-facts"><div><dt>Handled by</dt><dd>{r.receivingUnit??'Not set yet'}</dd></div><div><dt>Contact</dt><dd>{contactLine(r)}{r.backupContact?<> · Backup: {r.backupContactId?<Link to={'/people?contact='+r.backupContactId}>{r.backupContact}</Link>:r.backupContact}</>:null}</dd></div><div><dt>How long it takes</dt><dd>{leadTime(r)}{r.leadTimeText?<> · {r.leadTimeText}</>:null}</dd></div></dl>
  {r.form?<section className="panel" aria-label="What you'll be asked"><h2>What you'll be asked</h2>{r.form.sections.map(s=><section key={s.key} aria-label={s.label}><h3>{s.label}</h3><ul>{r.form?.fields.filter(f=>f.section===s.key).map(f=><li key={f.key}><strong>{f.label}</strong>{f.required?'':f.requiredWhen?' (sometimes required)':' (optional)'}{f.help?<p className="muted">{f.help}</p>:null}{f.options?<p className="muted">Choices: {f.options.map(o=>o.label).join(', ')}</p>:null}</li>)}</ul></section>)}</section>:null}
  <details className="how-this-works"><summary>More about this service</summary><div className="how-this-works__body">{r.processNote?<p className="record-text">{r.processNote}</p>:null}{r.officialUrl?<p><a href={r.officialUrl} target="_blank" rel="noopener noreferrer">Official process page</a></p>:null}<p>{r.guestEligible?'Guests can request this service.':'Only core members can request this service.'}</p><p>Form version {r.formVersion}.</p></div></details>
 </>
}
