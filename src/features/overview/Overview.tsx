import {TurnoverLinks} from '../admin/turnover/TurnoverPage'
import {Countdown} from '../../components/Countdown'
import type {TurnoverApi} from '../admin/turnover/api'
import {useCallback,useEffect,useState} from 'react'
import {Link,useNavigate,useRouteLoaderData} from 'react-router'
import {PageHeading} from '../../components/Page'
import {LoadingState,ErrorState} from '../../components/FeedbackState'
import {isGuest,type WorkspaceContext} from '../auth/gateway'
import {formatTime} from '../shared/dates'
import type {OverviewApi,OverviewResult} from './api'
import {defaultLayout,resolveLayout,validateLayout,viewStorageKey,type Layout} from './layout'
import {LayoutControls} from './LayoutControls'
import {LayoutPreview} from './LayoutPreview'
import {AccountLayouts} from './AccountLayouts'
import {OverviewLane,SecondaryViews,WorkHelp} from './OverviewViews'
import './overview.css'
import {AnnouncementHighlights} from '../announcements/Reader'
import type {AnnouncementsApi} from '../announcements/api'
import {TaskEditor} from '../tasks/TaskEditor'
import type {TasksApi} from '../tasks/api'
import type {InventoryApi} from '../inventory/api'
import {InventoryOverviewActions} from '../inventory/InventoryPage'
import type {GrowthApi} from '../growth/api'
import {GrowthLink} from '../growth/GrowthPage'
import {EvaluationsLink} from '../evaluations/EvaluationsPage'
import type {EvaluationsApi} from '../evaluations/api'

export function Overview({api,announcements,canSearch=false,tasks,inventory,growth,evaluations,turnover}:{api:OverviewApi;announcements?:AnnouncementsApi;canSearch?:boolean;tasks?:TasksApi;inventory?:InventoryApi;growth?:GrowthApi;evaluations?:EvaluationsApi;turnover?:TurnoverApi}){
 const context=useRouteLoaderData('workspace')as WorkspaceContext,subject=isGuest(context)?'guest:'+context.guestAccessId:'member:'+context.termMembershipId
 return <OverviewBody key={context.organizationId+context.termId+subject} api={api} announcements={announcements} context={context} subject={subject} canSearch={canSearch} tasks={tasks} inventory={inventory} growth={growth} evaluations={evaluations} turnover={turnover}/>
}
function OverviewBody({api,announcements,context,subject,canSearch,tasks,inventory,growth,evaluations,turnover}:{api:OverviewApi;announcements?:AnnouncementsApi;context:WorkspaceContext;subject:string;canSearch:boolean;tasks?:TasksApi;inventory?:InventoryApi;growth?:GrowthApi;evaluations?:EvaluationsApi;turnover?:TurnoverApi}){
 const termId=context.termId,guest=isGuest(context),audience=guest?'guest':'member',storageKey=viewStorageKey(context.organizationId,termId,subject)
 const navigate=useNavigate()
 const [addingTask,setAddingTask]=useState(false)
 const[result,setResult]=useState<OverviewResult|null>(null),[error,setError]=useState(false),[reload,setReload]=useState(0)
 const[viewLocked,setViewLocked]=useState(false)
 const[view,setView]=useState(()=>{try{
  const raw=localStorage.getItem(storageKey)
  if(raw&&raw.length>10000)throw Error('Saved view too large')
  const resolved=resolveLayout(raw===null?null:JSON.parse(raw),audience)
  return{...resolved,personal:raw!==null,message:resolved.repaired?'Your saved layout no longer works, so the default is shown. Choose Reset to default to clear it.':raw?'Your layout is saved on this device.':'Using the default layout.'}
 }catch{return{...resolveLayout(null,audience),personal:true,repaired:true,message:'Couldn\'t load your saved layout, so the default is shown. Choose Reset to default to clear it.'}}})
 const publishedDefault=useCallback((layout:Layout|null,source:string)=>{setView(previous=>previous.personal?previous:{layout:layout??defaultLayout(audience),personal:false,repaired:false,message:layout?`Using the ${source} layout.`:'Using the default layout.'})},[audience])
 function usePublished(layout:Layout|null,source:string){let message=layout?`Using the ${source} layout.`:'Using the default layout.';try{localStorage.removeItem(storageKey)}catch{message+=' Couldn\'t clear the layout saved on this device, so it may come back after you reload.'}setView({layout:layout??defaultLayout(audience),personal:false,repaired:false,message})}
 function changeLayout(layout:Layout){
  if(!validateLayout(layout,audience))return
  let message='Your layout is saved on this device.'
  try{localStorage.setItem(storageKey,JSON.stringify(layout))}catch{message='Couldn\'t save this layout on this device. It stays until you leave this page.'}
  setView({layout,personal:true,repaired:false,message})
 }
 useEffect(()=>{let live=true;void api.read(termId).then(r=>{if(live){setResult(r);setError(false)}}).catch(()=>{if(live){setResult(null);setError(true)}});return()=>{live=false}},[api,termId,reload])
 useEffect(()=>{const refresh=()=>setReload(n=>n+1),visible=()=>{if(document.visibilityState==='visible')refresh()};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',visible);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visible)}},[])
 return <><PageHeading title="Overview" description="Your next actions and work waiting on someone else."/><Countdown variant="overview"/>
 {error?<ErrorState title="Couldn't load your overview" description="Check your connection and try again." action={<button className="button button--secondary" type="button" onClick={()=>setReload(n=>n+1)}>Try again</button>}/>:!result?<LoadingState title="Loading your work"/>:<>
 <p className="muted">Updated {formatTime(result.refreshedAt)} (Manila time){result.hasMore?'. Showing the first 50 items; open Inbox, My tasks or Deliverables for more.':''}</p>
 <OverviewLane items={result.items} lane="actionable"/>
 </>}
 <WorkHelp guest={guest} canSearch={canSearch}>
   {!guest&&inventory?<InventoryOverviewActions api={inventory} term={termId}/>:null}
   {!guest&&growth?<GrowthLink api={growth} term={termId}/>:null}
   {!guest&&turnover?<TurnoverLinks api={turnover} term={termId}/>:null}
   {!guest&&evaluations?<EvaluationsLink api={evaluations} term={termId}/>:null}
 </WorkHelp>
 {!guest&&tasks?.execute?<details className="panel" onToggle={event=>{if(event.currentTarget.open)setAddingTask(true)}}>
  <summary>Add a personal task</summary>
  {addingTask?<TaskEditor personal termId={termId} api={tasks} onSaved={id=>void navigate('/tasks/'+id)}/>:null}
 </details>:null}
 <p><Link className="button button--secondary" to="/privacy">Privacy and help</Link></p>
 <AnnouncementHighlights api={announcements} term={termId} refresh={reload}/>
 {!guest&&context.capabilities?.some(c=>['admin.configure','committee.manage'].includes(c))?<p><Link to="/admin/layouts">Set default layouts for roles and committees</Link></p>:null}
 {view.repaired?<p role="alert">{view.message}</p>:null}
 <LayoutControls disabled={viewLocked} layout={view.layout} audience={audience} message={view.repaired?'Choose Reset to default to clear the old saved layout.':view.message} onChange={changeLayout} onReset={()=>changeLayout(defaultLayout(audience))}/>
 {!guest&&api.layouts?<AccountLayouts refresh={reload} api={api.layouts} term={termId} identity={subject} layout={view.layout} onUse={changeLayout} onDefault={publishedDefault} onPublished={usePublished} onLock={setViewLocked}/>:null}
 {result&&!error?<SecondaryViews layout={view.layout} items={result.items}/>:null}
 <LayoutPreview layout={view.layout}/></>
}
