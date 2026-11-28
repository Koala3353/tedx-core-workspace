import {useCallback,useEffect,useRef,useState} from 'react'
import {onPageReturn} from '../../lib/pageReturn'
import {useListEnter} from '../../components/useListEnter'
import {Pending} from '../../components/PendingButton'
import {Link,useRouteLoaderData,useSearchParams} from 'react-router'
import {PageHeading} from '../../components/Page'
import {isGuest,type WorkspaceContext} from '../auth/gateway'
import {searchKinds,type SearchApi,type SearchKind,type SearchResult} from './api'
import '../overview/overview.css'
import './search.css'
import {HowThisWorks} from '../shared/HowThisWorks'
import { EmptyState } from '../../components/FeedbackState'
import { EmptySearch } from '../../components/illustrations'
const labels:Record<SearchKind,string>={task:'Task',deliverable:'Deliverable',request:'Request',guide:'Guide',glossary:'Glossary',contact:'Contact'}
export function Search({api}:{api:SearchApi}){const c=useRouteLoaderData('workspace')as WorkspaceContext;return isGuest(c)?<p>Search isn't available for guests. Use the links that were shared with you.</p>:<SearchBody key={c.termId+c.termMembershipId} api={api} term={c.termId}/>}
function SearchBody({api,term}:{api:SearchApi;term:string}){
 const[params,setParams]=useSearchParams(),[terms,setTerms]=useState<{id:string;label:string}[]|null>(null),[termError,setTermError]=useState(false)
 useEffect(()=>{const readTerms=api.terms;if(!readTerms)return;let live=true,sequence=0
  // Refresh in place: the current list stays visible until a newer answer arrives.
  const refresh=()=>{if(document.visibilityState==='hidden')return;const current=++sequence;void readTerms(term).then(v=>{if(live&&current===sequence){setTerms(v);setTermError(false)}}).catch(()=>{if(live&&current===sequence)setTermError(true)})}
  // The list of terms rarely changes: read it on open and when the person returns to the tab.
  refresh();const stopReturn=onPageReturn(refresh)
  return()=>{live=false;stopReturn()}
 },[api,term])
 // The query and category live in the URL (replace, not push) so Back and reload restore them.
 const[q,setQ]=useState(()=>(params.get('q')??'').slice(0,120)),[kind,setKind]=useState(()=>{const k=params.get('kind');return k&&(searchKinds as readonly string[]).includes(k)?k:'all'}),[result,setResult]=useState<SearchResult|null>(null),[busy,setBusy]=useState<''|'search'|'next'>(''),[error,setError]=useState(''),[copied,setCopied]=useState(''),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null)
 const enter=useListEnter(!!result?.items.length)
 function clearResults(){generation.current++;setResult(null);setError('');setCopied('');setBusy('')}
 const search=useCallback(async(cursor:SearchResult['nextCursor']=null)=>{if(timer.current)clearTimeout(timer.current);// Stale-while-refresh: the previous results stay up (with a small hint) until the new ones land.
 const current=++generation.current;setError('');setCopied('');setBusy(cursor?'next':'search');try{const r=await api.read(term,q.trim(),kind,cursor);if(current===generation.current)setResult(r)}catch(e){if(current===generation.current)setError((e as {denied?:boolean})?.denied?'You can\'t search right now. Refresh the page or sign in again.':'Couldn\'t search. Check your connection and try again. Your search is kept.')}finally{if(current===generation.current)setBusy('')}},[api,term,q,kind])
 useEffect(()=>{const trimmed=q.trim(),next=new URLSearchParams(params);if(trimmed)next.set('q',trimmed);else next.delete('q');if(kind!=='all')next.set('kind',kind);else next.delete('kind')
  const sync=next.toString()!==params.toString()?window.setTimeout(()=>setParams(next,{replace:true}),300):undefined;return()=>{if(sync)clearTimeout(sync)}},[q,kind,params,setParams])
 useEffect(()=>{if(q.trim().length<2)return;timer.current=setTimeout(()=>{void search()},300);return()=>{if(timer.current)clearTimeout(timer.current)}},[q,kind,search])
 useEffect(()=>()=>{generation.current++},[])
 return <><PageHeading title="Find" description="Search tasks, deliverables, references, guides and people in this term. Old committee names work too."/><HowThisWorks><p>Private request details, profiles, email addresses and file contents are never searched. Announcements aren't included yet.</p></HowThisWorks>
 {terms?<label>Term<select className="overview-example" value={term} onChange={e=>{clearResults();const next=new URLSearchParams(params);next.set('term',e.target.value);setParams(next)}}>{terms.map(t=><option value={t.id} key={t.id}>{t.label}</option>)}</select></label>:null}{termError?<p role="status">Couldn't load other terms. Searching this term only.</p>:null}
 <form onSubmit={e=>{e.preventDefault();void search()}}><label>Title or reference<input className="overview-example" value={q} minLength={2} maxLength={120} onChange={e=>{if(e.target.value.trim().length<2)clearResults();else setCopied('');setQ(e.target.value)}}/></label><label>Category<select className="overview-example" value={kind} onChange={e=>{setCopied('');setKind(e.target.value)}}><option value="all">All categories</option>{searchKinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label><button className="button" disabled={!!busy||q.trim().length<2} aria-busy={busy==='search'||undefined}><Pending when={busy==='search'}>Search</Pending></button><button type="button" className="button button--secondary" onClick={()=>{clearResults();setQ('')}}>Clear</button></form>
 {busy==='search'?<p role="status" className="refreshing-hint"><span className="pending-spinner" aria-hidden="true"/>Searching…</p>:null}{error?<p role="alert">{error}</p>:null}
 {result?<section aria-label="Search results" aria-busy={!!busy||undefined}>{result.total?<p role="status">{`${result.total} ${result.total===1?'match':'matches'} in this term.`}</p>:<><p role="status" className="visually-hidden">No matches.</p><EmptyState level={3} illustration={<EmptySearch />} title="No matches" description={kind==='all'?'Try a different title or reference, or an older committee name.':'Try All categories, or a different title or reference.'} action={kind!=='all'?<button type="button" className="button button--secondary" onClick={()=>{setCopied('');setKind('all')}}>Search all categories</button>:undefined}/></>}<ul className={enter||undefined}>{result.items.map(r=><li key={r.kind+':'+r.id}><h2><Link className="search-result-title" to={r.href}>{r.title}</Link></h2><p>{labels[r.kind]}{r.reference?' · '+r.reference:''} · {r.termLabel}</p>{r.matchedAlias?<p>Previously known as {r.matchedAlias}</p>:null}<button className="button button--secondary" onClick={()=>{void Promise.resolve().then(()=>navigator.clipboard.writeText(new URL(r.href,location.origin).href)).then(()=>setCopied('Link copied.'),()=>setCopied('Couldn\'t copy. Open the link instead.'))}}>Copy link for {r.title}</button></li>)}</ul>{result.nextCursor?<button className="button button--secondary" disabled={!!busy} aria-busy={busy==='next'||undefined} onClick={()=>void search(result.nextCursor)}><Pending when={busy==='next'} label="Loading…">Next</Pending></button>:null}</section>:!busy&&!error?<EmptyState level={3} illustration={<EmptySearch />} title="Search this term" description="Type at least two letters of a title, a reference like DEL-12, a guide or a person. Results show up here."/>:null}{copied?<p role="status">{copied}</p>:null}
 </>
}
