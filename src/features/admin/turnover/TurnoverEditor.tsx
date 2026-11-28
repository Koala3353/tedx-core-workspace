import {useId,useRef,type FormEvent} from 'react'
import {SearchSelect} from '../../../components/list'
import {Panel} from '../../../components/Page'
import {useFinDecision} from '../../finance/DecisionMemory'
import {formatDay} from '../../shared/dates'
import type {ArchivedCustody,TurnoverApi,TurnoverCommand,TurnoverSetup,TurnoverWorkspace} from './api'

export type TurnoverEdit={kind:'unit'|'obligation';id:string}|{kind:'transfer'|'nominate'|'prepare'|'freeze'|'archive'|'verify'|'complete'}|
  {kind:'acceptRecords'|'acceptCustody';id:string}|{kind:'custodyAction';id:string;action:'hold'|'release_hold'|'correction'}
export const categoryName=(v:string)=>({operational:'Regular work',restricted:'Restricted records',finance:'Budget',prism:'Check-ins (confidential)',security:'Security records',privacy:'Privacy records',profile:'Private profiles',guest:'Guest records',learning:'Learning records',backup:'Recovery records'}[v]??'Private records')
const labels:Record<TurnoverEdit['kind'],string>={unit:'Check committee',obligation:'Record item outcome',transfer:'Plan a handover',nominate:'Name a custodian for private records',prepare:'Start term handover',freeze:'Freeze the term',archive:'Export the archive',verify:'Check the archive',complete:'Complete handover',acceptRecords:'Accept records',acceptCustody:'Accept private records',custodyAction:'Save archive change'}
export function TurnoverEditor({api,term,workspace:w,setup,custody,edit,checking,refresh,saved,close}:{api:TurnoverApi;term:string;workspace:TurnoverWorkspace;setup:TurnoverSetup|null;custody:ArchivedCustody|null;edit:TurnoverEdit;checking:boolean;refresh:()=>void;saved:(message:string)=>void;close:()=>void}){
  const input=useId(),running=useRef(false),target='id'in edit?edit.id:w.case?.id??term
  const unit=w.units.find(u=>'id'in edit&&u.id===edit.id),work=w.work.find(x=>'id'in edit&&x.id===edit.id)
  const base=edit.kind==='custodyAction'?custody?.version??0:w.case?.version??0
  const m=useFinDecision(api,'turnover:'+term+':'+target+':'+edit.kind+('action'in edit?edit.action:''),{
    __base:String(base),__dirty:'',reference:'',owner:work?.owner??unit?.owner??'',successor:work?.successor??'',
    outcome:work?.state==='completed'?'resolved':work?.state==='cancelled'?'cancelled':'carry',approval:w.approvals[0]?.id??'',authority:'',reviewAt:'',hold:'',confirmed:'',
    ...Object.fromEntries([...w.work,...(setup?.privateRoots??[])].map(r=>['work_'+r.id,''])),
    ...Object.fromEntries(w.roles.map(r=>['role_'+r.id,''])),...Object.fromEntries(w.grants.map(g=>['grant_'+g.id,''])),
  })
  const f=m.fields,stale=Number(f.__base)!==base,run=w.runs.find(r=>r.restored)
  const change=(key:string,value:string)=>m.change({...f,...(key==='authority'?Object.fromEntries(Object.keys(f).filter(k=>k.startsWith('work_')).map(k=>[k,''])):{}),[key]:value,__dirty:'1'})
  const selected=(prefix:string)=>Object.entries(f).filter(([k,v])=>k.startsWith(prefix)&&v==='1').map(([k])=>k.slice(prefix.length))
  const authority=setup?.authorities.find(a=>a.id===f.authority)
  async function send(command?:TurnoverCommand){
    if(running.current)return;running.current=true
    try{const result=await m.run(command);if(result)saved(edit.kind==='acceptRecords'?'Records accepted.':edit.kind==='acceptCustody'?'Private records accepted.':'Saved.');else refresh()}
    finally{running.current=false}
  }
  function submit(e:FormEvent){
    e.preventDefault();if(checking||m.locked||stale)return
    const c=w.case,version=Number(f.__base),reference=f.reference
    if(edit.kind==='prepare')void send({kind:'prepare',term,approval:f.approval})
    else if(edit.kind==='unit'&&c)void send({kind:'update',caseId:c.id,version,action:'unit',values:{unit:edit.id,owner:f.owner,reference}})
    else if(edit.kind==='obligation'&&c&&work)void send({kind:'update',caseId:c.id,version,action:'obligation',values:{work:work.id,workVersion:work.version,owner:f.owner,resolution:f.outcome,successor:f.outcome==='carry'?f.successor:null,reference}})
    else if(edit.kind==='transfer'&&c)void send({kind:'update',caseId:c.id,version,action:'transfer',values:{successor:f.successor,work:selected('work_'),roles:selected('role_'),grants:selected('grant_'),reference}})
    else if(edit.kind==='nominate'&&c&&authority)void send({kind:'nominate',caseId:c.id,version,recipient:authority.recipient,category:authority.category,work:selected('work_'),authority:authority.id,expiresAt:authority.expiresAt,reference})
    else if((edit.kind==='freeze'||edit.kind==='archive')&&c)void send({kind:edit.kind,caseId:c.id,version})
    else if((edit.kind==='verify'||edit.kind==='complete')&&c&&w.runs[0])void send({kind:edit.kind,caseId:c.id,version,run:w.runs[0].id,reference})
    else if((edit.kind==='acceptRecords'||edit.kind==='acceptCustody')&&run)void send({kind:edit.kind,term,id:edit.id,run:run.id,reference})
    else if(edit.kind==='custodyAction'&&custody){
      const hold=custody.holds.find(h=>h.id===f.hold)
      const values:Record<string,string|number>=edit.action==='release_hold'?{hold:f.hold,holdVersion:hold?.version??0}:edit.action==='hold'?{work:f.successor,reviewAt:new Date(f.reviewAt+':00+08:00').toISOString()}:{work:f.successor}
      void send({kind:'custodyAction',term,id:edit.id,version,action:edit.action,values,reference})
    }
  }
  const choice=(key:string,label:string,options:{id:string;name:string}[])=> <div className="form-field"><label htmlFor={input+key}>{label}</label>{options.length>12?<SearchSelect id={input+key} required value={f[key]} onChange={value=>change(key,value)} placeholder={'Type to find '+label.toLowerCase()} options={options.map(o=>({value:o.id,label:o.name}))}/>:<select id={input+key} required value={f[key]} onChange={e=>change(key,e.target.value)}><option value="">Choose {label.toLowerCase()}</option>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>}</div>
  const checks=(prefix:string,items:{id:string;name:string}[])=>items.map(r=><label className="turnover-check" key={r.id}><input type="checkbox" checked={f[prefix+r.id]==='1'} onChange={e=>change(prefix+r.id,e.target.checked?'1':'')}/><span>{r.name}</span></label>)
  const requiresNote=!['prepare','freeze','archive','verify'].includes(edit.kind)
  return <Panel title={labels[edit.kind]}>
    {m.error?<p role="alert">{m.error}</p>:null}
    {m.pending?<><p role="status">We couldn't confirm this was saved. Try again before changing anything; it won't save twice.</p><button className="button" disabled={checking||m.busy} onClick={()=>void send()}>Try again</button></>:null}
    {stale&&!m.pending?<div role="alert"><p>Someone changed the handover. Your entries are kept. Check the latest checklist before sending.</p><button className="button button--secondary" onClick={()=>m.change({...f,__base:String(base)})}>Keep my entries</button></div>:null}
    <form onSubmit={submit} data-unsaved-changes={f.__dirty==='1'} data-pending-command={m.locked}><fieldset disabled={checking||m.locked||stale}>
      {edit.kind==='prepare'?choice('approval','Approval',w.approvals.map(a=>({id:a.id,name:a.reference+' · '+(a.scope==='synthetic'?'Practice run':'Real handover')}))):null}
      {edit.kind==='unit'||edit.kind==='obligation'?<><p>{unit?.name??work?.reference??work?.title}</p>{choice('owner','Responsible person',w.people)}</>:null}
      {edit.kind==='obligation'?<>
        {choice('outcome','Outcome',work?.state==='completed'?[{id:'resolved',name:'Done'}]:work?.state==='cancelled'?[{id:'cancelled',name:'Cancelled'}]:[{id:'carry',name:'Carry over to next term (successor must accept)'}])}
        {f.outcome==='carry'?choice('successor','Successor',w.successors.map(p=>({id:p.id,name:p.name+' · '+p.term}))):null}
      </>:null}
      {edit.kind==='transfer'?<>
        <p>The successor will be able to read the records you pick. The access you pick below is removed once they accept. Private records need their own custodian.</p>
        {choice('successor','Successor',w.successors.map(p=>({id:p.id,name:p.name+' · '+p.term})))}
        <fieldset><legend>Records</legend>{checks('work_',w.work.filter(x=>x.transferable).map(x=>({id:x.id,name:(x.reference?x.reference+' · ':'')+x.title})))}</fieldset>
        <details><summary>Access to remove from outgoing members</summary><fieldset><legend>Roles</legend>{checks('role_',w.roles)}</fieldset><fieldset><legend>Record access</legend>{checks('grant_',w.grants)}</fieldset></details>
      </>:null}
      {edit.kind==='nominate'?<>
        <p>The custodian can place holds and add corrections, but can't open Budget, evaluation or file contents. They need the right role in next term first.</p>
        {choice('authority','Incoming custodian',setup?.authorities.map(a=>({id:a.id,name:a.name+' · '+categoryName(a.category)}))??[])}
        {!setup?.authorities.length?<p>No one is eligible yet. Start next term and give someone the custodian role in Administration, then come back.</p>:null}
        {authority?<fieldset><legend>Records for {categoryName(authority.category)}</legend>{checks('work_',authority.category==='prism'?(setup?.privateRoots??[]).map(r=>({id:r.id,name:r.reference})):w.work.filter(x=>x.classification===authority.category).map(x=>({id:x.id,name:(x.reference?x.reference+' · ':'')+x.title})))}</fieldset>:null}
      </>:null}
      {edit.kind==='freeze'?<p>Freezing stops normal edits to this term. Every committee and item needs an outcome first.</p>:null}
      {edit.kind==='archive'?<p>This starts or resumes the archive export. The archive operator then exports records and files and test-restores them before the archive can be checked.</p>:null}
      {edit.kind==='verify'?<p>Checks the exported files and test restore. It fails if any record is missing or changed.</p>:null}
      {edit.kind==='complete'?<p>Do this once every successor and custodian has accepted. It archives the term and removes the outgoing access you picked.</p>:null}
      {edit.kind==='acceptRecords'?<p>By accepting, you take responsibility for these records and any carried-over work.</p>:null}
      {edit.kind==='acceptCustody'?<p>By accepting, you agree to manage holds and corrections for these private records until the end date. You won't see their contents.</p>:null}
      {edit.kind==='custodyAction'&&custody?<>
        {edit.action==='release_hold'&&!custody.holds.length?<p>There are no active holds to release.</p>:null}
        {edit.action==='release_hold'?choice('hold','Hold to release',custody.holds.map(h=>({id:h.id,name:(w.custody.find(n=>n.id===edit.id)?.records.find(r=>r.id===h.objectId)?.reference??'Record')+' · Review '+formatDay(h.reviewAt)}))):choice('successor','Record',(w.custody.find(n=>n.id===edit.id)?.records??[]).map((r,i)=>({id:r.id,name:r.reference??'Record '+(i+1)})))}
        {edit.action==='hold'?<div className="form-field"><label htmlFor={input+'date'}>Review date and time</label><input id={input+'date'} type="datetime-local" required value={f.reviewAt} onChange={e=>change('reviewAt',e.target.value)}/></div>:null}
        <p>The original record doesn't change. Add the approval reference for this {edit.action==='release_hold'?'hold release':edit.action==='hold'?'hold':'correction'}.</p>
      </>:null}
      {requiresNote?<div className="form-field"><label htmlFor={input+'note'}>Note or approval reference</label><textarea id={input+'note'} minLength={3} maxLength={500} required value={f.reference} onChange={e=>change('reference',e.target.value)}/></div>:null}
      {['freeze','complete','acceptRecords','acceptCustody'].includes(edit.kind)?<label className="turnover-check"><input type="checkbox" required checked={f.confirmed==='1'} onChange={e=>change('confirmed',e.target.checked?'1':'')}/><span>I've checked this and understand what happens next.</span></label>:null}
      <div className="auth-actions"><button className="button" type="submit" disabled={edit.kind==='nominate'&&(!authority||!selected('work_').length)||edit.kind==='transfer'&&!selected('work_').length||edit.kind==='custodyAction'&&edit.action==='release_hold'&&!custody?.holds.length}>{labels[edit.kind]}</button><button className="button button--secondary" type="button" onClick={close}>Cancel</button></div>
    </fieldset></form>
  </Panel>
}
