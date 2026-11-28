import {WorkReference} from '../work-references/WorkReference'
import { useEffect, useRef, useState } from 'react'
import { EmptyResults, ListToolbar, PersonPicker } from '../../components/list'
import { Link, useLocation, useNavigate, useRouteLoaderData, useSearchParams } from 'react-router'
import { PageHeading } from '../../components/Page'
import { useAutoRefresh } from '../shared/useAutoRefresh'
import { HowThisWorks } from '../shared/HowThisWorks'
import { OverflowMenu } from '../shared/OverflowMenu'
import { Pager } from '../shared/Pager'
import { refreshKey, settled } from '../shared/settled'
import { MY_COMMITTEE, committeeChips, resolveUnits, toolbarState, useMyUnits, useServerFilters } from '../shared/serverList'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import type { WorkspaceContext } from '../auth/gateway'
import { deliverableSorts, filterSearch, parseFilters, type DeliverableSort, type DeliverablesApi, type DeliverableList, type Filters } from './api'
import { DeliverableFacts } from './DeliverableFacts'
import { DeliverableEditor } from './DeliverableEditor'
import type { DeliverableCommands } from './commands'
import { WorkCsvDownload } from '../exports/WorkCsvDownload'
import type { OperationalExport } from '../exports/operational'
import { EmptyBoard, EmptySearch } from '../../components/illustrations'
export function DeliverablesRoute({ api, commands, exportCsv }: { api: DeliverablesApi; commands?: DeliverableCommands; exportCsv?: OperationalExport }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext
  return <DeliverablesPage key={context.termId} api={api} commands={commands} termId={context.termId}
    exportControl={<WorkCsvDownload api={exportCsv} context={context} kind="deliverable"/>} />
}
// The search box, committee chips and sort live in the toolbar; the form below keeps the other filters.
const toolbarKeys = ['unit', 'sort'] as const
const formKeys = ['phase', 'owner', 'blocked', 'overdue', 'mine', 'review']
export function DeliverablesPage({ api, commands, termId, exportControl }: { api: DeliverablesApi; commands?: DeliverableCommands; termId: string; exportControl?: React.ReactNode }) {
  const navigate=useNavigate()
  const [params,setParams] = useSearchParams(); const location = useLocation()
  const myUnits = useMyUnits(api.myUnits, termId)
  // Committee heads start on their own committee ("My committee" chip, clearable, remembered for this tab).
  const filter = useServerFilters({ storageKey: 'deliverables:' + termId, keys: toolbarKeys, ready: myUnits.ready,
    defaults: myUnits.units.some(u => u.head) ? { unit: MY_COMMITTEE } : {} })
  const fromUrl = parseFilters(params.toString())
  const filters: Filters = { ...fromUrl, q: filter.query, unit: parseFilters('unit=' + encodeURIComponent(filter.values.unit)).unit,
    sort: parseFilters('sort=' + encodeURIComponent(filter.values.sort)).sort, units: undefined }
  filters.units = filters.unit === MY_COMMITTEE ? resolveUnits(MY_COMMITTEE, myUnits.units) ?? [] : undefined
  const search = filterSearch(filters)
  const [reload,setReload] = useState(0); const [creating,setCreating]=useState(false)
  // The refresh counter is outside the scope, so a background refresh keeps the list on screen while new filters load.
  const scope = termId + search + (filters.units ? ':' + filters.units.join(',') : '')
  const key = refreshKey(scope, reload)
  const waiting = filter.pending || filters.unit === MY_COMMITTEE && !myUnits.ready
  const [state,setState] = useState<{key:string;data:DeliverableList|null;error:boolean}|null>(null)
  useAutoRefresh(()=>setReload(n=>n+1),{paused:creating})
  const request = JSON.stringify(filters)
  useEffect(()=>{
    if (waiting) return
    let active=true
    void api.list(termId,JSON.parse(request) as Filters).then(data=>{if(active)setState({key,data,error:false})}).catch(()=>{if(active)setState({key,data:null,error:true})})
    return()=>{active=false}
  },[api,termId,request,key,waiting])
  const current = settled(state, key); const data = current?.data ?? null
  const formFiltered = !!(filters.phase||filters.owner||filters.blocked||filters.overdue||filters.mine||filters.review)
  const filtered = formFiltered || filter.active
  // The owner picker submits through a hidden input, which fires no change event, so it applies the form itself.
  const filterForm=useRef<HTMLFormElement>(null)
  function apply(form:HTMLFormElement){
    const fields=new FormData(form);const p=new URLSearchParams();for(const [k,v] of fields)if(typeof v==='string'&&v)p.set(k,v)
    const next=parseFilters(p.toString())
    // Keep the toolbar's search, committee and sort; start again from page 1.
    setParams(filterSearch({...next,q:filters.q,unit:filters.unit,sort:filters.sort,page:1}))
  }
  const clearAll=()=>filter.clear(formKeys)
  const move=(page:number)=>setParams(prev=>{const next=new URLSearchParams(prev);if(page>1)next.set('page',String(page));else next.delete('page');return next})
  const toolbar=toolbarState(filter,[committeeChips(data?.facets?.units,myUnits.units,filter.values.unit)])
  return <>
    <PageHeading title="Deliverables" description="What each committee is delivering for the event, who owns it and what's next." />
    <div className="page-actions">{commands?<button type="button" className="button" aria-expanded={creating} onClick={()=>setCreating(c=>!c)}>New deliverable</button>:null}<span className="page-actions__spacer"/><OverflowMenu><Link className="button button--secondary" to="/working-together/timeline">Committee timeline</Link>{exportControl}</OverflowMenu></div>
    <HowThisWorks><p>A deliverable is ready once its reviews are accepted. Finishing its tasks doesn't accept it on its own.</p><p>Deadlines end at 11:59 PM Manila time.</p></HowThisWorks>
    {commands&&creating?<DeliverableEditor api={commands} termId={termId} onCancel={()=>setCreating(false)} onSaved={id=>void navigate('/deliverables/'+id)}/>:null}
    <ListToolbar filter={toolbar} label="Search deliverables" placeholder="Search by title, DEL-012, owner or committee" noun={['deliverable','deliverables']}
      count={data?{shown:data.total,total:data.unfilteredTotal??data.total}:undefined}
      sort={{label:'Sort deliverables',value:filters.sort??'due',options:deliverableSorts.map(([value,label])=>({value,label})),onChange:v=>filter.set('sort',v==='due'?'':v as DeliverableSort)}}/>
    {!current ? <LoadingState title="Loading deliverables" /> : current.error ? <ErrorState title="Couldn't load deliverables" description="Check your connection and try again." action={<button className="button button--secondary" onClick={()=>setReload(n=>n+1)}>Try again</button>} /> : data ? <>
      {(data.unfilteredTotal??data.total)||formFiltered?<form ref={filterForm} key={search} onChange={e=>apply(e.currentTarget)} onSubmit={e=>{e.preventDefault();apply(e.currentTarget)}} className="deliverable-filters" aria-label="Filter deliverables">
          <label>Phase<select name="phase" defaultValue={filters.phase}><option value="">All phases</option>{filters.phase&&!data.options.phases.includes(filters.phase)?<option value={filters.phase}>Other phase</option>:null}{data.options.phases.map(p=><option key={p}>{p}</option>)}</select></label>
          <label>Owner<PersonPicker name="owner" aria-label="Owner" defaultValue={filters.owner} onChange={()=>setTimeout(()=>{if(filterForm.current)apply(filterForm.current)})} options={[{value:'',label:'Anyone'},...(filters.owner&&!data.options.owners.some(o=>o.id===filters.owner)?[{value:filters.owner,label:'Other owner'}]:[]),...data.options.owners.map(o=>({value:o.id,label:o.name}))]}/></label>
          <div className="deliverable-toggles">{[{name:'blocked',label:'Blocked',checked:filters.blocked},{name:'overdue',label:'Overdue',checked:filters.overdue},...(filters.mine?[{name:'mine',label:'Involves my committee',checked:true}]:[]),{name:'review',label:'Waiting on a review',checked:filters.review}].map(f=><label key={f.name}><input type="checkbox" name={f.name} value="1" defaultChecked={f.checked}/>{f.label}</label>)}</div>
          {formFiltered?<div className="auth-actions"><button className="button button--quiet" type="button" onClick={clearAll}>Clear filters</button></div>:null}
        </form>:null}
      {data.items.length ? <div className="deliverable-list">{data.items.map(item=><article className="panel deliverable-row" key={item.id}>
        <h2><Link to={`/deliverables/${item.id}`} state={{from:location.search}}>{item.title}</Link></h2>
        <WorkReference compact reference={item.reference} id={item.id} kind="deliverable"/>
        <p className="muted">Phase: {item.phase ?? 'Not set'}</p>{item.summary?<p>{item.summary}</p>:null}<DeliverableFacts item={item}/>
      </article>)}</div> : data.total ? <EmptyState illustration={<EmptySearch />} title="Nothing on this page" description="The list changed while you were browsing." action={<button className="button button--secondary" onClick={()=>move(1)}>Go to the first page</button>}/> : filtered ? <EmptyResults query={filter.query} noun="deliverables" onClear={clearAll}/> : <EmptyState illustration={<EmptyBoard />} title="No deliverables yet" description="Heads add their committee's outputs here. Each one has an owner, a due date and what counts as done." action={commands&&!creating?<button className="button button--secondary" onClick={()=>setCreating(true)}>New deliverable</button>:undefined}/>}
      <Pager label="Deliverable pages" page={data.page} total={data.total} pageSize={data.pageSize} onMove={move}/>
    </> : null}
  </>
}
