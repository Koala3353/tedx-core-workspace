import {useEffect,useState} from 'react'
import {Link,useParams,useRouteLoaderData,useSearchParams} from 'react-router'
import {PageHeading} from '../../components/Page'
import {LoadingState,ErrorState,EmptyState} from '../../components/FeedbackState'
import type {WorkspaceContext} from '../auth/gateway'
import type {CatalogApi,CatalogEntry} from '../requests/catalog/api'
import type {FilesApi} from '../files/api'
import {Files} from '../files/Files'
import {FormRenderer} from './FormRenderer'
import type {FormsApi} from './api'
import type {FormOptions} from './validation'
import './forms.css'
import { EmptyInbox, EmptySearch } from '../../components/illustrations'
export function FormPreviewPage({api,catalog,files}:{api:FormsApi;catalog:CatalogApi;files?:FilesApi}){
 const context=useRouteLoaderData('workspace') as WorkspaceContext,{typeId=''}=useParams(),[params]=useSearchParams(),workId=params.get('workId')??undefined,[retry,setRetry]=useState(0);
 const identity=context.termId+('memberId'in context?context.memberId:context.guestAccessId),key=identity+typeId+workId+retry;
 const[state,setState]=useState<{key:string;entry:CatalogEntry|null;options:FormOptions|null;error:boolean}|null>(null);
 useEffect(()=>{let live=true;void Promise.allSettled([catalog.read(context.termId,typeId),api.options(context.termId,typeId,workId)]).then(([rows,options])=>{if(!live)return;if(rows.status==='rejected'){setState({key,entry:null,options:null,error:true});return}setState({key,entry:rows.value?.[0]??null,options:options.status==='fulfilled'?options.value:null,error:false})});return()=>{live=false}},[api,catalog,context.termId,typeId,workId,key]);
 const current=state?.key===key?state:null,admin=context.capabilities.includes('admin.configure');
 const missing=current?.entry?[!current.entry.receivingUnit?'a receiving committee':null,!current.entry.form?'a published form':null].filter(Boolean).join(' and '):'';
 return <><PageHeading title="Preview form" description="Try the form as a requester would see it. Nothing is saved or sent."/><nav className="page-actions" aria-label="Service"><Link className="button button--quiet" to={'/requests/services/'+typeId}>Back to service</Link></nav>
 {!current?<LoadingState/>:current.error?<ErrorState title="Couldn't load this form" description="Check your connection and try again." action={<button className="button button--secondary" onClick={()=>setRetry(n=>n+1)}>Try again</button>}/>:!current.entry?<EmptyState illustration={<EmptySearch />} title="Service not found" description="It may have been removed or renamed." action={<Link className="button button--secondary" to="/requests">All services</Link>}/>:missing?<EmptyState illustration={<EmptyInbox />} title="This form can't be previewed yet" description={admin?`The service still needs ${missing}.`:'This service isn\'t open yet.'} action={admin?<Link className="button button--secondary" to="/admin/config">Set up service</Link>:undefined}/>:!current.options||!current.entry.form?<ErrorState title="Couldn't load the form choices" description="The lists this form uses (people, committees) didn't load. Try again." action={<button className="button button--secondary" onClick={()=>setRetry(n=>n+1)}>Try again</button>}/>:<>
 <h2>{current.entry.label}</h2>{current.entry.processNote?<p className="muted">{current.entry.processNote}</p>:null}
 <FormRenderer key={identity+current.entry.formVersionId+workId} definition={current.entry.form} restricted={current.entry.classification==='restricted'} options={current.options} draftKey={current.entry.formVersionId+':'+(workId??'none')} validate={(values,centavos)=>api.validate(context.termId,typeId,current.entry!.formVersionId,values,centavos,workId)}/>
 {current.entry.form.fields.some(f=>f.type==='file')?<p className="muted">{workId?'You can attach files that are already uploaded to this work item.':'File fields are skipped in the preview.'}</p>:null}
 {workId&&files?<Files api={files} workId={workId}/>:null}
 </>}
 </>
}
