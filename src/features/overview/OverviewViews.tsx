import {Link} from 'react-router'
import {Status} from '../../components/Status'
import type {ReactNode} from 'react'
import {Panel} from '../../components/Page'
import {EmptyState} from '../../components/FeedbackState'
import {WorkReference} from '../work-references/WorkReference'
import {formatDateTime,formatDay} from '../shared/dates'
const dateLabel=(at:string|null|undefined,on:string|null|undefined)=>at?formatDateTime(at):formatDay(on)
import {widgetCatalog} from '../../app/widgetCatalog'
import type {OverviewRow} from './api'
import type {Layout} from './layout'

export function OverviewLane({items,lane,illustrative=false}:{items:OverviewRow[];lane:'actionable'|'waiting';illustrative?:boolean}){
 const rows=items.filter(i=>i.lane===lane)
 return <Panel title={lane==='actionable'?`Who is waiting on you · ${rows.length}`:`Waiting on someone else · ${rows.length}`}>
 <p>{lane==='actionable'?'Tasks, reviews and requests that need you next.':'Work you\'ve handed off or submitted, waiting on someone else.'}</p>
 {rows.length===0?<EmptyState title={lane==='actionable'?'You\'re all caught up.':'Nothing waiting on others.'} description={lane==='actionable'?'New tasks assigned to you will appear here.':'Work you hand off or submit will show here until someone acts on it.'}/>:<ul className="guest-list">{rows.map(i=><li key={i.source+':'+i.id}>
 <h3><Link className="overview-work-link" aria-disabled={illustrative||undefined} tabIndex={illustrative?-1:undefined} onClick={illustrative?e=>e.preventDefault():undefined} to={illustrative?'#':(i.source==='review'?'/reviews/'+i.termId+'/':i.source==='request'?'/requests/'+i.termId+'/':i.source==='task'?'/tasks/':i.source==='handoff'?'/working-together/handoffs/':'/deliverables/')+i.id}>{i.title}</Link></h3>
 {i.source==='task'||i.source==='deliverable'?<WorkReference compact reference={i.reference} id={i.id} kind={i.source}/>:null}
 <p>Owner: {i.owner} · Committee: {i.committee??'Not assigned'}</p><p>Next action: {i.action} · Next person: {i.person}</p>
 {i.source==='review'||i.source==='request'?<p>Requested: {dateLabel(null,i.requestedOn??null)} · Agreed date: {i.dueOn?dateLabel(null,i.dueOn):'Not agreed yet'}{i.overdue?' · Overdue':''} · <Status state={i.state}/></p>:<p>Due: {i.dueOn||i.dueAt?dateLabel(i.dueAt,i.dueOn):'No due date'}{i.overdue?' · Overdue':''} · <Status state={i.state}/></p>}
 </li>)}</ul>}</Panel>
}
export function WorkHelp({guest,canSearch=false,children}:{guest:boolean;canSearch?:boolean;children?:ReactNode}){
 return <nav aria-label="Work and help" className="overview-help">
  <Link className="button button--secondary" to="/tasks">My tasks</Link>
  {canSearch&&!guest?<Link className="button button--secondary" to="/search">Find</Link>:null}
  {!guest?<Link className="button button--secondary" to="/requests">Ask a committee</Link>:null}
  {children}
  <Link className="button button--secondary" to="/resources">Resources & Start Here</Link>
  {guest?<Link className="button button--secondary" to="/shared">Shared with me</Link>:<Link className="button button--secondary" to="/people">Find a contact</Link>}
 </nav>
}
export function SecondaryViews({layout,items,illustrative=false}:{layout:Layout;items:OverviewRow[];illustrative?:boolean}){
 return <section aria-label="Follow-up and planning"><h2>Follow-up and planning</h2><div className="overview-secondary">
 {layout.widgets.map(w=><div key={w.id} className={'overview-widget overview-widget--'+w.size} data-widget={w.id}>
 {w.id==='waiting'?<OverviewLane items={items} lane="waiting" illustrative={illustrative}/>:<Panel title={widgetCatalog.find(c=>c.id===w.id)!.label}>
 {w.id==='calendar'?<p><Link className="button button--secondary" to="/calendar">Open calendar</Link></p>:w.id==='resources'?<p><Link className="button button--secondary" to="/resources">Open guides and contacts</Link></p>:<><p>{items.filter(i=>w.id==='tasks'?i.source==='task':w.id==='deliverables'?i.source==='deliverable':w.id==='working'?i.source==='handoff':['request','review'].includes(i.source)).length} in your overview.</p><Link className="button button--secondary" to={w.id==='tasks'?'/tasks':w.id==='deliverables'?'/deliverables':w.id==='working'?'/working-together':'/reviews'}>Open {widgetCatalog.find(c=>c.id===w.id)!.label}</Link></>}
 </Panel>}</div>)}
 </div></section>
}
