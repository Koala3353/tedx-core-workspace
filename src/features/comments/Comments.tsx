import {useEffect,useId,useRef,useState,type FormEvent} from 'react'
import {useRouteLoaderData} from 'react-router'
import {Panel} from '../../components/Page'
import {LoadingState,ErrorState,EmptyState} from '../../components/FeedbackState'
import type {WorkspaceContext} from '../auth/gateway'
import {formatDateTime} from '../shared/dates'
import {Pager} from '../shared/Pager'
import {useAutoRefresh} from '../shared/useAutoRefresh'
import type {CommentsApi,CommentPage,CommentItem,CommentHistory,CommentInput,Candidate} from './api'

const stamp=(value:string)=>formatDateTime(value)
export function Comments({api,workId,quickUpdate=false}:{api:CommentsApi;workId:string;quickUpdate?:boolean}) {
 const context=useRouteLoaderData('workspace') as WorkspaceContext|undefined
 const subject=context?('memberId'in context?context.memberId:context.guestAccessId):''
 return <Thread key={workId+':'+subject} api={api} workId={workId} quickUpdate={quickUpdate}/>
}
function Thread({api,workId,quickUpdate}:{api:CommentsApi;workId:string;quickUpdate:boolean}) {
 const [page,setPage]=useState(1),[reload,setReload]=useState(0)
 const [loaded,setLoaded]=useState<{key:string;data:CommentPage|null;error:boolean}|null>(null)
 const key=page+':'+reload
 useEffect(()=>{let live=true;void api.read(workId,page).then(data=>{if(live)setLoaded({key,data,error:false})}).catch(()=>{if(live)setLoaded({key,data:null,error:true})});return()=>{live=false}},[api,workId,page,key])
 const current=loaded
 useAutoRefresh(()=>setReload(n=>n+1))
 const discussion=<>
 {current&&current.key!==key?<p role="status">Updating…</p>:null}
 {!current?<LoadingState title="Loading comments"/>:current.error?<ErrorState title="Couldn't load comments" description="Check your connection and try again."/>:!current.data?<EmptyState title="You can't see comments here" description="You need access to this work to see its comments."/>:<>
 {current.data.canComment?null:<p>You can read these comments but not add any.</p>}
 {current.data.items.length===0?<p>No comments yet.</p>:current.data.items.map(item=><CommentRow key={item.id} api={api} workId={workId} item={item} onSaved={()=>setReload(reload+1)}/>)}
 <Pager label="Comment pages" page={page} total={current.data.total} onMove={setPage}/>
 </>}
 </>
 const composer=current?.data?.canComment?<Composer api={api} workId={workId} onSaved={()=>setReload(reload+1)} quickUpdate={quickUpdate}/>:null
 return <Panel title={quickUpdate?'Task updates':'Comments'}>
 {quickUpdate?<>{!current?<LoadingState title="Loading updates"/>:current.error?<ErrorState title="Couldn't load updates" description="Check your connection and try again." action={<button className="button button--secondary" onClick={()=>setReload(reload+1)}>Try again</button>}/>:composer}<details className="work-section"><summary>Activity and discussion</summary>{discussion}</details></>:<>{discussion}{composer}</>}
 </Panel>
}
function CommentRow({api,workId,item,onSaved}:{api:CommentsApi;workId:string;item:CommentItem;onSaved:()=>void}) {
 const [history,setHistory]=useState<{version:number;rows:CommentHistory[]}|null>(null),[error,setError]=useState(''),[editing,setEditing]=useState(false),[pending,setPending]=useState(false)
 return <article className="comment-row"><h3>{item.author}</h3><p>{stamp(item.createdAt)}{item.state!=='published'?' · '+item.state:''}{item.version>1?' · Edited '+stamp(item.updatedAt):''}</p>
 <p className="record-text">{item.body??(item.state==='redacted'?'This comment was removed.':'Draft deleted.')}</p>{item.version>1?<p className="record-text">Reason for edit: {item.reason}</p>:null}
 {item.state==='published'||item.evidence.length?<details><summary>Record details</summary>{item.state==='published'?<p className="record-text">Reference: <code>{'comment:'+item.id+':'+item.version}</code></p>:null}{item.evidence.map((e,i)=><p key={i}>Version {e.revision} kept for {e.purpose} (work version {e.workVersion}).{e.revision<item.version?' It has been edited since.':''}</p>)}</details>:null}
 <div className="auth-actions"><button className="button button--secondary" onClick={()=>{setError('');void api.history(item.id).then(rows=>setHistory({version:item.version,rows})).catch(()=>setError('Couldn\'t load the edit history. Try again.'))}}>Show edit history</button>{item.canEdit||item.canRedact?<button disabled={pending} className="button button--secondary" onClick={()=>setEditing(!editing)}>{editing?'Cancel':'Edit'}</button>:null}</div>
 {error?<p role="alert">{error}</p>:null}{history?.version===item.version?<ol>{history.rows.map(h=><li key={h.revision}><p>Version {h.revision} · {stamp(h.recordedAt)} · {h.state}</p><p className="record-text">{h.body??'Text removed.'}</p><p className="record-text">Reason: {h.reason}</p></li>)}</ol>:null}
 {editing?<Composer key={item.id} api={api} workId={workId} item={item} onPending={setPending} onSaved={()=>{setEditing(false);onSaved()}}/>:null}</article>
}
function Composer({api,workId,item,onSaved,onPending,quickUpdate=false}:{api:CommentsApi;workId:string;item?:CommentItem;onSaved:()=>void;onPending?:(pending:boolean)=>void;quickUpdate?:boolean}) {
 const fieldId=useId()
 const [baseVersion]=useState(item?.version)
 const [body,setBody]=useState(item?.body??''),[reason,setReason]=useState(''),[draft,setDraft]=useState(false),[mentions,setMentions]=useState<string[]>(item?.mentions??[])
 const [search,setSearch]=useState(''),[candidates,setCandidates]=useState<Candidate[]>([]),[candidateError,setCandidateError]=useState('')
 const [finding,setFinding]=useState(false),[searched,setSearched]=useState(false)
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[conflict,setConflict]=useState(false),[error,setError]=useState('')
 const pending=useRef<{input:CommentInput;key:string}|null>(null)
 const [confirmation,setConfirmation]=useState('')
 async function send(input:CommentInput) {const request=pending.current??{input,key:crypto.randomUUID()};pending.current=request;setBusy(true);onPending?.(true);setError('');setConfirmation('');const result=await api.execute(request.input,request.key);setBusy(false)
  if(!result.ok){setError(result.error.message);setUncertain(result.error.retryable);onPending?.(result.error.retryable);setConflict(['stale_version','conflict','idempotency_conflict','unexpected'].includes(result.error.kind));if(!result.error.retryable)pending.current=null;return}
  pending.current=null;setUncertain(false);onPending?.(false);setBody('');setReason('');setMentions([]);setDraft(false);if(quickUpdate)setConfirmation(request.input.draft?'Draft saved.':'Update posted.');onSaved()
 }
 function submit(e:FormEvent<HTMLFormElement>) {e.preventDefault();const action=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') as CommentInput['action']||'edit';void send({workId,commentId:item?.id,version:baseVersion,body,mentions,draft,action,reason})}
 const locked=busy||uncertain||conflict
 const extraFields=<>{item?<div className="form-field"><label htmlFor={fieldId+'-reason'}>Why are you changing this? (required)</label><textarea id={fieldId+'-reason'} value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} required/></div>:<label className="editor-check"><input type="checkbox" checked={draft} onChange={e=>setDraft(e.target.checked)}/>Save as a draft (only you can see it)</label>}
 {!item||item.canEdit?<><div className="form-field"><label htmlFor={fieldId+'-search'}>Mention someone</label><input id={fieldId+'-search'} value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></div><button type="button" disabled={finding} className="button button--secondary" onClick={()=>{setCandidates([]);setCandidateError('');setFinding(true);setSearched(false);void api.candidates(workId,search).then(rows=>{setCandidates(rows);setSearched(true)}).catch(()=>setCandidateError('Couldn\'t search. Try again.')).finally(()=>setFinding(false))}}>Search</button>
 {finding?<p role="status">Searching…</p>:searched?<p role="status">{candidates.length?`${candidates.length} ${candidates.length===1?'person':'people'} found.`:'No one on this work matches that name.'}</p>:null}
 <p>{mentions.length} mentioned. People aren't notified of mentions yet.</p>{candidateError?<p role="alert">{candidateError}</p>:null}{candidates.map(c=><label className="editor-check" key={c.id}><input type="checkbox" checked={mentions.includes(c.id)} disabled={!mentions.includes(c.id)&&mentions.length>=20} onChange={e=>setMentions(e.target.checked?[...mentions,c.id]:mentions.filter(id=>id!==c.id))}/>{c.name}</label>)}{mentions.length?<button type="button" className="button button--quiet" onClick={()=>setMentions([])}>Clear mentions</button>:null}</>:null}</>
 return <form className="deliverable-editor" onSubmit={submit}><h3>{quickUpdate?'Post an update':item?'Edit comment':'New comment'}</h3>
 {quickUpdate?<p>Everyone on this task can see updates. Save a draft to keep one to yourself.</p>:null}
 {confirmation?<p role="status">{confirmation}</p>:null}
 {error?<p role="alert">{error}{conflict?' Your text is kept below. Copy it, then reload the page to see the latest version.':''}</p>:null}
 {uncertain?<button type="button" className="button" disabled={busy} onClick={()=>pending.current&&void send(pending.current.input)}>Try again</button>:null}
 <fieldset disabled={locked}><div className="form-field"><label htmlFor={fieldId+'-body'}>{quickUpdate?'Update text':'Comment text'}{!item||item.canEdit?' (required)':''}</label><textarea id={fieldId+'-body'} value={body} onChange={e=>{setBody(e.target.value);setConfirmation('')}} maxLength={8000} required={!item||item.canEdit} readOnly={!!item&&!item.canEdit}/></div>
 {quickUpdate?<details className="work-section"><summary>Mentions and drafts{draft?' · Draft':''}{mentions.length?' · '+mentions.length+' selected':''}</summary>{extraFields}</details>:extraFields}
 {!item||item.canEdit?<button className={item?.state==='draft'?'button button--secondary':'button'} value="edit">{item?'Save changes':draft?'Save draft':quickUpdate?'Post update':'Post comment'}</button>:null}
 {item?.canEdit&&item.state==='draft'?<><button className="button" value="publish">Publish draft</button><button className="button button--quiet" value="remove" formNoValidate>Delete draft</button></>:null}
 {item?.canRedact?<button className="button button--quiet" value="redact" formNoValidate>Remove comment text</button>:null}
 </fieldset></form>
}
