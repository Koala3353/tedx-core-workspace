import {useEffect,useState} from 'react'
import {Panel} from '../../../components/Page'
import {useFinDecision} from '../../finance/DecisionMemory'
import {LayoutControls} from '../../overview/LayoutControls'
import {LayoutPreview} from '../../overview/LayoutPreview'
import {defaultLayout,type Layout} from '../../overview/layout'
import {widgetCatalog} from '../../../app/widgetCatalog'
import type {LayoutAdminApi,LayoutCommand,LayoutConfiguration,LayoutTarget,LayoutReview} from './api'
function Description({layout}:{layout:Layout|null}){return layout?<ol>{layout.widgets.map(w=><li key={w.id}>{widgetCatalog.find(c=>c.id===w.id)?.label} · {w.size==='wide'?'Full width':'Half width'}</li>)}{!layout.widgets.length?<li>No extra views. Tasks and help still show.</li>:null}</ol>:<p>Built-in default (nothing published).</p>}
export function LayoutEditor({api,term,identity,target,data,refreshed,onLock}:{api:LayoutAdminApi;term:string;identity:string;target:LayoutTarget;data:LayoutConfiguration;refreshed:()=>void;onLock:(locked:boolean)=>void}){
 const draft=data.drafts[0],initial=JSON.stringify(draft?.definition??data.definition??defaultLayout('member'))
 const mem=useFinDecision<LayoutCommand,{version:number}>(api,'layout:layout-'+term+':'+target.kind+':'+target.id+':'+identity,{layout:initial,baseline:initial,reason:'',rollback:draft?.rollbackVersionId??'',baselineRollback:draft?.rollbackVersionId??''})
 const layout=JSON.parse(mem.fields.layout)as Layout,[review,setReview]=useState<LayoutReview|null>(null),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),dirty=mem.fields.layout!==mem.fields.baseline||mem.fields.rollback!==mem.fields.baselineRollback
 useEffect(()=>onLock(mem.locked),[mem.locked,onLock])
 function change(next:Layout,rollback=''){mem.change({...mem.fields,layout:JSON.stringify(next),rollback});setReview(null);setAck(false)}
 async function save(){setReview(null);setAck(false);if(await mem.run({action:'save',term,target,definition:layout,baseVersion:data.version,version:draft?.version??0,rollbackVersionId:mem.fields.rollback||null}))refreshed()}
 async function inspect(){if(!draft||dirty)return;setBusy(true);setError('');setAck(false);try{setReview(await api.preview(draft.draftId))}catch{setError('Couldn\'t load the preview. Your inputs are kept.')}finally{setBusy(false)}}
 async function publish(){if(!review||review.stale||!ack||!draft||dirty||!mem.fields.reason.trim())return;setReview(null);setAck(false);if(await mem.run({action:'publish',draftId:draft.draftId,version:draft.version,reviewHash:review.reviewHash,reason:mem.fields.reason}))refreshed()}
 return <div data-edit-form data-pending-command={mem.locked} data-unsaved-changes={dirty||!!mem.fields.reason}>
 {data.repaired?<p role="alert">The saved or published layout uses views that no longer exist, so the editor starts from the default. Save, preview and publish it to fix the layout.</p>:null}
 <Panel title={'Draft layout · '+target.label}><p>Only you can see this draft until you publish it. Tasks and help always stay at the top.</p>
 {mem.fields.rollback?<p>You're editing a copy of an older version. Save and review it to publish it again.</p>:null}
 <LayoutControls disabled={busy||mem.locked} audience="member" layout={layout} message="This is the default for everyone in this group, not just you." onChange={change} onReset={()=>change(defaultLayout('member'))}/>
 <button className="button button--secondary" disabled={busy||mem.locked} onClick={()=>void save()}>Save draft</button>{draft&&!draft.publishedVersionId?<button className="button button--secondary" disabled={busy||mem.locked||dirty} onClick={()=>void inspect()}>Preview saved layout</button>:null}
 <LayoutPreview layout={layout}/><p><label>Reason for publishing<input className="overview-example" maxLength={2000} disabled={mem.locked} value={mem.fields.reason} onChange={e=>mem.change({...mem.fields,reason:e.target.value})}/></label></p>
 </Panel>
 {review?<Panel title="Review before publishing">{review.stale?<p>The published layout changed since you saved this draft. Save it again, then review.</p>:null}<h3>Before</h3>{review.previousUnsupported?<p>An old layout that no longer works. Publishing replaces it.</p>:<Description layout={review.previous}/>}<h3>After</h3><Description layout={review.proposed}/><label><input type="checkbox" disabled={mem.locked} checked={ack} onChange={e=>setAck(e.target.checked)}/>I've checked this layout</label><button className="button" disabled={mem.locked||review.stale||!ack||!mem.fields.reason.trim()} onClick={()=>void publish()}>Publish layout</button></Panel>:null}
 {mem.pending?<button className="button" disabled={mem.busy} onClick={()=>void mem.run().then(r=>{if(r)refreshed()})}>Try again</button>:null}{error||mem.error?<p role="alert">{error||mem.error} Your inputs are kept. If someone else changed the layout, check it before saving again.</p>:null}
 <Panel title="Past versions">{data.history.length?<ol>{data.history.map(h=><li key={h.id}>Version {h.version} · {h.reason}{h.rollbackVersionId?' · Restored from an earlier version':''}{h.supported===false?<p>Uses views that no longer exist, so it can't be restored.</p>:<Description layout={h.definition}/>}<button className="button button--quiet" disabled={mem.locked||h.supported===false} onClick={()=>change(h.definition,h.id)}>Restore version {h.version}</button></li>)}</ol>:<p>No layout published for this group yet.</p>}</Panel>
 </div>
}
