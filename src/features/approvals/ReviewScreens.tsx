import {useEffect,useState} from 'react'
import {refreshKey,settled} from '../shared/settled'
import {Link,useParams,useRouteLoaderData,useSearchParams} from 'react-router'
import {PageHeading,Panel} from '../../components/Page'
import {TextField} from '../../components/TextField'
import {celebrate} from '../../components/celebrate'
import {LoadingState,ErrorState,EmptyState} from '../../components/FeedbackState'
import type {WorkspaceContext} from '../auth/gateway'
import type {FilesApi} from '../files/api'
import {RequestPayload,requestDate} from '../requests/Payload'
import type {ApprovalsApi} from './api'
import type {InboxApi,InboxLane,InboxResult,TriageView} from './inbox-api'
import {useReviewMemory,type ReviewCommand} from './Memory'
import type {RoomBookingApi} from '../rooms/api'
import {RoomBookingPanel} from '../rooms/BookingPanel'
import '../requests/requests.css'
import {ViewTabs} from '../shared/ViewTabs'
import {RefreshButton} from '../shared/RefreshButton'
import {HowThisWorks} from '../shared/HowThisWorks'
import {Pager} from '../shared/Pager'
import {useAutoRefresh} from '../shared/useAutoRefresh'
const identity=(c:WorkspaceContext)=>c.termId+('memberId'in c?c.memberId:c.guestAccessId)
const inboxLanes=[['all','All'],['unassigned','Needs a reviewer'],['assigned','Assigned'],['aging','Reminder due'],['revision','Waiting on requester']] as const
export function ReviewInbox({api}:{api:InboxApi}){
 const c=useRouteLoaderData('workspace')as WorkspaceContext,[params,setParams]=useSearchParams(),raw=params.get('view'),view:InboxLane=['unassigned','assigned','aging','revision'].includes(raw??'')?raw as InboxLane:'all',page=Math.min(10000,Math.max(1,Number(params.get('page'))||1)),[reload,setReload]=useState(0),key=refreshKey(identity(c)+view+':'+page,reload)
 const[state,setState]=useState<{key:string;result:InboxResult|null;error:boolean}|null>(null)
 const[counts,setCounts]=useState<InboxResult['counts']|null>(null)
 useAutoRefresh(()=>setReload(n=>n+1))
 useEffect(()=>{let live=true;void api.list(c.termId,view,page).then(result=>{if(live){setState({key,result,error:false});if(result)setCounts(result.counts)}}).catch(()=>{if(live)setState({key,result:null,error:true})});return()=>{live=false}},[api,c.termId,view,page,key])
 const current=settled(state,key)
 return <><PageHeading title="Inbox" description="Requests waiting for your review."/>
 <ViewTabs label="Inbox views" value={view} onChange={v=>setParams({view:v})} tabs={inboxLanes.map(([value,label])=>({value,label,count:counts?counts[value]:null}))}/>
 {!current?<LoadingState title="Loading your inbox"/>:current.error?<ErrorState title="Couldn't load your inbox" description="Check your connection and try again." action={<button className="button button--secondary" onClick={()=>setReload(n=>n+1)}>Try again</button>}/>:!current.result?<EmptyState title="The inbox isn't available to you" description="Only core members on this term's roster have an inbox."/>:<>
 {!current.result.items.length?<EmptyState title={view==='all'?'Nothing to review right now':'Nothing here'} description={view==='all'?'Requests assigned to you or your committee show up here.':'Try another tab.'}/>:<ul className="guest-list">{current.result.items.map(r=><li key={r.id}><h2><Link to={'/reviews/'+r.termId+'/'+r.id}>{r.trackingId} · {r.title}</Link></h2><p>{r.serviceLabel} · {r.state.replaceAll('_',' ')} · {r.stageLabel}</p><p>Reviewer: {r.owner} · Next: {r.nextAction}</p><p className="muted">Needed by {requestDate(r.requestedOn)}{r.acceptedOn?' · Agreed for '+requestDate(r.acceptedOn):''} · Sent {requestDate(r.submittedAt)}{r.aging?' · Reminder due':''}</p></li>)}</ul>}
 <Pager label="Inbox pages" page={page} total={current.result.total} onMove={p=>setParams({view,page:String(p)})}/></>}
 </>
}
export function ReviewPage({api,inbox,files,roomBookings}:{api:ApprovalsApi;inbox:InboxApi;files?:FilesApi;roomBookings?:RoomBookingApi}){
 const c=useRouteLoaderData('workspace')as WorkspaceContext,{reviewTermId='',reviewId=''}=useParams()
 return <ReviewBody key={identity(c)+reviewTermId+reviewId} term={reviewTermId} id={reviewId} api={api} inbox={inbox} files={files} roomBookings={'memberId'in c&&c.termId===reviewTermId?roomBookings:undefined}/>
}
function ReviewBody({term,id,api,inbox,files,roomBookings}:{term:string;id:string;api:ApprovalsApi;inbox:InboxApi;files?:FilesApi;roomBookings?:RoomBookingApi}){
 const[r,setRecord]=useState<TriageView|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[reload,setReload]=useState(0),[localError,setLocalError]=useState(''),[reviewed,setReviewed]=useState(false),[downloading,setDownloading]=useState(false),m=useReviewMemory(term+id,api,inbox)
 const refresh=()=>{setRecord(null);setLoading(true);setReload(n=>n+1);setReviewed(false)}
 useEffect(()=>{let live=true;void inbox.read(term,id).then(value=>{if(live){setRecord(value);setError(false);setLoading(false)}}).catch(()=>{if(live){setRecord(null);setError(true);setLoading(false)}});return()=>{live=false}},[inbox,term,id,reload])
 useEffect(()=>{const focus=()=>{setRecord(null);setLoading(true);setReload(n=>n+1);setReviewed(false)};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus)},[])
 async function command(kind:'activate'|'approve'|'reject'|'request_revision'|'note'|'accepted_date'|'completed',from?:HTMLElement){
  setLocalError('');if(!r||m.locked)return;if(!m.fields.reason.trim()){setLocalError('Add a reason or a shared note.');document.getElementById('review-reason')?.focus();return}
  const base={requestId:id,revision:r.revision,version:r.version,key:crypto.randomUUID()},assignment=r.assignments.find(a=>a.isMe),decision=['approve','reject','request_revision'].includes(kind)
  if(decision&&!reviewed){setLocalError('Tick the box to confirm you reviewed this version.');document.getElementById('review-confirm')?.focus();return}
  let attempt:ReviewCommand
  if(kind==='activate'){const reviewers=m.fields.reviewers?m.fields.reviewers.split(','):null;attempt={kind:'activate',input:{...base,stageKey:r.stageKey,reviewers,reason:m.fields.reason}}}
  else if(decision){if(!assignment)return;attempt={kind:'transition',input:{...base,assignmentId:assignment.id,stageKey:r.stageKey,action:kind as 'approve'|'reject'|'request_revision',reason:m.fields.reason,evidenceManifestId:r.externalEvidenceRequired&&m.fields.evidence==='yes'?r.manifestId:null}}}
  else{attempt={kind:'triage',input:{...base,action:kind as 'note'|'accepted_date'|'completed',note:m.fields.reason,acceptedOn:kind==='accepted_date'?m.fields.acceptedOn||null:null}}}
  // Approving or finishing is the win; declines and notes get a quiet check.
  const win=kind==='completed'||kind==='approve'&&r.stageOutcome!=='revision'&&r.stageOutcome!=='rejected'
  if(await m.run(attempt))void celebrate(from,win?'complete':'save');refresh()
 }
 async function download(asset:string){if(!files||!r?.package||downloading)return;setDownloading(true);setLocalError('');try{const blob=await files.download(r.package.downloadContext,asset),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.package.files.find(f=>f.id===asset)?.name??'review-evidence';a.click();setTimeout(()=>URL.revokeObjectURL(url),0)}catch{setLocalError('Couldn\'t download this file. Refresh the page and try again.')}finally{setDownloading(false)}}
 return <div className="request-detail"><PageHeading title="Review request" description="Check what was submitted, then approve, ask for changes or decline."/><nav className="page-actions" aria-label="Inbox"><Link className="button button--quiet" to="/reviews">Back to Inbox</Link><span className="page-actions__spacer"/><RefreshButton onRefresh={refresh} disabled={m.busy}/></nav><HowThisWorks><p>Approving here covers this service only. Spending still needs Budget (FIN) approval and posts still need Publicity sign-off.</p></HowThisWorks>
 {m.error||localError?<p role="alert">{m.error||localError}</p>:null}{m.pending?<Panel title="We couldn't confirm your last action"><p>Try again. It won't be recorded twice.</p><button className="button" disabled={m.busy} onClick={()=>void m.run().then(()=>refresh())}>Try again</button></Panel>:null}
 {roomBookings?<RoomBookingPanel api={roomBookings} term={term} request={id} files={files} refreshToken={reload}/>:null}
 {loading?<LoadingState title="Loading request"/>:error?<ErrorState title="Couldn't load this request" description="Check your connection and try again. Anything you typed is kept." action={<button className="button button--secondary" onClick={refresh}>Try again</button>}/>:!r?<EmptyState title="You can't open this review" description="It may have been reassigned to someone else. Check your Inbox."/>:<>
 <Panel title={r.trackingId+' · '+r.typeLabel}><p>{r.state.replaceAll('_',' ')} · {r.serviceLabel} · {r.stageLabel} · Version {r.revision}</p><p>Needed by {requestDate(r.requestedOn)}{r.originalRequestedOn!==r.requestedOn?' (first asked for '+requestDate(r.originalRequestedOn)+')':''} · {r.acceptedOn?'Agreed for '+requestDate(r.acceptedOn):'Date not agreed yet'}</p>{r.effectivePaused?<p role="status">On hold: {(r.effectivePauseReason??'needs a reviewer').replaceAll('_',' ')}</p>:null}<ul>{r.assignments.map(a=><li key={a.id}>{a.name}{a.isMe?' (you)':''} · {a.current?'Reviewer':'No longer a reviewer'} · Until {requestDate(a.expiresAt)}</li>)}</ul></Panel>
 {r.package?<Panel title={'What was submitted · '+r.package.title}><RequestPayload form={r.package.form} values={r.package.values} snapshots={r.package.snapshots} centavos={r.package.requestedCentavos}/><details><summary>Technical details</summary><p className="record-text">Checksum: {r.package.manifestHash}</p></details><ul>{r.package.files.map(f=><li key={f.id}>{f.name} · {f.size} bytes <button className="button button--secondary" disabled={!files||downloading} onClick={()=>void download(f.id)}>Download {f.name}</button></li>)}</ul></Panel>:<p className="muted">Only the requester and assigned reviewers can see what was submitted.</p>}
 {r.canAssign||r.canAct||r.canTriage||r.canNote?<Panel title="Your review"><TextField id="review-reason" label="Note" required maxLength={2000} value={m.fields.reason} disabled={m.locked} onChange={e=>m.change({...m.fields,reason:e.target.value})}/><p className="muted">The requester, reviewers and the service head can read this. Keep personal or money details out of it.</p>
 {r.canAssign?<fieldset disabled={m.locked}><legend>Choose reviewers · {r.requiredSlots} needed</legend><p className="muted">Leave everyone unticked to use the service's default reviewers.</p>{r.reviewerChoices.map(choice=><label className="review-choice" key={choice.id}><input type="checkbox" checked={m.fields.reviewers.split(',').includes(choice.id)} onChange={e=>{const selected=m.fields.reviewers?m.fields.reviewers.split(','):[];m.change({...m.fields,reviewers:(e.target.checked?[...selected,choice.id]:selected.filter(id=>id!==choice.id)).join(',')})}}/>{choice.name}</label>)}<button className="button" onClick={e=>void command('activate',e.currentTarget)}>Assign reviewers</button></fieldset>:null}
 {r.canAct?<fieldset disabled={m.locked}><legend>Decision on version {r.revision}</legend><label className="review-choice"><input id="review-confirm" type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed this version and its files.</label>{r.externalEvidenceRequired?<label className="review-choice"><input type="checkbox" checked={m.fields.evidence==='yes'} onChange={e=>m.change({...m.fields,evidence:e.target.checked?'yes':''})}/>Attach these submitted files to the decision record.</label>:null}<div className="auth-actions">{r.actions.map(action=><button className={action==='approve'?'button':'button button--secondary'} key={action} onClick={e=>void command(action,e.currentTarget)}>{action==='approve'?(r.stageOutcome==='completed'?'Mark this step done':r.stageOutcome==='revision'?'Send back for changes':r.stageOutcome==='rejected'?'Decline':'Approve'):action==='reject'?'Decline':'Ask for changes'}</button>)}</div></fieldset>:null}
 {r.canNote?<button className="button button--secondary" disabled={m.locked} onClick={e=>void command('note',e.currentTarget)}>Add note</button>:null}
 {r.canTriage?<fieldset disabled={m.locked}><legend>Scheduling</legend><TextField id="review-date" label="Agreed date" type="date" value={m.fields.acceptedOn} onChange={e=>m.change({...m.fields,acceptedOn:e.target.value})}/><button className="button button--secondary" onClick={e=>void command('accepted_date',e.currentTarget)}>Save agreed date</button>{r.canComplete?<button className="button" onClick={e=>void command('completed',e.currentTarget)}>Mark request done</button>:null}<p className="muted">The requester's original date stays on record. You can mark it done once this version is approved.</p></fieldset>:null}
 </Panel>:null}
 <Panel title="Decision history">{r.decisions.length?<ol>{r.decisions.map(d=><li key={d.id}>{d.stageKey} · {d.action.replaceAll('_',' ')} · {d.name} · {requestDate(d.at)}{d.reason?<p className="record-text">{d.reason}</p>:null}</li>)}</ol>:<p className="muted">No decisions yet.</p>}</Panel>
 <Panel title="Notes and dates"><p className="muted">Latest 100. Notes can't be edited once added.</p>{r.triageHistory.length?<ol>{r.triageHistory.map(t=><li key={t.id}>{t.kind.replaceAll('_',' ')} · {t.name} · {requestDate(t.at)}{t.acceptedOn?' · '+requestDate(t.acceptedOn):''}<p className="record-text">{t.note}</p></li>)}</ol>:<p className="muted">No notes yet.</p>}</Panel>
 </>}
 </div>
}
