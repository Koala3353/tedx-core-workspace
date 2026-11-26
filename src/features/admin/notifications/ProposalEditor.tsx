import {useId,useState} from 'react'
import {formatDateTime,formatDay} from '../../shared/dates'
import {defaultProposal,externalTemplate,planReminder,type NotificationProposal,type PlannedReminder} from './proposal'
export function ProposalEditor({value,onChange,disabled=false}:{value?:NotificationProposal;onChange?:(v:NotificationProposal)=>void;disabled?:boolean}={}){
 const[localRule,setRule]=useState(defaultProposal),[due,setDue]=useState('2027-04-17'),[rows,setRows]=useState<PlannedReminder[]|null>(null),[error,setError]=useState(''),[dirty,setDirty]=useState(false),id=useId(),rule=value??localRule
 function change(next:NotificationProposal){if(disabled)return;if(onChange)onChange(next);else setRule(next);setRows(null);setError('');setDirty(true)}
 function preview(){setRows(null);setError('');try{const d=Date.parse(due+'T00:00:00Z');if(!Number.isFinite(d))throw Error();setRows(planReminder(rule,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',due,new Date(d-3*86400000).toISOString(),new Date(d+5*86400000).toISOString()))}catch{setError('Pick a valid example date, whole numbers for the timings and different quiet-hour start and end times. Your settings are kept.')}}
 const hour=(key:'hour'|'quietStart'|'quietEnd',label:string)=><div><label htmlFor={id+key}>{label}</label><select id={id+key} className="overview-example" value={rule[key]} onChange={e=>change({...rule,[key]:Number(e.target.value)})}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>)}</select></div>
 return <details className="work-section" data-edit-form={value===undefined?true:undefined} data-unsaved-changes={value===undefined?dirty:undefined}><summary>{value?'Edit reminder settings':'Try reminder timing'}</summary>
 <p>{value?'Change the settings, then preview when reminders would go out for a sample task.':'Sample only. Nothing is saved or sent.'}</p>
 <fieldset disabled={disabled}><legend>Reminder settings</legend><p>Reminders go to the people assigned to the work: before it's due, on the due day and when it's overdue.</p>
 <div><label htmlFor={id+'channel'}>Send by</label><select id={id+'channel'} className="overview-example" value={rule.channel} onChange={e=>change({...rule,channel:e.target.value as NotificationProposal['channel']})}><option value="in_app">In-app</option><option value="email">Email (not connected yet)</option><option value="telegram">Telegram (not connected yet)</option></select></div>
 <div><label htmlFor={id+'mode'}>How often</label><select id={id+'mode'} className="overview-example" value={rule.mode} onChange={e=>change({...rule,mode:e.target.value as NotificationProposal['mode']})}><option value="immediate">Right away</option><option value="digest">Daily digest</option><option value="mute">Off</option></select></div>
 <label>Days before due<input className="overview-example" type="number" min={1} max={7} value={rule.beforeDays} onChange={e=>change({...rule,beforeDays:Number(e.target.value)})}/></label>
 <label><input type="checkbox" checked={rule.dueDay} onChange={e=>change({...rule,dueDay:e.target.checked})}/>Include the due day</label>
 <label>Repeat overdue reminders every (days)<input className="overview-example" type="number" min={1} max={7} value={rule.overdueEveryDays} onChange={e=>change({...rule,overdueEveryDays:Number(e.target.value)})}/></label>
 {hour('hour','Reminder time')}{hour('quietStart','Quiet hours start')}{hour('quietEnd','Quiet hours end')}
 <label>Sample due date<input className="overview-example" type="date" value={due} onChange={e=>{setDue(e.target.value);setDirty(true);setRows(null);setError('')}}/></label>
 </fieldset><p>Quiet hours only delay email and Telegram. Work always stays visible in the app.</p>
 <p>Message wording: {externalTemplate(rule.template)}</p>
 <button className="button button--secondary" disabled={disabled} onClick={preview}>Preview timing</button>{error?<p role="alert">{error}</p>:null}
 {rows?<section aria-label="Timing preview"><h3>Timing preview</h3><p>When reminders would go out for one sample task. Nothing is sent.</p><ol>{rows.map(r=><li key={r.key}>{r.event==='before_due'?'Before due':r.event==='due'?'Due day':'Overdue'} · for {formatDay(r.logicalDay)} · sent {formatDateTime(r.at)}{rule.mode==='mute'?' · Off':''}</li>)}</ol></section>:null}
 </details>
}
