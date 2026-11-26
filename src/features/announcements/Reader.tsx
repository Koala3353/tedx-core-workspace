import {useEffect,useState} from 'react'
import {Link,useParams,useRouteLoaderData} from 'react-router'
import {PageHeading} from '../../components/Page'
import {TextField} from '../../components/TextField'
import {isGuest,type WorkspaceContext} from '../auth/gateway'
import {forgetRecordDrafts} from '../auth/draftScope'
import {useFinDecision} from '../finance/DecisionMemory'
import type {FilesApi} from '../files/api'
import type {Announcement,AnnouncementPage,AnnouncementsApi} from './api'
import {formatDateTime} from '../shared/dates'
import {Pager} from '../shared/Pager'
import './announcements.css'
const date=(v:string)=>formatDateTime(v)
function Facts({row}:{row:Announcement}){return <p>{row.audience.name} · Published by {row.publisherName} · {date(row.publishedAt)} · {row.expired?'Expired':'Expires'} {date(row.expiresAt)}{row.pinned?' · Pinned':''}{row.requiredAck?row.acknowledged?' · You\'ve confirmed you read this':' · Confirm you\'ve read this':''}</p>}
function identity(c:WorkspaceContext){return c.termId+':'+(isGuest(c)?c.guestAccessId:c.termMembershipId)}
export function Announcements({api}:{api:AnnouncementsApi}){const c=useRouteLoaderData('workspace')as WorkspaceContext;return <AnnouncementList key={identity(c)} api={api} context={c}/>}
function AnnouncementList({api,context}:{api:AnnouncementsApi;context:WorkspaceContext}){
 const[page,setPage]=useState(1),[query,setQuery]=useState(''),[epoch,setEpoch]=useState(0),[result,setResult]=useState<AnnouncementPage|null>(null),[error,setError]=useState(false),term=context.termId
 useEffect(()=>{let live=true;const timer=setTimeout(()=>{setResult(null);setError(false);void api.list(term,page,query.trim()).then(v=>{if(live)setResult(v)}).catch(()=>{if(live)setError(true)})},query?200:0);return()=>{live=false;clearTimeout(timer)}},[api,term,page,query,epoch,context])
 useEffect(()=>{const check=()=>{if(document.visibilityState!=='hidden'){setResult(null);setEpoch(n=>n+1)}};window.addEventListener('focus',check);return()=>window.removeEventListener('focus',check)},[])
 const canManage=!isGuest(context)&&context.capabilities.some(c=>['admin.configure','committee.manage'].includes(c)),[canPublish,setCanPublish]=useState(false)
 useEffect(()=>{let live=true;if(canManage)void api.options(term).then(o=>{if(live)setCanPublish(o.targets.length>0)}).catch(()=>{if(live)setCanPublish(false)});return()=>{live=false}},[api,term,canManage])
 return <section className="announcement-reader"><PageHeading title="Announcements" description="Team decisions, deadlines and updates."/><TextField id="announcement-search" label="Find an announcement" maxLength={120} value={query} onChange={e=>{setResult(null);setPage(1);setQuery(e.target.value)}}/>{canPublish?<p><Link to="/admin/announcements">Publishing tools</Link></p>:null}
 {error?<p role="alert">Couldn't load announcements. Check your connection and try again.</p>:!result?<p role="status">Loading announcements…</p>:<>{result.total?<p>{result.total} announcement{result.total===1?'':'s'}</p>:null}{result.items.length?result.items.map(row=><article key={row.id}><h2><Link to={'/announcements/'+row.id}>{row.title}</Link></h2><Facts row={row}/></article>):<p>{query.trim()?'No announcements match your search.':'No announcements yet. Leadership posts decisions and deadlines here.'}</p>}<Pager label="Announcement pages" page={page} total={result.total} onMove={setPage}/></>}</section>
}
export function AnnouncementDetail({api,files}:{api:AnnouncementsApi;files?:FilesApi}){const c=useRouteLoaderData('workspace')as WorkspaceContext,{announcementId=''}=useParams();return <Detail key={identity(c)+announcementId} api={api} files={files} term={c.termId} id={announcementId} access={c}/>}
function Detail({api,files,term,id,access}:{api:AnnouncementsApi;files?:FilesApi;term:string;id:string;access:WorkspaceContext}){
 const[row,setRow]=useState<Announcement|null>(null),[state,setState]=useState('loading'),[epoch,setEpoch]=useState(0),[fileError,setFileError]=useState(''),[fileBusy,setFileBusy]=useState(false)
 const m=useFinDecision(api,'announcement-ack:'+id,{})
 function refresh(){setRow(null);setState('loading');setEpoch(n=>n+1)}
 useEffect(()=>{let live=true;setRow(null);setState('loading');void api.detail(term,id).then(v=>{if(!live)return;setRow(v);setState(v?'ready':'missing');if(!v)forgetRecordDrafts(id)}).catch(e=>{if(!live)return;setRow(null);setState('error');if(e?.denied)forgetRecordDrafts(id)});return()=>{live=false}},[api,term,id,epoch,access])
 useEffect(()=>{const check=()=>{if(document.visibilityState!=='hidden')refresh()};window.addEventListener('focus',check);return()=>window.removeEventListener('focus',check)},[])
 async function acknowledge(retry=false){const r=await m.run(retry?undefined:row?{action:'ack',term,id,materialRevisionId:row.materialRevisionId,version:row.version}:undefined);if(r||!m.pending)refresh()}
 async function download(asset:Announcement['attachments'][number]){if(!files)return;setFileBusy(true);setFileError('');try{const blob=await files.download(asset.workId,asset.assetId),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=asset.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch{setFileError('Couldn\'t download this file. You may not have access to it. Ask the person who posted the announcement.')}finally{setFileBusy(false)}}
 return <section className="announcement-reader"><Link to="/announcements">All announcements</Link>{state==='loading'?<p role="status">Loading announcement…</p>:state==='missing'?<p>This announcement doesn't exist or isn't shared with you.</p>:state==='error'?<p role="alert">Couldn't load this announcement. Check your connection and try again.</p>:row?<><PageHeading title={row.title}/><Facts row={row}/><p className="announcement-body">{row.body}</p>{row.requiredAck&&!row.acknowledged?<button className="button" disabled={m.locked} onClick={()=>void acknowledge()}>I've read this</button>:null}{row.attachments.map(a=><p key={a.assetId}><button className="button button--secondary" disabled={fileBusy||!files} onClick={()=>void download(a)}>Download {a.name}</button></p>)}</>:null}{m.pending?<button className="button" disabled={m.busy} onClick={()=>void acknowledge(true)}>Try again</button>:null}{m.error?<p role="alert">{m.error} The announcement may have changed. Check it and try again.</p>:null}{fileError?<p role="alert">{fileError}</p>:null}</section>
}
export function ContextAnnouncements({api}:{api?:AnnouncementsApi}){const c=useRouteLoaderData('workspace')as WorkspaceContext|undefined;return c?<AnnouncementHighlights key={identity(c)} api={api} term={c.termId}/>:null}
export function AnnouncementHighlights({api,term,refresh=0}:{api?:AnnouncementsApi;term:string;refresh?:number}){
 const[data,setData]=useState<AnnouncementPage|null>(null),[error,setError]=useState(false),[epoch,setEpoch]=useState(0),context=useRouteLoaderData('workspace')
 useEffect(()=>{let live=true;setData(null);setError(false);if(api)void api.list(term).then(v=>{if(live)setData(v)}).catch(()=>{if(live){setData(null);setError(true)}});return()=>{live=false}},[api,term,refresh,epoch,context])
 useEffect(()=>{const check=()=>{if(document.visibilityState!=='hidden'){setData(null);setEpoch(n=>n+1)}};window.addEventListener('focus',check);return()=>window.removeEventListener('focus',check)},[])
 if(!api)return null
 const rows=data?.items.filter(r=>!r.expired&&(r.pinned||r.requiredAck&&!r.acknowledged)).slice(0,3)??[]
 return <section className="announcement-highlights" aria-label="Team announcements"><h2>Team announcements</h2>{error?<p>Couldn't load announcements right now.</p>:rows.length?<ul>{rows.map(r=><li key={r.id}><Link to={'/announcements/'+r.id}>{r.title}</Link> · {r.requiredAck&&!r.acknowledged?'Read and confirm':'Read'} · {r.audience.name}</li>)}</ul>:null}<Link to="/announcements">All announcements</Link></section>
}
