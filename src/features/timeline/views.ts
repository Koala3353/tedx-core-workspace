import {addDays,schedule,windowFor} from './dates'
import type {Named,TimelineItem} from './api'

export const ganttWeeks=13
const dayMs=86_400_000
export const daysBetween=(a:string,b:string)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/dayMs)

/** Date range each view loads and draws. Calendar: whole Monday-to-Sunday weeks around the month. Gantt: 13 weeks from the Monday on or before the 1st. */
export function viewWindow(anchor:string,view:'calendar'|'gantt'):{start:string;end:string}{
 const month=windowFor(anchor,'month')
 try{
 const start=windowFor(month.start,'week').start
 return view==='calendar'?{start,end:windowFor(month.end,'week').end}:{start,end:addDays(start,ganttWeeks*7-1)}
 }catch{return month}
}

const short=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'UTC'})
const withYear=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})
const monthName=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})
/** "3 Mar" */
export const shortDay=(day:string)=>short.format(new Date(day+'T00:00:00Z'))
export const longDay=(day:string)=>withYear.format(new Date(day+'T00:00:00Z'))
export const monthLabel=(day:string)=>monthName.format(new Date(day+'T00:00:00Z'))

export type Span={item:TimelineItem;start:string;end:string;estimated:boolean;committee:string}
export const committeeOf=(item:TimelineItem)=>item.primaryUnit?.name??'No committee'

/** Bar extent: planned start to due date. With no start, a 7-day estimate ending on the due date. Items with no due date can't be placed. */
export function span(item:TimelineItem,estimate=true):Span|null{
 const s=schedule(item.plannedStartOn,item.dueOn,item.dueAt)
 if(s.kind==='unscheduled')return null
 if(s.kind==='range')return{item,start:s.start,end:s.end,estimated:false,committee:committeeOf(item)}
 let start=s.end
 if(estimate)try{start=addDays(s.end,-7)}catch{/* Keep a one-day bar at the calendar boundary. */}
 return{item,start,end:s.end,estimated:estimate,committee:committeeOf(item)}
}

/** Screen-reader text for a bar: "Rehearsal cue sheet, Programs & Activities, 3 Mar to 14 Mar, overdue". */
export function describe(s:Span,dueOnly=false){
 const when=dueOnly||s.start===s.end?'due '+shortDay(s.end):shortDay(s.start)+' to '+shortDay(s.end)
 return [s.item.title,s.committee,when,s.estimated?'start not set, estimated a week before the due date':'',s.item.overdue?'overdue':'',s.item.blocked?'blocked':''].filter(Boolean).join(', ')
}

export type Group={key:string;name:string;spans:Span[]}
/** One group per primary committee. Subcommittee work is never split out; it stays with whatever primary committee the item has. */
export function groupByCommittee(spans:Span[],only:Named|null):Group[]{
 if(only)return[{key:only.id,name:only.name,spans:sortSpans(spans)}]
 const map=new Map<string,Group>()
 for(const s of spans){const key=s.item.primaryUnit?.id??'none';const g=map.get(key)??{key,name:s.committee,spans:[]};g.spans.push(s);map.set(key,g)}
 return [...map.values()].map(g=>({...g,spans:sortSpans(g.spans)})).sort((a,b)=>(a.key==='none'?1:0)-(b.key==='none'?1:0)||a.name.localeCompare(b.name))
}
export const sortSpans=(spans:Span[])=>[...spans].sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end)||a.item.title.localeCompare(b.item.title))
