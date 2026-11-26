import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router'
import {Panel} from '../../components/Page'
import {RefreshButton} from '../shared/RefreshButton'
import {formatDateTime,formatDay} from '../shared/dates'
import type {ImportInput,ImportPreview,ImportRead,ImportReceipt,ImportRef,TaskImportsApi} from './task-import-api'

type Pending={run:()=>Promise<void>}
const signature=(unit:string,list:string,input:ImportInput)=>JSON.stringify({unit,list,input:{header:input.header,rows:input.rows,mapping:Object.fromEntries(Object.entries(input.mapping).sort(([a],[b])=>a.localeCompare(b)))}})
export function TaskImportPanel({api,term,input,enabled,onLoad,onDenied,onLockChange}:{api:TaskImportsApi;term:string;input:ImportInput;enabled:boolean;onLoad:(value:ImportRead['draft'])=>void;onDenied:()=>void;onLockChange:(locked:boolean)=>void}){
 const [units,setUnits]=useState<ImportRead['units']>([]),[drafts,setDrafts]=useState<ImportRead['drafts']>([]),[selected,setSelected]=useState(''),[unit,setUnit]=useState(''),[list,setList]=useState('')
 const [draft,setDraft]=useState<(ImportRef&{stamp:string})|null>(null),[review,setReview]=useState<{value:ImportPreview;stamp:string}|null>(null),[receipt,setReceipt]=useState<ImportReceipt|null>(null)
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[pending,setPending]=useState<Pending|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),epoch=useRef(0)
 const callbacks=useRef({onDenied,onLoad,onLockChange});callbacks.current={onDenied,onLoad,onLockChange}
 const stamp=signature(unit,list,input),currentReview=review?.stamp===stamp?review.value:null,locked=busy||!!pending
 function problem(e:unknown){const kind=(e as{kind?:string}).kind
  if(kind==='denied'){setReview(null);setReceipt(null);setDraft(null);setDrafts([]);setUnits([]);setUnit('');setList('');setSelected('');callbacks.current.onDenied();return 'You no longer have permission to import here, so your saved review was cleared.'}
  return kind==='conflict'?'The saved draft changed. Check the saved version, then save and preview again. Your edits are kept.':kind==='validation'?'Some rows or columns aren\'t valid. Fix them and save again. Your edits are kept.':'Couldn\'t connect. Your input is kept. Try again.'
 }
 async function read(id?:string,replace=false){const seq=++epoch.current;setBusy(true);setError('');if(replace)callbacks.current.onLockChange(true)
  try{const data=await api.read(term,id);if(seq!==epoch.current)return;setUnits(data.units);setDrafts(data.drafts)
   if(data.draft){const d=data.draft;setDraft({...d,stamp:signature(d.unitId,d.listName,d.input)});setReceipt(d.receipt);setReview(null);setConfirmed(false)
    if(replace){setUnit(d.unitId);setList(d.listName);callbacks.current.onLoad(d)}
   }
  }catch(e){if(seq===epoch.current)setError(problem(e))}finally{if(seq===epoch.current){setBusy(false);if(replace)callbacks.current.onLockChange(false)}}
 }
 useEffect(()=>{void read();return()=>{epoch.current++}},[api,term]) // Reads never submit CSV or replace entered input automatically.
 async function execute(action:Pending){const seq=++epoch.current;setPending(action);setBusy(true);setError('');callbacks.current.onLockChange(true)
  try{await action.run();if(seq!==epoch.current)return;setPending(null);callbacks.current.onLockChange(false)}catch(e){if(seq!==epoch.current)return
   setReview(null);setConfirmed(false)
   if((e as{kind?:string}).kind==='connection')setError('We couldn\'t confirm this went through. Choose Try again; it won\'t create duplicates.')
   else{setPending(null);callbacks.current.onLockChange(false);setError(problem(e))}
  }finally{if(seq===epoch.current)setBusy(false)}
 }
 function save(){const data=structuredClone(input),id=draft?.draftId??null,version=draft?.version??0,key=crypto.randomUUID(),savedStamp=stamp
  void execute({run:async()=>{const d=await api.save(term,unit,list,data,id,version,key);setDraft({...d,stamp:savedStamp});setReview(null);setReceipt(null);setConfirmed(false);setMessage('Draft saved. Preview the changes before importing.')}})
 }
 async function preview(){if(!draft)return;const seq=++epoch.current;setBusy(true);setReview(null);setConfirmed(false);setError('');const savedStamp=stamp
  try{const v=await api.preview(draft.draftId,draft.version);if(seq===epoch.current)setReview({value:v,stamp:savedStamp})}catch(e){if(seq===epoch.current)setError(problem(e))}finally{if(seq===epoch.current)setBusy(false)}
 }
 function commit(){if(!draft||!currentReview?.valid||!confirmed)return;const id=draft.draftId,version=draft.version,hash=currentReview.reviewHash,key=crypto.randomUUID()
  void execute({run:async()=>{const result=await api.commit(term,id,version,hash,key);setReceipt(result);setDraft({...result,stamp});setReview(null);setMessage('Tasks imported.')}})
 }
 return <Panel title="3. Save and import tasks">
  <p>Import up to 50 tasks at a time. Either every row is imported or none are.</p>
  <details><summary>Import rules</summary><p>Use the same committee, list name and source keys (case matters) when you import again. A blank person on a new task assigns it to you. Blank dates or people on existing tasks leave them unchanged. Only the title and date of To do tasks can be updated here; change assignees and timed deadlines on the task page.</p></details>
  <label>Import committee<select aria-label="Import committee" disabled={locked||!!draft} value={unit} onChange={e=>{setUnit(e.target.value);setReview(null);setConfirmed(false)}}><option value="">Choose a committee</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
  <label>List name (use the same one when you retry)<input maxLength={80} value={list} disabled={locked||!!draft} onChange={e=>{setList(e.target.value);setReview(null);setConfirmed(false)}}/></label>
  <div className="auth-actions"><button className={currentReview?'button button--secondary':'button'} disabled={locked||!enabled||!unit||!list.trim()||draft?.state==='committed'} onClick={save}>Save draft</button><button className="button button--secondary" disabled={locked||!draft||draft.state!=='draft'||draft.stamp!==stamp} onClick={()=>void preview()}>Preview changes</button></div>
  {message?<p role="status">{message}</p>:null}{error?<p role="alert">{error}</p>:null}
  {pending?<button className="button" disabled={busy} onClick={()=>void execute(pending)}>Try again</button>:null}
  {currentReview&&!receipt?<section aria-label="Changes to import"><h3>Changes to import · {currentReview.unitName} · {currentReview.listName}</h3><p>New tasks start with no description or checklist. Existing tasks keep everything except the title and date shown below.</p>
   <ol>{currentReview.rows.map(r=><li key={r.record}><h4>Row {r.record}: {r.operation}</h4><p>{r.reference??'Reference given on import'} · source key {r.sourceKey}</p><dl><dt>Title</dt><dd>{r.before?`${r.before.title} → `:''}{r.after.title}</dd><dt>Person responsible</dt><dd>{r.after.assignee??'Not found'}</dd><dt>Due date</dt><dd>{r.before?`${r.before.dueOn?formatDay(r.before.dueOn):formatDateTime(r.before.dueAt)} → `:''}{r.after.dueOn?formatDay(r.after.dueOn):formatDateTime(r.after.dueAt)}</dd></dl>{r.errors.length?<ul role="alert">{r.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>:null}</li>)}</ol>
   {!currentReview.valid?<p>Fix every row error and save the draft again. Partial imports aren't possible.</p>:null}
   <label className="csv-confirm"><input type="checkbox" checked={confirmed} disabled={locked||!currentReview.valid} onChange={e=>setConfirmed(e.target.checked)}/>I've checked these changes.</label><button className="button" disabled={locked||!currentReview.valid||!confirmed} onClick={commit}>Import tasks</button>
  </section>:null}
  {receipt?<section aria-label="Import result"><h3>Imported</h3><p>{receipt.created} created · {receipt.updated} updated · {receipt.unchanged} unchanged.</p><ul>{receipt.items.map(r=><li key={r.sourceKey}><Link to={r.href}>{r.title} · {r.reference}</Link></li>)}</ul></section>:null}
  <details><summary>Open a saved draft</summary><RefreshButton onRefresh={()=>void read()} disabled={locked}/><label>Saved draft<select aria-label="Saved draft" disabled={locked} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a saved draft</option>{drafts.map(d=><option key={d.draftId} value={d.draftId}>{d.listName} · {d.state} · version {d.version}</option>)}</select></label><button className="button button--secondary" disabled={locked||!selected} onClick={()=>void read(selected,true)}>Open this draft</button>{draft?<button className="button button--quiet" disabled={locked} onClick={()=>void read(draft.draftId)}>Check for changes (keeps your edits)</button>:null}</details>
  {draft?<button className="button button--secondary" disabled={locked} onClick={()=>{setDraft(null);setReview(null);setReceipt(null);setConfirmed(false);setMessage('Starting a new draft. Use the same list name and source keys to avoid duplicates.')}}>Start another file</button>:null}
 </Panel>
}
