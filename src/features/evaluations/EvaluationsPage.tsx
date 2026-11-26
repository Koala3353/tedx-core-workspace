import {useCallback,useEffect,useRef,useState} from 'react'
import {Link,useParams,useRouteLoaderData} from 'react-router'
import {PageHeading,Panel} from '../../components/Page'
import {EmptyState,ErrorState,LoadingState} from '../../components/FeedbackState'
import {forgetRecordDrafts} from '../auth/draftScope'
import type {WorkspaceContext} from '../auth/gateway'
import type {EvaluationCase,EvaluationOwnExport,EvaluationRecord,EvaluationReport,EvaluationSetup,EvaluationSummary,EvaluationWorkspace,EvaluationsApi} from './api'
import {EvaluationAction,EvaluationEditor,type EvaluationEdit} from './EvaluationEditor'
import {HowThisWorks} from '../shared/HowThisWorks'
import {formatDateTime} from '../shared/dates'
import './evaluations.css'

const date=(v:string)=>formatDateTime(v)
const path=(term:string,id?:string,view='feedback')=>'/prism'+(id?'/'+id+'/'+view:'')+'?term='+term

export function EvaluationsLink({api,term}:{api:EvaluationsApi;term:string}){
  const [w,setW]=useState<EvaluationWorkspace|null>(null)
  useEffect(()=>{let live=true;void api.workspace(term).then(v=>{if(live)setW(v)}).catch(()=>{});return()=>{live=false}},[api,term])
  if(!w?.enabled||!w.cases.length)return null
  const own=w.cases.filter(c=>c.asAuthor),reviews=w.cases.filter(c=>c.asReviewer),released=w.cases.filter(c=>c.asSubject&&c.subjectState==='released')
  const direct=new Set([...(own.length===1?own:[]),...(reviews.length===1?reviews:[]),...(released.length===1?released:[])].map(c=>c.id))
  return <div className="auth-actions">
    {own.length===1?<Link className="button button--secondary" to={path(term,own[0].id)}>Open my feedback form</Link>:null}
    {released.length===1?<Link className="button button--secondary" to={path(term,released[0].id,'summary')}>Read my released summary</Link>:null}
    {reviews.length===1?<Link className="button button--secondary" to={path(term,reviews[0].id)}>Open my PRISM review</Link>:null}
    {w.cases.some(c=>!direct.has(c.id)||c.asCustodian)?
      <Link className="button button--secondary" to={path(term)}>Check-ins (PRISM)</Link>:null}
  </div>
}

export function EvaluationsPage({api}:{api:EvaluationsApi}){
  const c=useRouteLoaderData('workspace')as WorkspaceContext,{evaluationId,view}=useParams()
  if(!('memberId'in c))return <EmptyState title="Check-ins aren't available" description="Check-ins (PRISM) are only for organizers on this term's roster."/>
  return <EvaluationBody key={c.termId+c.memberId+evaluationId+view} api={api} term={c.termId} caseId={evaluationId} view={view}/>
}

function EvaluationBody({api,term,caseId,view}:{api:EvaluationsApi;term:string;caseId?:string;view?:string}){
  const [w,setW]=useState<EvaluationWorkspace|null>(null),[r,setR]=useState<EvaluationRecord|null>(null)
  const [summary,setSummary]=useState<EvaluationSummary|null>(null),[grants,setGrants]=useState<EvaluationOwnExport[]>([])
  const [help,setHelp]=useState<{complaintsUrl:string}|null>(null)
  const [checking,setChecking]=useState(true),[failed,setFailed]=useState(false),[notice,setNotice]=useState('')
  const [mode,setMode]=useState<EvaluationEdit['kind']|null>(null),[draftId,setDraftId]=useState<string|null>(null)
  const [page,setPage]=useState(1),sequence=useRef(0),previous=useRef<EvaluationRecord|null>(null),focus=useRef<HTMLDivElement>(null)
  const priorCases=useRef<string[]>([])
  const load=useCallback(async()=>{
    const current=++sequence.current;setChecking(true);setFailed(false)
    try{
      const next=await api.workspace(term,page)
      const record=next.enabled&&caseId&&view==='feedback'?await api.record(term,caseId):null
      const result=next.enabled&&caseId&&view==='summary'?await api.summary(term,caseId):null
      const exports=record?await api.exports(term,record.caseId):[]
      const guidance=next.enabled?await api.help(term):null
      if(sequence.current!==current)return
      const visible=new Set(next.enabled?next.cases.map(c=>c.id):[])
      for(const old of priorCases.current)if(!visible.has(old))forgetRecordDrafts(old)
      priorCases.current=[...visible]
      if(caseId&&(!record&&view==='feedback'||previous.current&&record&&previous.current.reviewer!==record.reviewer||!next.enabled)){
        forgetRecordDrafts(caseId);setMode(null);setDraftId(null)
      }
      if(record&&!record.reviewer&&!previous.current)setMode('submit')
      previous.current=record;setW(next);setR(record);setSummary(result);setGrants(exports);setHelp(guidance)
    }catch{if(sequence.current===current)setFailed(true)}
    finally{if(sequence.current===current)setChecking(false)}
  },[api,term,caseId,view,page])
  useEffect(()=>{
    const check=()=>{if(document.visibilityState!=='hidden')void load()};check()
    window.addEventListener('focus',check);document.addEventListener('visibilitychange',check)
    const timer=setInterval(check,30000)
    return()=>{sequence.current++;clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)}
  },[load])
  useEffect(()=>{if(mode||notice)focus.current?.focus()},[mode,notice])
  function saved(message:string){setMode(null);setDraftId(null);setNotice(message);void load()}
  const actions={api,term,checking,saved,refresh:()=>void load()}
  const draft=r?.releaseDrafts.find(d=>d.id===draftId)
  const edit:EvaluationEdit|null=r&&mode&&mode!=='grantExport'?(mode==='publishRelease'?draft?{kind:mode,record:r,draft}:null:{kind:mode,record:r}):null
  const item=w?.cases.find(c=>c.id===caseId)
  const own=r?.submissions.find(s=>s.own)
  return <div className="evaluations">
    <PageHeading title={view==='summary'?'My released summary':view==='feedback'?'My feedback form':'Check-ins (PRISM)'}
      description="Private feedback to help each other grow. It's separate from tasks and from formal complaints."/>
    <div className="auth-actions"><Link className="button button--secondary" to="/">Overview</Link>
      {caseId?<Link className="button button--secondary" to={path(term)}>Check-ins</Link>:null}</div>
    {checking&&!w?<LoadingState title="Opening check-ins"/>:null}
    {failed?<ErrorState title="Couldn't load check-ins" description="Check your connection and try again. What you typed is kept."
      action={<button className="button button--secondary" onClick={()=>void load()}>Try again</button>}/>:null}
    {w?<div hidden={failed} inert={checking}>
      {!w.enabled?<EmptyState title="Not switched on yet" description="Check-ins (PRISM) aren't switched on yet."/>:<>
        <div ref={focus} tabIndex={-1}>{notice?<p role="status">{notice}</p>:null}</div>
        {caseId?view==='summary'?summary?<Panel title={summary.round}>
          <p>{summary.purpose}</p><p><strong>{summary.state==='released'?'Your summary is ready':summary.state==='awaiting_updated_summary'?'Waiting for an updated summary':'Waiting for release'}</strong></p>
          {summary.summary?<p className="record-text">{summary.summary}</p>:<p>No summary to read yet. You'll see a summary, not the individual feedback.</p>}
          {summary.releasedAt?<p>Released {date(summary.releasedAt)}</p>:null}
        </Panel>:<Unavailable/>:view==='feedback'&&r?<>
          <Panel title={r.round}><p><strong>{r.subject}</strong> · {r.purpose}</p>
            <p>{r.reviewer?'You\'re reviewing this. Keep it confidential.':'Only you and the assigned reviewers can read your feedback.'}</p>
            <p>Submit by {date(r.closesAt)}. You can make changes until {date(r.appealUntil)}.</p>
            <details className="work-section"><summary>How long this is kept</summary>
              <p>Kept for {r.retention.days} days after the change deadline, unless it has to be held longer. Owner: {r.retention.owner}. Basis: {r.retention.basis}.</p>
              <p>{w.anonymity}</p></details>
          </Panel>
          {edit?<EvaluationEditor key={edit.kind+draftId} edit={edit} {...actions} close={()=>setMode(null)}/>:null}
          {!r.reviewer?<Panel title={own?'Your submitted feedback':'Write your feedback'}>
            {own?<p>Revision {own.revision} · {own.state==='submitted'?'Submitted':'Withdrawn'}</p>:<p>You haven't submitted feedback yet.</p>}
            {!edit?<div className="auth-actions"><button className="button" onClick={()=>setMode('submit')}>{own?'Update my feedback':'Write feedback'}</button>
              {own?.state==='submitted'?<EvaluationAction {...actions} id={r.caseId} command={{term,kind:'submit',caseId:r.caseId,revision:own.revision,answers:null,withdraw:true}}
                label="Withdraw my feedback" notice="Feedback withdrawn. Earlier versions are still kept."
                confirm="Withdraw your feedback? Earlier versions are still kept for the retention period."/>:null}</div>:null}
            {own?<details className="work-section"><summary>Earlier versions</summary>{own.history?.map(h=><article key={h.revision}>
              <h3>Revision {h.revision} · {h.state==='submitted'?'Submitted':'Withdrawn'}</h3><p>{date(h.at)}</p>
              {r.template.map(p=>h.answers?.[p.key]?<p className="record-text" key={p.key}><strong>{p.label}</strong><br/>{h.answers[p.key]}</p>:null)}
            </article>)}</details>:null}
          </Panel>:<>
            <Panel title="Feedback to review">
              <p>If you have a conflict of interest, stop and ask through Privacy rights and requests for this to be reassigned.</p>
              {!edit?<div className="auth-actions"><button className="button button--secondary" onClick={()=>setMode('note')}>Add reviewer note</button>
                {r.canPrepare?<button className="button" onClick={()=>setMode('prepareRelease')}>Write a summary</button>:null}</div>:null}
              {!r.submissions.length?<p>No feedback submitted yet.</p>:null}
              {r.submissions.map(s=><article key={s.id}><h3>{s.author} · revision {s.revision}</h3>
                {r.template.map(p=>s.answers?.[p.key]?<p className="record-text" key={p.key}><strong>{p.label}</strong><br/>{s.answers[p.key]}</p>:null)}</article>)}
            </Panel>
            <details className="work-section"><summary>Reviewer notes</summary>{r.notes.length?r.notes.map(n=><article key={n.id}>
              <h3>{n.author}</h3><p>{date(n.at)}</p><p className="record-text">{n.body}</p></article>):<p>No notes yet.</p>}</details>
            <Panel title="Summary and release"><p>Summaries can be released from {date(r.releaseAfter)}. Another reviewer has to check a summary before it's released.</p>
              {!r.releaseDrafts.length?<p>No summary written yet.</p>:null}
              {r.releaseDrafts.map(d=><article key={d.id}><h3>{d.published?'Released summary':d.current?'Summary draft':'Older draft'}</h3><p className="record-text">{d.summary}</p>
                <p>{d.own?'Written by you · another reviewer releases it':'Written by another reviewer'}</p>
                {r.canRelease&&d.current&&!d.published&&!d.own&&!edit?<button className="button" onClick={()=>{setDraftId(d.id);setMode('publishRelease')}}>Review and release to {r.subject}</button>:null}
              </article>)}</Panel>
          </>}
          <ExportRecord api={api} term={term} caseId={r.caseId} grants={grants} checking={checking}/>
        </>:<Unavailable/>:<>
          {!w.cases.length?<EmptyState title="Nothing here yet" description="When you're asked to give feedback, or your summary is ready, it shows up here. Feedback is optional."/>:null}
          {w.cases.some(c=>c.asAuthor)?<DeskList title="Feedback I'm giving" cases={w.cases.filter(c=>c.asAuthor)} term={term}/>:null}
          {w.cases.some(c=>c.asReviewer)?<DeskList title="Feedback I'm reviewing" cases={w.cases.filter(c=>c.asReviewer)} term={term}/>:null}
          {w.cases.some(c=>c.asSubject)?<DeskList title="My summaries" cases={w.cases.filter(c=>c.asSubject)} term={term} subject/>:null}
          {w.hasMore||page>1?<div className="auth-actions"><button className="button button--secondary" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</button>
            <button className="button button--secondary" disabled={!w.hasMore} onClick={()=>setPage(p=>p+1)}>Next</button></div>:null}
          {w.cases.some(c=>c.asCustodian)?<Custody {...actions}/>:null}
        </>}
        <HowThisWorks title="Privacy and complaints">
          <p>{w.anonymity}</p><p>Feedback is optional. It isn't a disciplinary finding. If you ask to see or correct your record, other people's feedback stays private.</p>
          {item?<Retention item={item}/>:null}
          <Link className="button button--secondary" to={'/privacy?term='+term}>Privacy rights and requests</Link>
          <p>For allegations or formal complaints, use the school's complaint process instead of this form.</p>
          {help?<a className="button button--secondary" href={help.complaintsUrl} target="_blank" rel="noreferrer">School complaint process</a>:<p>The school complaint link isn't set up yet. Ask through Privacy rights and requests.</p>}
        </HowThisWorks>
      </>}
    </div>:null}
  </div>
}
function Unavailable(){return <EmptyState title="You can't open this" description="It isn't assigned to you. Go back to Check-ins to see what is."/>}
function Retention({item}:{item:EvaluationCase}){return <p>Kept for {item.retention.days} days after the round's change deadline, unless it has to be held longer. Owner: {item.retention.owner}. Basis: {item.retention.basis}.</p>}
function DeskList({title,cases,term,subject=false}:{title:string;cases:EvaluationCase[];term:string;subject?:boolean}){
  return <Panel title={title}>{!cases.length?<p>Nothing here yet.</p>:<ul className="evaluation-list">{cases.map(c=><li key={c.id}>
    <h3>{c.round}{!subject&&c.subject?' · '+c.subject:''}</h3><p>{c.purpose}</p>
    <p>{subject?c.subjectState==='released'?'Summary ready':'Waiting for release':c.asAuthor?c.authorState==='submitted'?'Feedback submitted':c.authorState==='withdrawn'?'Feedback withdrawn':'Not submitted yet':'Waiting for your review'}</p>
    <Link className="button" to={path(term,c.id,subject?'summary':'feedback')}>{subject?'Read summary':c.asAuthor?'Open feedback form':'Open review'}</Link>
  </li>)}</ul>}</Panel>
}
function ExportRecord({api,term,caseId,grants,checking}:{api:EvaluationsApi;term:string;caseId:string;grants:EvaluationOwnExport[];checking:boolean}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),live=useRef(true)
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  async function download(grant:string){
    setBusy(true);setError('')
    try{const record=await api.exportRecord(term,grant);if(!record||record.caseId!==caseId)throw Error()
      if(!live.current)return
      const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)+'\n'],{type:'application/json;charset=utf-8'}))
      const link=document.createElement('a');link.href=url;link.download='approved-prism-record.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch{if(live.current)setError('Couldn\'t download your copy. The approval may have changed. Refresh the page and try again.')}
    finally{if(live.current)setBusy(false)}
  }
  return <details className="work-section"><summary>Download a copy</summary><p>You can download a copy of your record once the person who runs PRISM approves it. Keep the copy private.</p>
    {!grants.length?<p>No download approved yet. Ask through Privacy rights and requests.</p>:grants.map(g=><div key={g.id}>
      <p>Approved · available until {date(g.expiresAt)}</p><button className="button button--secondary" disabled={busy||checking} onClick={()=>void download(g.id)}>Download my copy</button></div>)}
    {error?<p role="alert">{error}</p>:null}</details>
}
type Actions={api:EvaluationsApi;term:string;checking:boolean;saved:(n:string)=>void;refresh:()=>void}
function Custody(actions:Actions){
  const [open,setOpen]=useState(false),[setup,setSetup]=useState<EvaluationSetup|null>(null),[report,setReport]=useState<EvaluationReport|null>(null)
  const [error,setError]=useState(''),[revision,setRevision]=useState(0),[chosen,setChosen]=useState<string|null>(null)
  const {api,term}=actions
  useEffect(()=>{if(!open)return;let live=true
    void Promise.all([api.setup(term),api.report(term)]).then(([s,r])=>{if(live){setSetup(s);setReport(r);setError('')}})
      .catch(()=>{if(live){setSetup(null);setReport(null);setError('Couldn\'t load these controls. Sign in again, then retry.')}})
    return()=>{live=false}
  },[api,term,open,revision,actions.checking])
  const saved=(n:string)=>{setChosen(null);setRevision(v=>v+1);actions.saved(n)}
  const current=setup?.rounds.flatMap(r=>r.cases).find(c=>c.id===chosen)
  return <details className="work-section" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Custodian: downloads and term report</summary>
    {open?<>{error?<p role="alert">{error}</p>:null}
      {current&&setup?<EvaluationEditor {...actions} saved={saved} edit={{kind:'grantExport',caseRecord:current,people:setup.people}} close={()=>setChosen(null)}/>:null}
      {setup?.rounds.map(r=><Panel title={r.label} key={r.id}>{r.cases.map(c=><article key={c.id}>
        <h3>{setup.people.find(p=>p.id===c.subjectId)?.name??'Current subject'}</h3>
        {!chosen?<button className="button button--secondary" onClick={()=>setChosen(c.id)}>Approve download for this person</button>:null}
        {c.exports.filter(g=>!g.revoked).map(g=><div key={g.id}><p>Export for {setup.people.find(p=>p.id===g.memberId)?.name??'Named participant'} · ends {date(g.expiresAt)}</p>
          <EvaluationAction {...actions} saved={saved} id={g.id} command={{kind:'revokeExport',term,grant:g.id,version:g.version}}
            label="Revoke download approval" notice="Download approval revoked."/></div>)}
      </article>)}</Panel>)}
      {report?<Panel title="Term report"><p>Shows only whether at least five people received a summary this term. No themes, scores, names or exact counts.</p>
        <p>{report.state==='published'?'Published: 5 or more people. Locked on '+date(report.at!):report.state==='suppressed'?
          'Not published: fewer than five people. No smaller count is shown.':report.state==='not_ready'?'Available once every round has closed and its release date has passed.':'Ready to publish. You can publish this once.'}</p>
        {report.state==='ready'?<EvaluationAction {...actions} saved={saved} id="cohort-report" command={{term,kind:'report'}} label="Publish term report"
          notice="Term report published and locked." confirm="Publish the term report? You can only publish it once."/>:null}
      </Panel>:null}
    </>:null}
  </details>
}
