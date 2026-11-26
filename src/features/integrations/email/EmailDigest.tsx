import { useEffect,useState } from 'react'
import { Panel } from '../../../components/Page'
import { useFinDecision } from '../../finance/DecisionMemory'
import {RefreshButton} from '../../shared/RefreshButton'
import type { EmailDigestApi,EmailDigestStatus } from './api'

const activationText={
  ready:'Email is ready.',
  sender:'Email isn\'t set up for this workspace yet.',
  domain:'Email delivery is paused while the sending domain is checked.',
  quota:'Email is paused while the sending limit is checked.',
}
const healthText={
  waiting:'The last email is waiting for another delivery attempt.',
  sending:'The last email is being checked.',
  accepted:'The provider accepted the last email. Delivery is pending.',
  delivered:'The provider confirmed delivery of the last email.',
  bounced:'The last email was returned. Email is paused for this address.',
  failed:'The last email could not be delivered.',
  uncertain:'Delivery could not be confirmed. Check this inbox for the updates.',
}

export function EmailDigest({api,term,scopeReady}:{api:EmailDigestApi;term:string;scopeReady:boolean}) {
  const preference=useFinDecision(api,'email-digest:'+term,{})
  const [revision,setRevision]=useState(0)
  const [read,setRead]=useState<{revision:number;status:EmailDigestStatus|null}|null>(null)
  const [saved,setSaved]=useState('')
  const status=read?.revision===revision?read.status:null
  function refresh(){setRevision(value=>value+1)}
  useEffect(()=>{
    let active=true
    void api.status(term).then(status=>{if(active)setRead({revision,status})})
      .catch(()=>{if(active)setRead({revision,status:null})})
    return()=>{active=false}
  },[api,revision,term])
  async function update(enable?:boolean){
    setSaved('')
    const result=await preference.run(status&&enable!==undefined?{term,enable,version:status.version}:undefined)
    if(result)setSaved(result.enabled?'Email digest preference saved.':'Email digest turned off.')
    refresh()
  }
  return <Panel title="Email digest">
    <p>Optional: get one email each morning (after 8 AM) listing yesterday's unread updates.</p>
    <p role="status">{status?activationText[status.activation]:read?.revision===revision?'Couldn\'t load email settings. Try again.':'Loading…'}</p>
    {status?.bounced?<p role="status">Emails to this address keep bouncing, so they're paused. If the address is right, tell an admin.</p>:
      status?.health?<p role="status">{healthText[status.health]}</p>:null}
    {saved?<p role="status">{saved}</p>:null}{preference.error?<p role="alert">{preference.error}</p>:null}
    <div className="auth-actions">
      {status&&(status.enabled||status.activation==='ready'&&!status.bounced)?<button type="button" className="button button--secondary"
        disabled={preference.locked||!scopeReady} onClick={()=>void update(!status.enabled)}>
        {status.enabled?'Turn off email digest':'Turn on daily email digest'}
      </button>:null}
      {preference.pending?<button type="button" className="button button--secondary" disabled={preference.busy}
        onClick={()=>void update()}>Try again</button>:null}
      <RefreshButton onRefresh={refresh}/>
    </div>
  </Panel>
}
