import {useCallback,useEffect,useRef,useState} from 'react'
import {Link,useParams,useRouteLoaderData,useSearchParams} from 'react-router'
import {PageHeading,Panel} from '../../components/Page'
import {TextField} from '../../components/TextField'
import {Pending,PendingButton} from '../../components/PendingButton'
import {EmptyState,ErrorState,LoadingState} from '../../components/FeedbackState'
import type {WorkspaceContext} from '../auth/gateway'
import {forgetRecordDrafts} from '../auth/draftScope'
import {manilaDay} from '../timeline/dates'
import {InventoryEditor,type InventoryAction} from './InventoryEditor'
import type {InventoryApi,InventoryEntry,InventoryReceipt,InventoryWorkspace,Loan,StockItem} from './api'
import {formatDay,formatDateTime} from '../shared/dates'
import './inventory.css'
import { NoAccess, NotSwitchedOn, EmptyCalendar, EmptyInbox, EmptySearch } from '../../components/illustrations'

const loanStates={reserved:'Reserved',issued:'Picked up',partial:'Partial return',complete:'Complete',cancelled:'Cancelled'}
const historyNames={reserve:'Reserved',issue:'Picked up',consume:'Picked up to use up',return:'Returned to stock',
  damage:'Damaged · set aside',loss:'Reported lost',cancel:'Reservation cancelled'}
const conditions={usable:'Usable',worn:'Worn · still usable',damaged:'Damaged',missing:'Missing'}
const details=(w:InventoryWorkspace,choice:InventoryAction)=>{
  const loan='loan'in choice?w.loans.find(l=>l.id===choice.loan):undefined
  return {loan,item:w.items.find(i=>i.id===('item'in choice?choice.item:loan?.itemId))}
}
const canIssue=(loan:Loan)=>{
  const today=manilaDay(new Date().toISOString())
  return loan.borrowerActive&&loan.startsOn<=today&&today<=loan.dueOn
}
const canUse=(w:InventoryWorkspace,choice:InventoryAction,loan?:Loan,item?:StockItem)=>{
  if(!w.editable)return false
  if(choice.kind==='register')return w.steward
  if(choice.kind==='reserve')return item?.canReserve===true
  if(choice.kind==='reassign')return item?.canReassign===true
  if(choice.kind==='finance')return item?.canStartFinance===true
  if(choice.kind==='replacement')return loan?.canStartFinance===true&&loan.history.some(e=>e.incidentId===choice.incident&&!e.financeStarted)
  if(!loan||choice.kind!=='movement')return false
  if(choice.action==='cancel')return loan.state==='reserved'
  if(!loan.custodian)return false
  return choice.action==='issue'?loan.state==='reserved'&&canIssue(loan):loan.outstanding>0
}

export function InventoryOverviewActions({api,term}: {api:InventoryApi;term:string}){
  const [search]=useSearchParams(),[entry,setEntry]=useState<{term:string;value:InventoryEntry}|null>(null)
  useEffect(()=>{
    let live=true,sequence=0
    const check=()=>{
      const current=++sequence
      void api.entry(term).then(value=>{if(live&&current===sequence)setEntry({term,value})})
        .catch(()=>{if(live&&current===sequence)setEntry(null)})
    }
    check()
    window.addEventListener('focus',check)
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')check()},30000)
    return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',check)}
  },[api,term])
  const current=entry?.term===term?entry.value:null
  if(!current?.enabled)return null
  const query=search.has('term')?'?term='+term:''
  return <>
    <Link className="button button--secondary" to={'/inventory'+query}>Borrow inventory</Link>
    {current.checkout?<Link className="button button--secondary" to={'/inventory/'+current.checkout.id+query}>
      Check out {current.checkout.item} · {current.checkout.reference}</Link>:null}
    {current.dueReturn?<Link className="button button--secondary" to={'/inventory/'+current.dueReturn.id+query}>
      Return {current.dueReturn.item} · {current.dueReturn.reference}</Link>:null}
  </>
}

export function InventoryPage({api}:{api:InventoryApi}){
  const c=useRouteLoaderData('workspace')as WorkspaceContext,{inventoryLoanId}=useParams(),[search]=useSearchParams()
  if(!('memberId'in c))return <EmptyState illustration={<NoAccess />} title="Inventory isn't available" description="Only organizers on this term's roster can borrow inventory."/>
  return <InventoryBody key={c.termId+':'+c.memberId+':'+inventoryLoanId} api={api} term={c.termId}
    loanId={inventoryLoanId??null} termQuery={search.has('term')?'?term='+c.termId:''}
    focusItem={/^[0-9a-f-]{36}$/i.test(search.get('item')??'')?search.get('item'):null}/>
}

function InventoryBody({api,term,loanId,termQuery,focusItem=null}:{api:InventoryApi;term:string;loanId:string|null;termQuery:string;focusItem?:string|null}){
  const [itemPage,changeItemPage]=useState(1),[loanPage,changeLoanPage]=useState(1)
  const [filter,setFilter]=useState(''),[query,setQuery]=useState('')
  const [workspace,setWorkspace]=useState<InventoryWorkspace|null>(null)
  // `loud`: a load the person is waiting on (first open, search, paging, retry, after saving).
  // Background checks (focus, every 30s) stay quiet: no status line, no inert list, no locked editor.
  const [checking,setChecking]=useState(true),[loud,setLoud]=useState(true),[pressed,setPressed]=useState(''),[failed,setFailed]=useState(false)
  const [choice,setChoice]=useState<InventoryAction|null>(null)
  const [receipt,setReceipt]=useState<InventoryReceipt|null>(null)
  const generation=useRef(0),initialized=useRef(false),activeChoice=useRef<InventoryAction|null>(null)
  const confirmation=useRef<HTMLParagraphElement>(null)
  const editor=useRef<HTMLDivElement>(null),focusEditor=useRef(false)
  const focusedItem=useRef<string|null>(null)

  const load=useCallback(async(quiet=false)=>{
    const current=++generation.current
    setChecking(true);setFailed(false);if(!quiet)setLoud(true)
    try{
      const next=await api.read(term,loanId,itemPage,loanPage,query)
      if(generation.current!==current)return
      if(!next)setReceipt(null)
      const opened=activeChoice.current
      if(opened){
        const records=next?details(next,opened):null
        const losesScope=!next||('loan'in opened&&!records?.loan)||
          ('item'in opened&&!records?.item)||opened.kind==='register'&&!next.steward||
          (opened.kind==='replacement'||opened.kind==='movement'&&opened.action!=='cancel')&&!records?.loan?.custodian||
          opened.kind==='reassign'&&!records?.item?.canReassign||opened.kind==='finance'&&!records?.item?.canStartFinance
        if(losesScope){
          forgetRecordDrafts('loan'in opened?opened.loan:'item'in opened?opened.item:'register')
          setReceipt(null);setChoice(null);activeChoice.current=null
        }
      }
      setWorkspace(next)
      if(next&&!initialized.current){
        initialized.current=true
        const l=loanId?next.loans[0]:undefined
        if(l?.custodian&&(l.outstanding>0||l.state==='reserved'&&canIssue(l))){
          const opening:InventoryAction={kind:'movement',loan:l.id,action:l.state==='reserved'?'issue':'return'}
          activeChoice.current=opening
          setChoice(opening)
        }
      }
    }catch{if(generation.current===current)setFailed(true)}
    finally{if(generation.current===current){setChecking(false);setLoud(false);setPressed('')}}
  },[api,term,loanId,itemPage,loanPage,query])

  useEffect(()=>{
    const check=()=>{if(document.visibilityState!=='hidden')void load(true)}
    void load();window.addEventListener('focus',check);document.addEventListener('visibilitychange',check)
    const timer=setInterval(check,30000)
    return()=>{generation.current++;clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)}
  },[load])
  useEffect(()=>{if(receipt)confirmation.current?.focus()},[receipt])
  // A scanned item label opens /inventory?item=<id>: bring that item into view once.
  const itemListed=!!focusItem&&!!workspace?.items.some(i=>i.id===focusItem)
  useEffect(()=>{
    if(!focusItem||!itemListed||focusedItem.current===focusItem)return
    focusedItem.current=focusItem
    const row=document.getElementById('inventory-item-'+focusItem)
    row?.scrollIntoView({block:'center'});row?.focus({preventScroll:true})
  },[focusItem,itemListed])
  useEffect(()=>{if(choice&&focusEditor.current){editor.current?.focus();focusEditor.current=false}},[choice])

  function choose(selected:InventoryAction){
    focusEditor.current=true
    activeChoice.current=selected
    setReceipt(null);setChoice(selected)
  }
  function close(){activeChoice.current=null;setChoice(null)}
  function saved(value:InventoryReceipt){close();setReceipt(value);void load()}

  const retained=workspace&&choice?details(workspace,choice):null
  const loansHref='/inventory'+termQuery
  const itemForLoan=loanId?workspace?.items[0]:undefined
  return <div className="inventory">
    <PageHeading title={loanId?'Inventory booking':'Borrow inventory'} description={workspace?.termLabel}/>
    {loanId?<Link className="button button--secondary" to={loansHref}>Back to inventory</Link>:null}
    {failed?<ErrorState title="Couldn't load inventory" description="Check your connection and try again. What you typed is kept."
      action={<PendingButton className="button button--secondary" pending={loud} pendingLabel="Trying again…" onClick={()=>load()}>Try again</PendingButton>}/>:null}
    {!workspace&&checking?<LoadingState title="Loading inventory"/>:null}
    {!workspace&&!checking&&!failed?<EmptyState illustration={<NotSwitchedOn />} title="Inventory isn't switched on yet" description="Borrowing isn't open for this term yet. Ask Logistics if you need equipment."
      action={<Link className="button button--secondary" to="/people">Find a contact</Link>}/>:null}
    {workspace?<div hidden={failed}>
      {receipt?<p ref={confirmation} tabIndex={-1} role="status" className="inventory-result">
        {'loanId'in receipt?<>{loanId?'Saved':'Reserved'} · {receipt.reference}{!loanId?
          <> <Link className="button button--secondary" to={'/inventory/'+receipt.loanId+termQuery}>Open booking {receipt.reference}</Link></>:null}</>:
          'financeRequestId'in receipt?<>Budget request (FIN) draft created. <Link className="button button--secondary" to={'/finance/'+term+'/'+receipt.financeRequestId+termQuery}>Open budget request</Link></>:
          'Inventory item saved.'}
      </p>:null}
      {loud&&workspace&&!pressed?<p role="status" className="refreshing-hint"><span className="pending-spinner" aria-hidden="true"/>Updating stock and bookings…</p>:null}
      <div>
        {loanId&&workspace.loans[0]?<LoanSummary loan={workspace.loans[0]} item={itemForLoan} term={term}
          termQuery={termQuery} choose={choose} editing={!!choice} editable={workspace.editable}/>:null}
        {choice&&retained?<div ref={editor} tabIndex={-1}>
          <InventoryEditor key={JSON.stringify(choice)} choice={choice} api={api} term={term} workspace={workspace}
            item={retained.item} loan={retained.loan} checking={loud}
            allowed={canUse(workspace,choice,retained.loan,retained.item)} refresh={()=>void load()} saved={saved} close={close}/>
        </div>:null}
        {!loanId?<div className="inventory-sections" aria-busy={loud||undefined}>
          <Panel title="Item availability">
            <form className="inventory-search" onSubmit={event=>{
              event.preventDefault()
              changeItemPage(1)
              if(filter.trim()!==query)setPressed('find')
              setQuery(filter.trim())
            }}>
              <TextField id="inventory-item-search" label="Search by item or pickup location" type="search"
                maxLength={160} value={filter} disabled={!!choice} onChange={event=>setFilter(event.target.value)}/>
              <button className="button button--secondary" disabled={!!choice}><Pending when={loud&&pressed==='find'}>Find items</Pending></button>
            </form>
            {focusItem&&!itemListed&&!loud&&!query&&itemPage===1?<p className="muted">The scanned item isn't on this page. Search for it by name.</p>:null}
            {workspace.steward&&!choice?<button className="button button--secondary" onClick={()=>choose({kind:'register'})}>Register an item</button>:null}
            {workspace.items.length?<ul className="inventory-list">{workspace.items.map(i=><li key={i.id} id={'inventory-item-'+i.id} tabIndex={i.id===focusItem?-1:undefined} className={i.id===focusItem?'inventory-item--focused':undefined} aria-current={i.id===focusItem?'true':undefined}>
              <h3>{i.name}</h3><p><strong>{i.available} available</strong> · {i.kind==='returnable'?'Returnable equipment':'Consumable supplies'}</p>
              <p>{i.location} · {i.custodian?'In charge: '+i.custodian:'Needs someone in charge'}</p>
              {!choice?<div className="auth-actions">
                {i.canReserve&&i.available>0?<button className="button" onClick={()=>choose({kind:'reserve',item:i.id})}>Reserve {i.name}</button>:null}
                {i.canReassign&&(i.needsCustodian||workspace.custodians.some(person=>person.id!==i.custodianId))?
                  <button className="button button--secondary" onClick={()=>choose({kind:'reassign',item:i.id})}>
                    {i.needsCustodian?'Assign someone in charge':'Change who\'s in charge'} · {i.name}</button>:null}
                {i.canStartFinance?<button className="button button--secondary" onClick={()=>choose({kind:'finance',item:i.id})}>Request purchase · {i.name}</button>:null}
              </div>:null}
            </li>)}</ul>:<EmptyState level={3} illustration={query?<EmptySearch size={96} />:<EmptyInbox size={96} />} title={query?'No items match this search':'No items listed yet'} description={query?'Try another word, or clear the search to see everything.':'Logistics lists the equipment you can borrow here. Ask them about available stock.'}/>}
            {itemPage>1||workspace.moreItems?<div className="auth-actions">
              <button className="button button--secondary" disabled={!!choice||itemPage===1} onClick={()=>{setPressed('items-prev');changeItemPage(v=>v-1)}}><Pending when={loud&&pressed==='items-prev'}>Previous</Pending></button>
              <button className="button button--secondary" disabled={!!choice||!workspace.moreItems} onClick={()=>{setPressed('items-next');changeItemPage(v=>v+1)}}><Pending when={loud&&pressed==='items-next'}>Next</Pending></button>
            </div>:null}
          </Panel>
          <Panel title={workspace.steward?'Bookings you look after':'My bookings'}>
            {workspace.loans.length?<ul className="inventory-list">{workspace.loans.map(l=><li key={l.id}>
              <h3><Link className="button button--secondary" to={'/inventory/'+l.id+termQuery}>{l.item} · {l.reference}</Link></h3>
              <p>{loanStates[l.state]} · {l.quantity} units{l.custodian?' · '+l.borrower:''}</p>
              <p>{l.kind==='returnable'?'Return by '+formatDay(l.dueOn):'Pickup '+formatDay(l.startsOn)}</p>
            </li>)}</ul>:<EmptyState level={3} illustration={<EmptyCalendar size={96} />} title="No bookings yet" description="Reserve an item above. Your bookings and their return dates show up here."/>}
            {loanPage>1||workspace.moreLoans?<div className="auth-actions">
              <button className="button button--secondary" disabled={!!choice||loanPage===1} onClick={()=>{setPressed('loans-prev');changeLoanPage(v=>v-1)}}><Pending when={loud&&pressed==='loans-prev'}>Previous</Pending></button>
              <button className="button button--secondary" disabled={!!choice||!workspace.moreLoans} onClick={()=>{setPressed('loans-next');changeLoanPage(v=>v+1)}}><Pending when={loud&&pressed==='loans-next'}>Next</Pending></button>
            </div>:null}
          </Panel>
        </div>:null}
      </div>
      <div className="auth-actions">
        <Link className="button button--secondary" to="/people">Find inventory help</Link>
      </div>
    </div>:null}
  </div>
}

function LoanSummary({loan:l,item,term,termQuery,choose,editing,editable}:{
  loan:Loan;item?:StockItem;term:string;termQuery:string;choose:(a:InventoryAction)=>void;editing:boolean;editable:boolean
}){
  return <Panel title={l.item+' · '+l.reference}>
    <p><strong>{loanStates[l.state]}</strong>{l.consumed?' · picked up to use up':''}</p>
    <p>{l.quantity} units · Pickup {formatDay(l.startsOn)}{l.kind==='returnable'?' · Return by '+formatDay(l.dueOn):''}</p>
    <p>{l.location} · {item?.custodian?'In charge: '+item.custodian:'Needs someone in charge'}</p>
    {l.custodian?<p>Borrower {l.borrower}{!l.borrowerActive?' · no longer on the roster':''}</p>:null}
    {l.state==='reserved'?<p>{l.custodian&&!canIssue(l)?'Check the pickup date and that the borrower is still on the roster before handing it over.':
      'Collect it at pickup. The person in charge records the handover.'}</p>:null}
    {l.kind==='returnable'&&l.state!=='reserved'&&l.state!=='cancelled'?<dl className="inventory-balance">
      <div><dt>Still out</dt><dd>{l.outstanding}</dd></div><div><dt>Returned</dt><dd>{l.returned}</dd></div>
      {l.damaged?<div><dt>Damaged</dt><dd>{l.damaged}</dd></div>:null}
      {l.lost?<div><dt>Lost</dt><dd>{l.lost}</dd></div>:null}
    </dl>:null}
    {editable&&!editing?<div className="auth-actions">
      {l.custodian&&l.state==='reserved'&&canIssue(l)?
        <button className="button" onClick={()=>choose({kind:'movement',loan:l.id,action:'issue'})}>Hand over</button>:null}
      {l.state==='reserved'?<button className="button button--secondary" onClick={()=>choose({kind:'movement',loan:l.id,action:'cancel'})}>Cancel booking</button>:null}
      {l.custodian&&l.outstanding>0?<button className="button" onClick={()=>choose({kind:'movement',loan:l.id,action:'return'})}>Record return</button>:null}
    </div>:null}
    {editable&&!editing&&l.custodian&&l.outstanding>0?<details className="work-section"><summary>Report damage or loss</summary>
      <div className="auth-actions">
        <button className="button button--secondary" onClick={()=>choose({kind:'movement',loan:l.id,action:'damage'})}>Record damaged units</button>
        <button className="button button--secondary" onClick={()=>choose({kind:'movement',loan:l.id,action:'loss'})}>Record lost units</button>
      </div></details>:null}
    {l.relatedWork?<p>Related work <Link className="button button--secondary" to={'/'+(l.relatedWork.kind==='task'?'tasks':'deliverables')+'/'+l.relatedWork.id+termQuery}>{l.relatedWork.label}</Link></p>:null}
    <details className="work-section"><summary>Booking history</summary>
      <ol className="inventory-list">{l.history.map(h=><li key={h.version}>
        <p>{historyNames[h.action]} · {h.quantity} units{h.condition?' · '+conditions[h.condition]:''} · {formatDateTime(h.at)}</p>
        {h.note?<p className="record-text">{h.note}</p>:null}
        {h.evidence?<p>Photo or file attached</p>:null}
        {h.financeRequestId?<Link className="button button--secondary" to={'/finance/'+term+'/'+h.financeRequestId+termQuery}>Open budget follow-up</Link>:
          h.financeStarted?<p>Budget follow-up (FIN) started</p>:null}
        {h.incidentId&&l.canStartFinance&&!h.financeStarted&&!editing?
          <button className="button button--secondary" onClick={()=>choose({kind:'replacement',loan:l.id,incident:h.incidentId!})}>Request a replacement budget</button>:null}
      </li>)}</ol>
    </details>
  </Panel>
}
