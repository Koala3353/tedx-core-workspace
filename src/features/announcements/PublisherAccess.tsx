import {useEffect,useRef,useState} from 'react'
import {PersonPicker,personOptions} from '../../components/list'
import {formatDateTime} from '../shared/dates'
import type {AnnouncementsApi,PublisherAccess as Access,PublisherCommand} from './api'

/** Full admins only: allow someone to post announcements to an audience, or stop it. Hidden for everyone else. */
export function PublisherAccess({api,term,self,changed}:{api:AnnouncementsApi;term:string;self:string;changed:()=>void}){
 const[access,setAccess]=useState<Access|null>(null),[person,setPerson]=useState(''),[audience,setAudience]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const pending=useRef<{signature:string;key:string}|null>(null)
 useEffect(()=>{let live=true;void api.publishers?.(term).then(v=>{if(live)setAccess(v??null)});return()=>{live=false}},[api,term])
 if(!access||!api.setPublisher)return null
 const people=access.people.filter(p=>p.membershipId!==self),chosenPerson=people.find(p=>p.membershipId===person),chosenAudience=access.audiences.find(a=>a.kind+':'+a.id===audience)
 const already=!!chosenPerson&&!!chosenAudience&&access.publishers.some(p=>p.membershipId===chosenPerson.membershipId&&p.targetKind===chosenAudience.kind&&p.targetId===chosenAudience.id)
 async function run(command:PublisherCommand,done:string){
  if(!api.setPublisher)return
  const signature=JSON.stringify(command),request=pending.current?.signature===signature?pending.current:{signature,key:crypto.randomUUID()};pending.current=request
  setBusy(true);setError('');setNotice('')
  const result=await api.setPublisher(command,request.key)
  setBusy(false)
  if(!result.ok){setError(result.error.message);if(!result.error.retryable)pending.current=null;return}
  pending.current=null;setAccess(result.value);setNotice(done);changed()
 }
 return <section className="panel publisher-access" aria-labelledby="publisher-access-title">
  <h2 id="publisher-access-title">Who can post announcements</h2>
  <p className="muted">PMs can always post to the Core team. Allow anyone else here. You can stop it at any time.</p>
  {access.publishers.length?<ul className="publisher-access__list">{access.publishers.map(p=><li key={p.membershipId+p.targetKind+p.targetId}>
   <span><strong>{p.name}</strong> posts to {p.audience}<span className="muted"> · Allowed by {p.allowedBy}{p.allowedAt?', '+formatDateTime(p.allowedAt):''}</span></span>
   <button type="button" className="button button--quiet" disabled={busy} onClick={()=>{if(window.confirm('Stop '+p.name+' from posting to '+p.audience+'? Announcements they already posted stay up.'))void run({term,membershipId:p.membershipId,targetKind:p.targetKind,targetId:p.targetId,allow:false},p.name+' can no longer post to '+p.audience+'.')}}>Stop</button>
  </li>)}</ul>:<p>Only PMs can post right now.</p>}
  <div className="publisher-access__form">
   <label htmlFor="publisher-person">Person</label>
   <PersonPicker id="publisher-person" value={person} disabled={busy} onChange={value=>{setPerson(value);setNotice('')}} options={personOptions(people.map(p=>({id:p.membershipId,name:p.name})))}/>
   <label htmlFor="publisher-audience">Audience</label>
   <select id="publisher-audience" value={audience} disabled={busy} onChange={e=>{setAudience(e.target.value);setNotice('')}}><option value="">Choose an audience</option>{access.audiences.map(a=><option key={a.kind+a.id} value={a.kind+':'+a.id}>{a.name}</option>)}</select>
   {already?<p className="muted">{chosenPerson?.name} can already post to {chosenAudience?.name}.</p>:null}
   <button type="button" className="button button--secondary" disabled={busy||!chosenPerson||!chosenAudience||already} onClick={()=>{if(chosenPerson&&chosenAudience)void run({term,membershipId:chosenPerson.membershipId,targetKind:chosenAudience.kind,targetId:chosenAudience.id,allow:true},chosenPerson.name+' can now post to '+chosenAudience.name+'.')}}>
    {chosenPerson&&chosenAudience?'Allow '+chosenPerson.name+' to post announcements to '+chosenAudience.name:'Allow posting'}
   </button>
  </div>
  {notice?<p role="status">{notice}</p>:null}
  {error?<p role="alert">{error} Your choices are kept.</p>:null}
 </section>
}
