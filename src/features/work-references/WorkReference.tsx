import { appPath } from '../../lib/basePath'
import {TextField} from '../../components/TextField'
import {useState} from 'react'
import {validWorkReference,type WorkReferenceValue} from './api'
import './references.css'

export function WorkReference({reference,id,kind,compact=false}:{reference?:WorkReferenceValue|null;id:string;kind:'task'|'deliverable';compact?:boolean}){
 const [status,setStatus]=useState<{key:string;message:string;failed:boolean}|null>(null)
 if(!validWorkReference(reference,kind))return compact?null:<p className="muted">No reference number yet.</p>
 const context=reference.value+' · '+reference.termLabel,key=id+context,href=new URL(appPath((kind==='task'?'/tasks/':'/deliverables/')+id),window.location.origin).href
 const current=status?.key===key?status:null
 async function copy(link=false){
  try{await navigator.clipboard.writeText(link?href:context);setStatus({key,message:link?'Link copied.':'Reference copied.',failed:false})}
  catch{setStatus({key,message:'Couldn\'t copy automatically. Select the link below and copy it.',failed:true})}
 }
 return <div className={'work-reference'+(compact?' work-reference--compact':'')}><p className="muted record-text"><strong>{reference.value}</strong> · <span>{reference.termLabel}</span></p>{!compact?<><div className="auth-actions"><button className="button button--secondary" onClick={()=>void copy()}>Copy reference</button><button className="button button--secondary" onClick={()=>void copy(true)}>Copy link</button></div>{current?<p role="status">{current.message}</p>:null}{current?.failed?<TextField id={'work-link-'+id} label="Work link to copy" readOnly value={href} onFocus={e=>e.currentTarget.select()}/>:null}</>:null}</div>
}
