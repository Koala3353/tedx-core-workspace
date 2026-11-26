import {Panel} from './Page'
export type ReviewApplicability='not_required'|'pending_assessment'|'verified'|'pending'
// Applicability must come from an authorized projection, never a task type or hidden panel.
export function ReviewGate({title,status,applicability,loading}:{title:string;status:string|null;applicability?:ReviewApplicability;loading:boolean}){
 const label=loading?'Checking…':status==='authorized'||status==='reviewed'?'Approved for this revision':status==='pending'||status==='not_verified'&&applicability==='pending'?'Waiting for review':status==='not_verified'&&applicability==='not_required'?'Not required':'Unavailable'
 return <Panel title={title}><p role="status">{title}: {label}</p>{label==='Unavailable'?<p>Couldn't check the review requirements or evidence. Refresh this page before you rely on a review.</p>:null}<p>Completing a task doesn't approve it, confirm payment or accept the deliverable. Private review details aren't shown here.</p></Panel>
}
