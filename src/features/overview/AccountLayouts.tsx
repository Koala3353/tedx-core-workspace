import {useEffect,useState} from 'react'
import {useFinDecision} from '../finance/DecisionMemory'
import type {AccountLayoutApi,AccountLayoutsData,ViewCommand} from './account-api'
import type {Layout} from './layout'
export function AccountLayouts({api,term,identity,layout,onUse,onDefault,onLock,onPublished,refresh=0}:{api:AccountLayoutApi;term:string;identity:string;layout:Layout;onUse:(layout:Layout)=>void;onDefault:(layout:Layout|null,source:string)=>void;onLock:(locked:boolean)=>void;onPublished?:(layout:Layout|null,source:string)=>void;refresh?:number}){
 const[data,setData]=useState<AccountLayoutsData|null>(null),[failed,setFailed]=useState(false),[epoch,setEpoch]=useState(0),[saved,setSaved]=useState(false)
 const mem=useFinDecision<ViewCommand,{viewId:string;version:number}>(api,'operational-view:'+term+':'+identity,{name:'',selected:''})
 useEffect(()=>{let live=true;setData(null);void api.read(term).then(v=>{if(live){setData(v);setFailed(false);onDefault(v.layout,v.source)}}).catch(()=>{if(live){setData(null);setFailed(true)}});return()=>{live=false}},[api,term,epoch,refresh,onDefault])
 useEffect(()=>{if(saved&&!mem.locked&&(mem.fields.name||mem.fields.selected))mem.change({name:'',selected:''})},[saved,mem])
 useEffect(()=>{onLock(mem.locked)},[mem.locked,onLock])
 const selected=data?.views.find(v=>v.viewId===mem.fields.selected)
 async function save(archive=false){const command:ViewCommand=archive&&selected?{term,viewId:selected.viewId,name:selected.name,layout:selected.layout,version:selected.version,archived:true}:{term,viewId:crypto.randomUUID(),name:mem.fields.name,layout,version:0,archived:false};if(await mem.run(command)){mem.change({...mem.fields,name:'',selected:''});setSaved(true);setEpoch(n=>n+1)}}
 return <section className="overview-account" aria-label="Saved layouts" data-edit-form data-pending-command={mem.locked} data-unsaved-changes={!!mem.fields.name}>
 {data?.repaired?<p role="alert">A saved or default layout no longer works, so a basic layout is shown. Archive the old saved layout, or ask an admin to fix the default.</p>:null}
 {data?.ambiguous?<p role="status">More than one default layout applies to you, so a general one is used until an admin fixes it.</p>:null}
 {failed?<p role="alert">Couldn't load your saved layouts. Your tasks above still work. <button className="button button--secondary" onClick={()=>setEpoch(n=>n+1)}>Try again</button></p>:data?<details className="work-section"><summary>Saved layouts</summary><p>Save layouts to your account so they follow you to other devices this term.</p>
 <fieldset disabled={mem.locked}><legend>My saved layouts</legend>
 {onPublished?<button className="button button--secondary" onClick={()=>onPublished(data.layout,data.source)}>Use the default layout</button>:null}
 <label>Saved layout<select value={mem.fields.selected} onChange={e=>mem.change({...mem.fields,selected:e.target.value})}><option value="">Choose a saved layout</option>{data.views.map(v=><option key={v.viewId} value={v.viewId}>{v.name}</option>)}</select></label>
 {selected?.supported===false?<p role="alert">This saved layout uses views that no longer exist. Archive it and save a new one.</p>:null}
 <div className="overview-move"><button className="button button--secondary" disabled={!selected||selected.supported===false} onClick={()=>{if(selected&&selected.supported!==false)onUse(selected.layout)}}>Use this layout</button><button className="button button--quiet" disabled={!selected} onClick={()=>void save(true)}>Archive</button></div>
 <label>Layout name<input value={mem.fields.name} maxLength={80} onChange={e=>{mem.change({...mem.fields,name:e.target.value});setSaved(false)}}/></label>
 <button className="button button--secondary" disabled={!mem.fields.name.trim()||data.views.length>=20} onClick={()=>void save()}>Save current layout</button><p>You can save up to 20 layouts per term. Archived ones count too.</p>
 </fieldset></details>:<p>Loading saved layouts…</p>}
 {mem.pending?<button className="button button--secondary" disabled={mem.busy} onClick={()=>void mem.run().then(r=>{if(r){setSaved(true);setEpoch(n=>n+1)}})}>Try saving again</button>:null}
 {mem.error?<p role="alert">{mem.error}</p>:null}{saved?<p role="status">Layout saved.</p>:null}
 </section>
}
