import {useState} from 'react'
import {Link} from 'react-router'
import {addDays} from './dates'
import type {Named,TimelineItem} from './api'
import {daysBetween,describe,ganttWeeks,groupByCommittee,shortDay,sortSpans,span,type Span} from './views'

const dayWidth=12,weekWidth=dayWidth*7

function Bar({s,start,days}:{s:Span;start:string;days:number}){
 const from=Math.max(0,daysBetween(start,s.start)),to=Math.min(days,daysBetween(start,s.end)+1)
 if(to<=0||from>=days)return null
 const label=describe(s)
 const cls='gantt-bar'+(s.estimated?' gantt-bar--estimated':'')+(s.item.overdue?' gantt-bar--overdue':'')+(daysBetween(start,s.start)<0?' gantt-bar--clipped-start':'')+(daysBetween(start,s.end)>=days?' gantt-bar--clipped-end':'')
 return <Link className={cls} to={s.item.href} aria-label={label} title={label} style={{left:from*dayWidth,width:Math.max(dayWidth,(to-from)*dayWidth)}}>{s.item.overdue?<span className="gantt-bar__tag">Overdue</span>:null}</Link>
}

/** Week-by-week gantt. One committee when `only` is set, otherwise every committee compiled into one chart. */
export function Gantt({items,start,today,only,several,units,onCommittee}:{items:TimelineItem[];start:string;today:string;only:Named|null;several:boolean;units:Named[];onCommittee:(id:string)=>void}){
 const[collapsed,setCollapsed]=useState<Set<string>>(()=>new Set())
 const days=ganttWeeks*7,end=addDays(start,days-1)
 const weeks=Array.from({length:ganttWeeks},(_,n)=>addDays(start,n*7))
 const spans=items.map(i=>span(i)).filter((s):s is Span=>s!==null)
 const groups=groupByCommittee(spans,only)
 const todayOffset=daysBetween(start,today),showToday=todayOffset>=0&&todayOffset<days
 const toggle=(key:string)=>setCollapsed(c=>{const n=new Set(c);if(n.has(key))n.delete(key);else n.add(key);return n})
 const byWeek=new Map<string,Span[]>()
 for(const s of sortSpans(spans)){if(s.end>end||s.end<start)continue;const w=weeks.filter(x=>x<=s.end).pop()??weeks[0];byWeek.set(w,[...(byWeek.get(w)??[]),s])}
 const later=spans.filter(s=>s.end>end).length,earlier=spans.filter(s=>s.end<start).length
 return <section className="gantt" aria-label={only?only.name+' gantt':'Project-wide gantt'}>
 <div className="gantt-toolbar">
 <label>Committee<select value={only?.id??(several?'several':'')} onChange={e=>{if(e.target.value!=='several')onCommittee(e.target.value)}}><option value="">All committees</option>{several?<option value="several">Several (set in Filters)</option>:null}{only&&!units.some(u=>u.id===only.id)?<option value={only.id}>{only.name}</option>:null}{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
 {groups.length>1?<div className="gantt-toolbar__actions"><button type="button" className="button button--secondary" onClick={()=>setCollapsed(new Set())}>Expand all</button><button type="button" className="button button--secondary" onClick={()=>setCollapsed(new Set(groups.map(g=>g.key)))}>Collapse all</button></div>:null}
 </div>
 <p className="gantt-legend"><span className="gantt-key gantt-key--planned" aria-hidden="true"/> Planned start to due date <span className="gantt-key gantt-key--estimated" aria-hidden="true"/> No start date, shown as the week before it's due <span className="gantt-key gantt-key--overdue" aria-hidden="true"/> Overdue{showToday?<><span className="gantt-key gantt-key--today" aria-hidden="true"/> Today</>:null}</p>
 {spans.length===0?<p>Nothing with a due date falls in these weeks.</p>:<>
 <div className="gantt-scroll" role="region" aria-label="Gantt chart, scroll sideways" tabIndex={0}>
 <table className="gantt-table" style={{width:240+days*dayWidth}}>
 <caption className="visually-hidden">{(only?only.name:'All committees')+', weeks of '+shortDay(start)+' to '+shortDay(end)+'. Each row is a work item; the bar runs from planned start to due date.'}</caption>
 <colgroup><col style={{width:240}}/><col span={ganttWeeks} style={{width:weekWidth}}/></colgroup>
 <thead><tr><th scope="col" className="gantt-name">Work item</th>{weeks.map(w=><th scope="col" key={w} className={'gantt-week'+(showToday&&today>=w&&today<=addDays(w,6)?' gantt-week--now':'')}><span className="visually-hidden">Week of </span>{shortDay(w)}</th>)}</tr></thead>
 {groups.map(g=>{const open=!collapsed.has(g.key);return <tbody key={g.key}>
 <tr className="gantt-group"><th scope="rowgroup" colSpan={ganttWeeks+1}><button type="button" aria-expanded={open} onClick={()=>toggle(g.key)}><span className="gantt-chevron" aria-hidden="true">{open?'-':'+'}</span>{g.name}<span className="gantt-count">{g.spans.length} {g.spans.length===1?'item':'items'}</span></button></th></tr>
 {open?g.spans.map(s=><tr key={s.item.id} className="gantt-row">
 <th scope="row" className="gantt-name"><div className="gantt-name__inner"><Link to={s.item.href}>{s.item.title}</Link><span>{s.estimated?'Due '+shortDay(s.end):shortDay(s.start)+' to '+shortDay(s.end)}{s.item.overdue?' · Overdue':''}</span></div></th>
 <td colSpan={ganttWeeks} className="gantt-track-cell"><div className="gantt-track" style={{width:days*dayWidth,backgroundSize:`${weekWidth}px 100%`}}>
 {showToday?<div className="gantt-today" aria-hidden="true" style={{left:todayOffset*dayWidth+dayWidth/2}}/>:null}
 <Bar s={s} start={start} days={days}/>
 </div></td></tr>):null}
 </tbody>})}
 </table></div>
 <div className="gantt-mobile">{[...byWeek].map(([w,list])=><section key={w} aria-label={'Due in the week of '+shortDay(w)}><h3>Week of {shortDay(w)}{showToday&&today>=w&&today<=addDays(w,6)?' (this week)':''}</h3><ul className="gantt-mobile__list">{list.map(s=><li key={s.item.id} className={s.item.overdue?'is-overdue':undefined}><Link to={s.item.href} aria-label={describe(s)}>{s.item.title}</Link><span>{s.committee} · {s.estimated?'Due '+shortDay(s.end):shortDay(s.start)+' to '+shortDay(s.end)}{s.item.overdue?' · Overdue':''}</span></li>)}</ul></section>)}
 {later?<p>{later} {later===1?'item is':'items are'} due after {shortDay(end)}. Move to the next month to see {later===1?'it':'them'} by week.</p>:null}
 {earlier?<p>{earlier} {earlier===1?'item was':'items were'} due before {shortDay(start)}. Move to an earlier month to see {earlier===1?'it':'them'} by week.</p>:null}</div>
 </>}
 </section>
}
