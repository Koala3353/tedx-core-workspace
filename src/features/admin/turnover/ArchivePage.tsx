import {useCallback,useEffect,useRef,useState} from 'react'
import {useAutoRefresh} from '../../shared/useAutoRefresh'
import {Link,useParams,useRouteLoaderData,useSearchParams} from 'react-router'
import {PageHeading,Panel} from '../../../components/Page'
import {EmptyState,ErrorState,LoadingState} from '../../../components/FeedbackState'
import type {WorkspaceContext} from '../../auth/gateway'
import type {ArchivedWork,ArchivePage as ArchiveResult,TurnoverApi} from './api'
import {formatDateTime,formatDay} from '../../shared/dates'
import './turnover.css'

export const archivePath=(term:string,id?:string)=>'/archive'+(id?'/'+id:'')+'?term='+encodeURIComponent(term)
export function ArchivePage({api}:{api:TurnoverApi}){
  const context=useRouteLoaderData('workspace')as WorkspaceContext,{archivedWorkId}=useParams()
  if(!('memberId'in context))return <EmptyState title="Archive isn't available" description="Only core team members can open the archive."/>
  return <ArchiveBody key={context.memberId+context.termId+archivedWorkId} api={api} term={context.termId} id={archivedWorkId}/>
}
function ArchiveBody({api,term,id}:{api:TurnoverApi;term:string;id?:string}){
  const [search]=useSearchParams(),pageValue=Number(search.get('page')??1),page=Number.isSafeInteger(pageValue)&&pageValue>0?pageValue:1
  const [result,setResult]=useState<ArchiveResult|null>(null),[record,setRecord]=useState<ArchivedWork|null>(null)
  const [checking,setChecking]=useState(true),[failed,setFailed]=useState(false),sequence=useRef(0)
  const load=useCallback(async()=>{
    const current=++sequence.current;setChecking(true);setFailed(false)
    // Rechecking hides retained content immediately, including on denied/error paths.
    setRecord(null);setResult(null)
    try{const next=id?await api.record(term,id):await api.archive(term,page)
      if(current===sequence.current){if(id)setRecord(next as ArchivedWork|null);else setResult(next as ArchiveResult)}}
    catch{if(current===sequence.current)setFailed(true)}finally{if(current===sequence.current)setChecking(false)}
  },[api,term,id,page])
  useEffect(()=>{
    void load()
    return()=>{sequence.current++}
  },[load])
  useAutoRefresh(()=>void load(),{intervalMs:30_000})
  return <div className="turnover">
    <PageHeading title={id?'Archived work':'Work archive'} description="Work handed over to you from a past term."/>
    <div className="auth-actions"><Link className="button button--secondary" to={'/?term='+term}>Overview</Link>
      {id?<Link className="button button--secondary" to={archivePath(term)}>Work archive</Link>:null}</div>
    {checking?<LoadingState title="Loading archive"/>:null}
    {failed?<ErrorState title="Couldn't load the archive" description="Check your connection and try again." action={<button className="button button--secondary" type="button" onClick={()=>void load()}>Try again</button>}/>:null}
    {!checking&&!failed&&id?(record?<Panel title={record.title}>
      <ArchiveFacts record={record}/><p className="record-text">{record.body}</p>
      <p>Saved from {record.sourceTerm}. To correct it, contact the handover custodian.</p>
    </Panel>:<EmptyState title="Can't open this record" description="It may not have been handed over to you. Ask the handover custodian." action={<Link className="button button--secondary" to={archivePath(term)}>Work archive</Link>}/>):null}
    {!checking&&!failed&&!id&&result?<>
      {!result.items.length?<EmptyState title="No archived work" description="Work handed over to you from past terms appears here. Missing something? Ask the handover custodian."/>:
        <ul className="turnover-list">{result.items.map(w=><li key={w.id}><h2><Link to={archivePath(term,w.id)}>{w.title}</Link></h2><ArchiveFacts record={w}/><p>{w.summary}</p></li>)}</ul>}
      <nav className="auth-actions" aria-label="Archive pages">{page>1?<Link className="button button--secondary" to={archivePath(term)+'&page='+(page-1)}>Previous</Link>:null}
        {page>1||result.hasMore?<p>Page {page}</p>:null}{result.hasMore?<Link className="button button--secondary" to={archivePath(term)+'&page='+(page+1)}>Next</Link>:null}</nav>
    </>:null}
  </div>
}
export function ArchiveFacts({record:w}:{record:ArchivedWork}){
  return <p>{w.reference?<><strong>{w.reference}</strong> · </>:null}{w.sourceTerm}{w.owner?' · '+w.owner:''}
    {w.dueAt?' · Due '+formatDateTime(w.dueAt):w.dueOn?' · Due '+formatDay(w.dueOn):''}</p>
}
