import {formatDateTime} from '../../shared/dates'
import type {Action,AccessData,Values} from './api'

const permissions:Record<string,string>={'workspace.read':'See workspace work','directory.read':'View the member directory','profile.edit_own':'Edit your own profile','committee.manage':'Manage committee work','department.review':'Review requests to their committee','finance.review':'Review budgets (FIN)','mcd.review':'Give publicity sign-off (MCD)','feedback.review':'Review confidential feedback (needs sign-off from a second admin)','mentoring.view':'View your mentoring records','reports.view':'View reports','admin.configure':'Configure the workspace','roles.manage':'Manage roles and access'}
export const permissionName=(key:string)=>permissions[key]??'Permission unavailable'
export const scopeName=(scope:string)=>({unit:'One committee',term:'The whole term',work:'One work item',own:'Their own records'} as Record<string,string>)[scope]??'Area unavailable'
export const actionName=(action:Action)=>({role_publish:'Edit role permissions',assignment_grant:'Give someone a role',assignment_expiry:'Change when a role ends',assignment_revoke:'Remove a role',custodian_nominate:'Name a new workspace owner',custodian_accept:'Accept becoming workspace owner'})[action]
export const accessDate=(value:string)=>Number.isFinite(Date.parse(value))?formatDateTime(value):'No date'
export function namedScope(data:AccessData,scope:string,unitId:string|null,workId:string|null){
 if(scope==='unit'){const unit=data.units.find(u=>u.id===unitId);return unit?'This committee · '+unit.name:null}
 if(scope==='work'){const work=data.records.find(w=>w.id===workId);return work?'This record · '+work.name:null}
 return ['own','term'].includes(scope)?scopeName(scope):null
}
export function explainImpact(data:AccessData,action:Action,values:Values){
 const str=(key:string)=>typeof values[key]==='string'?values[key] as string:''
 const nomination=action==='custodian_accept'?data.nominations?.find(n=>n.id===str('nominationId')):null
 const assignment=data.assignments?.find(a=>a.id===(nomination?.assignmentId??str('assignmentId')))
 const role= data.roles.find(r=>r.id===(assignment?.roleId??str('roleId')))
 const person=data.targets.find(t=>t.id===(assignment?.membershipId??str('targetMembershipId')))
 const scope=namedScope(data,assignment?.scope??str('scope'),assignment?.unitId??str('unitId'),assignment?.workId??str('workId'))
 if(action==='role_publish'){
  const selected=Array.isArray(values.permissions)?values.permissions:[]
  if(!scope||!selected.length||selected.some(p=>!permissions[p.capability]))return null
  return {person:null,role:str('name'),scope,permissions:selected,from:null,to:null,previousExpiry:null,nominationExpiry:null,reference:null,impact:'Saves a new version of this role. People who already have the role keep the old version until they\'re given the new one.'}
 }
 if(!assignment&&action!=='assignment_grant'||!person||!role||!scope)return null
 if(action==='custodian_accept'&&(!nomination||nomination.candidateId!==assignment?.membershipId))return null
 if(role.permissions.some(p=>!permissions[p.capability]||!['unit','term','work','own'].includes(p.scope)))return null
 return {person:person.name,role:role.name,scope,permissions:role.permissions,from:assignment?.from??str('from'),to:action==='assignment_expiry'||action==='assignment_grant'?str('to'):assignment?.to??null,previousExpiry:action==='assignment_expiry'?assignment?.to??null:null,nominationExpiry:nomination?.expiresAt??null,reference:action.startsWith('custodian_')?str('reference'):null,impact:action==='assignment_grant'?'Gives this role for these dates only.':action==='assignment_expiry'?'Changes only when this role ends.':action==='assignment_revoke'?'Removes this role now. If they\'re the workspace owner, a confirmed replacement has to be in place first.':action==='custodian_nominate'?'They have to sign in and accept before they become the new workspace owner.':'Confirms you\'re taking over as workspace owner in this app. Ownership of Supabase or Google accounts is handled separately.'}
}

/** One plain sentence: "Maria will be able to review budgets (FIN) for Finance until 30 Jun 2027, 11:59 PM." */
export function plainSummary(data:AccessData,action:Action,values:Values):string|null{
 const v=explainImpact(data,action,values);if(!v)return null
 const can=v.permissions.map(p=>permissionName(p.capability).toLowerCase()).join(', ')
 const where=v.scope.replace(/^This committee · /,'').replace(/^This record · /,'')
 const until=v.to?' until '+accessDate(v.to):''
 if(action==='role_publish')return `The ${v.role||'new'} role will let people ${can} (${where}). Nobody gets it until you give it to them.`
 if(action==='assignment_grant')return `${v.person} will be able to ${can} for ${where}${until}.`
 if(action==='assignment_expiry')return `${v.person}'s ${v.role} role will end on ${v.to?accessDate(v.to):'the new date'}${v.previousExpiry?' instead of '+accessDate(v.previousExpiry):''}.`
 if(action==='assignment_revoke')return `${v.person} will lose the ${v.role} role for ${where} right away.`
 if(action==='custodian_nominate')return `${v.person} will be asked to become the workspace owner. Nothing changes until they accept.`
 return `You'll become the workspace owner in this app.`
}
