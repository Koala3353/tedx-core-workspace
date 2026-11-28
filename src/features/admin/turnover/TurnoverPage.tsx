import {useCallback,useEffect,useRef,useState} from 'react'
import {EmptyResults,ListToolbar,useListFilter} from '../../../components/list'
import {Link,useParams,useRouteLoaderData} from 'react-router'
import {PageHeading,Panel} from '../../../components/Page'
import {EmptyState,ErrorState,LoadingState} from '../../../components/FeedbackState'
import type {WorkspaceContext} from '../../auth/gateway'
import {forgetRecordDrafts} from '../../auth/draftScope'
import type {ArchivedCustody,TurnoverApi,TurnoverSetup,TurnoverState,TurnoverWorkspace} from './api'
import {TurnoverEditor,categoryName,type TurnoverEdit} from './TurnoverEditor'
import {archivePath,ArchiveFacts} from './ArchivePage'
import {HowThisWorks} from '../../shared/HowThisWorks'
import {formatDateTime,formatDay} from '../../shared/dates'
import './turnover.css'
const stateName:Record<TurnoverState,string>={preparing:'Review unit and item outcomes',frozen:'Frozen. Name who keeps the archive, then export it',exporting:'Archive export needs attention',verified:'Archive checked. Waiting for successors to accept',rehearsal_verified:'Practice run checked. Waiting for successors to accept',complete:'Handover complete',rehearsal_complete:'Practice run complete'}
export function TurnoverLinks({api,term}:{api:TurnoverApi;term:string}){
  const [w,setW]=useState<TurnoverWorkspace|null>(null),sequence=useRef(0)
  useEffect(()=>{let live=true;const check=()=>{const n=++sequence.current;setW(null);void api.workspace(term).then(v=>{if(live&&sequence.current===n)setW(v)}).catch(()=>{})};check();window.addEventListener('focus',check);return()=>{live=false;window.removeEventListener('focus',check)}},[api,term])
  return <div className="auth-actions">{w&&(w.case||w.approvals.length)?<Link className="button button--secondary" to={'/handover'+(w.case?'/'+w.case.id:'')+'?term='+term}>Term handover</Link>:null}
    {w?.hasArchive?<Link className="button button--secondary" to={archivePath(term)}>Archived work</Link>:null}</div>
}
export function TurnoverPage({api}:{api:TurnoverApi}){
  const c=useRouteLoaderData('workspace')as WorkspaceContext,{turnoverCaseId}=useParams()
  if(!('memberId'in c))return <EmptyState title="Handover isn't available" description="Only core team members can open the term handover."/>
  return <TurnoverBody key={c.memberId+c.termId+turnoverCaseId} api={api} term={c.termId} membership={c.termMembershipId} caseId={turnoverCaseId}/>
}
function TurnoverBody({api,term,membership,caseId}:{api:TurnoverApi;term:string;membership:string;caseId?:string}){
  const [w,setW]=useState<TurnoverWorkspace|null>(null),[setup,setSetup]=useState<TurnoverSetup|null>(null),[custody,setCustody]=useState<ArchivedCustody|null>(null)
  const [checking,setChecking]=useState(true),[failed,setFailed]=useState(false),[edit,setEdit]=useState<TurnoverEdit|null>(null),[notice,setNotice]=useState('')
  const outcome=(x:TurnoverWorkspace['work'][number])=>x.resolution==='carry'?'Carry forward':x.resolution==='resolved'?'Resolved':x.resolution==='cancelled'?'Cancelled':'Outcome needed'
  const items=useListFilter(w?.work??[],{storageKey:'turnover-work',text:x=>[x.title,x.reference,w?.people.find(p=>p.id===x.owner)?.name,categoryName(x.classification)],filters:[{key:'outcome',label:'Outcome',get:x=>x.recordedVersion!==x.version&&x.resolution?'Check again':outcome(x),options:['Outcome needed','Check again','Carry forward','Resolved','Cancelled'].map(value=>({value,label:value}))},{key:'kind',label:'Kind',get:x=>categoryName(x.classification)}]})
  const sequence=useRef(0),previous=useRef<{caseId:string|null;canManage:boolean;records:string[];managerRecords:string[]}|null>(null),choice=useRef<TurnoverEdit|null>(null),focus=useRef<HTMLDivElement>(null),completed=useRef(false)
  const load=useCallback(async()=>{
    if(completed.current)return
    const n=++sequence.current;setChecking(true);setFailed(false)
    try{
      const next=await api.workspace(term,caseId)
      const settings=next.canManage||next.approvals.length?await api.setup(term):null
      const q=choice.current,details=q?.kind==='custodyAction'&&next.custody.some(x=>x.id===q.id&&x.recipient===membership&&x.qualified)?await api.custody(term,q.id):null
      if(sequence.current!==n)return
      const old=previous.current,visible=new Set([...next.transfers,...next.custody].map(x=>x.id))
      for(const id of old?.records??[])if(!visible.has(id))forgetRecordDrafts(id)
      if(old?.caseId&&(!next.case||old.canManage&&!next.canManage)){forgetRecordDrafts(old.caseId);old.managerRecords.forEach(forgetRecordDrafts);choice.current=null;setEdit(null)}
      if(q&&'id'in q&&!next.canManage&&!visible.has(q.id)){choice.current=null;setEdit(null);setNotice('What you can see in this handover changed. Ask the handover custodian if something is missing.')}
      previous.current={caseId:next.case?.id??null,canManage:next.canManage,records:[...visible],managerRecords:[...next.units,...next.work].map(r=>r.id)};setW(next);setSetup(settings);setCustody(details)
    }catch{if(sequence.current===n){setFailed(true);setW(null);setSetup(null);setCustody(null)}}finally{if(sequence.current===n)setChecking(false)}
  },[api,term,caseId,membership])
  useEffect(()=>{const check=()=>{if(document.visibilityState!=='hidden')void load()};check();window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);const timer=setInterval(check,30000);return()=>{sequence.current++;clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)}},[load])
  useEffect(()=>{if(edit||notice)focus.current?.focus()},[edit,notice])
  async function open(q:TurnoverEdit){setNotice('');choice.current=q;if(q.kind==='custodyAction'){
    setChecking(true);setCustody(null);try{const d=await api.custody(term,q.id);if(choice.current===q){setCustody(d);setEdit(q)}}catch{setFailed(true);setW(null)}finally{setChecking(false)}
  }else setEdit(q)}
  function close(){choice.current=null;setEdit(null);setCustody(null)}
  function saved(message:string){
    if(choice.current?.kind==='complete'){
      const synthetic=w?.case?.scope==='synthetic';completed.current=true;sequence.current++;close();setW(null);setSetup(null);setCustody(null);setChecking(false)
      setNotice(synthetic?'Practice handover complete. The term is archived, but this was only a practice run.':'Handover complete. The term is archived and outgoing members\' access was removed as planned.');return
    }
    close();setNotice(message);void load()
  }
  const acceptedCurrent=(v:{accepted:boolean;acceptedRun:string|null})=>v.accepted&&v.acceptedRun===w?.runs[0]?.id
  const c=w?.case,done=c?.state==='complete'||c?.state==='rehearsal_complete',verified=c?.state==='verified'||c?.state==='rehearsal_verified'
  return <div className="turnover">
    <PageHeading title="Term handover" description="Pass each committee's work to next term's team, archive the rest, and have successors accept it."/>
    <div className="auth-actions"><Link className="button button--secondary" to={completed.current?'/':'/?term='+term}>Overview</Link>{w?.hasArchive?<Link className="button button--secondary" to={archivePath(term)}>Archived work</Link>:null}</div>
    {completed.current?<Panel title="Handover recorded"><p role="status">{notice}</p></Panel>:null}
    {checking?<LoadingState title="Loading handover"/>:null}
    {failed?<ErrorState title="Couldn't load the handover" description="Check your connection and try again. Your entries are kept."/>:null}
    {!checking&&!failed&&w&&!c&&!w.approvals.length?<EmptyState title="No handover for you yet" description="You'll see the handover here once you're named as its custodian or a successor. Ask an admin if you expected one."/>:null}
    {w?<div hidden={failed||checking}>
      {c?<Panel title={c.term}><p><strong>{stateName[c.state]}</strong></p><p>Handover custodian: {c.custodian}</p>{c.scope==='synthetic'?<p role="note">Practice run with sample data. Nothing real is handed over.</p>:null}
        {w.runs[0]?.failure&&!w.runs[0].restored?<p role="alert">Archive operator: the {w.runs[0].failure.phase==='files'?'file checks':w.runs[0].failure.phase==='restore'?'restore rehearsal':'record checks'} need attention. Check the source, then resume the archive export. The archive can't be checked until this is fixed.</p>:null}
      </Panel>:null}
      <div ref={focus} tabIndex={-1}>{notice?<p role="status">{notice}</p>:null}
        {edit?<TurnoverEditor key={edit.kind+('id'in edit?edit.id:'')+('action'in edit?edit.action:'')} api={api} term={term} workspace={w} setup={setup} custody={custody} edit={edit} checking={checking} refresh={()=>void load()} saved={saved} close={close}/>:null}</div>
      {!edit&&!c&&w.approvals.length?<button className="button" onClick={()=>void open({kind:'prepare'})}>Start term handover</button>:null}
      {w.canManage&&c?<>
        <Panel title="1. Check each committee"><ul className="turnover-list">{w.units.map(u=><li key={u.id}><h3>{u.name}</h3><p>{u.checked?'Checked':'Needs a check'} · {w.people.find(p=>p.id===u.owner)?.name??'No one responsible yet'}</p>{c.state==='preparing'&&!edit?<button className="button button--secondary" onClick={()=>void open({kind:'unit',id:u.id})}>Check {u.name}</button>:null}</li>)}</ul></Panel>
        <Panel title="2. Close or carry over each item">{w.work.length>10?<ListToolbar filter={items} label="Search handover items" placeholder="Search title, reference or person" noun={['item','items']}/>:null}{w.work.length>10&&!items.results.length?<EmptyResults query={items.query} noun="items" onClear={items.clear}/>:null}<ul className="turnover-list">{(w.work.length>10?items.results:w.work).map(x=><li key={x.id}><h3>{x.reference?x.reference+' · ':''}{x.title}</h3><p>{categoryName(x.classification)} · {x.resolution==='carry'?'Carry forward':x.resolution==='resolved'?'Resolved':x.resolution==='cancelled'?'Cancelled':'Outcome needed'}{x.recordedVersion!==x.version&&x.resolution?' · Changed since you decided; check again':''}</p><p>Responsible person: {w.people.find(p=>p.id===x.owner)?.name??'Not yet recorded'}{x.successor?' · Successor: '+(w.successors.find(p=>p.id===x.successor)?.name??'Successor needs checking'):''}</p>{c.state==='preparing'&&!edit?<button className="button button--secondary" onClick={()=>void open({kind:'obligation',id:x.id})}>Record outcome for {x.reference??x.title}</button>:null}</li>)}</ul></Panel>
        <Panel title="3. Plan access and check the archive"><div className="auth-actions">
          {!edit&&c.state==='preparing'?<><button className="button button--secondary" onClick={()=>void open({kind:'transfer'})}>Plan a handover</button><button className="button" onClick={()=>void open({kind:'freeze'})}>Freeze the term</button></>:null}
          {!edit&&['preparing','frozen'].includes(c.state)?<button className="button button--secondary" onClick={()=>void open({kind:'nominate'})}>Name a custodian for private records</button>:null}
          {!edit&&['frozen','exporting','verified','rehearsal_verified'].includes(c.state)?<button className={verified?'button button--secondary':'button'} onClick={()=>void open({kind:'archive'})}>{c.state==='exporting'?'Resume archive export':'Export the archive'}</button>:null}
          {!edit&&c.state==='exporting'?<button className="button button--secondary" onClick={()=>void open({kind:'verify'})}>Check the archive</button>:null}
          {!edit&&verified?<button className="button" onClick={()=>void open({kind:'complete'})}>Complete handover</button>:null}
        </div><HowThisWorks><p>The archive operator exports records and files and checks they can be restored. Starting next term and giving new roles happen separately in Administration.</p></HowThisWorks>
          <details><summary>Archive details</summary>{w.categories.map((r,i)=><p key={i}>{categoryName(r.category)} · {r.disposition==='hold'?'Held':r.disposition==='carry'?'Carried forward':r.disposition==='dispose'?'Disposal review':'Archived'} · {r.rows} rows · Review {formatDay(r.reviewOn)}</p>)}{w.runs.map(r=><p key={r.id}>{formatDateTime(r.at)} · {r.restored?'Restore checked':'Checks pending'}</p>)}</details>
        </Panel>
      </>:null}
      {c?<Panel title="4. Successors accept their work">
        {!w.transfers.length&&!w.custody.length?<p>No successors or custodians named yet.</p>:null}
        {w.transfers.map(t=><section key={t.id}><h3>{t.name} · {t.term}</h3><p>{t.reference}</p><p>{acceptedCurrent(t)?'Accepted':'Waiting for acceptance'}</p><ul className="turnover-list">{t.work.map(x=><li key={x.id}><h3>{x.title}</h3><ArchiveFacts record={x}/><details><summary>View record</summary><p className="record-text">{x.body}</p></details></li>)}</ul>{!edit&&verified&&!acceptedCurrent(t)&&t.successor===membership?<button className="button" onClick={()=>void open({kind:'acceptRecords',id:t.id})}>Accept these records</button>:null}</section>)}
        {w.custody.map(n=><section key={n.id}><h3>{n.name} · {categoryName(n.category)}</h3><p>{n.reference}</p><p>{acceptedCurrent(n)?'Accepted':'Waiting for acceptance'} · {n.qualified?'Eligible':'Eligibility needs checking'} · Until {formatDay(n.expiresAt)}</p><ul>{n.records.map((r,i)=><li key={r.id}>{r.reference??'Record '+(i+1)}</li>)}</ul>{!edit&&verified&&!acceptedCurrent(n)&&n.qualified&&n.recipient===membership?<button className="button" onClick={()=>void open({kind:'acceptCustody',id:n.id})}>Accept {categoryName(n.category)} records</button>:null}
          {!edit&&done&&n.recipient===membership&&n.qualified?<div className="auth-actions">{(['hold','correction','release_hold']as const).map(action=><button key={action} className="button button--secondary" onClick={()=>void open({kind:'custodyAction',id:n.id,action})}>{action==='hold'?'Place a hold':action==='correction'?'Add a correction':'Release a hold'}</button>)}</div>:null}
        </section>)}
      </Panel>:null}
    </div>:null}
  </div>
}
