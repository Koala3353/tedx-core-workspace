import {useEffect,useRef,useState} from 'react'
import {Panel} from '../../components/Page'
import {RefreshButton} from '../shared/RefreshButton'
import {formatDay} from '../shared/dates'
import type {ImportInput,ImportRef} from './task-import-api'
import type {RosterImportsApi,RosterPreview,RosterRead,RosterReceipt} from './roster-import-api'

const instant=(date:string)=>date?date+'T00:00:00+08:00':''
const manilaDate=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))
const stampOf=(list:string,joined:string,ends:string,input:ImportInput)=>JSON.stringify({list,joined,ends,header:input.header,rows:input.rows,mapping:Object.fromEntries(Object.entries(input.mapping).sort(([a],[b])=>a.localeCompare(b)))})
type Pending={run:()=>Promise<()=>void>}
export function RosterImportPanel({api,term,input,enabled,onLoad,onDenied,onLockChange}:{api:RosterImportsApi;term:string;input:ImportInput;enabled:boolean;onLoad:(value:NonNullable<RosterRead['draft']>)=>void;onDenied:()=>void;onLockChange:(locked:boolean)=>void}){
 const [list,setList]=useState(''),[joined,setJoined]=useState(''),[ends,setEnds]=useState(''),[reason,setReason]=useState(''),[selected,setSelected]=useState('')
 const [drafts,setDrafts]=useState<RosterRead['drafts']>([]),[draft,setDraft]=useState<(ImportRef&{stamp:string})|null>(null),[review,setReview]=useState<{value:RosterPreview;stamp:string}|null>(null),[receipt,setReceipt]=useState<RosterReceipt|null>(null)
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<Pending|null>(null),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),epoch=useRef(0)
 const callbacks=useRef({onLoad,onDenied,onLockChange});callbacks.current={onLoad,onDenied,onLockChange}
 const stamp=stampOf(list,joined,ends,input),currentReview=review?.stamp===stamp?review.value:null,locked=busy||!!pending
 function problem(e:unknown){const kind=(e as{kind?:string}).kind
  if(kind==='denied'){setDraft(null);setDrafts([]);setReview(null);setReceipt(null);setList('');setJoined('');setEnds('');setReason('');setSelected('');callbacks.current.onDenied();return 'You no longer have permission to manage the roster, so your saved review was cleared.'}
  return kind==='conflict'?'The draft or roster changed. Check the saved version, then save and preview again. Your edits are kept.':kind==='validation'?'Fix the rows or membership dates, then save and preview again. Your edits are kept.':'Couldn\'t connect. Your input is kept. Try again.'
 }
 async function read(id?:string,replace=false){const seq=++epoch.current;setBusy(true);setError('');callbacks.current.onLockChange(true)
  try{const v=await api.read(term,id);if(seq!==epoch.current)return;setDrafts(v.drafts)
   if(v.draft){const d=v.draft,j=manilaDate(d.joinedAt),e=manilaDate(d.endsAt);setDraft({...d,stamp:stampOf(d.listName,j,e,d.input)});setReceipt(d.receipt);setReview(null);setConfirmed(false)
    if(replace){setList(d.listName);setJoined(j);setEnds(e);setReason('');callbacks.current.onLoad(d)}
   }
  }catch(e){if(seq===epoch.current)setError(problem(e))}finally{if(seq===epoch.current){setBusy(false);callbacks.current.onLockChange(false)}}
 }
 useEffect(()=>{void read();return()=>{epoch.current++}},[api,term])
 async function execute(action:Pending){const seq=++epoch.current;setPending(action);setBusy(true);setError('');callbacks.current.onLockChange(true)
  try{const apply=await action.run();if(seq!==epoch.current)return;apply();setPending(null);callbacks.current.onLockChange(false)}catch(e){if(seq!==epoch.current)return;setReview(null);setConfirmed(false)
   if((e as{kind?:string}).kind==='connection')setError('We couldn\'t confirm this went through. Choose Try again; it won\'t create duplicates.')
   else{setPending(null);callbacks.current.onLockChange(false);setError(problem(e))}
  }finally{if(seq===epoch.current)setBusy(false)}
 }
 function save(){const data=structuredClone(input),id=draft?.draftId??null,version=draft?.version??0,key=crypto.randomUUID(),savedStamp=stamp
  void execute({run:async()=>{const d=await api.save(term,list,instant(joined),instant(ends),data,id,version,key);return()=>{setDraft({...d,stamp:savedStamp});setReview(null);setReceipt(null);setConfirmed(false);setMessage('Draft saved. Preview the changes before importing.')}}})
 }
 async function preview(){if(!draft)return;const seq=++epoch.current;setBusy(true);callbacks.current.onLockChange(true);setReview(null);setConfirmed(false);setError('');const savedStamp=stamp
  try{const v=await api.preview(term,draft.draftId,draft.version);if(seq===epoch.current)setReview({value:v,stamp:savedStamp})}catch(e){if(seq===epoch.current)setError(problem(e))}finally{if(seq===epoch.current){setBusy(false);callbacks.current.onLockChange(false)}}
 }
 function commit(){if(!draft||!currentReview?.valid||!confirmed||!reason.trim())return;const id=draft.draftId,version=draft.version,hash=currentReview.reviewHash,key=crypto.randomUUID(),why=reason
  void execute({run:async()=>{const result=await api.commit(term,id,version,hash,why,key);return()=>{setReceipt(result);setDraft({...result,stamp});setReview(null);setConfirmed(false);setMessage('People added to the roster. Assign their committees and roles in Administration.')}}})
 }
 return <Panel title="3. Save and add people">
  <p>Add up to 50 people at a time. Either everyone is added or no one is. This doesn\'t assign committees or roles, or send invitations.</p>
  <details><summary>Import rules</summary><p>Use the same list name and source keys (case matters) when you import again. People already on the roster stay as they are, including their names and dates. Fix name differences, returning members, guests or suspended accounts in Administration.</p></details>
  <label>List name (use the same one when you retry)<input maxLength={80} disabled={locked||!!draft} value={list} onChange={e=>{setList(e.target.value);setConfirmed(false)}}/></label>
  <label>Membership starts<input type="date" disabled={locked} value={joined} onChange={e=>{setJoined(e.target.value);setConfirmed(false)}}/></label>
  <label>Membership ends (first day they\'re no longer a member)<input type="date" disabled={locked} value={ends} onChange={e=>{setEnds(e.target.value);setConfirmed(false)}}/></label>
  <p>These dates apply only to people being added.</p>
  <div className="auth-actions"><button className={currentReview?'button button--secondary':'button'} disabled={locked||!enabled||!list.trim()||!joined||!ends||joined>=ends||draft?.state==='committed'} onClick={save}>Save draft</button><button className="button button--secondary" disabled={locked||!draft||draft.state!=='draft'||draft.stamp!==stamp} onClick={()=>void preview()}>Preview changes</button></div>
  {message?<p role="status">{message}</p>:null}{error?<p role="alert">{error}</p>:null}
  {pending?<button className="button" disabled={busy} onClick={()=>void execute(pending)}>Try again</button>:null}
  {currentReview&&!receipt?<section aria-label="Roster changes"><h3>Roster changes · {currentReview.termLabel} · {currentReview.listName}</h3>
   <p>New people are added as active members with the dates below. People already on the roster don\'t change.</p>
   <ol>{currentReview.rows.map(r=><li key={r.record}><h4>Row {r.record}: {r.operation==='create'?'Add to roster':'Already on the roster'}</h4><p>Source key {r.sourceKey}</p><dl><dt>Before</dt><dd>{r.before?`${r.before.name} · ${r.before.email} · active · ${formatDay(r.before.joinedAt)} – ${formatDay(r.before.endsAt)}`:'Not on the roster yet'}</dd><dt>After</dt><dd>{r.after.name} · {r.after.email} · active · {formatDay(r.after.joinedAt)} – {formatDay(r.after.endsAt)}</dd></dl>{r.errors.length?<ul role="alert">{r.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>:null}</li>)}</ol>
   {!currentReview.valid?<p>Fix every row error and save again. Partial imports aren\'t possible.</p>:null}
   <label className="csv-confirm"><input type="checkbox" checked={confirmed} disabled={locked||!currentReview.valid} onChange={e=>setConfirmed(e.target.checked)}/>I\'ve checked these people and their dates.</label>
  </section>:null}
  {currentReview||pending?<label>Reason for adding these people<input maxLength={1000} value={reason} disabled={locked} onChange={e=>setReason(e.target.value)}/></label>:null}
  {currentReview?<button className="button" disabled={locked||!currentReview.valid||!confirmed||!reason.trim()} onClick={commit}>Add to roster</button>:null}
  {receipt?<section aria-label="Import result"><h3>Added</h3><p>{receipt.created} added · {receipt.unchanged} already on the roster.</p><ul>{receipt.items.map(r=><li key={r.sourceKey}>{r.name} · {r.action==='create'?'Added':'Already on the roster'}</li>)}</ul></section>:null}
  <details><summary>Open a saved draft</summary><RefreshButton onRefresh={()=>void read()} disabled={locked}/><label>Saved draft<select aria-label="Saved draft" disabled={locked} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a saved draft</option>{drafts.map(d=><option key={d.draftId} value={d.draftId}>{d.listName} · {d.state} · version {d.version}</option>)}</select></label><button className="button button--secondary" disabled={locked||!selected} onClick={()=>void read(selected,true)}>Open this draft</button>{draft?<button className="button button--quiet" disabled={locked} onClick={()=>void read(draft.draftId)}>Check for changes (keeps your edits)</button>:null}</details>
  {draft?<button className="button button--secondary" disabled={locked} onClick={()=>{setDraft(null);setReview(null);setReceipt(null);setConfirmed(false);setReason('');setMessage('Starting a new draft. Use the same list name and source keys to avoid duplicates.')}}>Start another file</button>:null}
 </Panel>
}
