import {RefreshButton} from '../shared/RefreshButton'
import {PublishedStatus} from '../admin/process/ProcessPage'
import {Status} from '../../components/Status'
import type {ProcessApi} from '../admin/process/api'
import {WorkReference} from '../work-references/WorkReference'
import {PublicityGate} from '../publicity/Publicity'
import type {PublicityApi} from '../publicity/api'
import {FinanceGate} from '../finance/FinanceDesk'
import type {FinanceApi} from '../finance/api'
import {TaskHandoffs} from '../handoffs/HandoffScreens'
import type {HandoffsApi} from '../handoffs/api'
import type {TimelineApi} from '../timeline/api'
import {Dependencies} from './Dependencies'
import type {DependenciesApi} from './dependenciesApi'
import {ContributionTerms} from '../synergies/ContributionTerms'
import type {SynergiesApi} from '../synergies/api'
import {Files} from '../files/Files'
import type {FilesApi} from '../files/api'
import {Comments} from '../comments/Comments'
import type {CommentsApi} from '../comments/api'
import{useEffect,useState}from'react'
import{refreshKey,settled}from'../shared/settled'
import{Link,useParams,useRouteLoaderData}from'react-router'
import{PageHeading,Panel}from'../../components/Page'
import{LoadingState,ErrorState,EmptyState}from'../../components/FeedbackState'
import{isGuest,type WorkspaceContext}from'../auth/gateway'
import{dateLabel}from'../deliverables/DeliverableFacts'
import{TaskEditor}from'./TaskEditor'
import type{TasksApi,TaskItem}from'./api'
export function TaskDetail({process,api,comments,files,synergies,dependencies,timeline,handoffs,finance,publicity}:{process?:ProcessApi;publicity?:PublicityApi;finance?:FinanceApi;handoffs?:HandoffsApi;timeline?:TimelineApi;api:TasksApi;comments?:CommentsApi;files?:FilesApi;synergies?:SynergiesApi;dependencies?:DependenciesApi}){
 const{taskId=''}=useParams();const context=useRouteLoaderData('workspace') as WorkspaceContext;const[reload,setReload]=useState(0);const[schedulePending,setSchedulePending]=useState(false);const[handoffPending,setHandoffPending]=useState(false);const[dependencyPending,setDependencyPending]=useState(false);const[dependencyEpoch,setDependencyEpoch]=useState(0);const key=refreshKey(taskId+':'+('memberId'in context?context.memberId:context.guestAccessId),reload)
 const[state,setState]=useState<{key:string;item:TaskItem|null;error:boolean}|null>(null),[refreshFailed,setRefreshFailed]=useState<string|null>(null)
 useEffect(()=>{let active=true;void Promise.resolve(api.detail?.(taskId)??null).then(item=>{if(active)setState({key,item,error:false})}).catch(()=>{if(!active)return
  // A failed refresh keeps the last good copy on screen (children keep their keys) and shows a banner.
  setRefreshFailed(key);setState(prev=>settled(prev,key)?.item?prev:{key,item:null,error:true})});return()=>{active=false}},[api,taskId,key])
 // Data key vs child key: `key` asks for fresh data; children remount on `shown` (the key of the data on screen),
 // so a refresh keeps the page up and only swaps editors once the new copy has landed.
 const current=settled(state,key);const item=current?.item;const shown=current?.key??key;const failedRefresh=refreshFailed===key&&!!current&&current.key!==key,refreshing=!!current&&current.key!==key&&!failedRefresh
 return <><Link className="button button--secondary" to={isGuest(context)?'/shared':'/tasks'}>Back to my tasks</Link>{!current?<LoadingState title="Loading task"/>:current.error?<ErrorState title="Couldn't load this task" description="Check your connection and try again." action={<button className="button button--secondary" onClick={()=>setReload(n=>n+1)}>Try again</button>}/>:!item?<EmptyState title="Task cannot be shown" description="The address is unavailable or your access changed. No private details are shown." action={<Link className="button button--secondary" to={isGuest(context)?'/shared':'/tasks'}>{isGuest(context)?'Shared with me':'My tasks'}</Link>}/>:<><PageHeading title={item.title} description="Task completion is separate from finance, publicity and deliverable acceptance."/>{failedRefresh?<p role="alert" className="refresh-failed">Couldn't refresh. Showing the last copy that loaded.<button className="button button--quiet" type="button" onClick={()=>setReload(n=>n+1)}>Try again</button></p>:null}<PublishedStatus api={process} kind="task" state={item.state}/><WorkReference reference={item.reference} id={item.id} kind="task"/><Panel title="Next step"><p>State: {item.state.replaceAll('_',' ')}</p><p>Owner: {item.ownerName} · Assignee: {item.assigneeName??'Unassigned'}</p><p>Target: {dateLabel(item.dueAt,item.dueOn)}{item.overdue?' · Overdue':''}</p><p>{item.blockedReason?'Blocked: '+item.blockedReason:item.dependencyBlocked?'Waiting for required dependencies. Open Dependencies below.':item.archivedAt||item.state==='done'||item.state==='cancelled'?'This task is finished.':item.canEdit?'Update progress below. Open Edit task to change the details.':'You can view this task. Ask the owner or assignee for updates.'}</p><Link to="/resources">Find work guidance and help</Link></Panel>{!isGuest(context)&&item.canEdit?<div inert={dependencyPending||handoffPending}><Panel title="Task progress"><TaskEditor focused timeline={timeline} onPendingChange={setSchedulePending} key={shown+':'+item.version} api={api} termId={context.termId} item={item} onSaved={()=>setReload(n=>n+1)}/></Panel></div>:null}{comments?<Comments api={comments} workId={taskId} quickUpdate/>:null}<details className="work-section"><summary>Details</summary><Panel title="Task details"><p>{item.summary}</p>{item.contributionId?<p>Agreed committee contribution · <Link to="/working-together?view=contributions">Open contributions / assigned work</Link>. Ask the heads to renegotiate material terms.</p>:null}<p>Saved version {item.version} · Updated {dateLabel(item.updatedAt,null)}</p>{item.archivedAt?<p>This task is archived.</p>:null}<p>Completion rule: {item.taskType.replaceAll('_',' ')}. {item.taskType==='governed'?'You can\'t complete this until the required approvals are in.':item.taskType==='review_required'?'A head reviews it before it\'s done.':'Finish the checklist and add the evidence first.'}</p><p>Owner: {item.ownerName} · Assignee: {item.assigneeName??'Unassigned'} · Status: <Status state={item.state}/></p><p>Target: {dateLabel(item.dueAt,item.dueOn)}{item.overdue?' · Overdue':''} · Original: {dateLabel(item.originalDueAt,item.originalDueOn)}</p>{item.blockedReason?<p>Blocked: {item.blockedReason}</p>:null}<p className="record-text">{item.body}</p>{item.evidence?<p className="record-text">Evidence: {item.evidence}</p>:null}<ul>{item.checklist.map(c=><li key={c.id}>{c.done?'Complete: ':'Pending: '}{c.text}</li>)}</ul></Panel></details>{dependencies?<Dependencies key={shown} api={dependencies} id={taskId} onPendingChange={setDependencyPending} onSaved={()=>setDependencyEpoch(n=>n+1)}/>:null}{synergies&&item.contributionId?<ContributionTerms key={shown+dependencyEpoch} api={synergies} id={item.contributionId}/>:null}<span data-discard-edits><RefreshButton disabled={refreshing||dependencyPending||schedulePending||handoffPending} onRefresh={()=>setReload(n=>n+1)}/></span>{handoffs&&!isGuest(context)?<TaskHandoffs api={handoffs} termId={context.termId} id={taskId} canStart={item.state==='done'&&item.ownerId===context.memberId} onPendingChange={setHandoffPending}/>:null}{publicity?<PublicityGate api={publicity} term={context.termId} id={taskId} applicability={item.reviewGates?.publicity}/>:null}{finance?<FinanceGate api={finance} term={context.termId} id={taskId} applicability={item.reviewGates?.finance}/>:null}{files?<details className="work-section"><summary>Files</summary><Files api={files} workId={taskId} allowDrive/></details>:null}</>}</>
}
