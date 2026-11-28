import {useEffect,useRef,useState} from 'react'
import {PendingButton} from '../../components/PendingButton'
import {Link,useParams,useRouteLoaderData} from 'react-router'
import {PageHeading,Panel} from '../../components/Page'
import {TextField} from '../../components/TextField'
import {celebrate} from '../../components/celebrate'
import {LoadingState,ErrorState,EmptyState} from '../../components/FeedbackState'
import type {WorkspaceContext} from '../auth/gateway'
import type {FilesApi} from '../files/api'
import {RequestPayload,requestDate} from '../requests/Payload'
import type {ApprovalsApi} from './api'
import type {InboxApi,TriageView} from './inbox-api'
import {useReviewMemory,type ReviewCommand} from './Memory'
import type {RoomBookingApi} from '../rooms/api'
import {RoomBookingPanel} from '../rooms/BookingPanel'
import '../requests/requests.css'
import {RefreshButton} from '../shared/RefreshButton'
import {HowThisWorks} from '../shared/HowThisWorks'
import { NoAccess } from '../../components/illustrations'
const identity=(c:WorkspaceContext)=>c.termId+('memberId'in c?c.memberId:c.guestAccessId)
export function ReviewPage({api,inbox,files,roomBookings}:{api:ApprovalsApi;inbox:InboxApi;files?:FilesApi;roomBookings?:RoomBookingApi}){
 const c=useRouteLoaderData('workspace')as WorkspaceContext,{reviewTermId='',reviewId=''}=useParams()
 return <ReviewBody key={identity(c)+reviewTermId+reviewId} term={reviewTermId} id={reviewId} api={api} inbox={inbox} files={files} roomBookings={'memberId'in c&&c.termId===reviewTermId?roomBookings:undefined}/>
}
function ReviewBody({term,id,api,inbox,files,roomBookings}:{term:string;id:string;api:ApprovalsApi;inbox:InboxApi;files?:FilesApi;roomBookings?:RoomBookingApi}){
 const[r,setRecord]=useState<TriageView|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[reload,setReload]=useState(0),[localError,setLocalError]=useState(''),[reviewed,setReviewed]=useState(false),[downloading,setDownloading]=useState<string|null>(null),[acting,setActing]=useState<string|null>(null),[settling,setSettling]=useState(false),[refreshFailed,setRefreshFailed]=useState(false),m=useReviewMemory(term+id,api,inbox),seen=useRef<string|null>(null),hadRecord=useRef(false)
 // Stale-while-refresh: keep the request on screen while it reloads (focus, refresh, after an action).
 // After an action the controls stay locked until the fresh copy lands, so nothing acts on the old version.
 const refresh=(afterAction=false)=>{if(afterAction)setSettling(true);setReload(n=>n+1)}
 useEffect(()=>{let live=true;void inbox.read(term,id).then(value=>{if(live){const version=value?value.revision+':'+value.version:null;if(version!==seen.current)setReviewed(false);seen.current=version;hadRecord.current=!!value;setRecord(value);setError(false);setRefreshFailed(false);setLoading(false);setSettling(false)}}).catch(()=>{if(live){
  // A failed background refresh keeps the last good copy and says so; only a first load shows the error page.
  if(hadRecord.current)setRefreshFailed(true);else{setRecord(null);setError(true)}setLoading(false);setSettling(false)}});return()=>{live=false}},[inbox,term,id,reload])
 useEffect(()=>{const focus=()=>setReload(n=>n+1);window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus)},[])
 const locked=m.locked||settling
 async function command(kind:'activate'|'approve'|'reject'|'request_revision'|'note'|'accepted_date'|'completed',from?:HTMLElement){
  setLocalError('');if(!r||locked)return;if(!m.fields.reason.trim()){setLocalError('Add a reason or a shared note.');document.getElementById('review-reason')?.focus();return}
  const base={requestId:id,revision:r.revision,version:r.version,key:crypto.randomUUID()},assignment=r.assignments.find(a=>a.isMe),decision=['approve','reject','request_revision'].includes(kind)
  if(decision&&!reviewed){setLocalError('Tick the box to confirm you reviewed this version.');document.getElementById('review-confirm')?.focus();return}
  let attempt:ReviewCommand
  if(kind==='activate'){const reviewers=m.fields.reviewers?m.fields.reviewers.split(','):null;attempt={kind:'activate',input:{...base,stageKey:r.stageKey,reviewers,reason:m.fields.reason}}}
  else if(decision){if(!assignment)return;attempt={kind:'transition',input:{...base,assignmentId:assignment.id,stageKey:r.stageKey,action:kind as 'approve'|'reject'|'request_revision',reason:m.fields.reason,evidenceManifestId:r.externalEvidenceRequired&&m.fields.evidence==='yes'?r.manifestId:null}}}
  else{attempt={kind:'triage',input:{...base,action:kind as 'note'|'accepted_date'|'completed',note:m.fields.reason,acceptedOn:kind==='accepted_date'?m.fields.acceptedOn||null:null}}}
  // Approving or finishing is the win; declines and notes get a quiet check.
  const win=kind==='completed'||kind==='approve'&&r.stageOutcome!=='revision'&&r.stageOutcome!=='rejected'
  setActing(kind)
  try{if(await m.run(attempt))void celebrate(from,win?'complete':'save')}finally{setActing(null)}
  refresh(true)
 }
 async function download(asset:string){if(!files||!r?.package||downloading)return;setDownloading(asset);setLocalError('');try{const blob=await files.download(r.package.downloadContext,asset),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.package.files.find(f=>f.id===asset)?.name??'review-evidence';a.click();setTimeout(()=>URL.revokeObjectURL(url),0)}catch{setLocalError('Couldn\'t download this file. Refresh the page and try again.')}finally{setDownloading(null)}}
 return <div className="request-detail"><PageHeading title="Review request" description="Check what was submitted, then approve, ask for changes or decline."/><nav className="page-actions" aria-label="Inbox"><Link className="button button--quiet" to="/reviews">Back to Inbox</Link><span className="page-actions__spacer"/><RefreshButton onRefresh={()=>refresh()} disabled={m.busy||settling}/></nav><HowThisWorks><p>Approving here covers this service only. Spending still needs Budget (FIN) approval and posts still need Publicity sign-off.</p></HowThisWorks>
 {m.error||localError?<p role="alert">{m.error||localError}</p>:null}{m.pending?<Panel title="We couldn't confirm your last action"><p>Try again. It won't be recorded twice.</p><PendingButton className="button" pending={m.busy} pendingLabel="Trying again…" onClick={()=>m.run().then(()=>refresh(true))}>Try again</PendingButton></Panel>:null}
 {roomBookings?<RoomBookingPanel api={roomBookings} term={term} request={id} files={files} refreshToken={reload}/>:null}
 {refreshFailed&&r?<p role="alert" className="refresh-failed">Couldn't refresh. Showing the last copy that loaded.<button className="button button--quiet" type="button" onClick={()=>refresh()}>Try again</button></p>:null}
 {loading&&!r?<LoadingState title="Loading request"/>:error?<ErrorState title="Couldn't load this request" description="Check your connection and try again. Anything you typed is kept." action={<button className="button button--secondary" onClick={()=>{setLoading(true);refresh()}}>Try again</button>}/>:!r?<EmptyState illustration={<NoAccess />} title="You can't open this review" description="It may have been reassigned to someone else. Check your Inbox."/>:<>
 <Panel title={r.trackingId+' · '+r.typeLabel}><p>{r.state.replaceAll('_',' ')} · {r.serviceLabel} · {r.stageLabel} · Version {r.revision}</p><p>Needed by {requestDate(r.requestedOn)}{r.originalRequestedOn!==r.requestedOn?' (first asked for '+requestDate(r.originalRequestedOn)+')':''} · {r.acceptedOn?'Agreed for '+requestDate(r.acceptedOn):'Date not agreed yet'}</p>{r.effectivePaused?<p role="status">On hold: {(r.effectivePauseReason??'needs a reviewer').replaceAll('_',' ')}</p>:null}<ul>{r.assignments.map(a=><li key={a.id}>{a.name}{a.isMe?' (you)':''} · {a.current?'Reviewer':'No longer a reviewer'} · Until {requestDate(a.expiresAt)}</li>)}</ul></Panel>
 {r.package?<Panel title={'What was submitted · '+r.package.title}><RequestPayload form={r.package.form} values={r.package.values} snapshots={r.package.snapshots} centavos={r.package.requestedCentavos}/><details><summary>Technical details</summary><p className="record-text">Checksum: {r.package.manifestHash}</p></details><ul>{r.package.files.map(f=><li key={f.id}>{f.name} · {f.size} bytes <PendingButton className="button button--secondary" disabled={!files||!!downloading} pending={downloading===f.id} pendingLabel="Downloading…" onClick={()=>download(f.id)}>Download {f.name}</PendingButton></li>)}</ul></Panel>:<p className="muted">Only the requester and assigned reviewers can see what was submitted.</p>}
 {r.canAssign||r.canAct||r.canTriage||r.canNote?<Panel title="Your review"><TextField id="review-reason" label="Note" required maxLength={2000} value={m.fields.reason} disabled={m.locked} onChange={e=>m.change({...m.fields,reason:e.target.value})}/><p className="muted">The requester, reviewers and the service head can read this. Keep personal or money details out of it.</p>
 {r.canAssign?<fieldset disabled={locked}><legend>Choose reviewers · {r.requiredSlots} needed</legend><p className="muted">Leave everyone unticked to use the service's default reviewers.</p>{r.reviewerChoices.map(choice=><label className="review-choice" key={choice.id}><input type="checkbox" checked={m.fields.reviewers.split(',').includes(choice.id)} onChange={e=>{const selected=m.fields.reviewers?m.fields.reviewers.split(','):[];m.change({...m.fields,reviewers:(e.target.checked?[...selected,choice.id]:selected.filter(id=>id!==choice.id)).join(',')})}}/>{choice.name}</label>)}<PendingButton className="button" pending={acting==='activate'} pendingLabel="Assigning…" onClick={e=>command('activate',e.currentTarget)}>Assign reviewers</PendingButton></fieldset>:null}
 {r.canAct?<fieldset disabled={locked}><legend>Decision on version {r.revision}</legend><label className="review-choice"><input id="review-confirm" type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed this version and its files.</label>{r.externalEvidenceRequired?<label className="review-choice"><input type="checkbox" checked={m.fields.evidence==='yes'} onChange={e=>m.change({...m.fields,evidence:e.target.checked?'yes':''})}/>Attach these submitted files to the decision record.</label>:null}<div className="auth-actions">{r.actions.map(action=><PendingButton className={action==='approve'?'button':'button button--secondary'} key={action} pending={acting===action} onClick={e=>command(action,e.currentTarget)}>{action==='approve'?(r.stageOutcome==='completed'?'Mark this step done':r.stageOutcome==='revision'?'Send back for changes':r.stageOutcome==='rejected'?'Decline':'Approve'):action==='reject'?'Decline':'Ask for changes'}</PendingButton>)}</div></fieldset>:null}
 {r.canNote?<PendingButton className="button button--secondary" disabled={locked} pending={acting==='note'} pendingLabel="Adding…" onClick={e=>command('note',e.currentTarget)}>Add note</PendingButton>:null}
 {r.canTriage?<fieldset disabled={locked}><legend>Scheduling</legend><TextField id="review-date" label="Agreed date" type="date" value={m.fields.acceptedOn} onChange={e=>m.change({...m.fields,acceptedOn:e.target.value})}/><PendingButton className="button button--secondary" pending={acting==='accepted_date'} pendingLabel="Saving…" onClick={e=>command('accepted_date',e.currentTarget)}>Save agreed date</PendingButton>{r.canComplete?<PendingButton className="button" pending={acting==='completed'} onClick={e=>command('completed',e.currentTarget)}>Mark request done</PendingButton>:null}<p className="muted">The requester's original date stays on record. You can mark it done once this version is approved.</p></fieldset>:null}
 </Panel>:null}
 <Panel title="Decision history">{r.decisions.length?<ol>{r.decisions.map(d=><li key={d.id}>{d.stageKey} · {d.action.replaceAll('_',' ')} · {d.name} · {requestDate(d.at)}{d.reason?<p className="record-text">{d.reason}</p>:null}</li>)}</ol>:<p className="muted">No decisions yet.</p>}</Panel>
 <Panel title="Notes and dates"><p className="muted">Latest 100. Notes can't be edited once added.</p>{r.triageHistory.length?<ol>{r.triageHistory.map(t=><li key={t.id}>{t.kind.replaceAll('_',' ')} · {t.name} · {requestDate(t.at)}{t.acceptedOn?' · '+requestDate(t.acceptedOn):''}<p className="record-text">{t.note}</p></li>)}</ol>:<p className="muted">No notes yet.</p>}</Panel>
 </>}
 </div>
}
