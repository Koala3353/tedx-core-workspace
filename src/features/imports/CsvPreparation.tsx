import {useMemo,useState} from 'react'
import {Link,useRouteLoaderData} from 'react-router'
import {PageHeading,Panel} from '../../components/Page'
import {isGuest,type WorkspaceContext} from '../auth/gateway'
import {dryRun,fields,parseCsv,templates,type Kind,type Mapping} from './csv'
import {TaskImportPanel} from './TaskImportPanel'
import type {TaskImportsApi} from './task-import-api'
import {RosterImportPanel} from './RosterImportPanel'
import type {RosterImportsApi} from './roster-import-api'
import {HowThisWorks} from '../shared/HowThisWorks'
import './imports.css'

const labels:Record<string,string>={source_key:'source key',title:'title',assignee:'person responsible',committee:'committee',due_on:'due date',reference:'existing reference',display_name:'person’s name',email:'school email'}
const defaultMap=(kind:Kind):Mapping=>Object.fromEntries(fields[kind].map(field=>[field,field]))
export function CsvPreparation({api,rosterApi}:{api?:TaskImportsApi;rosterApi?:RosterImportsApi}={}){
  const context=useRouteLoaderData('workspace') as WorkspaceContext
  if(isGuest(context)||!['admin.configure','roles.manage'].every(c=>context.capabilities.includes(c)))return <><PageHeading title="You can't import here"/><p>Importing needs admin and roster permissions. <Link to="/">Back to Overview</Link>.</p></>
  return <Preparation key={context.termId+context.memberId+JSON.stringify(context.capabilities)} api={api} rosterApi={rosterApi} term={context.termId}/>
}
function Preparation({api,rosterApi,term}:{api?:TaskImportsApi;rosterApi?:RosterImportsApi;term:string}){
  const [locked,setLocked]=useState(false)
  const [kind,setKind]=useState<Kind>('tasks'),[input,setInput]=useState(templates.tasks),[mapping,setMapping]=useState<Mapping>(defaultMap('tasks'))
  const [review,setReview]=useState<ReturnType<typeof dryRun>|null>(null)
  const parsed=useMemo(()=>{try{return {rows:parseCsv(input),error:''}}catch(e){return {rows:[],error:(e as Error).message}}},[input])
  const header=parsed.rows[0]??[]
  const ignored=header.filter(h=>!Object.values(mapping).includes(h))
  return <div className="csv-preparation"><PageHeading title="Prepare a CSV" description="Match your columns, fix any problem rows, then review before importing."/>
    <p role="status">{api||rosterApi?'Nothing is imported until you review and confirm it.':'This page only prepares a CSV. Importing isn\'t available here.'}</p><p>To start from existing records, download them from <Link to="/tasks">My tasks</Link> or <Link to="/deliverables">Deliverables</Link>.</p><fieldset disabled={locked} className="csv-editor">
    <Panel title="1. Choose a template"><label>What are you importing?<select aria-label="What are you importing?" value={kind} onChange={e=>{setKind(e.target.value as Kind);setMapping({});setReview(null)}}><option value="tasks">Tasks</option><option value="roster">People for the roster</option></select></label>
      <HowThisWorks title="Formatting rules"><ul><li>Save as a UTF-8 CSV with a header row: up to 500 rows, 32 columns and 200,000 characters.</li><li>Cells in quotes can contain commas and line breaks. Row numbers count the header row.</li><li>Give every row a unique source key, and keep it the same if you import the file again.</li><li>Use people and committee names exactly as they appear in the workspace.</li><li>An existing reference only helps find a record. New work gets its reference automatically.</li><li>Roster rows add people for review only. They don't link a login or assign a role.</li><li>Budget items can't be imported here.</li><li>Your CSV stays on this page only until you save a draft. Reloading clears it, so keep your original file.</li></ul></HowThisWorks>
      <button className="button button--quiet" onClick={()=>{setInput(templates[kind]);setMapping(defaultMap(kind));setReview(null)}}>Load sample CSV</button>
      <label>CSV input<textarea aria-label="CSV input" rows={8} spellCheck={false} value={input} onChange={e=>{setInput(e.target.value);setReview(null)}}/></label>
      {parsed.error?<p role="alert">{parsed.error} Fix the CSV and try again.</p>:null}
    </Panel>
    <Panel title="2. Match your columns"><p>Pick which CSV column fills each field. Tasks need a source key and title. Roster rows need a source key, name and school email.</p>
      <div className="csv-mapping">{fields[kind].map(field=><label key={field}>Column for {labels[field]}<select aria-label={'Column for '+labels[field]} value={mapping[field]??''} onChange={e=>{setMapping({...mapping,[field]:e.target.value});setReview(null)}}><option value="">Not used</option>{mapping[field]&&!header.includes(mapping[field])?<option value={mapping[field]}>Missing: {mapping[field]}</option>:null}{header.map((h,i)=><option key={i} value={h}>{h||'(unnamed column)'}</option>)}</select></label>)}</div>
      <p>Columns not used: {ignored.join(', ')||'none'}. Remove any role, permission or money columns, even if they're not used.</p>
      <button className={api||rosterApi?'button button--secondary':'button'} disabled={!!parsed.error||!input} onClick={()=>setReview(dryRun(kind,parsed.rows,mapping))}>Check rows</button>
    </Panel>
    {review?<Panel title="Check results"><p role="status">{review.valid?`${review.rows.length} ${review.rows.length===1?'row looks':'rows look'} good. Nothing has been imported yet.`:'Fix the errors below, then check again. Nothing can be imported while any error remains.'}</p>
      {review.errors.length?<ul role="alert">{review.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>:null}
      <p>These are the values from your CSV. Names, committees and references are matched in the next step. Blank cells don't clear existing fields.</p>
      <div className="csv-review" tabIndex={0} role="region" aria-label="Rows from your CSV"><table><thead><tr><th>Row</th>{fields[kind].map(f=><th key={f}>{labels[f]}</th>)}<th>Problems</th></tr></thead><tbody>{review.rows.map(row=><tr key={row.record}><th>{row.record}</th>{fields[kind].map(f=><td key={f}>{row.values[f]||'Blank'}</td>)}<td>{row.errors.length?<ul>{row.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>:'Looks good'}</td></tr>)}</tbody></table></div>
    </Panel>:null}
    </fieldset>
    {api&&kind==='tasks'?<TaskImportPanel api={api} term={term} input={{header:parsed.rows[0]??[],rows:parsed.rows.slice(1),mapping}} enabled={!parsed.error&&parsed.rows.length>1&&parsed.rows.length<=51} onLockChange={setLocked} onDenied={()=>{setInput('');setMapping({});setReview(null)}} onLoad={d=>{if(d){setKind('tasks');setMapping(d.input.mapping);setInput([d.input.header,...d.input.rows].map(row=>row.map(cell=>'"'+cell.replaceAll('"','""')+'"').join(',')).join('\r\n'));setReview(null)}}}/>:rosterApi&&kind==='roster'?<RosterImportPanel api={rosterApi} term={term} input={{header:parsed.rows[0]??[],rows:parsed.rows.slice(1),mapping}} enabled={!parsed.error&&parsed.rows.length>1&&parsed.rows.length<=51} onLockChange={setLocked} onDenied={()=>{setInput('');setMapping({});setReview(null)}} onLoad={d=>{setMapping(d.input.mapping);setInput([d.input.header,...d.input.rows].map(row=>row.map(cell=>'"'+cell.replaceAll('"','""')+'"').join(',')).join('\r\n'));setReview(null)}}/>:<Panel title="3. Import"><p>Importing isn't connected yet. You can prepare and check a CSV here, but not import it.</p></Panel>}
  </div>
}
