import {WorkReference} from '../work-references/WorkReference'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useRouteLoaderData, useSearchParams } from 'react-router'
import { PageHeading } from '../../components/Page'
import { useAutoRefresh } from '../shared/useAutoRefresh'
import { HowThisWorks } from '../shared/HowThisWorks'
import { OverflowMenu } from '../shared/OverflowMenu'
import { Pager } from '../shared/Pager'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import type { WorkspaceContext } from '../auth/gateway'
import { filterSearch, parseFilters, type DeliverablesApi, type DeliverableList } from './api'
import { DeliverableFacts } from './DeliverableFacts'
import { DeliverableEditor } from './DeliverableEditor'
import type { DeliverableCommands } from './commands'
import { WorkCsvDownload } from '../exports/WorkCsvDownload'
import type { OperationalExport } from '../exports/operational'
export function DeliverablesRoute({ api, commands, exportCsv }: { api: DeliverablesApi; commands?: DeliverableCommands; exportCsv?: OperationalExport }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext
  return <DeliverablesPage key={context.termId} api={api} commands={commands} termId={context.termId}
    exportControl={<WorkCsvDownload api={exportCsv} context={context} kind="deliverable"/>} />
}
export function DeliverablesPage({ api, commands, termId, exportControl }: { api: DeliverablesApi; commands?: DeliverableCommands; termId: string; exportControl?: React.ReactNode }) {
  const navigate=useNavigate()
  const [params,setParams] = useSearchParams(); const location = useLocation()
  const search = filterSearch(parseFilters(params.toString())); const filters = parseFilters(search)
  const [reload,setReload] = useState(0); const [creating,setCreating]=useState(false)
  // The refresh counter is not part of the key, so a background refresh keeps the list on screen.
  const key = termId + search
  const [state,setState] = useState<{key:string;data:DeliverableList|null;error:boolean}|null>(null)
  useAutoRefresh(()=>setReload(n=>n+1),{paused:creating})
  useEffect(()=>{
    let active=true
    void api.list(termId,parseFilters(search)).then(data=>{if(active)setState({key,data,error:false})}).catch(()=>{if(active)setState({key,data:null,error:true})})
    return()=>{active=false}
  },[api,termId,search,key,reload])
  const loaded=state?.key===key; const data=loaded?state.data:null
  const filtered=!!(filters.phase||filters.unit||filters.owner||filters.blocked||filters.overdue||filters.mine||filters.review)
  function apply(form:HTMLFormElement){const fields=new FormData(form);const p=new URLSearchParams();for(const [k,v] of fields)if(typeof v==='string'&&v)p.set(k,v);setParams(filterSearch(parseFilters(p.toString())))}
  const move=(page:number)=>setParams(filterSearch({...filters,page}))
  return <>
    <PageHeading title="Deliverables" description="What each committee is delivering for the event, who owns it and what's next." />
    <div className="page-actions">{commands?<button type="button" className="button" aria-expanded={creating} onClick={()=>setCreating(c=>!c)}>New deliverable</button>:null}<span className="page-actions__spacer"/><OverflowMenu><Link className="button button--secondary" to="/working-together/timeline">Committee timeline</Link>{exportControl}</OverflowMenu></div>
    <HowThisWorks><p>A deliverable is ready once its reviews are accepted. Finishing its tasks doesn't accept it on its own.</p><p>Deadlines end at 11:59 PM Manila time.</p></HowThisWorks>
    {commands&&creating?<DeliverableEditor api={commands} termId={termId} onCancel={()=>setCreating(false)} onSaved={id=>void navigate('/deliverables/'+id)}/>:null}
    {!loaded ? <LoadingState title="Loading deliverables" /> : state.error ? <ErrorState title="Couldn't load deliverables" description="Check your connection and try again." action={<button className="button button--secondary" onClick={()=>setReload(reload+1)}>Try again</button>} /> : data ? <>
      {data.total||filtered?<form key={search} onChange={e=>apply(e.currentTarget)} onSubmit={e=>{e.preventDefault();apply(e.currentTarget)}} className="deliverable-filters" aria-label="Filter deliverables">
          <label>Phase<select name="phase" defaultValue={filters.phase}><option value="">All phases</option>{filters.phase&&!data.options.phases.includes(filters.phase)?<option value={filters.phase}>Other phase</option>:null}{data.options.phases.map(p=><option key={p}>{p}</option>)}</select></label>
          <label>Committee<select name="unit" defaultValue={filters.unit}><option value="">All committees</option>{filters.unit&&!data.options.units.some(u=>u.id===filters.unit)?<option value={filters.unit}>Other committee</option>:null}{data.options.units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label>Owner<select name="owner" defaultValue={filters.owner}><option value="">Anyone</option>{filters.owner&&!data.options.owners.some(o=>o.id===filters.owner)?<option value={filters.owner}>Other owner</option>:null}{data.options.owners.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <div className="deliverable-toggles">{[{name:'blocked',label:'Blocked',checked:filters.blocked},{name:'overdue',label:'Overdue',checked:filters.overdue},{name:'mine',label:'Involves my committee',checked:filters.mine},{name:'review',label:'Waiting on a review',checked:filters.review}].map(f=><label key={f.name}><input type="checkbox" name={f.name} value="1" defaultChecked={f.checked}/>{f.label}</label>)}</div>
          {filtered?<div className="auth-actions"><button className="button button--quiet" type="button" onClick={()=>setParams('')}>Clear filters</button></div>:null}
        </form>:null}
      {data.items.length?<p role="status" className="muted">{data.total} {data.total===1?'deliverable':'deliverables'}</p>:null}
      {data.items.length ? <div className="deliverable-list">{data.items.map(item=><article className="panel deliverable-row" key={item.id}>
        <h2><Link to={`/deliverables/${item.id}`} state={{from:location.search}}>{item.title}</Link></h2>
        <WorkReference compact reference={item.reference} id={item.id} kind="deliverable"/>
        <p className="muted">Phase: {item.phase ?? 'Not set'}</p>{item.summary?<p>{item.summary}</p>:null}<DeliverableFacts item={item}/>
      </article>)}</div> : data.total ? <EmptyState title="Nothing on this page" description="The list changed while you were browsing." action={<button className="button button--secondary" onClick={()=>move(1)}>Go to the first page</button>}/> : filtered ? <EmptyState title="No deliverables match these filters" description="Try fewer filters." action={<button className="button button--secondary" onClick={()=>setParams('')}>Clear filters</button>}/> : <EmptyState title="No deliverables yet" description="Heads add their committee's outputs here. Each one has an owner, a due date and what counts as done." action={commands&&!creating?<button className="button button--secondary" onClick={()=>setCreating(true)}>New deliverable</button>:undefined}/>}
      <Pager label="Deliverable pages" page={data.page} total={data.total} pageSize={data.pageSize} onMove={move}/>
    </> : null}
  </>
}
