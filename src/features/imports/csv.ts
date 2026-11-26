export type Kind = 'tasks' | 'roster'
export type Mapping = Record<string, string>
export const fields = {
  tasks: ['source_key','title','assignee','committee','due_on','reference'],
  roster: ['source_key','display_name','email'],
} as const
export const templates: Record<Kind,string> = {
  tasks: 'source_key,title,assignee,committee,due_on,reference\r\nexample-1,Prepare welcome signs,Ana Example,Example committee,2027-04-17,\r\n',
  roster: 'source_key,display_name,email\r\nexample-1,Ana Example,ana.example@student.ateneo.edu\r\n',
}
// Small local preparation only. No identity lookup, database write or privilege assignment.
export function parseCsv(input: string): string[][] {
  if(input.length>200000 || input.includes('\0')) throw Error('Use at most 200,000 characters and remove null characters.')
  const text=input.replace(/^\uFEFF/,'');if(!text) return []
  const rows:string[][]=[];let row:string[]=[], value='', quoted=false, closed=false
  const cell=()=>{row.push(value);value='';closed=false;if(row.length>32)throw Error('Use at most 32 columns.')}
  const record=()=>{cell();rows.push(row);row=[];if(rows.length>501)throw Error('Use at most 500 rows.')}
  for(let i=0;i<text.length;i++){
    const c=text[i]
    if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++}else{quoted=false;closed=true}}else value+=c;continue}
    if(c===','){cell();continue}
    if(c==='\r'||c==='\n'){record();if(c==='\r'&&text[i+1]==='\n')i++;continue}
    if(closed)throw Error(`Row ${rows.length+1}: remove text after a closing quote.`)
    if(c==='"'){if(value)throw Error(`Row ${rows.length+1}: put quotes around the whole cell, and double any quotes inside it.`);quoted=true}else value+=c
  }
  if(quoted)throw Error(`Row ${rows.length+1}: a quoted cell is missing its closing quote.`)
  if(value||closed||row.length||!/[\r\n]$/.test(text))record()
  return rows
}
// Human-viewing CSV, not a lossless machine interchange format. Spreadsheet save/reopen
// behavior still needs application-specific verification; this is not a scoped export API.
export function spreadsheetCsv(rows: readonly (readonly string[])[]): string {
  return '\uFEFF'+rows.map(row=>row.map(value=>{
    const leading=value.match(/^[\s\p{Cf}]*/u)?.[0]??''
    const dangerous=/^[\s\p{Cf}]*[=+\-@＝＋－＠]/u.test(value)||value.charCodeAt(0)<32||Array.from(leading).some(c=>c.charCodeAt(0)<32)
    return '"'+((dangerous?"'":'')+value).replaceAll('"','""')+'"'
  }).join(',')).join('\r\n')+'\r\n'
}
function calendarDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value}
export function dryRun(kind: Kind, csv: string[][], mapping: Mapping) {
  const errors:string[]=[];const header=csv[0]??[];const allowed:readonly string[]=fields[kind]
  const required=kind==='tasks'?['source_key','title']:['source_key','display_name','email']
  if(!header.length||csv.length<2)errors.push('Include a header row and at least one data row.')
  if(header.some(h=>!h.trim())||new Set(header.map(h=>h.trim().toLowerCase())).size!==header.length)errors.push('Give each column a unique name.')
  const forbidden=header.some(h=>/(^|[^a-z])(roles?|admin|permissions?|capabilit(y|ies)|privileges?|amount|cost|centavos|financial|money)([^a-z]|$)/i.test(h))
  if(forbidden)errors.push('Remove role, permission or money columns. Those can\'t be imported.')
  if(Object.keys(mapping).some(k=>!allowed.includes(k)))errors.push('One of the fields can\'t be imported.')
  const selected=Object.values(mapping).filter(Boolean)
  if(new Set(selected).size!==selected.length)errors.push('Use each CSV column for only one field.')
  for(const field of required)if(!mapping[field]||!header.includes(mapping[field]))errors.push(`Choose a column for ${field.replaceAll('_',' ')}.`)
  for(const source of selected)if(!header.includes(source))errors.push(`The column “${source}” isn't in your CSV. Pick a different column.`)
  const rows=csv.slice(1).map((cells,i)=>{
    const rowErrors:string[]=[];const values:Record<string,string>={}
    if(cells.length!==header.length)rowErrors.push(`Expected ${header.length} cells; found ${cells.length}. Repair commas/quotes.`)
    for(const field of allowed){const source=mapping[field];values[field]=source&&header.includes(source)?cells[header.indexOf(source)]??'':''}
    for(const field of required)if(!values[field]?.trim())rowErrors.push(`Enter ${field.replaceAll('_',' ')}.`)
    if(values.source_key&&!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(values.source_key))rowErrors.push('Use a source key of 1–100 letters, digits, dots, colons, hyphens or underscores.')
    if(values.due_on&&!calendarDate(values.due_on))rowErrors.push('Use a real date in YYYY-MM-DD format for the due date.')
    if(kind==='roster'&&values.email&&!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@student\.ateneo\.edu$/.test(values.email))rowErrors.push('Use a student.ateneo.edu school email.')
    if(Object.values(values).some(v=>v.length>2000))rowErrors.push('Keep each cell under 2,000 characters.')
    return {record:i+2,values,errors:rowErrors}
  })
  for(const key of ['source_key',...(kind==='roster'?['email']:[])]){
    const counts=new Map<string,number>();for(const row of rows){const value=key==='email'?row.values[key].toLowerCase():row.values[key];if(value)counts.set(value,(counts.get(value)??0)+1)}
    for(const row of rows){const value=key==='email'?row.values[key].toLowerCase():row.values[key];if((counts.get(value)??0)>1)row.errors.push(`Duplicate ${key.replaceAll('_',' ')}. Repair every matching record before retrying.`)}
  }
  return {valid:errors.length===0&&rows.every(r=>r.errors.length===0),errors,rows}
}
