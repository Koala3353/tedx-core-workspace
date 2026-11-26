import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router'
import {formatDay} from '../../shared/dates'
import type {RecipientPage} from './rules-api'
export function RecipientPreview({load,draftId,version,disabled,denied}:{load:((id:string,version:number,after:string|null)=>Promise<RecipientPage>);draftId:string;version:number;disabled:boolean;denied:()=>void}){
 const[page,setPage]=useState<RecipientPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),live=useRef(true)
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 async function preview(after:string|null=null){setBusy(true);setError(false);setPage(null);try{const v=await load(draftId,version,after);if(live.current)setPage(v)}catch(e){if(live.current){setError(true);if((e as{denied?:boolean})?.denied)denied()}}finally{if(live.current)setBusy(false)}}
 return <section aria-label="Who would get reminders"><h3>Who would get reminders</h3><p>People assigned to open tasks and deliverables that have a deadline, for work you can open. Nothing is sent.</p><button className="button button--secondary" disabled={disabled||busy} onClick={()=>void preview()}>Show who would get reminders</button>{disabled?<p>Save your changes first.</p>:null}{busy?<p role="status">Loading…</p>:null}{error?<p role="alert">Couldn't load the list. Try again.</p>:null}{page&&!disabled?<><p role="status">{page.items.length} on this page.</p><ul>{page.items.map(i=><li key={i.workId}><h4><Link className="button button--secondary" to={i.href}>{i.title}</Link></h4><p>{i.name} · Due {formatDay(i.dueOn)} · {i.action}</p></li>)}</ul>{!page.items.length?<p>No one has open work with a deadline.</p>:null}<p>Message wording: {page.template}</p>{page.nextAfter?<button className="button button--secondary" disabled={busy} onClick={()=>void preview(page.nextAfter)}>Next</button>:null}</>:null}</section>
}
