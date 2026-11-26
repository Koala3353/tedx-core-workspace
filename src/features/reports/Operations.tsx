import {formatDateTime} from '../shared/dates'
import {Link} from 'react-router'
import {Panel} from '../../components/Page'
import type {FlowRow,Operations,Workload} from './api'

function Sources({rows,total}:{rows:FlowRow[];total:number}){
 return total===0?<p className="muted">Nothing here right now.</p>:<><p className="muted">Showing {rows.length} of {total}, oldest first.</p><ul>{rows.map(row=><li key={row.id}><h3><Link className="report-title" to={row.href}>{row.title}</Link></h3><p>{row.reference?row.reference+' · ':''}{row.state.replaceAll('_',' ')}</p><p className="muted">Sent {formatDateTime(row.since)}{row.ageDays!==null?` · waiting ${row.ageDays} ${row.ageDays===1?'day':'days'}`:''}</p></li>)}</ul></>
}
function Times({samples,median,p90,kind}:{samples:number;median:number|null;p90:number|null;kind:string}){
 return samples===0?<p className="muted">No {kind} this week yet.</p>:<p>Usually {median} {median===1?'day':'days'}; 9 in 10 within {p90} {p90===1?'day':'days'} (based on {samples} {kind}).</p>
}
export function WorkloadSummary({value:w}:{value:Workload}){
 return <Panel title="Workload"><dl className="report-metrics"><dt>Open tasks</dt><dd>{w.totalOpen} ({w.assignedOpen} assigned, {w.unassignedOpen} unassigned)</dd><dt>Due in the next 7 days</dt><dd>{w.dueInSevenDays}</dd><dt>Due in the selected week</dt><dd>{w.dueSelectedWeek}</dd><dt>No due date</dt><dd>{w.undatedOpen}</dd><dt>Effort estimates</dt><dd>{w.effort.small} small · {w.effort.medium} medium · {w.effort.large} large · {w.effort.notRecorded} not set</dd></dl></Panel>
}
export function OperationalFlows({value:o}:{value:Operations}){
 return <><Panel title="Review queue"><dl className="report-metrics"><dt>Needs a reviewer</dt><dd>{o.queue.unassigned}</dd><dt>With a reviewer</dt><dd>{o.queue.assigned}</dd><dt>Waiting on something else first</dt><dd>{o.queue.prerequisites}</dd><dt>Longest wait</dt><dd>{o.queue.oldestDays===null?'Not known':`${o.queue.oldestDays} days`}</dd></dl><Sources rows={o.queue.items} total={o.queue.total}/><Link to="/reviews">Open Inbox</Link></Panel>
 <Panel title="How long reviews take"><Times samples={o.reviews.samples} median={o.reviews.medianDays} p90={o.reviews.p90Days} kind="decisions"/></Panel>
 <Panel title="Handoffs"><p>{o.handoffs.pending} of {o.handoffs.total} waiting for the receiving committee.</p><h3>Time to first reply</h3><Times samples={o.handoffs.responseSamples} median={o.handoffs.medianResponseDays} p90={o.handoffs.p90ResponseDays} kind="replies"/><h3>Time to accept</h3><Times samples={o.handoffs.acceptanceSamples} median={o.handoffs.medianAcceptanceDays} p90={o.handoffs.p90AcceptanceDays} kind="acceptances"/><Sources rows={o.handoffs.items} total={o.handoffs.total}/><Link to="/working-together/handoffs">Open handoffs</Link></Panel>
 <details className="how-this-works"><summary>How waiting times are counted</summary><div className="how-this-works__body"><p>Times are calendar days, including weekends and pauses. A review's wait starts when the latest version was submitted and doesn't reset when it's reassigned.</p><p>The review queue only counts general requests in services you head. Budget and Publicity cases aren't included.</p><p>Handoff reply time runs from when a handoff is sent to the receiving committee's first answer. Resending starts a new clock.</p></div></details></>
}
