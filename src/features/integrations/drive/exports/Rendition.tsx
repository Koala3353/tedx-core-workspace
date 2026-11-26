import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router'
import {Panel} from '../../../../components/Page'
import {DriveUiError} from '../api'
import type {RenditionApi, RenditionOffer, SavedRendition} from './api'

export function DriveRendition({api,term,work,disabled,onSaved,onBusy}: {
  api: RenditionApi; term: string; work: string; disabled: boolean
  onSaved: (result: SavedRendition)=>void; onBusy: (busy: boolean)=>void
}) {
  const [offer,setOffer]=useState<RenditionOffer|null>(null)
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState<'pick'|'save'|null>(null)
  const [retry,setRetry]=useState(false)
  const [manage,setManage]=useState(false)
  const active=useRef<AbortController|null>(null)
  useEffect(()=>()=>active.current?.abort(),[])

  async function run(mode: 'pick'|'save') {
    if (active.current || disabled || (mode==='save'&&!offer)) return
    const operation=new AbortController()
    active.current=operation
    setBusy(mode);onBusy(true);setMessage('');setManage(false)
    try {
      if (mode==='pick') {
        const selected=await api.pick(term,work,operation.signal)
        if (!operation.signal.aborted) {setOffer(selected);setRetry(false)}
      } else if (offer) {
        const saved=await api.save(term,work,offer.selection)
        if (!operation.signal.aborted) {setOffer(null);setRetry(false);onSaved(saved)}
      }
    } catch (error) {
      if (operation.signal.aborted) return
      const code=error instanceof DriveUiError?error.code:'unavailable'
      setRetry(mode==='save'&&code==='unavailable')
      if (code!=='unavailable') setOffer(null)
      setManage(code==='reconnect')
      if (code==='stale') setMessage('The draft or Drive file changed, or your selection expired. Choose the final file again.')
      else if (code==='reconnect') setMessage('Connect Drive again, or upload the final PDF yourself.')
      else if (code==='file_unavailable'||code==='denied') setMessage('Couldn\'t save the PDF. Check you can open the file and try again, or upload the PDF yourself.')
      else setMessage(mode==='save'?'Couldn\'t confirm the save. Try again.':'Couldn\'t open Drive. Try again, or upload the PDF yourself.')
    } finally {
      active.current=null
      onBusy(false)
      if (!operation.signal.aborted) setBusy(null)
    }
  }

  return <Panel title="Save a PDF from Drive">
    <p>Choose the final Google Doc, Sheet or Slides file. Check the saved PDF before you submit.</p>
    {offer?<p>Selected PDF: <strong>{offer.name}</strong></p>:null}
    <div className="auth-actions">
      <button type="button" className="button button--secondary" disabled={disabled||!!busy} onClick={()=>void run('pick')}>
        {offer?'Choose a different file':'Choose the final file from Drive'}
      </button>
      {offer?<button type="button" className="button" disabled={disabled||!!busy} onClick={()=>void run('save')}>
        {retry?'Try again':'Save PDF'}
      </button>:null}
    </div>
    {busy?<p role="status">{busy==='save'?'Saving your selected PDF…':'Checking the file…'}</p>:null}
    {message?<p role="alert">{message}</p>:null}
    {manage?<Link to={'/account?term='+encodeURIComponent(term)+'#drive-connection'}>Manage your Drive connection</Link>:null}
  </Panel>
}
