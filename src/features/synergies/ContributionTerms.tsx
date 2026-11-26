import {useEffect,useState} from 'react'
import {Link} from 'react-router'
import {Panel} from '../../components/Page'
import {ErrorState,LoadingState} from '../../components/FeedbackState'
import {formatDay} from '../shared/dates'
import {useAutoRefresh} from '../shared/useAutoRefresh'
import type {ContributionView,SynergiesApi} from './api'
export function ContributionTerms({api,id}:{api:SynergiesApi;id:string}){
 const [item,setItem]=useState<ContributionView|null>(),[error,setError]=useState(false),[reload,setReload]=useState(0)
 useEffect(()=>{let live=true;void api.contribution(id).then(c=>{if(live){setItem(c);setError(false)}}).catch(()=>{if(live){setError(true);setItem(undefined)}});return()=>{live=false}},[api,id,reload])
 useAutoRefresh(()=>setReload(n=>n+1))
 return <Panel title="What was agreed">{error?<ErrorState title="Couldn't load what was agreed" description="Check your connection, then refresh the page."/>:item===undefined?<LoadingState title="Loading"/>:item?<><p>Agreed version {item.revision} · Owner: {item.ownerName} · Effort: {item.effort}</p><p>{item.task.dependencyBlocked?'Blocked: an earlier task has to finish first. Check this task\'s dependencies.':'Ready to work on.'}</p><p>Agreed deadline: {formatDay(item.dueOn)}</p><p className="record-text">{item.output}</p><h3>Done when</h3><p className="record-text">{item.criteria}</p>{item.parentId?<Link to={'/deliverables/'+item.parentId}>Open the deliverable</Link>:<p>The deliverable isn't shared with you.</p>}<p>Changes still being discussed don't apply until both heads agree.</p></>:<p>This agreement is no longer shared with you.</p>}</Panel>
}
