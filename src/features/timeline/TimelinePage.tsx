import {useEffect,useState} from 'react'
import {PersonPicker} from '../../components/list'
import {refreshKey,settled} from '../shared/settled'
import './timeline.css'
import {Link,useRouteLoaderData,useSearchParams} from 'react-router'
import {PageHeading,Panel} from '../../components/Page'
import {EmptyState,ErrorState,LoadingState} from '../../components/FeedbackState'
import {isGuest,type WorkspaceContext} from '../auth/gateway'
import {addDays,eventDay,manilaDay,schedule,windowFor} from './dates'
import {parseTimelineQuery,timelineSearch,type TimelineQuery} from './filters'
import type {TimelineApi,TimelineItem,TimelineResult} from './api'
import {formatDay,formatRange} from '../shared/dates'
import {Pager} from '../shared/Pager'
import {HowThisWorks} from '../shared/HowThisWorks'
import {ViewTabs} from '../shared/ViewTabs'
import {Calendar} from './Calendar'
import {Gantt} from './Gantt'
import {monthLabel,viewWindow} from './views'
const maxPages=10
const offset=(a:string,b:string)=>(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000
function dates(item:TimelineItem){const s=schedule(item.plannedStartOn,item.dueOn,item.dueAt);return s.kind==='range'?formatRange(s.start,s.end):s.kind==='deadline'?`Due ${formatDay(s.end)} · no start date`:s.start?`Starts ${formatDay(s.start)} · no due date`:'No dates set'}
function Chronology({items,allItems,edges}:{items:TimelineItem[];allItems:TimelineItem[];edges:TimelineResult['dependencies']}){
 return <ul className="timeline-list">{items.map(i=><li key={i.id}>
 <h3><Link to={i.href}>{i.title}</Link></h3><p>{i.type} · {i.status==='todo'?'To do':i.status.replaceAll('_',' ')}{i.blocked?' · Blocked':''}{i.overdue?' · Overdue':''}</p>
 <p>{dates(i)} · Owner: {i.owner.name}</p><p>Primary committee: {i.primaryUnit?.name??'Not assigned'}{i.phase?' · Phase: '+i.phase:''}</p>
 {i.participatingUnits.length?<p>Participating: {i.participatingUnits.map(u=>u.name).join(', ')}</p>:null}
 <p>Original due date: {formatDay(i.originalDueOn??(i.originalDueAt?manilaDay(i.originalDueAt):null))}</p>
 {edges.filter(e=>e.successorId===i.id).map(e=>{const p=allItems.find(x=>x.id===e.predecessorId)!;return <p key={e.id}>{e.required?'Needs this done first':e.type==='informational'?'Related':'Ideally after'}: <Link to={p.href}>{p.title}</Link></p>})}
 </li>)}</ul>
}
function Chart({items,edges,start,end,today}:{items:TimelineItem[];edges:TimelineResult['dependencies'];start:string;end:string;today:string}){
 const days=offset(end,start)+1,width=days*36,rows=items.filter(i=>i.endOn!==null&&i.endOn>=start&&(i.plannedStartOn??i.endOn)<=end).sort((a,b)=>(a.primaryUnit?.name??'').localeCompare(b.primaryUnit?.name??'')||a.id.localeCompare(b.id))
 const x=(day:string)=>Math.max(0,Math.min(days,offset(day,start)))*36
 const row=(i:TimelineItem)=>rows.findIndex(r=>r.id===i.id)
 return <section aria-label="Calendar chart"><p>Bars run from start to due date. Diamonds mark work with a due date but no start date.</p>
 <div className="timeline-scroll" role="region" aria-label="Calendar chart, scroll sideways" tabIndex={0}>
 <div className="timeline-canvas" style={{width:width+260}}><div className="timeline-axis" style={{gridTemplateColumns:`260px repeat(${days},36px)`}}><strong>Committee / work</strong>{Array.from({length:days},(_,n)=><span key={n}>{addDays(start,n).slice(8)}</span>)}</div>
 <div className="timeline-chart-body" style={{height:rows.length*88}}>
 {rows.map((i,n)=>{const s=schedule(i.plannedStartOn,i.dueOn,i.dueAt);if(s.kind==='unscheduled')return null;const left=x(s.kind==='range'?s.start:s.end),right=Math.min(width,x(s.end)+36),deadline=s.kind==='deadline'
 return <div className="timeline-chart-row" key={i.id} style={{top:n*88}}><div className="timeline-row-name"><span>{i.primaryUnit?.name??'No committee'}</span><Link to={i.href}>{i.title}</Link></div><div className="timeline-track" style={{width}}><Link className={'timeline-bar'+(deadline?' timeline-deadline':'')} to={i.href} aria-label={i.title+', '+dates(i)} style={{left,width:deadline?36:Math.max(36,right-left)}}>{deadline?'◆':'Open'}</Link></div></div>})}
 <svg className="timeline-edges" width={width} height={rows.length*88} aria-hidden="true">{edges.filter(e=>rows.some(i=>i.id===e.predecessorId)&&rows.some(i=>i.id===e.successorId)).map(e=>{const p=rows.find(i=>i.id===e.predecessorId)!,s=rows.find(i=>i.id===e.successorId)!,a=x(p.endOn!)+18,b=x(s.plannedStartOn??s.endOn!)+18,y1=row(p)*88+52,y2=row(s)*88+52;return <path key={e.id} d={`M ${a} ${y1} H ${Math.min(width-2,Math.max(a,b)+12)} V ${y2} H ${b}`} fill="none" className={e.required?'timeline-edge-required':'timeline-edge-info'}/>})}</svg>
 {[{day:today,label:'Today'},{day:eventDay,label:'Event'}].filter(m=>m.day>=start&&m.day<=end).map(m=><div aria-hidden="true" key={m.label} className="timeline-marker" style={{left:260+x(m.day)+18,height:Math.max(44,rows.length*88)}}><span>{m.label}</span></div>)}
 </div></div></div>
 {rows.length===0?<p>Nothing with dates falls in this window.</p>:null}<p>Solid line: has to finish first. Dashed line: related or optional.</p></section>
}
function TimelineBody({api,termId}:{api:TimelineApi;termId:string}){
 const[params,setParams]=useSearchParams(),today=manilaDay(new Date().toISOString()),q=parseTimelineQuery(params.toString(),today),query=timelineSearch(q),navScale=q.view==='list'?q.scale:'month',nav=windowFor(q.anchor,navScale),window=q.view==='list'?nav:viewWindow(q.anchor,q.view)
 const[epoch,setEpoch]=useState(0),[state,setState]=useState<{key:string;result:TimelineResult|null;error:boolean}|null>(null),key=refreshKey(query,epoch)
 const refresh=()=>setEpoch(n=>n+1)
 useEffect(()=>{let live=true;const f={units:q.units,...(!q.overdue?{from:window.start}:{}),to:q.overdue?today:window.end,includeUnscheduled:q.includeUnscheduled,blocked:q.blocked,overdue:q.overdue,...(q.owner?{owner:q.owner}:{}),...(q.phase?{phase:q.phase}:{}),...(q.type?{type:q.type}:{})};const all=q.view!=='list'
 // Calendar and gantt draw everything in range at once, so they read every page (up to maxPages) instead of paging.
 const load=async()=>{const first=await api.read(termId,f,all?1:q.page);if(!first||!all)return first;const items=[...first.items],dependencies=[...first.dependencies];for(let page=2;page<=maxPages&&items.length<first.total;page++){const next=await api.read(termId,f,page);if(!next||next.items.length===0)break;for(const i of next.items)if(!items.some(x=>x.id===i.id))items.push(i);for(const d of next.dependencies)if(!dependencies.some(x=>x.id===d.id))dependencies.push(d)}return{...first,items,dependencies}}
 void load().then(result=>{if(live)setState({key,result,error:false})}).catch(()=>{if(live)setState({key,result:null,error:true})});return()=>{live=false}
 // The canonical URL is the dependency for every validated filter and calendar field.
 },[api,termId,key])
 useEffect(()=>{const visible=()=>{if(document.visibilityState==='visible')refresh()};globalThis.window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',visible);const timer=setInterval(visible,30000);return()=>{globalThis.window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visible);clearInterval(timer)}},[])
 const current=settled(state,key),result=current?.result,options=result?.options
 function change(patch:Partial<TimelineQuery>,paging=false){setParams(timelineSearch({...q,...patch,...(paging?{}:{page:1})}).slice(1))}
 function shift(direction:number){try{change({anchor:direction<0?addDays(nav.start,-(navScale==='week'?7:1)):addDays(nav.end,1)})}catch{/* The supported calendar boundary disables navigation. */}}
 let previous=true,next=true;try{addDays(nav.start,-1)}catch{previous=false}try{addDays(nav.end,1)}catch{next=false}
 const only=q.units.length===1?{id:q.units[0],name:options?.units.find(u=>u.id===q.units[0])?.name??'Selected committee'}:null
 const dated=result?.items.filter(i=>i.endOn!==null)??[],unscheduled=result?.items.filter(i=>i.endOn===null)??[]
 return <><PageHeading title="Committee timeline" description="Who's doing what, when, and what depends on what."/>
 <p><Link to="/working-together">Working together</Link> · <Link to="/deliverables">Deliverables</Link></p>
 <p>Today: {formatDay(today)} · Event day: {formatDay(eventDay)}</p>
 <HowThisWorks><p>You only see work you have access to, so some links between tasks may be missing.</p><p>Work that overlaps on the chart isn't a sign anyone is overloaded or that anything is approved.</p></HowThisWorks>
 <ViewTabs label="Timeline view" value={q.view} onChange={view=>change({view})} tabs={[{value:'list',label:'List'},{value:'calendar',label:'Calendar'},{value:'gantt',label:'Gantt'}]}/>
 <div className="auth-actions"><button className="button button--secondary" disabled={!previous} onClick={()=>shift(-1)}>Previous {navScale}</button><button className="button button--secondary" onClick={()=>change({anchor:today})}>Today</button><button className="button button--secondary" disabled={!next} onClick={()=>shift(1)}>Next {navScale}</button></div>
 <div className="timeline-controls"><label>Go to date<input type="date" min="0001-01-01" max="9999-12-31" value={q.anchor} onChange={e=>{if(e.target.value)change({anchor:parseTimelineQuery('?date='+e.target.value,today).anchor})}}/></label>{q.view==='list'?<label>Scale<select aria-label="Scale" value={q.scale} onChange={e=>change({scale:e.target.value as TimelineQuery['scale']})}><option value="week">Week</option><option value="month">Month</option></select></label>:null}</div>
 <details className="timeline-filter-panel"><summary>Filters</summary><div className="timeline-controls">
 <label>Committees (pick one or more)<select aria-label="Committees (pick one or more)" multiple size={3} value={q.units} onChange={e=>change({units:Array.from(e.target.selectedOptions,o=>o.value)})}>{q.units.filter(id=>!options?.units.some(u=>u.id===id)).map(id=><option key={id} value={id}>Selected committee</option>)}{options?.units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
 <label>Owner<PersonPicker aria-label="Owner" value={q.owner} onChange={value=>change({owner:value})} options={[{value:'',label:'All owners'},...(q.owner&&!options?.owners.some(o=>o.id===q.owner)?[{value:q.owner,label:'Selected owner'}]:[]),...(options?.owners??[]).map(o=>({value:o.id,label:o.name}))]}/></label>
 <label>Phase<select aria-label="Phase" value={q.phase} onChange={e=>change({phase:e.target.value})}><option value="">All phases</option>{q.phase&&!options?.phases.includes(q.phase)?<option value={q.phase}>Selected phase</option>:null}{options?.phases.map(p=><option key={p} value={p}>{p}</option>)}</select></label>
 <label>Work type<select aria-label="Work type" value={q.type} onChange={e=>change({type:e.target.value as TimelineQuery['type']})}><option value="">All work</option><option value="deliverable">Deliverables</option><option value="contribution">Work for other committees</option><option value="task">Tasks</option></select></label>
 </div><div className="timeline-checks">{(['blocked','overdue','includeUnscheduled']as const).map(k=><label key={k}><input type="checkbox" checked={q[k]} onChange={e=>change({[k]:e.target.checked})}/>{k==='blocked'?'Blocked only':k==='overdue'?'Overdue only (any date)':'Include work with no dates'}</label>)}</div><button className="button button--secondary" onClick={()=>change({units:[],owner:'',phase:'',type:'',blocked:false,overdue:false,includeUnscheduled:true})}>Clear filters</button></details>
 <h2>{q.view==='calendar'?'Month: '+monthLabel(q.anchor):q.view==='gantt'?'Weeks: '+formatRange(window.start,window.end):(q.scale==='week'?'Week':'Month')+': '+formatRange(window.start,window.end)}</h2>
 {!current?<LoadingState title="Loading timeline"/>:current.error?<ErrorState title="Couldn't load the timeline" description="Check your connection and try again." action={<button className="button button--secondary" onClick={refresh}>Try again</button>}/>:!result?<EmptyState title="You can't see the timeline" description="The committee timeline is only for organizers on this term's roster."/>:<>
 <p role="status">{result.total} {result.total===1?'item':'items'}{q.view!=='list'&&result.items.length<result.total?`. Showing the first ${result.items.length}; narrow the filters to see the rest.`:''}</p>
 {q.view!=='list'&&unscheduled.length?<p>{unscheduled.length} {unscheduled.length===1?'item has':'items have'} no due date, so {unscheduled.length===1?"it isn't":"they aren't"} shown here. Switch to List to see {unscheduled.length===1?'it':'them'}.</p>:null}
 {result.items.length===0?<EmptyState title="Nothing in this window" description="Try another date or clear the filters."/>:<>
 {q.view==='calendar'?<Panel title="Calendar"><Calendar items={dated} start={window.start} end={window.end} month={q.anchor.slice(0,7)} today={today}/></Panel>:q.view==='gantt'?<Panel title={only?only.name+' gantt':'Project-wide gantt'}><Gantt items={dated} start={window.start} today={today} only={only} several={q.units.length>1} units={options?.units??[]} onCommittee={id=>change({units:id?[id]:[]})}/></Panel>:<>
 <Panel title="Day chart"><Chart items={result.items} edges={result.dependencies} start={window.start} end={window.end} today={today}/></Panel>
 <Panel title="By date">{dated.length?<Chronology items={dated} allItems={result.items} edges={result.dependencies}/>:<p>No dated work here.</p>}</Panel>
 <Panel title="No dates yet">{unscheduled.length?<Chronology items={unscheduled} allItems={result.items} edges={result.dependencies}/>:<p>Everything here has dates.</p>}</Panel>
 </>}
 </>}
 {q.view==='list'?<Pager label="Timeline pages" page={q.page} total={Math.min(result.total,result.pageSize*10000)} pageSize={result.pageSize} onMove={page=>change({page},true)}/>:null}
 </>}
 </>
}
export function TimelinePage({api}:{api:TimelineApi}){const context=useRouteLoaderData('workspace') as WorkspaceContext;if(isGuest(context))return <EmptyState title="Only organizers can see the timeline" description="Use the links that were shared with you."/>;return <TimelineBody key={context.termId+context.memberId} api={api} termId={context.termId}/>}
