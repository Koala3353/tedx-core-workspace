import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router'
import {ListToolbar,type ListFilterState} from '../../../components/list'
import {formatDay} from '../../shared/dates'
import {SEARCH_DEBOUNCE_MS,type ServerFilters} from '../../shared/serverList'
import type {RecipientPage} from './rules-api'
export function RecipientPreview({load,draftId,version,disabled,denied}:{load:((id:string,version:number,after:string|null,filters?:ServerFilters)=>Promise<RecipientPage>);draftId:string;version:number;disabled:boolean;denied:()=>void}){
 const[page,setPage]=useState<RecipientPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[query,setQuery]=useState(''),[applied,setApplied]=useState(''),live=useRef(true),latest=useRef(0)
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 // Searching keeps the current list on screen until the narrowed one arrives; only the newest answer is shown.
 async function preview(after:string|null=null,q=applied){const ticket=++latest.current;setBusy(true);setError(false);try{const v=await load(draftId,version,after,{q});if(live.current&&ticket===latest.current)setPage(v)}catch(e){if(live.current&&ticket===latest.current){setError(true);if((e as{denied?:boolean})?.denied)denied()}}finally{if(live.current&&ticket===latest.current)setBusy(false)}}
 const shown=!!page&&!disabled
 useEffect(()=>{const q=query.trim();if(!shown||q===applied)return;const timer=setTimeout(()=>{setApplied(q);void preview(null,q)},SEARCH_DEBOUNCE_MS);return()=>clearTimeout(timer)},[query,applied,shown])
 const filter:ListFilterState<never>={query,setQuery,selected:{},setFilter:()=>undefined,clear:()=>setQuery(''),active:query.trim()!=='',results:[],total:0,defs:[],options:{}}
 return <section aria-label="Who would get reminders"><h3>Who would get reminders</h3><p>People assigned to open tasks and deliverables that have a deadline, for work you can open. Nothing is sent.</p><button className="button button--secondary" disabled={disabled||busy} onClick={()=>void preview()}>Show who would get reminders</button>{disabled?<p>Save your changes first.</p>:null}{busy?<p role="status">Loading…</p>:null}{error?<p role="alert">Couldn't load the list. Try again.</p>:null}{shown?<><ListToolbar filter={filter} sticky={false} label="Search reminder recipients" placeholder="Search by person, title or TASK-012" noun={['reminder','reminders']} count={{shown:page.total??page.items.length,total:page.unfilteredTotal??page.total??page.items.length}}/>{typeof page.total!=='number'?<p role="status">{page.items.length} on this page.</p>:null}<ul>{page.items.map(i=><li key={i.workId}><h4><Link className="button button--secondary" to={i.href}>{i.title}</Link></h4><p>{i.name} · Due {formatDay(i.dueOn)} · {i.action}</p></li>)}</ul>{!page.items.length?<p>{applied?'No one matches this search.':'No one has open work with a deadline.'}</p>:null}<p>Message wording: {page.template}</p>{page.nextAfter?<button className="button button--secondary" disabled={busy} onClick={()=>void preview(page.nextAfter)}>Next</button>:null}</>:null}</section>
}
