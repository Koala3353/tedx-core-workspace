export function LogoReviewUse({disabled,apply}:{disabled:boolean;apply:(fields:Record<string,string>)=>void}){
 return <div><button className="button button--secondary" disabled={disabled} onClick={()=>apply({intendedUse:'core_workspace_logo',channel:'Core workspace (members and invited guests)',identity:'TEDx Ateneo de Manila U'})}>Fill in as workspace logo</button><p>Fills in the use and channel for a logo shown inside the workspace. You still need to attach the final PNG or JPEG, credits and rights for Publicity sign-off.</p></div>
}
