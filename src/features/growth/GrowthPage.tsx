import {useCallback,useEffect,useRef,useState} from 'react'
import {useAutoRefresh} from '../shared/useAutoRefresh'
import {Link,useRouteLoaderData,useSearchParams} from 'react-router'
import {EmptyState,ErrorState,LoadingState} from '../../components/FeedbackState'
import {PageHeading,Panel} from '../../components/Page'
import type {WorkspaceContext} from '../auth/gateway'
import {forgetRecordDrafts} from '../auth/draftScope'
import {privateAppointmentIcs} from '../calendar/ics'
import {categoryLabels,type Assignment,type Assignments,type Checkin,type Goal,type GrowthApi,type GrowthWorkspace,type Relationship} from './api'
import {GoalProgress,GrowthAction,GrowthEditor,type GrowthEdit} from './GrowthEditor'
import {RefreshButton} from '../shared/RefreshButton'
import {formatDateTime,formatDay,formatTime} from '../shared/dates'
import './growth.css'

const during=(start:string,end:string)=>formatDateTime(start)+' – '+(formatDay(start)===formatDay(end)?formatTime(end):formatDateTime(end))
const states={scheduled:'Scheduled',completed:'Completed',missed:'Missed',cancelled:'Cancelled',ended:'Mentorship ended'}
type Choice={kind:'goal';id:string|null}|{kind:'share'|'schedule'|'reschedule'|'note';id:string}
type Actions={api:GrowthApi;term:string;checking:boolean;refresh:()=>void;saved:(notice:string)=>void}

function resolveEdit(w:GrowthWorkspace,q:Choice):GrowthEdit|null{
  if(!w.editable)return null
  const goal=w.goals.find(g=>g.id===q.id&&g.own)
  if(q.kind==='goal')return q.id===null||goal?{kind:'goal',goal}:null
  if(q.kind==='share')return goal?{kind:'share',goal,choices:w.relationships.filter(r=>!r.asMentor&&r.state==='active')}:null
  if(q.kind==='schedule'){
    const relationship=w.relationships.find(r=>r.id===q.id&&r.state==='active')
    return relationship?{kind:'schedule',relationship}:null
  }
  const checkin=w.checkins.find(c=>c.id===q.id&&c.canAct)
  if(!checkin)return null
  if(q.kind==='note')return {kind:'note',checkin}
  const relationship=w.relationships.find(r=>r.id===checkin.relationship&&r.state==='active')
  return relationship?{kind:'schedule',relationship,checkin}:null
}

export function GrowthLink({api,term}:{api:GrowthApi;term:string}){
  const [search]=useSearchParams(),[enabled,setEnabled]=useState<string|null>(null)
  useEffect(()=>{
    let live=true,sequence=0
    const check=()=>{
      const current=++sequence
      void api.enabled(term).then(active=>{if(live&&current===sequence)setEnabled(active?term:null)})
        .catch(()=>{if(live&&current===sequence)setEnabled(null)})
    }
    check();window.addEventListener('focus',check)
    return()=>{live=false;window.removeEventListener('focus',check)}
  },[api,term])
  return enabled===term?<Link className="button button--secondary" to={'/mentoring'+(search.has('term')?'?term='+term:'')}>Goals and mentoring</Link>:null
}

export function GrowthPage({api}:{api:GrowthApi}){
  const workspace=useRouteLoaderData('workspace')as WorkspaceContext
  if(!('memberId'in workspace))return <EmptyState title="Goals and mentoring aren't available" description="Only organizers on this term's roster can use goals and mentoring."/>
  return <GrowthBody key={workspace.termId+':'+workspace.memberId} term={workspace.termId} api={api}/>
}

function GrowthBody({term,api}:{term:string;api:GrowthApi}){
  const [workspace,setWorkspace]=useState<GrowthWorkspace|null>(null)
  const [checking,setChecking]=useState(true),[failed,setFailed]=useState(false)
  const [choice,setChoice]=useState<Choice|null>(null),[notice,setNotice]=useState('')
  const generation=useRef(0),activeChoice=useRef<Choice|null>(null),lastWorkspace=useRef<GrowthWorkspace|null>(null)
  const editor=useRef<HTMLDivElement>(null),receipt=useRef<HTMLParagraphElement>(null)
  const load=useCallback(async()=>{
    const current=++generation.current
    setChecking(true);setFailed(false)
    try{
      const next=await api.read(term)
      if(generation.current!==current)return
      const old=lastWorkspace.current
      if(old){
        const visible=new Set(next?[...next.goals,...next.checkins,...next.relationships].map(r=>r.id):[])
        for(const record of [...old.goals,...old.checkins,...old.relationships])if(!visible.has(record.id))forgetRecordDrafts(record.id)
      }
      if(activeChoice.current&&(!next||!resolveEdit(next,activeChoice.current))){
        forgetRecordDrafts(activeChoice.current.id??'new-goal')
        activeChoice.current=null;setChoice(null)
        setNotice(next?'Your mentoring assignment or sharing changed, so that form was closed.':'')
      }
      if(!next)setNotice('')
      lastWorkspace.current=next
      setWorkspace(next)
    }catch{if(generation.current===current)setFailed(true)}
    finally{if(generation.current===current)setChecking(false)}
  },[api,term])
  useEffect(()=>{
    void load()
    return()=>{generation.current++}
  },[load])
  useAutoRefresh(()=>void load(),{intervalMs:30_000})
  useEffect(()=>{
    const expires=workspace?.relationships.filter(r=>r.state==='active').map(r=>Date.parse(r.endsAt)).sort((a,b)=>a-b)[0]
    if(!expires)return
    const delay=Math.min(Math.max(expires-Date.now()+50,50),2147483647)
    const timer=setTimeout(()=>void load(),delay)
    return()=>clearTimeout(timer)
  },[load,workspace])
  useEffect(()=>{if(choice)editor.current?.focus()},[choice])
  useEffect(()=>{if(notice)receipt.current?.focus()},[notice])

  function open(q:Choice){setNotice('');activeChoice.current=q;setChoice(q)}
  function close(){activeChoice.current=null;setChoice(null)}
  function saved(message:string){close();setNotice(message);void load()}
  const actions={api,term,checking,refresh:()=>void load(),saved}
  const edit=workspace&&choice?resolveEdit(workspace,choice):null
  const own=workspace?.goals.filter(g=>g.own)??[],shared=workspace?.goals.filter(g=>!g.own)??[]
  const live=workspace?.relationships.filter(r=>r.state==='active'&&!r.asMentor)??[]
  const next=workspace?.checkins.find(c=>c.state==='scheduled'&&Date.parse(c.endsAt)>Date.now())
  return <div className="growth">
    <PageHeading title="Goals and mentoring" description={workspace?.termLabel}/>
    {failed?<ErrorState title="Couldn't load goals and mentoring" description="Check your connection and try again. What you typed is kept."
      action={<button className="button button--secondary" onClick={()=>void load()}>Try again</button>}/>:null}
    {!workspace&&checking?<LoadingState title="Loading goals and mentoring"/>:null}
    {!workspace&&!checking&&!failed?<EmptyState title="Mentoring isn't switched on yet" description="Goals and mentoring aren't open for this term yet. Ask your committee head about mentoring."
      action={<Link className="button button--secondary" to="/people">Find a contact</Link>}/>:null}
    {workspace?<div hidden={failed}>
      <p>Set a private goal for yourself or share one with a current mentor. Check-ins are optional.</p>
      {next?<p><strong>Next check-in</strong> · {during(next.startsAt,next.endsAt)}</p>:null}
      {notice?<p ref={receipt} tabIndex={-1} role="status">{notice}</p>:null}
      {checking?<p role="status">Updating…</p>:null}
      <div inert={checking}>
        {edit?<div ref={editor} tabIndex={-1}><GrowthEditor key={choice?.kind+':'+choice?.id} edit={edit}
          {...actions} close={close}/></div>:null}
        <Panel title="My goals">
          {!own.length?<p>Start with one small goal. You can keep it private and add a target when you are ready.</p>:null}
          {workspace.editable&&!edit?<button className="button" onClick={()=>open({kind:'goal',id:null})}>Add a personal goal</button>:null}
          <ul className="growth-list">{own.map(g=><li key={g.id}>
            <GoalDetails goal={g} relationship={workspace.relationships.find(r=>r.id===g.sharedWith)}/>
            {workspace.editable?<GoalProgress goal={g} {...actions} checking={checking||!!edit}/>:null}
            {!edit?<div className="auth-actions">
              {workspace.editable?<button className="button button--secondary" onClick={()=>open({kind:'goal',id:g.id})}>Edit goal details</button>:null}
              {workspace.editable&&live.length?<button className="button button--secondary" onClick={()=>open({kind:'share',id:g.id})}>
                {g.sharedWith?'Change goal sharing':'Share with a mentor'}</button>:null}
              {g.hasSharingRecord?<GrowthAction {...actions} command={{kind:'share',term,id:g.id,version:g.version,relationship:null}}
                label="Stop sharing goal" notice="Sharing stopped. Your goal is still saved."/>:null}
            </div>:null}
          </li>)}</ul>
        </Panel>
        {shared.length?<Panel title="Goals your mentees shared"><ul className="growth-list">{shared.map(g=><li key={g.id}>
          <GoalDetails goal={g}/><p>{g.progress}% progress · Shared by {g.learner}</p>
        </li>)}</ul></Panel>:null}
        <Panel title="Mentoring">
          {!workspace.relationships.length?<p>No mentor yet. When one is set up for you, you can choose whether to join here. <Link className="button button--secondary" to="/people">Find a contact</Link></p>:null}
          <ul className="growth-list">{workspace.relationships.map(r=><li key={r.id}>
            <h3>{r.asMentor?'Mentee '+r.mentee:'Mentor '+r.mentor}</h3>
            <p>{r.state==='offered'?'Waiting for your answer':r.state==='upcoming'?'Accepted · starts later':r.state==='active'?'Active':'Ended'} · {during(r.startsAt,r.endsAt)}</p>
            {!edit?<div className="auth-actions">
              {r.state==='offered'&&workspace.editable?<div><p>Joining lets you both set up check-ins. You choose which goals to share.</p>
                <GrowthAction {...actions} command={{kind:'consent',term,id:r.id,version:r.version,accept:true}}
                  label="Join mentoring" notice="Mentoring accepted."/></div>:null}
              {r.state==='active'&&workspace.editable?<button className="button button--secondary" onClick={()=>open({kind:'schedule',id:r.id})}>
                Schedule a check-in</button>:null}
              {r.state!=='ended'?<GrowthAction {...actions} command={{kind:'consent',term,id:r.id,version:r.version,accept:false}}
                label={r.state==='offered'?'Decline':'End mentoring'}
                notice="Mentoring ended." confirm="End mentoring? Your mentor will no longer see your shared goals. You keep your own goals."/>:null}
            </div>:null}
          </li>)}</ul>
        </Panel>
        <Panel title="Check-ins" id="check-ins">
          {!workspace.checkins.length?<p>No check-ins yet. Schedule one with your mentor and it shows up here.</p>:null}
          <ul className="growth-list">{workspace.checkins.map(c=><li key={c.id}>
            <CheckinDetails checkin={c} relationship={workspace.relationships.find(r=>r.id===c.relationship)}
              {...actions} open={edit?undefined:open}/>
          </li>)}</ul>
        </Panel>
        {workspace.canManage?<MentoringAssignments {...actions}/>:null}
        <details className="work-section"><summary>Who can see my goals and notes?</summary>
          <p>Each goal shows who can see it. You can always see your own check-in history. The app's database admins can access stored records for backups and recovery.</p>
          <Link className="button button--secondary" to="/privacy">Privacy information</Link>
        </details>
        <details className="work-section"><summary>Download my goals and notes</summary>
          <p>Download a file (JSON) with your goals and the notes you wrote.</p>
          <DownloadAction label="Download my goals and notes" disabled={checking}
            download={async()=>({name:'my-learning-record.json',type:'application/json;charset=utf-8',data:JSON.stringify(await api.exportOwn(term),null,2)+'\n'})}/>
        </details>
      </div>
    </div>:null}
  </div>
}

function GoalDetails({goal,relationship}:{goal:Goal;relationship?:Relationship}){
  return <>
    <h3>{goal.title}</h3>
    <p>{categoryLabels[goal.category]}{goal.own?' · '+(relationship?'Shared with '+relationship.mentor:'Only you can see this'):''}</p>
    {goal.target?<p className="record-text">{goal.target}</p>:null}
  </>
}

function CheckinDetails({checkin:c,relationship:r,open,...actions}:Actions&{
  checkin:Checkin;relationship?:Relationship;open?:((c:Choice)=>void)
}){
  const now=Date.now(),date=Date.parse(c.startsAt),scheduled=c.state==='scheduled'
  return <>
    <h3>{c.title??'Mentoring check-in'}</h3>
    <p>{states[c.state]} · {during(c.startsAt,c.endsAt)}</p>
    {r?<p>With {r.asMentor?r.mentee:r.mentor}</p>:null}
    {open&&c.canAct?<div className="auth-actions">
      {c.state!=='cancelled'?<button className="button button--secondary" onClick={()=>open({kind:'note',id:c.id})}>Add a check-in note</button>:null}
      {scheduled&&date>now?<button className="button button--secondary" onClick={()=>open({kind:'reschedule',id:c.id})}>Change check-in</button>:null}
      {scheduled?(['completed','missed','cancelled'] as const).filter(action=>action==='cancelled'||
        action==='completed'&&date<=now||action==='missed'&&Date.parse(c.endsAt)<=now).map(action=><GrowthAction key={action} {...actions}
        command={{kind:'checkin',term:actions.term,id:c.id,version:c.version,relationship:c.relationship,action,startsAt:null,endsAt:null,title:null}}
        label={action==='completed'?'Mark completed':action==='missed'?'Mark missed':'Cancel check-in'}
        notice={'Check-in '+action+'.'} confirm={action==='cancelled'?'Cancel this check-in?':undefined}/>):null}
    </div>:null}
    {c.notes.length?<details className="work-section"><summary>Check-in notes</summary>
      <ul className="growth-list">{c.notes.map(n=><li key={n.id}>
        <strong>{n.author}</strong> · {formatDateTime(n.at)}
        {n.body?<p className="record-text">{n.body}</p>:null}
        {n.nextAction?<p className="record-text">Next action · {n.nextAction}</p>:null}
      </li>)}</ul></details>:null}
    {c.canExport?<details className="work-section"><summary>Add to my calendar</summary>
      <p>The calendar file only shows the time and “Private appointment”. If the check-in changes later, update it here and download a new file.</p>
      <DownloadAction label="Add to my calendar (.ics)" disabled={actions.checking}
        download={async()=>({name:'private-appointment.ics',type:'text/calendar;charset=utf-8',
          data:privateAppointmentIcs(await actions.api.calendar(actions.term,c.id,c.version))})}/>
    </details>:null}
  </>
}

function DownloadAction({label,disabled,download}:{label:string;disabled:boolean;download:()=>Promise<{name:string;type:string;data:string}>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  async function prepare(){
    setBusy(true);setError('')
    try{
      const file=await download()
      if(!mounted.current)return
      const url=URL.createObjectURL(new Blob([file.data],{type:file.type})),link=document.createElement('a')
      link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch{if(mounted.current)setError('Couldn\'t download the file. Refresh the page and try again.')}
    finally{if(mounted.current)setBusy(false)}
  }
  return <>{error?<p role="alert">{error}</p>:null}
    <button className="button button--secondary" disabled={busy||disabled} onClick={()=>void prepare()}>{label}</button></>
}

function MentoringAssignments(actions:Actions){
  const [open,setOpen]=useState(false),[data,setData]=useState<Assignments|null>(null),[failed,setFailed]=useState(false)
  const [version,setVersion]=useState(0),[choice,setChoice]=useState<Assignment|true|null>(null)
  const {api,term}=actions
  useEffect(()=>{
    if(!open)return
    let live=true
    void api.assignments(term).then(value=>{if(live){setData(value);setFailed(false)}})
      .catch(()=>{if(live){setData(null);setFailed(true)}})
    return()=>{live=false}
  },[api,term,open,version])
  function saved(message:string){setChoice(null);setVersion(v=>v+1);actions.saved(message)}
  const latest=data&&typeof choice==='object'&&choice?data.assignments.find(r=>r.id===choice.id):undefined
  return <details className="work-section" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>Manage mentor assignments</summary>
    {open?<Panel title="Mentor assignments">
      {failed?<p role="alert">Couldn't load assignments. Sign in again, then try again.</p>:null}
      <RefreshButton onRefresh={()=>setVersion(v=>v+1)}/>
      {data?<><p>Approving sends the mentee an offer they can accept or decline. Replacing a mentor ends the old assignment and sends a new offer.</p>
        {choice?<GrowthEditor key={latest?.id??'new'} {...actions} edit={{kind:'assignment',data,previous:latest}}
          close={()=>setChoice(null)} saved={saved} refresh={()=>{setVersion(v=>v+1);actions.refresh()}}/>:
          <button className="button" onClick={()=>setChoice(true)}>New assignment</button>}
        <ul className="growth-list">{data.assignments.map(r=><li key={r.id}>
          <strong>{r.mentee} · {r.mentor}</strong><p>{r.state} · {during(r.startsAt,r.endsAt)}</p>
          {!choice?<div className="auth-actions"><button className="button button--secondary" onClick={()=>setChoice(r)}>Replace {r.mentee}’s mentor</button>
            {!r.revoked?<GrowthAction {...actions} command={{kind:'consent',term,id:r.id,version:r.version,accept:false}}
              label="End assignment" notice="Assignment ended." confirm="End this mentoring assignment? The mentor will lose access to shared goals." saved={saved}/>:null}
          </div>:null}
        </li>)}</ul>
      </>:!failed?<LoadingState title="Loading assignments"/>:null}
    </Panel>:null}
  </details>
}
