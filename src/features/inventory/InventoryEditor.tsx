import {useEffect,useId,useRef,useState,type ComponentProps,type FormEvent} from 'react'
import {Pending} from '../../components/PendingButton'
import {PersonPicker,SearchSelect,personOptions} from '../../components/list'
import {Link} from 'react-router'
import {Panel} from '../../components/Page'
import {TextField} from '../../components/TextField'
import {forgetRecordDrafts} from '../auth/draftScope'
import {useFinDecision} from '../finance/DecisionMemory'
import {RefreshButton} from '../shared/RefreshButton'
import {labelPeople,usePeopleOptions} from '../people/peopleOptions'
import {formatDay,formatDateTime} from '../shared/dates'
import type {InventoryApi,InventoryCommand,InventoryEvidence,InventoryReceipt,InventoryWorkspace,Loan,Movement,StockItem} from './api'

export type InventoryAction=
  {kind:'register'}|
  {kind:'reserve'|'reassign'|'finance';item:string}|
  {kind:'movement';loan:string;action:Movement}|
  {kind:'replacement';loan:string;incident:string}

export const movementLabel:Record<Movement,string>={
  issue:'Confirm handover',return:'Record return',damage:'Record damaged items',loss:'Record lost items',cancel:'Cancel reservation',
}
const label={
  reserve:'Reserve an item',register:'Add an item',reassign:'Change who\'s in charge',
  finance:'Start FIN purchase request',replacement:'Start FIN replacement request',
}
const conditionValue=(v:string)=>v==='usable'||v==='worn'?v:null
const incident=(action:InventoryAction)=>action.kind==='movement'&&(action.action==='damage'||action.action==='loss')
const focusReview=(heading:HTMLHeadingElement|null)=>{heading?.focus()}

export function InventoryEditor({choice,api,term,workspace,item,loan,checking,allowed,close,refresh,saved}:{
  choice:InventoryAction;api:InventoryApi;term:string;workspace:InventoryWorkspace;item?:StockItem;loan?:Loan;
  checking:boolean;allowed:boolean;close:()=>void;refresh:()=>void;saved:(receipt:InventoryReceipt)=>void
}){
  const id=useId(),people=usePeopleOptions(term).people
  const key='inventory:'+term+':'+('loan'in choice?choice.loan:'item'in choice?choice.item:'register')
  const recordVersion=(choice.kind==='movement'?loan?.version:item?.version)??0
  const [base,setBase]=useState(recordVersion),[localError,setLocalError]=useState('')
  const [review,setReview]=useState(false),[dirty,setDirty]=useState(false)
  const [evidence,setEvidence]=useState<{rows:InventoryEvidence[]|null;failed:boolean}>()
  const [evidenceRefresh,setEvidenceRefresh]=useState(0)
  const problem=useRef<HTMLDivElement>(null),submitButton=useRef<HTMLButtonElement>(null)
  const action=choice.kind==='movement'?choice.action:null
  const recordEvidence=incident(choice)
  const m=useFinDecision(api,key+':'+(action??choice.kind),{
    name:'',location:'',kind:'returnable',custodian:choice.kind==='register'?workspace.actorId:'',
    quantity:choice.kind==='reserve'?'1':action==='return'?String(loan?.outstanding??1):recordEvidence?'1':'',
    startsOn:'',dueOn:'',work:'',condition:'',note:'',evidence:'',
  })
  const fields=m.fields
  const stale=base!==recordVersion
  const title=action===null?label[choice.kind as keyof typeof label]:movementLabel[action]
  useEffect(()=>{
    if(!recordEvidence||!loan?.id)return
    let live=true
    void api.evidence(term,loan.id).then(rows=>{if(live)setEvidence({rows,failed:false})})
      .catch(()=>{if(live)setEvidence({rows:null,failed:true})})
    return()=>{live=false}
  },[api,loan?.id,term,recordEvidence,evidenceRefresh])

  // A failed save disables the form for a moment, which drops focus: put it on the problem
  // (or back on the submit button) so keyboard and screen-reader users stay in place.
  const failure=localError||m.error||(m.pending?'pending':'')
  useEffect(()=>{
    if(!failure)return
    const lost=!document.activeElement||document.activeElement===document.body||!document.activeElement.isConnected
    if(lost)(problem.current??submitButton.current)?.focus({preventScroll:false})
  },[failure,m.busy])
  function field(name:string,value:string){
    m.change({...fields,[name]:value});setDirty(true);setLocalError('')
  }
  function discard(){
    if(dirty&&!window.confirm('Discard these inventory entries?'))return
    forgetRecordDrafts('loan'in choice?choice.loan:'item'in choice?choice.item:'register')
    close()
  }
  async function send(command?:InventoryCommand){
    const result=await m.run(command)
    if(result){setDirty(false);saved(result)}else refresh()
  }
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    if(checking&&!m.locked){setLocalError('Checking the latest stock. Send again in a moment.');return}
    if(!allowed||stale||m.locked)return
    const quantity=Number(fields.quantity),condition=conditionValue(fields.condition),note=fields.note.trim()||null
    if(choice.kind==='register'&&condition&&(fields.kind==='returnable'||fields.kind==='consumable')){
      void send({kind:'register',term,name:fields.name,location:fields.location,itemKind:fields.kind,quantity,condition,custodian:fields.custodian})
    }else if(choice.kind==='reserve'&&item){
      const dueOn=item.kind==='consumable'?fields.startsOn:fields.dueOn
      if(!Number.isInteger(quantity)||quantity<1||quantity>item.available||dueOn<fields.startsOn){
        setLocalError('Check the available quantity and the pickup and return dates.');return
      }
      if(!review){setReview(true);return}
      void send({kind:'reserve',term,item:item.id,version:base,quantity,startsOn:fields.startsOn,dueOn,work:fields.work||null})
    }else if(choice.kind==='movement'&&loan){
      if((choice.action==='return'||recordEvidence)&&(!Number.isInteger(quantity)||quantity<1||quantity>loan.outstanding)){
        setLocalError('Enter a quantity from the units still out.');return
      }
      if(recordEvidence&&!evidence?.rows?.some(file=>file.id===fields.evidence)){
        setLocalError('Choose a photo or document for this incident.');return
      }
      void send({kind:'movement',term,loan:loan.id,version:base,action:choice.action,quantity:
        choice.action==='issue'||choice.action==='cancel'?loan.quantity:quantity,
      condition,note,evidence:fields.evidence||null})
    }else if(choice.kind==='reassign'&&item&&note){
      void send({kind:'reassign',term,item:item.id,version:base,custodian:fields.custodian,note})
    }else if((choice.kind==='finance'||choice.kind==='replacement')&&item){
      void send({kind:'finance',term,item:item.id,version:base,incident:choice.kind==='replacement'?choice.incident:null})
    }else setLocalError('Fill in the required fields.')
  }
  const input=(name:string,nameLabel:string,options:Omit<ComponentProps<typeof TextField>,'id'|'label'|'value'|'onChange'>={})=>
    <TextField id={id+name} label={nameLabel} value={fields[name]} onChange={e=>field(name,e.target.value)} {...options}/>
  const conditionFields=<fieldset className="inventory-condition"><legend>Physical condition (required)</legend>
    <label><input name={id+'condition'} type="radio" value="usable" checked={fields.condition==='usable'}
      onChange={()=>field('condition','usable')} required/>Usable</label>
    <label><input name={id+'condition'} type="radio" value="worn" checked={fields.condition==='worn'}
      onChange={()=>field('condition','worn')} required/>Worn · still usable</label>
  </fieldset>
  const isFinance=choice.kind==='finance'||choice.kind==='replacement'
  const itemName=item?.name??loan?.item
  return <Panel title={title} className="inventory-editor">
    {itemName?<p><strong>{itemName}</strong>{loan?' · '+loan.reference:''}{item?' · '+item.location:''}</p>:null}
    <div ref={problem} tabIndex={-1} hidden={!localError&&!m.error&&!m.pending}>
    {localError||m.error?<p role="alert">{localError||m.error}</p>:null}
    {m.pending?<div data-pending-command="true">
      <p>We couldn't confirm this was saved. Retry to finish it.</p>
      <button className="button" disabled={m.busy} aria-busy={m.busy||undefined} onClick={()=>void send()}><Pending when={m.busy} label="Retrying…">Retry</Pending></button>
    </div>:null}
    </div>
    {!allowed&&!m.pending?<p role="status">The stock or booking changed, or you can no longer do this. Check the latest details.</p>:null}
    {allowed&&stale&&!m.pending?<div role="alert"><p>This record changed. Review the latest quantities before sending.</p>
      <button className="button button--secondary" disabled={checking} onClick={()=>{setBase(recordVersion);setReview(false);setLocalError('');m.change(fields)}}>Keep my entries and continue</button>
    </div>:null}
    <form onSubmit={submit} data-unsaved-changes={dirty} data-pending-command={m.locked}>
      <fieldset disabled={m.locked||stale||!allowed}>
        {choice.kind==='register'?<>
          {input('name','Item name',{required:true,maxLength:160})}{input('location','Pickup location',{required:true,maxLength:160})}
          <div className="form-field"><label htmlFor={id+'kind'}>Item type</label><select id={id+'kind'} value={fields.kind} onChange={e=>field('kind',e.target.value)}>
            <option value="returnable">Returnable equipment</option><option value="consumable">Consumable supplies</option>
          </select></div>
          {input('quantity','How many you have now',{type:'number',required:true,min:0,max:100000})}{conditionFields}
        </>:null}
        {choice.kind==='register'||choice.kind==='reassign'?<div className="form-field"><label htmlFor={id+'custodian'}>Person in charge</label>
          <PersonPicker id={id+'custodian'} required value={fields.custodian} onChange={value=>field('custodian',value)} options={personOptions(labelPeople(workspace.custodians.filter(person=>choice.kind==='register'||person.id!==item?.custodianId),people,'membershipId'))}/>
        </div>:null}
        {choice.kind==='reserve'&&item?<><p role="status">{item.available} available · {item.custodian?'In charge: '+item.custodian:'Needs someone in charge'}</p>
          {review?<div>
            <h3 tabIndex={-1} ref={focusReview}>Review your reservation</h3>
            <p>{fields.quantity} × {item.name} · Pickup {formatDay(fields.startsOn)}
              {item.kind==='returnable'?' · Return by '+formatDay(fields.dueOn):' · Used up, no return'}</p>
            {fields.work?<p>{workspace.work.find(w=>w.id===fields.work)?.label??'Previously selected work'}</p>:null}
            <p>Stock is set aside when you send this reservation. Collect it from {item.custodian}.</p>
            <button type="button" className="button button--secondary" onClick={()=>setReview(false)}>Back to change reservation</button>
          </div>:<>
            {input('quantity','Quantity',{required:true,type:'number',min:1,max:Math.max(1,item.available)})}
            {input('startsOn','Pickup date (Manila)',{type:'date',required:true})}
            {item.kind==='returnable'?input('dueOn','Return by (Manila)',{type:'date',required:true,min:fields.startsOn}):
              <p>This item gets used up, so there's no return date.</p>}
            {workspace.work.length?<div className="form-field"><label htmlFor={id+'work'}>Related work (optional)</label>
              <SearchSelect id={id+'work'} value={fields.work} onChange={value=>field('work',value)} placeholder="Type related work" options={[{value:'',label:'No related work'},...workspace.work.map(w=>({value:w.id,label:w.label}))]}/></div>:null}
          </>}
        </>:null}
        {action==='issue'&&loan?<><p>Confirm only after you've handed {loan.quantity} {loan.quantity===1?'unit':'units'} to {loan.borrower} at {loan.location}.</p>{conditionFields}</>:null}
        {action==='return'&&loan?<><p>{loan.outstanding} still out. Check the quantity and condition before restoring stock.</p>
          {input('quantity','Units returned',{type:'number',required:true,min:1,max:loan.outstanding})}{conditionFields}</>:null}
        {action==='cancel'&&loan?<p>This frees up all {loan.quantity} reserved units. The booking history keeps the reference and your reason.</p>:null}
        {recordEvidence&&loan?<><p>{loan.outstanding} still out. Damaged and lost units stay out of available stock.</p>
          {input('quantity',action==='loss'?'Units lost':'Units damaged',{type:'number',required:true,min:1,max:loan.outstanding})}
          <div className="form-field"><label htmlFor={id+'evidence'}>Photo or document (required)</label>
            <select id={id+'evidence'} required value={fields.evidence} onChange={e=>field('evidence',e.target.value)}>
            <option value="">Select a document</option>{evidence?.rows?.map(e=>
              <option key={e.id} value={e.id}>{e.work} · {e.files.join(', ')} · {formatDateTime(e.at)}</option>)}
          </select></div>
          {!evidence?<p role="status">Loading files…</p>:null}
          {evidence?.failed?<p role="alert">Couldn't load the files. Use the refresh button to try again.</p>:null}
          {evidence?.rows?.length===0?<p>No files yet. Add a photo or document to the related task, finalize it, then refresh this list.</p>:null}
          <div className="auth-actions">
            <Link className="button button--secondary" target="_blank" rel="noopener"
              to={loan.relatedWork?'/'+(loan.relatedWork.kind==='task'?'tasks':'deliverables')+'/'+loan.relatedWork.id:'/search'}>
              {loan.relatedWork?'Open related work in a new tab':'Find a task in a new tab'}</Link>
            <RefreshButton onRefresh={()=>setEvidenceRefresh(n=>n+1)}/>
          </div>
        </>:null}
        {recordEvidence||action==='cancel'||choice.kind==='reassign'?input('note',
          recordEvidence?'Incident details':action==='cancel'?'Why are you cancelling?':'Reason for the change',
          {required:true,maxLength:2000}):null}
        {isFinance?<p>This opens a FIN draft. Enter the costs there. FIN has to approve them before anyone spends money.</p>:null}
        <button ref={submitButton} className="button" type="submit" aria-busy={m.busy||undefined}><Pending when={m.busy} label="Sending…">{choice.kind==='reserve'?(review?'Send reservation':'Review reservation'):
          action==='cancel'?'Confirm cancellation':title}</Pending></button>
      </fieldset>
      <button className="button button--secondary" type="button" disabled={m.locked} onClick={discard}>Close</button>
    </form>
  </Panel>
}
