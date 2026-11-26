import {useEffect,useRef,useState} from 'react'
import {useLocation,useRevalidator} from 'react-router'
import {navigationItems} from '../../../app/navigation'
import {TextField} from '../../../components/TextField'
import {isGuest,type WorkspaceContext} from '../../auth/gateway'
import {forgetRecordDrafts} from '../../auth/draftScope'
import {useFinDecision} from '../../finance/DecisionMemory'
import {siteNavigationIds,validSitePresentation,type SitePresentation} from './presentation'
import {SiteControls} from './SiteControls'
import {SavedSitePreview,SiteReconcile} from './SiteReview'
import type {SiteWordingApi,SiteWordingConfiguration,SiteWordingSave,SitePublish,SiteReview,LogoChoice} from './wording-api'
import {HowThisWorks} from '../../shared/HowThisWorks'
import {useAutoRefresh} from '../../shared/useAutoRefresh'
import {formatDay} from '../../shared/dates'
import './site.css'

const defaultSite:SitePresentation={schemaVersion:1,labels:{},order:[],accent:'#b82320',blocks:[]}
const text=(v:SitePresentation)=>JSON.stringify(v)
export function SiteEditMode({api,context,onPublished}:{api:SiteWordingApi;context:WorkspaceContext;onPublished?:()=>void}){
 return isGuest(context)||!context.capabilities.includes('admin.configure')?null:<SiteMode key={context.termId+context.termMembershipId} api={api} term={context.termId} identity={context.termMembershipId} refreshToken={context} onPublished={onPublished}/>
}
function SiteMode({api,term,identity,refreshToken,onPublished}:{api:SiteWordingApi;term:string;identity:string;refreshToken:WorkspaceContext;onPublished?:()=>void}){
 const[open,setOpen]=useState(false),[data,setData]=useState<SiteWordingConfiguration|null>(null),[state,setState]=useState<'loading'|'ready'|'error'|'denied'>('loading'),[epoch,setEpoch]=useState(0),[revision,setRevision]=useState(0),[locked,setLocked]=useState(false),[saved,setSaved]=useState(false)
 const record='site-wording-'+term
 const{revalidate}=useRevalidator(),[published,setPublished]=useState(false)
 const path=useLocation().pathname,previousPath=useRef(path)
 function denied(){forgetRecordDrafts(record);setData(null);setState('denied');setLocked(false)}
 useEffect(()=>{let live=true;if(open){setState('loading');void api.read(term).then(v=>{if(live){setData(v);setState('ready')}}).catch(e=>{if(!live)return;if(e?.denied){forgetRecordDrafts(record);setData(null);setState('denied');setLocked(false)}else setState('error')})}return()=>{live=false}},[api,term,open,epoch,refreshToken,record])
 useAutoRefresh(()=>{if(open)setEpoch(n=>n+1)},{paused:locked})
 useEffect(()=>()=>forgetRecordDrafts(record),[record])
 // EditSafety permits a dirty route change only after explicit discard. The shared
 // shell survives that navigation, so close and clear this contextual editor too.
 useEffect(()=>{if(previousPath.current!==path){previousPath.current=path;forgetRecordDrafts(record);setOpen(false);setData(null);setLocked(false);setSaved(false)}},[path,record])
 return <section className="site-wording-mode" aria-label="Site wording edit mode">
 {!open?<button className="button button--secondary" onClick={()=>{setOpen(true);setSaved(false)}}>Edit site wording</button>:<div className="panel">
  <h2>Edit site wording</h2><p>Only you can see this draft until you publish it.</p>
  <div className="auth-actions"><button className="button button--quiet" disabled={locked} data-discard-edits onClick={()=>{forgetRecordDrafts(record);setOpen(false);setData(null);setSaved(false)}}>Close</button></div>
  {saved?<p role="status">{published?'Published. The menu has updated.':'Draft saved. Everyone still sees the published wording.'}</p>:null}
  {state==='loading'?<p role="status">Loading…</p>:null}
  {state==='error'?<p role="alert">Couldn\'t load site wording. Your inputs are kept. Check your connection and try again.</p>:null}
  {state==='denied'?<p role="alert">You no longer have access to site editing, so your unsaved changes were cleared.</p>:null}
  {data&&state!=='denied'?<WordingDraft key={revision} api={api} data={data} term={term} identity={identity} record={record} disabled={state!=='ready'} onLock={setLocked} denied={denied} conflict={()=>setEpoch(n=>n+1)} saved={pub=>{setSaved(true);setPublished(!!pub);setData(null);setRevision(n=>n+1);setEpoch(n=>n+1);if(pub){onPublished?.();void revalidate()}}}/>:null}
 </div>}
 </section>
}
function WordingDraft({api,data,term,identity,record,disabled,onLock,denied,conflict,saved}:{api:SiteWordingApi;data:SiteWordingConfiguration;term:string;identity:string;record:string;disabled:boolean;onLock:(v:boolean)=>void;denied:()=>void;conflict:()=>void;saved:(pub?:boolean)=>void}){
 const alive=useRef(true)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const draft=data.draft,privateDraft=draft&&!draft.publishedVersionId?draft:null,initial=text(privateDraft?.definition??data.definition??defaultSite)
 const runner={run:async(command:SiteWordingSave|SitePublish,key:string)=>{const result=await api.run(command,key);if(alive.current&&!result.ok){if(result.error.kind==='permission_denied')denied();if(result.error.kind==='stale_version')conflict()}return result}}
 const mem=useFinDecision<SiteWordingSave|SitePublish,{draftId:string;version:number}>(runner,record+':'+identity,{definition:initial,baseline:initial,base:String(privateDraft?.baseVersion??data.version),version:String(draft?.version??0),rollback:privateDraft?.rollbackVersionId??'',reason:''})
 const[review,setReview]=useState<{value:SiteReview;signature:string}|null>(null),[ack,setAck]=useState(false),[checking,setChecking]=useState(false),[error,setError]=useState(''),[logos,setLogos]=useState<LogoChoice[]|null>(null),[history,setHistory]=useState(data.history??[]),[before,setBefore]=useState(data.nextBefore??null)
 const value=JSON.parse(mem.fields.definition)as SitePresentation,dirty=mem.fields.definition!==mem.fields.baseline,stale=Number(mem.fields.base)!==data.version||Number(mem.fields.version)!==(draft?.version??0),valid=validSitePresentation(value)
 useEffect(()=>onLock(mem.locked||checking),[mem.locked,checking,onLock])
 const signature=JSON.stringify([mem.fields.definition,mem.fields.base,mem.fields.version,mem.fields.rollback,draft?.draftId,data.version]),currentReview=review?.signature===signature?review.value:null,reviewLogo=logos?.find(x=>x.assetId===currentReview?.proposed.logo?.assetId&&x.approvalId===currentReview?.proposed.logo?.approvalId)
 useEffect(()=>{let live=true;if(api.logos)void api.logos(term).then(v=>{if(live)setLogos(v)}).catch(e=>{if(!live)return;setError('Couldn\'t load the approved logos. The text name will be used for now.');if(e?.denied)denied()});return()=>{live=false}},[api,term])
 function replace(next:SitePresentation,rollback=''){mem.change({...mem.fields,definition:text(next),rollback});setReview(null);setAck(false)}
 function change(id:string,label:string){const labels={...value.labels};if(label==='')delete labels[id];else labels[id]=label;replace({...value,labels})}
 async function save(retry=false){if(!retry&&(disabled||stale||!valid))return;const command=mem.pending?.command;const result=await mem.run(retry?undefined:{term,definition:value,baseVersion:Number(mem.fields.base),version:Number(mem.fields.version),rollbackVersionId:mem.fields.rollback||null});if(result)saved(!!command&&'action'in command&&command.action==='publish')}
 async function inspect(){if(!privateDraft||dirty||stale||!api.preview)return;setChecking(true);setReview(null);setAck(false);setError('');try{const r=await api.preview(privateDraft.draftId);if(alive.current)setReview({value:r,signature})}catch(e){if(!alive.current)return;setError('Couldn\'t load the preview. Your inputs are kept. Try again.');if((e as{denied?:boolean})?.denied)denied()}finally{if(alive.current)setChecking(false)}}
 async function publish(){if(!currentReview||currentReview.stale||dirty||stale||!!currentReview.proposed.logo&&!reviewLogo||!ack||!mem.fields.reason.trim()||!privateDraft)return;const result=await mem.run({action:'publish',draftId:privateDraft.draftId,version:privateDraft.version,reviewHash:currentReview.reviewHash,reason:mem.fields.reason});if(result)saved(true)}
 return <div data-pending-command={mem.locked||checking} data-unsaved-changes={dirty||!!mem.fields.reason}>
  <fieldset disabled={mem.locked||disabled||checking}><legend>Menu names</legend><p>Leave a field empty to use the built-in name. Plain text, up to 80 characters.</p>
   {navigationItems.filter(item=>siteNavigationIds.includes(item.id)).map(item=><TextField key={item.id} id={'site-wording-'+item.id} label={item.id==='tasks'?'Tasks':item.label} maxLength={80} value={value.labels[item.id]??''} placeholder={item.label} hint={'Built-in name: '+item.label} error={value.labels[item.id]&&!validSitePresentation({...value,labels:{[item.id]:value.labels[item.id]}})?'Use plain text (no HTML), and not just spaces.':undefined} onChange={e=>change(item.id,e.target.value)}/>)}
   {stale?<p role="alert">Someone changed the site wording while you were editing. Your wording is kept. Use the comparison below to pick which version to keep for each part, then save.</p>:null}
   <button className="button button--secondary" disabled={stale||!valid} onClick={()=>void save()}>Save draft</button>
  </fieldset>
  {api.preview?<>
  <details><summary>Guidance, menu order, colour and logo</summary><SiteControls value={value} disabled={disabled||mem.locked||checking} change={replace}/>
   <div><label htmlFor="site-approved-logo">Logo</label><select id="site-approved-logo" disabled={disabled||mem.locked||logos===null} value={value.logo?value.logo.assetId+':'+value.logo.approvalId:''} onChange={e=>{const selected=logos?.find(x=>x.assetId+':'+x.approvalId===e.target.value);replace({...value,schemaVersion:2,logo:selected?{assetId:selected.assetId,approvalId:selected.approvalId}:null})}}><option value="">Text name (no logo)</option>{logos?.map(x=><option key={x.assetId+':'+x.approvalId} value={x.assetId+':'+x.approvalId}>{x.label} · Publicity sign-off valid until {formatDay(x.expiresAt)}</option>)}</select></div>
   <HowThisWorks><p>Only final PNG or JPEG logos with a current Publicity sign-off for workspace use appear here. You can\'t upload or edit a logo here.</p></HowThisWorks>{value.logo&&!logos?.some(x=>x.assetId===value.logo?.assetId&&x.approvalId===value.logo?.approvalId)?<p role="alert">The selected logo\'s sign-off has expired. Choose the text name or another logo before saving.</p>:null}{logos?.filter(x=>x.assetId===value.logo?.assetId&&x.approvalId===value.logo?.approvalId).map(x=><p key={x.approvalId}>Publicity sign-off conditions: {x.conditions}</p>)}
  </details>
  {!valid?<p role="alert">Some fields aren\'t valid. Use plain text (no HTML), pick links from the list and choose one of the colours and logos offered.</p>:null}
  {stale?<SiteReconcile key={data.version+':'+data.draft?.version} retained={value} current={data.definition??defaultSite} saved={data.draft?.definition??data.definition??defaultSite} disabled={disabled||mem.locked||checking} apply={v=>{mem.change({...mem.fields,definition:text(v),base:String(data.version),version:String(data.draft?.version??0),rollback:''});setReview(null);setAck(false)}}/>:null}
  <p>Save your draft, then preview it before publishing.</p><button className="button button--secondary" disabled={disabled||mem.locked||checking||dirty||stale||!privateDraft||!valid} onClick={()=>void inspect()}>Preview changes</button>
  {currentReview?<section className="panel"><h2>Review before publishing</h2>{currentReview.stale?<p>The site changed since you saved. Compare, save again, then preview.</p>:null}<SavedSitePreview previous={currentReview.previous} proposed={currentReview.proposed}/>{currentReview.proposed.logo?<p>Logo: {reviewLogo?.label??'Sign-off expired'}. Conditions: {reviewLogo?.conditions??'Choose another logo or the text name.'} {reviewLogo?'Sign-off valid until '+formatDay(reviewLogo.expiresAt):''}</p>:null}<TextField id="site-publication-reason" label="Reason for publishing" maxLength={2000} disabled={mem.locked} value={mem.fields.reason} onChange={e=>mem.change({...mem.fields,reason:e.target.value})}/><label><input type="checkbox" checked={ack} disabled={mem.locked} onChange={e=>setAck(e.target.checked)}/>I\'ve checked the changes, the sample previews and any Publicity sign-off conditions</label><button className="button" disabled={disabled||mem.locked||dirty||stale||currentReview.stale||!!currentReview.proposed.logo&&!reviewLogo||!ack||!mem.fields.reason.trim()} onClick={()=>void publish()}>Publish</button></section>:null}
  <details><summary>Past versions</summary><p>Restoring copies an old version into your draft. Save, preview and publish it to use it.</p>{history.map(h=><section key={h.id}><h3>Version {h.version}</h3><p>{h.reason}</p>{!h.supported?<p>This version is too old to restore.</p>:null}<button className="button button--quiet" disabled={disabled||mem.locked||!h.supported} onClick={()=>{mem.change({...mem.fields,definition:text(h.definition),base:String(data.version),version:String(data.draft?.version??0),rollback:h.id});setReview(null);setAck(false)}}>Restore version {h.version}</button></section>)}{before?<button className="button button--secondary" disabled={disabled||mem.locked||checking} onClick={()=>{setChecking(true);void api.read(term,before).then(v=>{if(!alive.current)return;setHistory([...history,...(v.history??[])]);setBefore(v.nextBefore??null)}).catch(e=>{if(!alive.current)return;setError('Couldn\'t load older versions. Try again.');if(e?.denied)denied()}).finally(()=>{if(alive.current)setChecking(false)})}}>Show older versions</button>:null}</details>
  </>:null}
  {mem.pending?<button className="button" disabled={mem.busy||disabled} onClick={()=>void save(true)}>Try again</button>:null}
  {mem.error?<p role="alert">{mem.error} Your inputs are kept.</p>:null}
  {error?<p role="alert">{error}</p>:null}
 </div>
}
