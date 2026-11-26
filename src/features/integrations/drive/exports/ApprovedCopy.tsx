import {useId,useRef,useState} from 'react'
import {DriveUiError} from '../api'
import type {ApprovedCopyApi} from './api'

export function ApprovedDriveCopy({api,term,work,asset,name,revision,disabled}: {
  api:ApprovedCopyApi;term:string;work:string;asset:string;name:string;revision:number;disabled:boolean
}) {
  const id=useId()
  const [destinations,setDestinations]=useState<Awaited<ReturnType<ApprovedCopyApi['destinations']>>|null>(null)
  const [selected,setSelected]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [result,setResult]=useState('')
  const active=useRef(false)

  async function perform(action:'review'|'copy'){
    if(active.current||disabled)return
    active.current=true;setBusy(true);setError('');setResult('')
    try{
      if(action==='review'){
        const choices=await api.destinations(term,work,asset)
        setDestinations(choices)
        setSelected(previous=>choices.some(choice=>choice.id===previous)?previous:choices.length===1?choices[0].id:'')
      }else{
        const saved=await api.copy(term,work,asset,selected)
        setResult('Copied to Drive · '+saved.name)
      }
    }catch(cause){
      const code=cause instanceof DriveUiError?cause.code:'unavailable'
      if(code==='denied'||code==='stale')setError('The approval or folder access changed. Ask an admin to check it, then choose the folder again.')
      else if(code==='reconnect')setError('Connect Drive again from Account, then try again.')
      else if(code==='file_unavailable')setError('Couldn\'t confirm the approved file. Ask an admin to check it.')
      else setError(action==='copy'?'Couldn\'t confirm the copy. Try the same folder again.':'Couldn\'t load Drive folders. Try again.')
    }finally{active.current=false;setBusy(false)}
  }

  return <div>
    <button type="button" className="button button--secondary" disabled={disabled||busy}
      onClick={()=>void perform('review')}>{destinations?'Reload folders':'Choose a Drive folder'}</button>
    {destinations?.length===0?<p role="status">No Drive folder has been approved for this file yet.</p>:null}
    {destinations?.length?<>
      <p>{name} · approved revision {revision}</p>
      <label htmlFor={id}>Drive folder</label>
      <select id={id} value={selected} disabled={disabled||busy} onChange={event=>{setSelected(event.target.value);setError('');setResult('')}}>
        {destinations.length>1?<option value="">Choose a folder</option>:null}
        {destinations.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <p>The final file remains available in the app after the copy.</p>
      <button type="button" className="button" disabled={disabled||busy||!selected} onClick={()=>void perform('copy')}>Copy to Drive</button>
    </>:null}
    {busy?<p role="status">Working…</p>:null}
    {error?<p role="alert">{error}</p>:null}
    {result?<p role="status">{result}</p>:null}
  </div>
}
