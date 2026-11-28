import {Link} from 'react-router'
import {addDays} from './dates'
import type {TimelineItem} from './api'
import {daysBetween,describe,longDay,shortDay,sortSpans,span,type Span} from './views'

const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
type Segment={s:Span;col:number;len:number;lane:number;before:boolean;after:boolean}

function lay(spans:Span[],week:string):{segments:Segment[];lanes:number}{
 const end=addDays(week,6),lanes:string[]=[],segments:Segment[]=[]
 const inWeek=spans.filter(s=>s.end>=week&&s.start<=end).sort((a,b)=>(a.start<week?week:a.start).localeCompare(b.start<week?week:b.start)||daysBetween(b.start,b.end)-daysBetween(a.start,a.end)||a.item.title.localeCompare(b.item.title))
 for(const s of inWeek){
 const from=s.start<week?week:s.start,to=s.end>end?end:s.end
 let lane=lanes.findIndex(last=>last<from);if(lane<0){lane=lanes.length;lanes.push(to)}else lanes[lane]=to
 segments.push({s,col:daysBetween(week,from),len:daysBetween(from,to)+1,lane,before:s.start<week,after:s.end>end})
 }
 return{segments,lanes:lanes.length}
}

/** Month grid, Monday first. Items with a start date span start to due; the rest sit on their due date. */
export function Calendar({items,start,end,month,today}:{items:TimelineItem[];start:string;end:string;month:string;today:string}){
 const spans=items.map(i=>span(i,false)).filter((s):s is Span=>s!==null)
 const weeks:string[]=[];for(let w=start;w<=end;w=addDays(w,7))weeks.push(w)
 const inMonth=(day:string)=>day.slice(0,7)===month
 const due=new Map<string,Span[]>();for(const s of sortSpans(spans)){if(s.end<start||s.end>end)continue;due.set(s.end,[...(due.get(s.end)??[]),s])}
 return <section className="cal" aria-label="Calendar">
 <p className="gantt-legend">Work with a start date runs across the days from start to due date. Work with only a due date sits on that day.</p>
 <div className="cal-grid">
 <div className="cal-head" aria-hidden="true">{weekdays.map(d=><span key={d}>{d}</span>)}</div>
 {weeks.map(w=>{const{segments,lanes}=lay(spans,w);return <section key={w} className="cal-week" aria-label={'Week of '+longDay(w)} style={{gridTemplateRows:`28px ${lanes?`repeat(${lanes},26px) `:''}minmax(12px,1fr)`}}>
 {Array.from({length:7},(_,n)=>{const day=addDays(w,n);return <div key={day} className={'cal-day'+(inMonth(day)?'':' cal-day--outside')+(day===today?' cal-day--today':'')} style={{gridColumn:n+1}}><span className="cal-date">{day===today?<span className="visually-hidden">Today, </span>:null}{Number(day.slice(8))}{day.slice(8)==='01'?' '+shortDay(day).split(' ')[1]:''}</span></div>})}
 {segments.map(g=>{const label=describe(g.s,g.s.start===g.s.end);return <Link key={g.s.item.id} to={g.s.item.href} aria-label={label} title={label} className={'cal-item'+(g.s.item.overdue?' cal-item--overdue':'')+(g.before?' cal-item--before':'')+(g.after?' cal-item--after':'')} style={{gridColumn:`${g.col+1} / span ${g.len}`,gridRow:g.lane+2}}>{g.s.item.title}</Link>})}
 </section>})}
 </div>
 <div className="cal-agenda">{due.size===0?<p>Nothing is due in this month.</p>:[...due].map(([day,list])=><section key={day} aria-label={'Due '+longDay(day)}><h3>{longDay(day)}{day===today?' (today)':''}</h3><ul className="gantt-mobile__list">{list.map(s=><li key={s.item.id} className={s.item.overdue?'is-overdue':undefined}><Link to={s.item.href} aria-label={describe(s,s.start===s.end)}>{s.item.title}</Link><span>{s.committee}{s.start!==s.end?' · from '+shortDay(s.start):''}{s.item.overdue?' · Overdue':''}</span></li>)}</ul></section>)}</div>
 </section>
}
