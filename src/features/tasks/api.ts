import {optionalWorkReference,type WorkReferenceValue} from '../work-references/api'
import type {ReviewApplicability} from '../../components/ReviewGate'
import type { createSupabaseClient } from '../../lib/supabase'
import {mapCommandError,type CommandResult,type WorkReceipt}from'../../lib/commands'
import type {Json} from '../../lib/database.types'
import {compactFilters,readMyUnits,validOptionalCount,validStateFacets,validUnitFacets,type MyUnit,type ServerFilters,type UnitFacet} from '../shared/serverList'
export type TaskState='todo'|'in_progress'|'blocked'|'ready_for_review'|'done'|'cancelled'
export type TaskItem={reference?:WorkReferenceValue|null;progressActions?:TaskState[];reviewGates?:{finance:ReviewApplicability;publicity:ReviewApplicability};dependencyBlocked?:boolean;contributionId?:string|null;id:string;version:number;updatedAt:string;archivedAt:string|null;title:string;summary:string;body:string;ownerId:string;ownerName:string;createdByName?:string|null;leadUnitId:string|null;parentId:string|null;dueOn:string|null;dueAt:string|null;originalDueOn:string|null;originalDueAt:string|null;classification:'ordinary'|'restricted';assigneeId:string|null;assigneeName:string|null;assignedUnitId:string|null;collaborators:string[];checklist:{id:string;text:string;done:boolean}[];state:TaskState;taskType:'ordinary'|'review_required'|'governed';blockedReason:string|null;evidence:string|null;overdue:boolean;canManage:boolean;canEdit:boolean}
type TaskParent = {id:string;name:string;reference?:WorkReferenceValue|null}
export type TaskOptions={actorId:string;members:{id:string;name:string}[];units:{id:string;name:string;canManage:boolean}[];parents?:TaskParent[]}
export type TaskSummary=Pick<TaskItem,'id'|'version'|'title'|'summary'|'dueOn'|'dueAt'|'state'|'overdue'|'assigneeName'|'reference'>
export type TaskInput={command:'create'|'update'|'assign'|'transition';termId:string;id?:string;version?:number;data:Record<string,unknown>}
/** One page of a task view. unfilteredTotal and facets are absent from older backends. */
export type TaskPage={items:TaskSummary[];total:number;page:number;unfilteredTotal?:number;facets?:{units?:UnitFacet[];states?:Record<string,number>}}
export type OwnedTask={reference?:WorkReferenceValue|null;id:string;title:string;summary:string;dueOn:string|null;dueAt:string|null;category:string;overdue:boolean}
export interface TasksApi{read(termId:string,page:number):Promise<{items:OwnedTask[];total:number;page:number}>;list?(termId:string,page:number,view:string,filters?:ServerFilters):Promise<TaskPage>;myUnits?(termId:string):Promise<MyUnit[]>;detail?(id:string):Promise<TaskItem|null>;options?(termId:string):Promise<TaskOptions|null>;execute?(input:TaskInput,key:string):Promise<CommandResult<WorkReceipt>>;createForCoreTeam?(termId:string,data:Record<string,unknown>,key:string):Promise<CoreTeamResult>}
/** Result of sending one task to every core member. 'missing' means the backend function is not deployed yet. */
export type CoreTeamResult={ok:true;created:number}|{ok:false;missing:boolean;retryable:boolean;message:string}
type UntypedRpc=(name:string,args?:Record<string,unknown>)=>Promise<{data:unknown;error:{code?:string;message?:string}|null}>
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function task(v:unknown,detail=false):boolean{
 if(!v||typeof v!=='object')return false;const t=v as TaskItem
 return optionalWorkReference(t.reference,'task')&&(t.progressActions===undefined||Array.isArray(t.progressActions)&&t.progressActions.every(a=>['todo','in_progress','blocked','ready_for_review','done','cancelled'].includes(a)))&&(t.reviewGates===undefined||!!t.reviewGates&&['finance','publicity'].every(k=>['not_required','pending_assessment','verified','pending'].includes(t.reviewGates![k as 'finance'|'publicity'])))&&(t.dependencyBlocked===undefined||typeof t.dependencyBlocked==='boolean')&&uuid.test(t.id)&&Number.isInteger(t.version)&&t.version>0&&typeof t.title==='string'&&typeof t.summary==='string'&&typeof t.overdue==='boolean'&&(t.assigneeName===null||typeof t.assigneeName==='string')&&['todo','in_progress','blocked','ready_for_review','done','cancelled'].includes(t.state)&&[t.dueOn,t.dueAt].every(d=>d===null||typeof d==='string')
  &&(t.contributionId===undefined||t.contributionId===null||uuid.test(t.contributionId))&&(!detail||typeof t.updatedAt==='string'&&Number.isFinite(Date.parse(t.updatedAt))&&(t.archivedAt===null||typeof t.archivedAt==='string')&&typeof t.body==='string'&&uuid.test(t.ownerId)&&typeof t.ownerName==='string'&&(t.createdByName===undefined||t.createdByName===null||typeof t.createdByName==='string')&&typeof t.canManage==='boolean'&&typeof t.canEdit==='boolean'&&[t.leadUnitId,t.parentId,t.assigneeId,t.assignedUnitId].every(id=>id===null||typeof id==='string'&&uuid.test(id))&&['ordinary','restricted'].includes(t.classification)&&['ordinary','review_required','governed'].includes(t.taskType)&&[t.originalDueOn,t.originalDueAt,t.blockedReason,t.evidence].every(s=>s===null||typeof s==='string')&&Array.isArray(t.collaborators)&&t.collaborators.every(id=>typeof id==='string'&&uuid.test(id))&&Array.isArray(t.checklist)&&t.checklist.every(c=>c&&uuid.test(c.id)&&typeof c.text==='string'&&typeof c.done==='boolean'))
}
export function createTasksApi(ready:ReturnType<typeof createSupabaseClient>):TasksApi{
  return{
    async list(termId,page,view,filters){const client=await ready;if(!client)throw new Error('Tasks unavailable');const f=compactFilters(filters??{});const{data,error}=await client.rpc('read_tasks',{p_term_id:termId,p_page:page,p_view:view,...(Object.keys(f).length?{p_filters:f as Json}:{})});const r=data as unknown as TaskPage;if(error||!r||!Array.isArray(r.items)||!r.items.every(t=>task(t)&&optionalWorkReference(t.reference,'task',termId))||!Number.isSafeInteger(r.total)||r.total<0||r.page!==page||!validOptionalCount(r.unfilteredTotal)||r.facets!==undefined&&(!r.facets||!validUnitFacets(r.facets.units)||!validStateFacets(r.facets.states)))throw new Error('Tasks unavailable');return r},
    myUnits:termId=>readMyUnits(ready,termId),
    async detail(id){if(!uuid.test(id))return null;const client=await ready;if(!client)throw new Error('Tasks unavailable');const{data,error}=await client.rpc('read_task',{p_work_item_id:id});if(error)throw new Error('Tasks unavailable');if(data===null)return null;if(!task(data,true))throw new Error('Tasks unavailable');return data as unknown as TaskItem},
    async options(termId){const client=await ready;if(!client)throw new Error('Tasks unavailable');const{data,error}=await client.rpc('task_options',{p_term_id:termId});if(error)throw new Error('Tasks unavailable');if(data===null)return null;const o=data as unknown as TaskOptions;if(!uuid.test(o.actorId)||!Array.isArray(o.members)||!o.members.every(m=>uuid.test(m.id)&&typeof m.name==='string')||!Array.isArray(o.units)||!o.units.every(u=>uuid.test(u.id)&&typeof u.name==='string'&&typeof u.canManage==='boolean')||o.parents!==undefined&&(!Array.isArray(o.parents)||!o.parents.every(p=>p&&uuid.test(p.id)&&typeof p.name==='string'&&optionalWorkReference(p.reference,'deliverable',termId))))throw new Error('Tasks unavailable');return o},
    async execute(input,key){try{const client=await ready;if(!client)throw{code:'COMMAND_UNAVAILABLE'};const result=input.command==='create'?await client.rpc('create_task',{p_term_id:input.termId,p_data:input.data as never,p_request_id:key})
      :await client.rpc(({update:'update_task',assign:'assign_task',transition:'transition_task'}as const)[input.command],{p_work_item_id:input.id!,p_data:input.data as never,p_expected_version:input.version!,p_request_id:key});if(result.error)return{ok:false,error:mapCommandError(result.error)};const r=result.data as WorkReceipt|null;if(!r||!uuid.test(r.workItemId)||!Number.isInteger(r.version)||r.version<1)throw{code:'COMMAND_UNAVAILABLE'};return{ok:true,value:r}}catch(e){return{ok:false,error:mapCommandError(e)}}},
    async createForCoreTeam(termId,data,key){
      try{
        const client=await ready;if(!client)return{ok:false,missing:false,retryable:true,message:'Tasks are unavailable right now. Try again in a moment.'}
        const rpc=client.rpc.bind(client) as unknown as UntypedRpc
        const{data:result,error}=await rpc('create_task_for_core_team',{p_term_id:termId,p_data:data,p_request_id:key})
        // 42883 / PGRST202: the function is not deployed yet.
        if(error&&(error.code==='42883'||error.code==='PGRST202'))return{ok:false,missing:true,retryable:false,message:"Sending to the whole team isn't switched on yet."}
        if(error){const mapped=mapCommandError(error);return{ok:false,missing:false,retryable:mapped.retryable,message:mapped.message}}
        const created=(result as {created?:unknown}|null)?.created
        if(typeof created!=='number'||!Number.isInteger(created)||created<0)return{ok:false,missing:false,retryable:true,message:"Couldn't confirm the tasks were sent. Check My tasks before trying again."}
        return{ok:true,created}
      }catch{return{ok:false,missing:false,retryable:true,message:"Couldn't reach the workspace. Check your connection and try again."}}
    },
    async read(termId,page){try{
    const client=await ready;if(!client)throw new Error()
    const{data,error}=await client.rpc('read_owned_tasks',{p_term_id:termId,p_page:page})
    const r=data as unknown as {items:OwnedTask[];total:number;page:number}|null
    if(error||!r||!Array.isArray(r.items)||!Number.isSafeInteger(r.total)||r.total<0||r.page!==page||!r.items.every(t=>t&&optionalWorkReference(t.reference,'task',termId)&&/^[0-9a-f-]{36}$/i.test(t.id)&&typeof t.title==='string'&&typeof t.summary==='string'&&typeof t.overdue==='boolean'&&['draft','active','needs_revision','approved','completed','rejected','cancelled'].includes(t.category)&&[t.dueOn,t.dueAt].every(d=>d===null||typeof d==='string')))throw new Error()
    return r
  }catch{throw new Error('Owned tasks could not load. Check access or connection and reload.')}}}
}
