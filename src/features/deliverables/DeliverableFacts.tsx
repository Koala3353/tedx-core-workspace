import { formatDateTime, formatDay } from '../shared/dates'
import {Status} from '../../components/Status'
import {readinessLabel} from './Readiness'
import type { Deliverable } from './api'
export function dateLabel(at: string | null, on: string | null): string {
  return at ? formatDateTime(at) : formatDay(on)
}
export function DeliverableFacts({ item }: { item: Deliverable }) {
  return <dl className="deliverable-facts">
    {item.workflowState?<div><dt>Workflow state</dt><dd><Status state={item.workflowState}/></dd></div>:null}
    <div><dt>Owner</dt><dd>{item.owner.name}{!item.owner.active ? <span className="muted"> · Needs a new owner</span> : null}</dd></div>
    <div><dt>Lead committee</dt><dd>{item.leadUnit?.name ?? 'Not set'}</dd></div>
    <div><dt>Supporting committees</dt><dd>{item.supportingUnits.map(u=>u.name).join(' · ') || 'None recorded'}</dd></div>
    <div><dt>Due</dt><dd>{dateLabel(item.dueAt,item.dueOn)}{item.overdue ? ' · Overdue' : ''}</dd></div>
    <div><dt>Checklist</dt><dd>{readinessLabel(item.readiness)}{item.reviewRequired?' · Needs another review':''}</dd></div>
    <div><dt>Next step</dt><dd>{item.nextAction}<span className="muted"> {item.readiness==='ready_for_acceptance'?'Acceptance reviewer':item.owner.active ? item.owner.name : 'Needs an owner'}</span></dd></div>
    <div><dt>Blockers</dt><dd>{item.blocked ? <><Status state="blocked"/> {item.blocker ?? 'Blocked. Ask the owner for details.'}</> : 'Not blocked'}</dd></div>
    <div><dt>Sign-offs</dt><dd>Budget: {item.gates.finance.replaceAll('_',' ')}<br/>Publicity: {item.gates.publicity.replaceAll('_',' ')}<br/>Acceptance: {item.gates.acceptance.replaceAll('_',' ')}{item.tasksComplete!==undefined?<><br/>Tasks done: {item.tasksComplete?'All':'Not yet'}</>:null}</dd></div>
    <div><dt>Last updated</dt><dd><time dateTime={item.updatedAt}>{dateLabel(item.updatedAt,null)}</time></dd></div>
  </dl>
}
