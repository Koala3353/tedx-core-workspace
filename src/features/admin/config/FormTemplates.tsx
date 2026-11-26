import {useState} from 'react'
import type {FormDefinition} from '../../requests/catalog/api'
import {freshQuestionKey,newQuestion} from './question-factory'

const templates={
 schedule:{label:'Schedule and place',size:2,description:'Optional date and time in Asia/Manila, plus a place or online location.',create:(section:string)=>[
  {...newQuestion('date_time',section),label:'When is it needed?',help:'Leave blank if the schedule is not yet known.'},
  {...newQuestion('short_text',section),label:'Where is it needed?',help:'Name the place or online location. Leave blank if it is not yet known.'}
 ]},
 items:{label:'Items to prepare',size:3,description:'Items and quantities. Leave prices and approvals out.',create:(section:string)=>{
  const rows=newQuestion('line_items',section)
  return[{...rows,label:'Items to prepare',help:'Add only what this request needs. Money goes in the Budget form.',itemFields:[
   {...rows.itemFields![0],label:'Item or activity',help:'Describe the item or activity in this row.',required:true},
   {...newQuestion('number',section),label:'Quantity',help:'Enter the number needed.',required:true,min:1}
  ]}]
 }}
} as const

export function FormTemplates({value,fieldCount,change}:{value:FormDefinition;fieldCount:number;change:(next:FormDefinition)=>void}){
 const[selected,setSelected]=useState<keyof typeof templates>('schedule'),template=templates[selected],blocked=value.sections.length>=10||fieldCount+template.size>50
 function add(){if(blocked)return;const section={key:freshQuestionKey('section'),label:template.label};change({...value,sections:[...value.sections,section],fields:[...value.fields,...template.create(section.key)]})}
 return <details><summary>Templates</summary><p>Add a set of questions you can edit as a new section in this private draft. Existing questions and answers stay as they are. Pick only what this request needs. Adding a template doesn't publish anything.</p>
  <label>Question template<select aria-label="Question template" value={selected} onChange={e=>setSelected(e.target.value as keyof typeof templates)}>{Object.entries(templates).map(([key,t])=><option key={key} value={key}>{t.label}</option>)}</select></label>
  <p>{template.description}</p><p>This adds 1 section and {template.size} questions, counting row questions. They use normal request access, and the template doesn't give anyone access or approval rights. Before saving, you can edit or remove draft questions nothing else uses.</p>
  {blocked?<p>This template won't fit. A form can have up to 10 sections and 50 questions, counting row questions. Remove unused draft questions or empty sections first. Existing questions are kept.</p>:null}
  <button type="button" className="button button--secondary" disabled={blocked} onClick={add}>Add template questions</button>
 </details>
}
