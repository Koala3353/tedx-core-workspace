import {useCallback,useEffect,useId,useRef,useState,type FormEvent} from 'react'
import {Link,useSearchParams} from 'react-router'
import {Panel} from '../../components/Page'
import {PendingButton,usePending} from '../../components/PendingButton'
import {TextField} from '../../components/TextField'
import {calendarDay,manilaDay} from '../timeline/dates'
import {Files} from '../files/Files'
import type {FilesApi} from '../files/api'
import {bookingProblem,bookingStateLabel,type Booking,type BookingCommand,type BookingWorkspace,type RoomBookingApi,type Slot} from './api'
import {formatDateTime,formatTime} from '../shared/dates'
import './rooms.css'

type Mode='request'|'hold'|'confirm'|'move'|'cancel'|'offer'
const localTime=(value:string)=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,16)
const showTime=(value:string)=>formatDateTime(value)
const equipmentName=(value:string)=>value.replace(/[_-]/g,' ').replace(/^./,letter=>letter.toUpperCase())
const slotName=(room:string,start:string,end:string)=>room+' · '+showTime(start)+' to '+
  (manilaDay(start)===manilaDay(end)?formatTime(end):showTime(end))
const controls={
  request:'Request a room',hold:'Hold this slot',confirm:'Confirm reservation',
  move:'Confirm new time',cancel:'Cancel room booking',offer:'Offer this alternative',
}
function toWindow(start:string,end:string){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end))return
  try{calendarDay(start.slice(0,10));calendarDay(end.slice(0,10))}catch{return}
  const startsAt=Date.parse(start+':00+08:00'),endsAt=Date.parse(end+':00+08:00')
  if(Number.isFinite(startsAt)&&Number.isFinite(endsAt)&&endsAt>startsAt&&endsAt-startsAt<=86400000)
    return {startsAt:new Date(startsAt).toISOString(),endsAt:new Date(endsAt).toISOString()}
}
function draft(booking:Booking|null){
  return {room:booking?.room.id??'',start:booking?localTime(booking.startsAt):'',end:booking?localTime(booking.endsAt):'',
    purpose:booking?.purpose??'',attendees:booking?String(booking.attendees):'',accessible:booking?.accessible??false,
    equipment:booking?.equipment??[],reason:'',manifest:'',officialReference:''}
}
type Entry=ReturnType<typeof draft>
type Edit={mode:Mode;version:number;policyVersion:number|null;offerVersion:number;usingOffer:boolean;fields:Entry;review:boolean;dirty:boolean}
const startEdit=(w:BookingWorkspace,mode:Mode):Edit=>({mode,version:w.booking?.version??0,policyVersion:w.policyVersion,
  offerVersion:w.offerVersion,usingOffer:false,fields:draft(w.booking),review:false,dirty:false})
const availabilityMatches=(w:BookingWorkspace,slot:Pick<Slot,'startsAt'|'endsAt'>)=>!!w.availabilityWindow
  &&Date.parse(w.availabilityWindow.startsAt)===Date.parse(slot.startsAt)
  &&Date.parse(w.availabilityWindow.endsAt)===Date.parse(slot.endsAt)
const allowed=(w:BookingWorkspace,mode:Mode)=>mode==='request'?w.canRequest:mode==='cancel'?w.canCancel:
  w.canDecide&&(mode==='move'?w.booking?.state==='confirmed':w.booking?.state!=='confirmed')

export function RoomBookingPanel({api,term,request,files,refreshToken}:{
  api:RoomBookingApi;term:string;request:string;files?:FilesApi;refreshToken:number
}){
  const [workspace,setWorkspace]=useState<BookingWorkspace|null>(null)
  const [edit,setEdit]=useState<Edit|null>(null)
  const [busy,setBusy]=useState(false),[checking,setChecking]=useState(false)
  const [problem,setProblem]=useState(''),[notice,setNotice]=useState(''),[readFailed,setReadFailed]=useState(false)
  const [slotConflict,setSlotConflict]=useState(false)
  const [pending,setPending]=useState<{command:BookingCommand;key:string}|null>(null)
  const currentRead=useRef(0),running=useRef(false),alive=useRef(false)
  const openedIntake=useRef(false)
  const heading=useRef<HTMLHeadingElement>(null),shouldFocus=useRef(false)
  const receipt=useRef<HTMLParagraphElement>(null)
  const evidenceDisclosure=useRef<HTMLDetailsElement>(null)
  const prefix=useId()+'-room-'
  const availability=usePending()

  const load=useCallback(async(window?:Pick<Slot,'startsAt'|'endsAt'>)=>{
    const generation=++currentRead.current
    setChecking(true);setReadFailed(false)
    try{
      const next=await api.workspace(term,request,window)
      if(generation!==currentRead.current)return
      setWorkspace(next)
      if(!next){setEdit(null);setPending(null);setProblem('');setNotice('');return}
      if(next.canRequest&&!next.booking&&!openedIntake.current){
        openedIntake.current=true
        setEdit(current=>current??startEdit(next,'request'))
      }
    }catch{if(generation===currentRead.current)setReadFailed(true)}
    finally{if(generation===currentRead.current)setChecking(false)}
  },[api,term,request])
  useEffect(()=>{
    alive.current=true
    const refresh=()=>{if(!running.current&&document.visibilityState!=='hidden')void load()}
    refresh();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh)
    const timer=setInterval(refresh,30000)
    return()=>{alive.current=false;currentRead.current++;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
  },[load,refreshToken])
  useEffect(()=>{if(shouldFocus.current){heading.current?.focus();shouldFocus.current=false}},[edit?.mode,edit?.review])
  useEffect(()=>{if(notice)receipt.current?.focus()},[notice])

  function open(mode:Mode){
    if(!workspace)return
    shouldFocus.current=true
    setProblem('');setSlotConflict(false)
    setEdit(startEdit(workspace,mode))
  }
  function update(fields:Partial<Entry>){
    if(!edit||pending||busy)return
    setEdit({...edit,fields:{...edit.fields,...fields},usingOffer:edit.usingOffer&&!('start'in fields||'end'in fields||'room'in fields),dirty:true});setProblem('')
  }
  function useAlternative(){
    if(!workspace?.alternative?.available||!workspace.canRequest||pending)return
    const alt=workspace.alternative
    shouldFocus.current=true
    setProblem('')
    setEdit({mode:'request',version:workspace.booking?.version??0,policyVersion:workspace.policyVersion,
      offerVersion:workspace.offerVersion,usingOffer:true,review:true,dirty:true,fields:{
        ...(edit?.mode==='request'?edit.fields:draft(workspace.booking)),
        room:alt.room.id,start:localTime(alt.startsAt),end:localTime(alt.endsAt),
      }})
  }
  function discard(){
    if(edit?.dirty&&!window.confirm('Discard the changes you entered for this room booking?'))return
    setEdit(null);setProblem('');setSlotConflict(false)
  }
  async function send(command?:BookingCommand){
    const attempt=pending??(command?{command,key:crypto.randomUUID()}:null)
    if(!attempt||running.current)return
    running.current=true;setPending(attempt);setBusy(true);setProblem('');setNotice('');setSlotConflict(false)
    try{
      const result=await api.run(attempt.command,attempt.key)
      if(!alive.current)return
      if(!result.ok){
        if(!result.error.retryable)setPending(null)
        setProblem(result.error.message)
        if(!result.error.retryable)await load(attempt.command.kind==='offer'?attempt.command.slot:undefined)
        return
      }
      setPending(null)
      if(result.value.outcome==='offered'){
        setEdit(null);setNotice('Alternative offered. The requester can now choose it.');await load();return
      }
      if(result.value.outcome==='saved'){
        setEdit(null)
        setNotice('Saved · '+bookingStateLabel[result.value.booking.state]+'.')
        const disclosure=evidenceDisclosure.current
        if(disclosure&&!disclosure.querySelector('[data-pending-command="true"]'))disclosure.open=false
        await load()
        return
      }
      setProblem(bookingProblem[result.value.reason]+' Your entries are kept.')
      setSlotConflict(result.value.outcome==='conflict')
      shouldFocus.current=true
      setEdit(current=>current&&{...current,review:false})
      await load(attempt.command.kind==='request'||attempt.command.kind==='confirm'?attempt.command.slot:undefined)
    }finally{
      running.current=false
      if(alive.current)setBusy(false)
    }
  }
  if(!workspace)return null
  const w=workspace,b=w.booking
  const latest=b?.version??0
  const stale=!!edit&&(edit.version!==latest||edit.mode!=='cancel'&&edit.policyVersion!==w.policyVersion
    ||(edit.mode==='offer'||edit.usingOffer)&&edit.offerVersion!==w.offerVersion)
  const selectedWindow=edit?toWindow(edit.fields.start,edit.fields.end):undefined
  const roomEditor=edit?.mode==='request'||edit?.mode==='move'||edit?.mode==='offer'
  const requestEditor=edit?.mode==='request'
  const needsEvidence=(edit?.mode==='confirm'||edit?.mode==='move')&&w.evidenceMode==='required'
  const requirements=edit?.fields
  const editingRooms=roomEditor&&requirements?w.rooms.filter(room=>room.capacity>=Number(requirements.attendees)
    &&(!requirements.accessible||room.accessible)&&requirements.equipment.every(item=>room.equipment.includes(item))):[]
  const sameWindow=!!selectedWindow&&w.rooms.some(r=>r.available!==null)&&availabilityMatches(w,selectedWindow)
  const editable=!!edit&&allowed(w,edit.mode)
  const holdMinutes=Math.min(15,w.maxHoldMinutes??15)
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    if(checking&&!busy){setProblem('Checking the latest booking details. Send again in a moment.');return}
    if(!edit||!w||readFailed||pending||stale||!allowed(w,edit.mode))return
    const f=edit.fields,base={term,request,version:edit.version,reason:f.reason.trim()}
    const slot=roomEditor&&selectedWindow?{room:f.room,...selectedWindow}:b?{room:b.room.id,startsAt:b.startsAt,endsAt:b.endsAt}:null
    if(roomEditor&&(!selectedWindow||!editingRooms.some(r=>r.id===f.room))){
      setProblem('Choose a room that fits, and a start and end time no more than 24 hours apart.');return
    }
    if(edit.mode==='request'&&slot){
      if(!f.purpose.trim()||!Number.isInteger(Number(f.attendees))){setProblem('Enter a purpose and the number of people attending.');return}
      if(edit.usingOffer&&!w.alternative?.available){
        setProblem('That alternative isn\'t available anymore. Your other entries are kept.')
        setEdit({...edit,usingOffer:false,review:false});return
      }
      if(!edit.review){shouldFocus.current=true;setEdit({...edit,review:true});return}
      void send({...base,kind:'request',slot,reason:f.purpose.trim(),purpose:f.purpose.trim(),attendees:Number(f.attendees),accessible:f.accessible,equipment:f.equipment})
    }else if(!base.reason){setProblem('Enter a reason.')}
    else if(edit.mode==='hold')void send({...base,kind:'hold',minutes:holdMinutes})
    else if(edit.mode==='cancel')void send({...base,kind:'cancel'})
    else if(edit.mode==='offer'&&slot&&w.policyVersion!==null)
      void send({...base,kind:'offer',slot,policyVersion:w.policyVersion,offerVersion:w.offerVersion})
    else if(slot&&w.policyVersion!==null){
      if(needsEvidence&&(!w.evidence.some(e=>e.id===f.manifest)||f.officialReference.trim().length<3)){
        setProblem('Choose the school reservation record and enter its reference number.');return
      }
      void send({...base,kind:'confirm',slot,policyVersion:w.policyVersion,
        manifest:needsEvidence?f.manifest:null,officialReference:needsEvidence?f.officialReference.trim():null})
    }
  }
  return <Panel title="Room booking" className="room-booking" id="room-booking">
    <p><strong>{w.requestTitle}</strong> · {w.reference.value} · {w.reference.termLabel}</p>
    {availability.pending?<p role="status" className="refreshing-hint"><span className="pending-spinner" aria-hidden="true"/>Checking rooms at this time…</p>:null}
    {readFailed?<p role="alert">Couldn't load the room booking. Your entries are kept. Refresh the page to try again.</p>:null}
    {notice?<p ref={receipt} tabIndex={-1} role="status">{notice}</p>:null}
    {problem?<p role="alert">{problem}</p>:null}
    {!readFailed?<BookingDetails workspace={w}/>:null}
    {!readFailed&&w.alternative&&w.canRequest&&w.alternative.available&&!pending&&!edit?.usingOffer?
      <button className="button" onClick={useAlternative}>Use the alternative from Logistics</button>:null}
    {pending?<div data-pending-command="true"><p>We couldn't confirm this was saved. Retry to finish it.</p>
      <PendingButton className="button" disabled={checking||readFailed} pending={busy} pendingLabel="Retrying…" onClick={()=>send()}>Retry</PendingButton></div>:null}
    <div className="auth-actions">
      {!edit&&!pending&&!readFailed?<>
        {w.canRequest?<button className={b?'button button--secondary':'button'} onClick={()=>open('request')}>{b?'Change room or time':'Request a room'}</button>:null}
        {w.canDecide&&b?.state!=='confirmed'?<>
          <button className="button" onClick={()=>open('confirm')}>Confirm reservation</button>
          <button className="button button--secondary" onClick={()=>open('offer')}>{w.alternative?'Change the alternative':'Offer an alternative'}</button>
          {b?.state!=='held'?<button className="button button--secondary" onClick={()=>open('hold')}>Hold this slot</button>:null}
        </>:null}
        {w.canDecide&&b?.state==='confirmed'?<button className="button" onClick={()=>open('move')}>Change reservation</button>:null}
        {w.canCancel?<button className="button button--secondary" onClick={()=>open('cancel')}>Cancel booking</button>:null}
      </>:null}
    </div>
    {edit&&editable&&!readFailed?<form onSubmit={submit} data-unsaved-changes={edit.dirty}>
      <h3 tabIndex={-1} ref={heading}>{edit.review?'Check your request':controls[edit.mode]}</h3>
      {stale?<div role="alert"><p>The booking or room rules changed. Check the details above before sending.</p>
        <button type="button" className="button button--secondary" disabled={checking||!!pending} onClick={()=>{
          setEdit({...edit,version:latest,policyVersion:w.policyVersion,offerVersion:w.offerVersion,usingOffer:false,review:false});setProblem('')
        }}>Keep my entries and continue</button></div>:null}
      {slotConflict&&w.canDecide&&b?.state!=='confirmed'&&(edit.mode==='hold'||edit.mode==='confirm')?
        <button type="button" className="button button--secondary" disabled={busy||checking||!!pending} onClick={()=>{
          shouldFocus.current=true
          setEdit({...edit,mode:'offer',offerVersion:w.offerVersion,review:false});setProblem('');setSlotConflict(false)
        }}>Choose an alternative to offer</button>:null}
      <fieldset disabled={busy||!!pending||stale}>
        {roomEditor&&!edit.review?<div className="room-fields">
          {requestEditor?<>
            <TextField id={prefix+'purpose'} label="Meeting purpose" value={edit.fields.purpose} required maxLength={1000} onChange={e=>update({purpose:e.target.value})}/>
            <TextField id={prefix+'count'} label="People attending" type="number" required min={1} max={10000} value={edit.fields.attendees} onChange={e=>update({attendees:e.target.value})}/>
            <label className="room-check"><input type="checkbox" checked={edit.fields.accessible} onChange={e=>update({accessible:e.target.checked})}/>Accessible room required</label>
            <fieldset><legend>Equipment needed</legend>{[...new Set([...edit.fields.equipment,...w.rooms.flatMap(r=>r.equipment)])].sort().map(item=>
              <label className="room-check" key={item}><input type="checkbox" checked={edit.fields.equipment.includes(item)}
                onChange={e=>update({equipment:e.target.checked?[...edit.fields.equipment,item]:edit.fields.equipment.filter(v=>v!==item)})}/>{equipmentName(item)}</label>)}
              {!w.rooms.some(r=>r.equipment.length)&&!edit.fields.equipment.length?<p>No equipment listed for these rooms.</p>:null}
            </fieldset>
          </>:null}
          <TextField id={prefix+'start'} label="Starts" type="datetime-local" required value={edit.fields.start} onChange={e=>update({start:e.target.value})}/>
          <TextField id={prefix+'end'} label="Ends" type="datetime-local" required value={edit.fields.end} onChange={e=>update({end:e.target.value})}/>
          <div className="form-field"><label htmlFor={prefix+'room'}>Room (required)</label>
            <select id={prefix+'room'} required value={edit.fields.room} onChange={e=>update({room:e.target.value})}>
              <option value="">Choose a room</option>{editingRooms.map(r=><option value={r.id} key={r.id}>{r.name} · up to {r.capacity}{sameWindow&&r.available===false?' · taken at this time':''}</option>)}
            </select></div>
          <PendingButton className="button button--secondary" disabled={!selectedWindow} pending={availability.pending} pendingLabel="Checking…" onClick={()=>availability.run(()=>load(selectedWindow))}>Check room availability</PendingButton>
          {sameWindow?<div role="status"><p>Logistics checks again before confirming.</p>
            {editingRooms.some(r=>r.available&&r.id!==edit.fields.room)?<ul>{editingRooms.filter(r=>r.available&&r.id!==edit.fields.room).map(r=>
              <li key={r.id}><button type="button" className="button button--secondary" onClick={()=>update({room:r.id})}>Choose {r.name} at this time</button></li>)}</ul>:null}
            {!editingRooms.some(r=>r.available)?<p>Choose a different start and end to check another time.</p>:null}</div>:null}
          <p>For repeating meetings, make a separate Logistics request for each session.</p>
        </div>:null}
        {edit.review&&selectedWindow?<div>
          <p>{slotName(w.rooms.find(room=>room.id===edit.fields.room)?.name??'Selected room',selectedWindow.startsAt,selectedWindow.endsAt)}</p>
          <p className="record-text">{edit.fields.purpose} · {edit.fields.attendees} attending{edit.fields.accessible?' · accessible room':''}{edit.fields.equipment.length?' · '+edit.fields.equipment.map(equipmentName).join(', '):''}</p>
          <p>Logistics will check the room and confirm.</p>
          {b?.state==='held'?<p>Sending a new time releases the current hold.</p>:null}
          <button type="button" className="button button--secondary" onClick={()=>{shouldFocus.current=true;setEdit({...edit,review:false})}}>Back to change details</button>
        </div>:null}
        {edit.mode==='hold'?<p>Hold this slot for up to {holdMinutes} minutes. It shows on the calendar once confirmed.</p>:null}
        {edit.mode==='cancel'?<p>{b?.state==='confirmed'?'This releases the reservation and removes it from the calendar.':'This closes the room request.'} The details stay in the request history.</p>:null}
        {needsEvidence?<div className="room-fields">
          <p>Use the school reservation record for this room and time.</p>
          <div className="form-field"><label htmlFor={prefix+'evidence'}>School reservation record (required)</label>
            <select id={prefix+'evidence'} value={edit.fields.manifest} required onChange={e=>update({manifest:e.target.value})}><option value="">Choose a record</option>
              {w.evidence.map(e=><option key={e.id} value={e.id}>{e.names.join(', ')} · {showTime(e.createdAt)}</option>)}</select></div>
          {!w.evidence.length?<p>No record yet. Attach and finalize the school record below.</p>:null}
          <TextField id={prefix+'reference'} label="School reference number" required minLength={3} maxLength={500} value={edit.fields.officialReference} onChange={e=>update({officialReference:e.target.value})}/>
        </div>:null}
        {(edit.mode==='confirm'||edit.mode==='move')&&w.evidenceMode==='official_not_required'?<p>This room doesn't need a school reservation record. You can confirm it directly.</p>:null}
        {!requestEditor?<TextField id={prefix+'reason'} label={edit.mode==='cancel'?'Reason for cancelling':'Reason'} required maxLength={2000} value={edit.fields.reason} onChange={e=>update({reason:e.target.value})}/>:null}
        <div className="auth-actions">
          <PendingButton className="button" type="submit" pending={busy} pendingLabel="Sending…">{edit.review?(edit.usingOffer?'Request this alternative':'Send to Logistics'):edit.mode==='cancel'?'Confirm cancellation':controls[edit.mode]}</PendingButton>
          <button className="button button--secondary" type="button" onClick={discard}>Close</button>
        </div>
      </fieldset>
    </form>:null}
    {w.canDecide&&w.evidenceMode==='required'&&files?<details ref={evidenceDisclosure} className="work-section" hidden={readFailed}><summary>Attach the school record</summary>
      <Files api={files} workId={request} uploadsOnly roomEvidence onFinalized={manifest=>{
        setEdit(current=>current&&(current.mode==='confirm'||current.mode==='move')?
          {...current,fields:{...current.fields,manifest},dirty:true}:current)
        void load(selectedWindow)
      }}/></details>:null}
    {edit&&!editable&&!checking&&!pending?<p role="status">You can't do this on the booking anymore. <button type="button" className="button button--secondary" onClick={discard}>Close</button></p>:null}
  </Panel>
}

function BookingDetails({workspace:w}:{workspace:BookingWorkspace}){
  const [search]=useSearchParams()
  const b=w.booking
  const term=search.has('term')?'&term='+w.reference.termId:''
  const contact=<Link className="button button--secondary" to={w.contact?'/people?contact='+w.contact.id+term:
    term?'/people?'+term.slice(1):'/people'}>{w.contact?.name??'Find a contact'}</Link>
  if(!b)return <><p>Choose a room and time for Logistics to review.</p>{contact}</>
  const room=availabilityMatches(w,b)?w.rooms.find(room=>room.id===b.room.id):undefined
  return <>
    <p><strong>{bookingStateLabel[b.state]}</strong></p>
    {w.desiredSlot&&(b.state==='confirmed'||b.state==='cancelled')?<p>Requested · {slotName(w.desiredSlot.room.name,w.desiredSlot.startsAt,w.desiredSlot.endsAt)}</p>:null}
    <p>{b.state==='confirmed'?'Reserved':b.state==='cancelled'?'Cancelled':'Requested'} · {slotName(b.room.name,b.startsAt,b.endsAt)}</p>
    <p className="record-text">{b.purpose} · {b.attendees} attending{b.accessible?' · accessible room':''}{b.equipment.length?' · '+b.equipment.map(equipmentName).join(', '):''}</p>
    {b.state==='requested'||b.state==='held'?<>
      <p>{room?.available===false?'This time is taken. Change the room or time, or ask Logistics.':
        b.state==='held'?'Held. It shows on the calendar once Logistics confirms.':'Waiting for Logistics to check and confirm.'}</p>
      {room?.available&&w.canDecide?<p>Free when last checked. Confirming checks again.</p>:null}
      {b.holdUntil?<p>Hold ends {showTime(b.holdUntil)}.</p>:null}
      {b.holdExpired?<p>The hold ended. Logistics can check again.</p>:null}
      {b.requestChanged?<p>The request changed. The requester needs to check and save the room details again.</p>:null}
    </>:null}
    {b.evidence?<p>{b.evidence.kind==='school_record'?'School reservation record attached':'No school record needed'}{w.officialReference?' · '+w.officialReference:''}</p>:null}
    {w.schoolFiles.length?<p className="record-text">School record · {w.schoolFiles.join(', ')}</p>:null}
    {w.alternative?<div>
      <p><strong>Alternative from Logistics</strong> · {slotName(w.alternative.room.name,w.alternative.startsAt,w.alternative.endsAt)}</p>
      <p>{w.alternative.available?'The requester can choose this, then Logistics confirms.':'This alternative isn\'t available anymore. Choose another time or ask Logistics.'}</p>
    </div>:null}
    {b.state==='confirmed'?<Link className="button button--secondary" to={'/calendar?booking='+b.requestId+term}>Open in calendar</Link>:null}
    {b.state==='cancelled'?<p>Not on the calendar.</p>:null}
    <p>{w.service??'Logistics'} booking contact</p>{contact}
  </>
}
