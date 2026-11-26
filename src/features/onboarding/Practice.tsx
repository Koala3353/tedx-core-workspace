import {useState} from 'react'
import {Panel} from '../../components/Page'
import {TextField} from '../../components/TextField'
import {formatDay} from '../shared/dates'
// Deliberately accepts no API, callback, work ID, upload or production request payload.
export function Practice(){
 const[title,setTitle]=useState(''),[date,setDate]=useState(''),[scope,setScope]=useState(''),[result,setResult]=useState(''),[draft,setDraft]=useState<{kind:string;title:string;date:string;scope:string}|null>(null)
 function tryDraft(kind:'task'|'request'){
  if(!title.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||!scope.trim()){setResult('Fill in a made-up title, date and description.');setDraft(null);return}
  setDraft({kind,title:title.trim(),date,scope:scope.trim()});setResult('Practice only. Nothing real was created.')
 }
 return <Panel title="Practice safely"><p>Use made-up details. Nothing here is saved, and it clears when you leave.</p><TextField id="practice-title" label="Practice title" value={title} onChange={e=>setTitle(e.target.value)} maxLength={240}/><TextField id="practice-date" label="Practice date" type="date" value={date} onChange={e=>setDate(e.target.value)}/><TextField id="practice-scope" label="What counts as done, or what you need" value={scope} onChange={e=>setScope(e.target.value)} maxLength={1000}/><div className="auth-actions"><button className="button button--secondary" onClick={()=>tryDraft('task')}>Try practice task</button><button className="button button--secondary" onClick={()=>tryDraft('request')}>Try practice request</button></div><p role="status">{result}</p>{draft?<div className="resource-article"><h3>Practice {draft.kind}: {draft.title}</h3><p>Owner: you (practice only) · Proposed date: {formatDay(draft.date)}</p><p className="resource-body">{draft.scope}</p>{draft.kind==='request'?<p>For a real request: find the right committee under Ask a committee. Anything involving money, even at zero cost, needs Budget approval. Public posts need Publicity sign-off.</p>:<p>For a real task: agree on who does it, the date and what counts as done. You stay responsible until someone accepts the handoff.</p>}</div>:null}</Panel>
}
