import {useEffect,useRef,useState} from 'react'
import {Link,useRouteLoaderData} from 'react-router'
import {PageHeading} from '../../../components/Page'
import {isGuest,type WorkspaceContext} from '../../auth/gateway'
import {forgetRecordDrafts} from '../../auth/draftScope'
import {LayoutEditor} from './LayoutEditor'
import type {LayoutAdminApi,LayoutConfiguration,LayoutTarget} from './api'
import {HowThisWorks} from '../../shared/HowThisWorks'
import {useAutoRefresh} from '../../shared/useAutoRefresh'
import '../../overview/overview.css'
export function LayoutsPage({api}:{api:LayoutAdminApi}){const c=useRouteLoaderData('workspace')as WorkspaceContext;return isGuest(c)?<p>Guests can't set layouts. <Link to="/shared">Open shared work</Link></p>:<LayoutsHub key={c.termId+c.termMembershipId} api={api} term={c.termId} identity={c.termMembershipId}/>}
function LayoutsHub({api,term,identity}:{api:LayoutAdminApi;term:string;identity:string}){
 const[targets,setTargets]=useState<LayoutTarget[]|null>(null),[selected,setSelected]=useState(''),[data,setData]=useState<LayoutConfiguration|null>(null),[error,setError]=useState(false),[epoch,setEpoch]=useState(0),[locked,setLocked]=useState(false),[older,setOlder]=useState(false),generation=useRef(0)
 const target=targets?.find(t=>t.kind+':'+t.id===selected)
 useEffect(()=>{let live=true;generation.current++;setData(null);setError(false);void api.targets(term).then(async list=>{if(!live)return;setTargets(list);const current=list.find(t=>t.kind+':'+t.id===selected);if(current){const value=await api.read(term,current);if(live)setData(value)}else if(selected){forgetRecordDrafts('layout-'+term);setLocked(false);setSelected('')}}).catch(e=>{if(live){if(e?.denied){forgetRecordDrafts('layout-'+term);setLocked(false)}setData(null);setTargets(null);setError(true)}});return()=>{live=false;generation.current++}},[api,term,selected,epoch])
 useAutoRefresh(()=>setEpoch(n=>n+1),{paused:locked})
 async function history(){if(!target||!data?.nextBefore)return;const requested=generation.current;setOlder(true);try{const next=await api.read(term,target,data.nextBefore);if(requested===generation.current)setData({...data,history:[...data.history,...next.history],nextBefore:next.nextBefore})}catch(e){if(requested===generation.current){if((e as {denied?:boolean})?.denied)forgetRecordDrafts('layout-'+term);setError(true)}}finally{setOlder(false)}}
 return <><PageHeading title="Dashboard layouts" description="Choose the default Overview layout for a role or committee."/><p><Link to="/admin">Administration</Link> · <Link to="/">My overview</Link></p>
 <HowThisWorks><p>Members see their committee's layout first, then their role's, then the term default. If two layouts at the same level apply to someone, they get the next broader one. Members can still rearrange their own Overview, and layouts never change what anyone can access.</p></HowThisWorks>
 {error?<p role="alert">Couldn't load layout settings. Check your connection and try again. Your inputs are kept unless you've lost access.</p>:targets===null?<p>Loading…</p>:!targets.length?<p>You can't set layouts for any role or committee yet.</p>:<><label>Layout audience<select className="overview-example" disabled={locked} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a role, committee or term default</option>{([['role','Roles'],['unit','Committees'],['other','Whole workspace']]as const).map(([group,name])=>{const items=targets.filter(t=>group==='other'?t.kind!=='unit'&&t.kind!=='role':t.kind===group);return items.length?<optgroup key={group} label={name}>{items.map(t=><option key={t.kind+':'+t.id} value={t.kind+':'+t.id}>{t.label}</option>)}</optgroup>:null})}</select></label>{target&&data?<LayoutEditor key={selected+':'+epoch} api={api} term={term} identity={identity} target={target} data={data} refreshed={()=>setEpoch(n=>n+1)} onLock={setLocked}/>:target?<p>Loading…</p>:null}{data?.nextBefore?<button className="button button--secondary" disabled={older||locked} onClick={()=>void history()}>Show older versions</button>:null}</>}
 </>
}
