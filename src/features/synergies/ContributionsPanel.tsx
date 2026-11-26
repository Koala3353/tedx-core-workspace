import {useEffect,useState} from 'react'
import {useNavigate} from 'react-router'
import {Panel} from '../../components/Page'
import {LoadingState} from '../../components/FeedbackState'
import type {SynergiesApi,SynergyOptions} from './api'
import {CommitteeWork} from './WorkingTogetherPage'
import {SynergyForm} from './SynergyForm'
import {RefreshButton} from '../shared/RefreshButton'
export function ContributionsPanel({api,termId,parentId,onPendingChange}:{api:SynergiesApi;termId:string;parentId:string;onPendingChange?:(pending:boolean)=>void}){
 const [options,setOptions]=useState<SynergyOptions|null>(),[error,setError]=useState(false),[reload,setReload]=useState(0),navigate=useNavigate()
 useEffect(()=>{let live=true;void api.options(termId,parentId).then(o=>{if(live){setOptions(o);setError(false)}}).catch(()=>{if(live){setError(true)}});return()=>{live=false}},[api,termId,parentId,reload])
 return <Panel title="Help from other committees"><CommitteeWork api={api} termId={termId} parentId={parentId} view="parent"/>{error?<p role="alert">Couldn't load the request form. Try again. <RefreshButton onRefresh={()=>setReload(n=>n+1)}/></p>:null}{options===undefined&&!error?<LoadingState title="Loading"/>:null}{options?<details className="synergy-request"><summary>Ask another committee for help</summary><SynergyForm api={api} options={options} parentId={parentId} onPendingChange={onPendingChange} onRefresh={()=>setReload(n=>n+1)} onSaved={r=>void navigate('/working-together/'+r.agreementId)}/></details>:null}</Panel>
}
