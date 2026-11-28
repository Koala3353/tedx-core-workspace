import {useId,useRef,type FormEvent} from 'react'
import {Panel} from '../../components/Page'
import {useFinDecision} from '../finance/DecisionMemory'
import {forgetRecordDrafts} from '../auth/draftScope'
import {PersonPicker,personOptions} from '../../components/list'
import {labelPeople,usePeopleOptions} from '../people/peopleOptions'
import type {EvaluationCommand,EvaluationRecord,EvaluationsApi,EvaluationSetup} from './api'

export type EvaluationEdit={kind:'submit'|'note'|'prepareRelease';record:EvaluationRecord}|
  {kind:'publishRelease';record:EvaluationRecord;draft:EvaluationRecord['releaseDrafts'][number]}|
  {kind:'grantExport';caseRecord:EvaluationSetup['rounds'][number]['cases'][number];people:EvaluationSetup['people']}
const title={submit:'Your feedback',note:'Add a reviewer note',prepareRelease:'Write a summary',
  publishRelease:'Review and release summary',grantExport:'Approve a download'}

export function EvaluationEditor({api,term,edit,checking,refresh,saved,close}:{api:EvaluationsApi;term:string;edit:EvaluationEdit;
  checking:boolean;refresh:()=>void;saved:(notice:string)=>void;close:()=>void}){
  const r='record'in edit?edit.record:null,own=r?.submissions.find(s=>s.own)
  const people=usePeopleOptions(term).people
  const id=useId(),running=useRef(false),caseId=r?.caseId??('caseRecord'in edit?edit.caseRecord.id:'')
  const version=edit.kind==='submit'?own?.revision??0:edit.kind==='publishRelease'?edit.draft.version:r?.version??('caseRecord'in edit?edit.caseRecord.version:0)
  const initial={...Object.fromEntries(r?.template.map(p=>['answer_'+p.key,own?.answers?.[p.key]??''])??[]),
    __base:String(version),__dirty:'',body:'',member:'',purpose:'',expires:''}
  const m=useFinDecision(api,'prism:'+term+':'+caseId+':'+edit.kind,initial)
  const fields=m.fields,stale=Number(fields.__base)!==version
  const changed=(key:string,value:string)=>m.change({...fields,[key]:value,__dirty:'1'})
  async function send(command?:EvaluationCommand){
    if(running.current)return
    running.current=true
    try{const result=await m.run(command);if(result)saved(edit.kind==='submit'?'Feedback saved.':
      edit.kind==='note'?'Reviewer note saved.':edit.kind==='prepareRelease'?'Summary saved. Another reviewer needs to release it.':
      edit.kind==='publishRelease'?'Summary released.':'Download approved.');else refresh()}
    finally{running.current=false}
  }
  function submit(e:FormEvent){
    e.preventDefault();if(m.locked||checking||stale)return
    const base=Number(fields.__base)
    if(edit.kind==='submit'&&r)void send({term,kind:'submit',caseId,revision:base,withdraw:false,
      answers:Object.fromEntries(r.template.map(p=>[p.key,fields['answer_'+p.key]??'']))})
    else if(edit.kind==='note')void send({term,kind:'note',caseId,version:base,body:fields.body})
    else if(edit.kind==='prepareRelease'&&r)void send({term,kind:'prepareRelease',caseId,version:base,subject:r.subjectId,summary:fields.body})
    else if(edit.kind==='publishRelease'&&r)void send({term,kind:'publishRelease',draft:edit.draft.id,version:base,subject:r.subjectId})
    else if(edit.kind==='grantExport'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fields.expires)){
      const expiry=new Date(fields.expires+':00+08:00')
      if(Number.isFinite(expiry.getTime()))void send({term,kind:'grantExport',caseId,version:base,member:fields.member,
        expiresAt:expiry.toISOString(),purposeReference:fields.purpose})
    }
  }
  return <Panel title={title[edit.kind]}>
    {r?<p><strong>{r.subject}</strong> · {r.round}</p>:null}
    {m.error?<p role="alert">{m.error}</p>:null}
    {m.pending?<p role="status">We couldn't confirm this was saved. Check before making changes.</p>:null}
    {m.pending?<button className="button" disabled={checking||m.busy} onClick={()=>void send()}>Check and retry</button>:null}
    {stale&&!m.pending?<div role="alert"><p>This record changed since you opened it. What you typed is kept. Check the latest version before sending.</p>
      <button className="button button--secondary" onClick={()=>m.change({...fields,__base:String(version)})}>Keep my text and continue</button></div>:null}
    <form onSubmit={submit} data-unsaved-changes={fields.__dirty==='1'} data-pending-command={m.locked}>
      <fieldset disabled={m.locked||stale||checking}>
        {edit.kind==='submit'&&r?<><p>Saving creates a new version. Earlier versions are kept. Reviewers can see your name.</p>
          {r.template.map(p=><div className="form-field" key={p.key}><label htmlFor={id+p.key}>{p.label}{p.required?'':' (optional)'}</label>
            <textarea id={id+p.key} value={fields['answer_'+p.key]??''} required={p.required} maxLength={p.maxLength}
              onChange={e=>changed('answer_'+p.key,e.target.value)}/></div>)}</>:null}
        {edit.kind==='note'||edit.kind==='prepareRelease'?<div className="form-field">
          <p>{edit.kind==='note'?'Your name is shown on this note. The person being reviewed doesn\'t see it.':
            'Write a summary for the person being reviewed. Leave out other people\'s names and private details. Another reviewer checks it before release.'}</p>
          <label htmlFor={id+'body'}>{edit.kind==='note'?'Reviewer note':'Summary'}</label>
          <textarea id={id+'body'} required maxLength={edit.kind==='note'?4000:6000} value={fields.body} onChange={e=>changed('body',e.target.value)}/>
        </div>:null}
        {edit.kind==='publishRelease'?<><p>Release this summary to <strong>{edit.record.subject}</strong>. They won't see the individual feedback or reviewer notes.</p>
          <p className="record-text">{edit.draft.summary}</p><p>Check it's the right person and that it doesn't reveal anything about anyone else.</p></>:null}
        {edit.kind==='grantExport'?<>
          <p>The person you choose can download their own view of this record. They're responsible for keeping the copy private.</p>
          <div className="form-field"><label htmlFor={id+'member'}>Who can download</label><PersonPicker id={id+'member'} value={fields.member} required onChange={value=>changed('member',value)}
            emptyText="No one matches. Only people assigned to this record are listed."
            options={personOptions(labelPeople(edit.people.filter(p=>edit.caseRecord.assignments.some(a=>a.memberId===p.id&&a.active)),people,'membershipId'))}/></div>
          <div className="form-field"><label htmlFor={id+'purpose'}>Reason for the download</label><input id={id+'purpose'} required minLength={3} maxLength={500} value={fields.purpose} onChange={e=>changed('purpose',e.target.value)}/></div>
          <div className="form-field"><label htmlFor={id+'expires'}>Available until (Manila time)</label><input id={id+'expires'} type="datetime-local" required value={fields.expires} onChange={e=>changed('expires',e.target.value)}/></div>
        </>:null}
        <button className="button">{edit.kind==='submit'?'Save feedback':edit.kind==='note'?'Save note':
          edit.kind==='prepareRelease'?'Save summary':edit.kind==='publishRelease'?'Release this summary':'Approve download'}</button>
      </fieldset>
    </form>
    <button className="button button--secondary" disabled={m.locked} onClick={()=>{
      if(fields.__dirty==='1'&&!window.confirm('Discard these unsaved entries?'))return
      forgetRecordDrafts(caseId);close()
    }}>Close</button>
  </Panel>
}

export function EvaluationAction({api,id,command,label,notice,checking,saved,refresh,confirm}:{api:EvaluationsApi;id:string;
  command:EvaluationCommand;label:string;notice:string;checking:boolean;saved:(notice:string)=>void;refresh:()=>void;confirm?:string}){
  const m=useFinDecision(api,'prism:'+command.term+':'+id+':'+command.kind,{})
  const running=useRef(false)
  async function act(){
    if(running.current||!m.pending&&confirm&&!window.confirm(confirm))return
    running.current=true
    try{const result=await m.run(command);if(result)saved(notice);else refresh()}
    finally{running.current=false}
  }
  return <>{m.error?<p role="alert">{m.error}</p>:null}<button className="button button--secondary" disabled={checking||m.busy}
    onClick={()=>void act()}>{m.pending?'Check and retry':label}</button></>
}
