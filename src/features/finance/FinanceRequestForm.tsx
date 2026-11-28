import {useState} from 'react'
import {PersonPicker,SearchSelect} from '../../components/list'
import {Link} from 'react-router'
import {Panel} from '../../components/Page'
import {TextField} from '../../components/TextField'
import {FormRenderer} from '../forms/FormRenderer'
import {useFormDrafts} from '../forms/Drafts'
import {validDate} from '../forms/validation'
import {calculatePlan,showPhp,type PlanDraft,type PlanKind} from './intake'
import type {FinanceIntake} from './api'
import type {useFinanceMemory} from './Memory'
import {HowThisWorks} from '../shared/HowThisWorks'

export function FinanceRequestForm({data,m,refresh}:{data:FinanceIntake;m:ReturnType<typeof useFinanceMemory>;refresh:()=>void}){
 const r=data.request,d=m.fields.plan,c=calculatePlan(d),[attempted,setAttempted]=useState(false),drafts=useFormDrafts(),draftKey='finance-envelope:'+r.id+':'+r.formVersionId;
 const set=(plan:PlanDraft)=>m.change({...m.fields,plan});const error=(key:string)=>attempted||key.startsWith('lines.')?c.errors[key]:undefined;
 const input=(key:'purpose'|'fundSource'|'termsRisks'|'price'|'forecastQuantity'|'plannedOn',label:string,maxLength:number,required=true)=><TextField id={'finance-'+key} label={label} required={required} maxLength={maxLength} disabled={m.locked} value={d[key]} error={error(key)} onChange={e=>set({...d,[key]:e.target.value})}/>;
 const definition={...r.form,fields:r.form.fields.filter(f=>f.key!=='requested_centavos')};
 return <>
 <Panel title="Plan details"><p>What you type is kept while you work here. Reloading the browser or signing out clears anything not yet submitted.</p>
 <fieldset disabled={m.locked} className="finance-fields"><legend>Finance plan</legend>
 <TextField id="finance-title" label="Plan title" required maxLength={240} value={m.fields.title} onChange={e=>m.change({...m.fields,title:e.target.value})}/>
 <div className="form-field"><label htmlFor="finance-kind">Plan type</label><select id="finance-kind" value={d.kind} onChange={e=>set({...d,kind:e.target.value as PlanKind})}>{(['cost','budget','expense','reimbursement','fundraising','sales']as const).map(k=><option key={k} value={k}>{k[0].toUpperCase()+k.slice(1)}</option>)}</select></div>
 {input('purpose','Plan purpose',2000)}{input('fundSource','Fund source',500)}
 <div className="form-field"><label htmlFor="finance-beneficiary">Beneficiary (required)</label><PersonPicker id="finance-beneficiary" value={d.beneficiaryMemberId} onChange={value=>set({...d,beneficiaryMemberId:value})} options={(data.options?.members??[]).map(v=>({value:v.id,label:v.label}))}/>{error('beneficiaryMemberId')?<p role="alert">{error('beneficiaryMemberId')}</p>:null}</div>
 <div className="form-field"><label htmlFor="finance-deliverable">Related deliverable (optional)</label><SearchSelect id="finance-deliverable" value={d.relatedDeliverableId} onChange={value=>set({...d,relatedDeliverableId:value})} placeholder="Type a deliverable" options={[{value:'',label:'No linked deliverable'},...data.deliverables.map(v=>({value:v.id,label:v.label}))]}/><p>Shows up to 100 deliverables you can see.</p></div>
 {input('plannedOn','Planned date (YYYY-MM-DD)',10,false)}
 <TextField id="finance-requested-on" label="Requested service date" type="date" value={m.fields.requestedOn} min="0001-01-01" max="9999-12-31" hint="The date you'd like. The committee confirms the final date." onChange={e=>m.change({...m.fields,requestedOn:e.target.value})}/>
 {input('termsRisks','Terms, risks and school approval requirements',4000)}
 </fieldset></Panel>
 <Panel title="Itemized requested costs"><p>Amounts in PHP. Quantities can have up to three decimal places.</p>
 {d.lines.map((l,i)=><fieldset key={i} disabled={m.locked} className="finance-line"><legend>Cost line {i+1}</legend><div className="finance-line-fields">
 {(['description','quantity','amount']as const).map(k=><TextField key={k} id={'finance-line-'+i+'-'+k} label={(k==='amount'?'Unit amount (PHP)':k==='quantity'?'Quantity':'Item description')+' · line '+(i+1)} required maxLength={k==='description'?500:24} inputMode={k==='description'?'text':'decimal'} value={l[k]} error={error('lines.'+i+'.'+k)} onChange={e=>set({...d,lines:d.lines.map((line,j)=>i===j?{...line,[k]:e.target.value}:line)})}/>)}</div>
 <p aria-live="polite">Line total: {c.lineTotals[i]===null?'Enter a quantity and unit amount.':showPhp(c.lineTotals[i]!)}</p><button type="button" className="button button--secondary" disabled={m.locked||d.lines.length===1} onClick={()=>set({...d,lines:d.lines.filter((_,j)=>j!==i)})}>Remove cost line {i+1}</button></fieldset>)}
 <button type="button" className="button button--secondary" disabled={m.locked||d.lines.length>=100} onClick={()=>set({...d,lines:[...d.lines,{description:'',quantity:'1',amount:''}]})}>Add cost line</button>
 <p role="status">Requested total: {c.total===null?'Incomplete. Check each cost line.':showPhp(c.total)}</p>{c.errors.lines?<p role="alert">{c.errors.lines}</p>:null}
 </Panel>
 {d.kind==='sales'||d.kind==='fundraising'?<Panel title="Forecast only"><fieldset disabled={m.locked}><legend>Pricing and forecast</legend>{input('price','Unit price (PHP)',24)}{input('forecastQuantity','Forecast quantity',24)}<p role="status">Forecast revenue: {c.revenue===null?'Incomplete. Check the price and quantity.':showPhp(c.revenue)}</p>{c.revenue!==null&&c.total!==null?<p>Forecast margin: {(BigInt(c.revenue)-BigInt(c.total)).toString().startsWith('-')?'-'+showPhp((BigInt(c.total)-BigInt(c.revenue)).toString()):showPhp((BigInt(c.revenue)-BigInt(c.total)).toString())}</p>:null}<p>A forecast isn't actual revenue. Zero-cost fundraising still needs FIN review.</p></fieldset></Panel>:null}
 <Panel title="Requirements and submission"><p>{data.processNote}</p><p><Link to={'/requests/services/'+r.typeId}>Current service requirements</Link></p><HowThisWorks><p>Check with FIN which school approvals and evidence you need. Uploading evidence or submitting a plan isn't school approval.</p><p>Spending needs FIN approval first. The amount FIN approves can differ from what you ask for.</p></HowThisWorks>
 <label><input type="checkbox" disabled={m.locked} checked={m.fields.ack} onChange={e=>m.change({...m.fields,ack:e.target.checked})}/>I understand this plan needs FIN review, even if it costs nothing.</label>
 {attempted&&(!c.payload||!m.fields.ack||!m.fields.title.trim())?<p role="alert">Fill in the plan, the title and the FIN review checkbox before submitting.</p>:null}
 {!data.options?<p role="alert">Couldn't load the form choices. Use the refresh button at the top before submitting.</p>:<FormRenderer draftKey={draftKey} definition={definition} restricted options={data.options} mode="request" hideSave initial={{values:r.draft?.values??{},money:''}} locked={m.locked} submitDisabled={!r.canSubmit} submitLabel={r.state==='revision_draft'?'Submit revised finance plan':'Submit finance plan'} validate={async values=>{
 setAttempted(true);if(!c.payload||!m.fields.ack||!m.fields.title.trim()||m.fields.title.length>240||m.fields.requestedOn&&!validDate(m.fields.requestedOn)||d.plannedOn&&!validDate(d.plannedOn)){throw Error('Check the plan fields and dates. What you typed is kept.')}
 const result=await m.run({id:r.id,values,requestedOn:m.fields.requestedOn||null,title:m.fields.title,payload:c.payload,version:r.version,revision:r.state==='revision_draft'});if(!result){if(!m.pending)refresh();throw Error('We couldn\'t confirm your plan was sent. See the message above. What you typed is kept.')}
 drafts?.delete(draftKey);refresh();return{valid:true,errors:{},values,snapshots:{},requestedCentavos:null}
 }}/>}<p>{r.canSubmit?'Pick your evidence files in the form. To add one, upload and finalize it below, then use the refresh button at the top.':'Submitting is paused until FIN finishes setting up this service.'}</p>
 </Panel>
 </>
}
