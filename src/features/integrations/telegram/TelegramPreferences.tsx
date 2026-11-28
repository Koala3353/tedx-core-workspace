import { useEffect,useState } from 'react'
import { Panel } from '../../../components/Page'
import { TextField } from '../../../components/TextField'
import { useFinDecision } from '../../finance/DecisionMemory'
import type { NotificationPage,NotificationsApi } from '../../notifications/api'
import {RefreshButton} from '../../shared/RefreshButton'
import { telegramConfirmCode,telegramProofHash,telegramStartCode,TelegramUiError,type TelegramApi,type TelegramCommand,type TelegramStatus } from './api'

type PendingLink={command:TelegramCommand;startCode?:string}
const deliveryModes=[
  ['immediate','Right away'],
  ['digest','Daily digest'],
  ['mute','Off'],
] as const
const savedMode=(mode:string)=>deliveryModes.find(([value])=>mode===value)?.[1]
const codeOf=(error:unknown)=>error&&typeof error==='object'&&'code'in error?error.code:undefined

export function TelegramPreferences({api,notifications,term,preference,refresh}:{
  api:TelegramApi;notifications:NotificationsApi;term:string;preference?:NotificationPage['preference'];refresh:()=>void
}) {
  const settings=useFinDecision(notifications,'telegram-preference:'+term,{})
  const [status,setStatus]=useState<TelegramStatus|null>(null)
  const [revision,setRevision]=useState(0)
  const [loadError,setLoadError]=useState('')
  const [linkError,setLinkError]=useState('')
  const [settingsNotice,setSettingsNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const [pending,setPending]=useState<PendingLink|null>(null)
  const [url,setUrl]=useState('')
  const [confirmation,setConfirmation]=useState('')

  const check=()=>setRevision(n=>n+1)
  useEffect(()=>{
    let live=true
    void api.status(term).then(value=>{
      if(!live)return
      setStatus(value)
      setLoadError('')
      if(value.attempt==='expired'||value.state==='linked')setUrl('')
    }).catch(error=>{
      if(!live)return
      setStatus(null)
      setLoadError('Couldn\'t load Telegram settings. Try again.')
      if(codeOf(error)==='permission'){
        setPending(null);setUrl('');setConfirmation('')
      }
    })
    return()=>{live=false}
  },[api,revision,term])

  async function editPreference(mode?:string){
    setSettingsNotice('')
    const result=await settings.run(mode&&preference?{kind:'preference',term,mode,version:preference.version}:undefined)
    if(result){setSettingsNotice('Alert preference saved.');refresh()}
    else if(!settings.pending)refresh()
  }

  async function command(action:TelegramCommand['action']){
    if(busy)return
    setBusy(true)
    setLinkError('')
    try{
      const attempt=await (async():Promise<PendingLink>=>{
        if(pending)return pending
        const key=crypto.randomUUID()
        if(action==='unlink'||action==='cancel')return {command:{action,hash:null,key}}
        if(action==='start'){
          const startCode=telegramStartCode()
          return {command:{action,hash:await telegramProofHash(startCode),key},startCode}
        }
        const proof=confirmation.trim()
        if(!telegramConfirmCode.test(proof))throw new TelegramUiError('restart')
        return {command:{action,hash:await telegramProofHash(proof),key}}
      })()
      setPending(attempt)
      const result=await api.run(term,attempt.command)
      setPending(null)
      setUrl(result==='start'&&attempt.startCode?api.startUrl(attempt.startCode):'')
      setConfirmation('')
      check()
    } catch(error){
      const code=codeOf(error)
      if(code==='permission'||code==='restart')setPending(null)
      if(code==='permission'){setStatus(null);setUrl('');setConfirmation('')}
      if(code==='restart')setConfirmation('')
      setLinkError(code==='permission'?'You don\'t have permission to change this Telegram connection.':
        code==='restart'?'This code did not match or has expired. Start a fresh link and use the new code from your private chat.':
        'We couldn\'t confirm the change. Choose Try again.')
      if(code==='restart')check()
    } finally{setBusy(false)}
  }

  return <Panel title="Delivery preferences">
    <p>All updates stay here. Telegram can also send you a short alert with a link back.</p>
    {preference?<p>Telegram alerts: <strong>{savedMode(preference.mode)}</strong>{status&&status.state!=='linked'&&preference.mode!=='mute'?' (starts once Telegram is linked below)':''}</p>:<p>Loading…</p>}
    <div className="auth-actions" aria-label="Optional alerts">
      {deliveryModes.map(([mode,label])=><button type="button" key={mode} className="button button--secondary"
        aria-pressed={preference?.mode===mode} disabled={settings.locked||!preference||preference.mode===mode}
        onClick={()=>void editPreference(mode)}>{label}</button>)}
    </div>
    {settingsNotice?<p role="status">{settingsNotice}</p>:null}
    {settings.error?<p role="alert">{settings.error}</p>:null}
    {settings.pending?<button type="button" className="button button--secondary" disabled={settings.busy}
      onClick={()=>void editPreference()}>Try again</button>:null}
    <p>No alerts between 8 PM and 8 AM. The daily digest arrives after 8 AM.</p>
    <h3>Telegram connection</h3>
    {loadError?<p role="status">{loadError}</p>:null}
    {linkError?<p role="alert">{linkError}</p>:null}
    {status?<p role="status">{status.state==='linked'?'Telegram linked.':
      status.state==='relink'?'Telegram can\'t receive alerts. Link it again if you want them.':
      status.attempt==='expired'?'Your link expired. Start a new one when you\'re ready.':'Telegram isn\'t linked. It\'s optional.'}</p>:null}
    {status?.issue?<p role="status">{status.issue==='retry'?'Telegram asked us to wait before sending the next alert.':
      status.issue==='uncertain'?'We couldn\'t confirm delivery. Check here for the update.':
      'A Telegram alert couldn\'t be delivered. Your updates are still here.'}</p>:null}
    {pending?<button type="button" className="button button--secondary" disabled={busy}
      onClick={()=>void command(pending.command.action)}>Try again</button>:null}
    {!pending&&(status?.state==='linked'||loadError)?<div className="auth-actions">
      <RefreshButton onRefresh={check} disabled={busy}/>
      {status?.state==='linked'?<button type="button" className="button button--quiet" disabled={busy||!preference}
        onClick={()=>void command('unlink')}>Unlink Telegram</button>:null}
    </div>:null}
    {status&&status.state!=='linked'&&!pending?<div>
      <div className="auth-actions">
        <button type="button" className="button button--secondary" disabled={busy||!preference} onClick={()=>void command('start')}>
          {url||status.attempt?'Start a new link':status.state==='relink'?'Relink Telegram':'Link Telegram'}
        </button>
        {status.attempt?<button type="button" className="button button--secondary" disabled={busy||!preference}
          onClick={()=>void command('cancel')}>Cancel linking</button>:null}
      </div>
      {url?<p><a className="button button--secondary" href={url} target="_blank" rel="noopener noreferrer">Open the Telegram bot</a></p>:null}
      {url||status.attempt==='confirm'||status.attempt==='start'?<form onSubmit={event=>{event.preventDefault();void command('confirm')}}>
        <p>Press Start in the bot chat, then enter the code it gives you here within 8 minutes.</p>
        <TextField id="telegram-confirmation" label="Code from Telegram" value={confirmation}
          onChange={event=>setConfirmation(event.target.value)} maxLength={24} autoComplete="off" spellCheck={false} disabled={busy||!preference}/>
        <button type="submit" className="button button--secondary" disabled={busy||!preference||!telegramConfirmCode.test(confirmation.trim())}>Confirm Telegram link</button>
      </form>:null}
    </div>:null}
  </Panel>
}
