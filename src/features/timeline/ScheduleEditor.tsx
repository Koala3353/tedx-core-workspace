import {useEffect,useRef,useState,type FormEvent} from 'react'
import {LoadingState} from '../../components/FeedbackState'
import {displayEndDay} from './dates'
import type {TimelineApi,ScheduleContext} from './api'
import './timeline.css'
import {useScheduleDrafts} from './ScheduleDrafts'
import {RefreshButton} from '../shared/RefreshButton'
import {formatDay} from '../shared/dates'
export function ScheduleEditor({api,id,disabled=false,onPendingChange}:{api:TimelineApi;id:string;disabled?:boolean;onPendingChange?:(pending:boolean)=>void}){
 const[context,setContext]=useState<ScheduleContext|null>(),[draft,setDraft]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false)
 const drafts=useScheduleDrafts(),initialized=useRef(false),pending=useRef<{start:string|null;version:number;key:string}|null>(null)
 useEffect(()=>{onPendingChange?.(busy||uncertain);return()=>onPendingChange?.(false)},[busy,uncertain,onPendingChange])
 useEffect(()=>{let live=true;void api.context(id).then(c=>{if(live){setContext(c);if(c&&!initialized.current){const saved=drafts?.get(id);setDraft(saved?.value??c.plannedStartOn??'');if(saved){setContext({...c,version:saved.base.version,plannedStartOn:saved.base.plannedStartOn});pending.current=saved.pending;setUncertain(saved.pending!==null)}initialized.current=true}else if(c){drafts?.set(id,{value:draft,base:c,pending:pending.current})}if(!c){setDraft('');pending.current=null;setUncertain(false);drafts?.delete(id)}}}).catch(()=>{if(live){setContext(undefined);setError('Couldn\'t load the start date. Use the refresh button to try again. What you typed is kept.')}});return()=>{live=false}},[api,id,reload,drafts])
 async function save(event?:FormEvent){event?.preventDefault();if(!context||disabled)return;const p=pending.current??{start:draft||null,version:context.version,key:crypto.randomUUID()};pending.current=p;drafts?.set(id,{value:draft,base:context,pending:p});setBusy(true);setError('');setNotice('');const r=await api.save(id,p.start,p.version,p.key);setBusy(false)
 if(!r.ok){setError(r.error.message);setUncertain(r.error.retryable);if(!r.error.retryable){pending.current=null;drafts?.set(id,{value:draft,base:context,pending:null})}if(r.error.kind==='permission_denied'){setContext(null);drafts?.delete(id)}return}
 const saved={...context,version:r.value.version,plannedStartOn:p.start};pending.current=null;drafts?.set(id,{value:draft,base:saved,pending:null});setUncertain(false);setContext(saved);setNotice('Start date saved. Your other unsaved edits are kept.')}
 function refresh(){drafts?.delete(id);setContext(undefined);setError('');setNotice('');setReload(n=>n+1)}
 function change(value:string){setDraft(value);if(context)drafts?.set(id,{value,base:context,pending:pending.current})}
 return <section className="schedule-editor" aria-label="Start date"><h3>Start date</h3><p>When work on this begins. This sets where it starts on the timeline.</p>
 {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
 {context===undefined?!error?<LoadingState title="Loading start date"/>:null:context===null?<p>You can't change the start date here.</p>:<><p>Saved start: {formatDay(context.plannedStartOn)}</p>{context.canSchedule?<form onSubmit={save}><fieldset disabled={disabled||busy||uncertain}><div className="form-field"><label htmlFor={'start-'+id}>Start date</label><input id={'start-'+id} type="date" min="0001-01-01" max={displayEndDay(context.dueOn,context.dueAt)??'9999-12-31'} value={draft} onChange={e=>change(e.target.value)}/><p className="field-hint">Optional. Without a due date it won't show on the chart. Save it separately from other edits.</p></div><button className="button button--secondary" disabled={draft===(context.plannedStartOn??'')} type="submit">{busy?'Saving…':'Save start date'}</button></fieldset></form>:<p>You can't change the start date for this item.</p>}</>}
 {uncertain?<button className="button" disabled={!context||busy||disabled} onClick={()=>void save()}>Retry</button>:null}
 <RefreshButton disabled={busy||uncertain||disabled} onRefresh={refresh}/></section>
}
