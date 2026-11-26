// Shared HTML layout for every workspace email. Table-based with inline styles so Gmail, Apple Mail and
// Outlook all render it, single column, max 560px wide.
//
// Dark mode: Gmail on iOS and Android ignores prefers-color-scheme and inverts colours itself (partly on
// Android, fully on iOS). The palette is chosen to survive that: off-white and near-black instead of pure
// #fff/#000, mid-tone borders that stay visible either way, a text-only logo, and a TEDx red (#EB0028) whose
// luminance gives about 4.6:1 contrast against both white and black text, so the button label stays
// readable whether or not Gmail flips it. Apple Mail and others get the TEDx dark palette (black ground,
// white type, red accent) from the prefers-color-scheme block; no inversion happens there, so pure black is safe.
//
// Every dynamic value goes through esc(); callers pass plain text, never HTML.

export const LICENSE_LINE='This independent TEDx event is operated under license from TED.'
export const SIGNATURE='TEDxAteneodeManilaU Core Workspace'
// The relay (apps-script/Code.gs) refuses html over 50,000 characters; Gmail clips around 102 KB.
export const MAX_HTML=50000

export type Inline=string|{strong:string}
export type Paragraph=Inline|Inline[]
export type Detail=
  |{kind:'facts';rows:Array<[label:string,value:string]>}
  |{kind:'code';label:string;code:string}
export type EmailLayout={
  subject:string
  preheader:string
  heading:string
  body:Paragraph[]
  detail?:Detail
  button?:{label:string;href:string}
  after?:Paragraph[]
  reason:string
}

const RED='#EB0028'
// Neutral greys with no warm tint, so Gmail's inversion lands on TEDx black rather than brown.
const PAGE='#f2f2f2',CARD='#fcfcfc',INK='#1a1a1a',MUTED='#5c5c5c',LINE='#c4c4c4',BOX='#f0f0f0',BOX_LINE='#b3b3b3'
const SANS="Inter,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO="'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono','Courier New',monospace"

export function esc(value:string):string {
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

function inline(part:Paragraph):string {
  const parts=Array.isArray(part)?part:[part]
  return parts.map(p=>typeof p==='string'?esc(p):`<strong class="tx" style="font-weight:600;color:${INK}">${esc(p.strong)}</strong>`).join('')
}

function paragraphs(list:Paragraph[]):string {
  return list.map(p=>`<p class="tx" style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:26px;color:${INK}">${inline(p)}</p>`).join('')
}

function detail(d:Detail):string {
  if(d.kind==='code') {
    // Plain text so it can be selected and copied; letter-spacing does not add characters to the copy.
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr>
<td class="box" align="center" bgcolor="${BOX}" style="background:${BOX};border:1px solid ${BOX_LINE};border-radius:10px;padding:20px 12px">
<div class="mt" style="font-family:${SANS};font-size:13px;line-height:18px;color:${MUTED};margin:0 0 8px">${esc(d.label)}</div>
<div class="tx" style="font-family:${MONO};font-size:36px;line-height:44px;font-weight:700;letter-spacing:8px;padding-left:8px;color:${INK};-webkit-user-select:all;user-select:all">${esc(d.code)}</div>
</td></tr></table>`
  }
  const rows=d.rows.map(([label,value],i)=>`<tr>
<td class="mt ln" style="padding:12px 0;${i?`border-top:1px solid ${LINE};`:''}font-family:${SANS};font-size:15px;line-height:22px;color:${MUTED}">${esc(label)}</td>
<td class="tx ln" align="right" style="padding:12px 0 12px 12px;${i?`border-top:1px solid ${LINE};`:''}font-family:${SANS};font-size:16px;line-height:22px;font-weight:600;color:${INK}">${esc(value)}</td>
</tr>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="box" bgcolor="${BOX}" style="margin:8px 0 24px;background:${BOX};border:1px solid ${BOX_LINE};border-radius:10px">
<tr><td style="padding:4px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr></table>`
}

function button(b:{label:string;href:string}):string {
  // 13px + 18px + 13px padding plus a 1px border gives a 46px tap target. The gradient background-image
  // repeats the solid red because Gmail's dark mode inverts background colours but not background images.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr>
<td align="center" bgcolor="${RED}" style="background:${RED};background-image:linear-gradient(${RED},${RED});border-radius:8px">
<a href="${esc(b.href)}" target="_blank" style="display:inline-block;padding:13px 28px;border:1px solid ${RED};background-image:linear-gradient(${RED},${RED});border-radius:8px;font-family:${SANS};font-size:16px;line-height:18px;font-weight:600;color:#ffffff;text-decoration:none">${esc(b.label)}</a>
</td></tr></table>
<p class="mt" style="margin:0 0 16px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};word-break:break-all">Or open this link: <a class="mt" href="${esc(b.href)}" target="_blank" style="color:${MUTED};text-decoration:underline">${esc(b.href)}</a></p>`
}

export function renderEmail(e:EmailLayout):string {
  // Zero-width padding keeps inbox previews from pulling in body text after the preheader.
  const pad='&#847;&zwnj;&nbsp;'.repeat(40)
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(e.subject)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;text-size-adjust:100%}
@media (max-width:600px){.px{padding-left:20px!important;padding-right:20px!important}.outer{padding:16px 8px!important}}
@media (prefers-color-scheme:dark){
.bg{background:#000000!important}
.card{background:#111111!important;border-color:#333333!important}
.tx{color:#ffffff!important}
.mt{color:#a6a6a6!important}
.ln{border-color:#333333!important}
.box{background:#000000!important;border-color:#3d3d3d!important}
}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${PAGE}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE}">${esc(e.preheader)}${pad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${PAGE}" style="background:${PAGE}">
<tr><td class="outer" align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td class="px" style="padding:0 4px 16px;font-family:${SANS};font-size:20px;line-height:28px;font-weight:700;letter-spacing:-0.2px"><span style="color:${RED};font-weight:800">TEDx</span><span class="tx" style="color:${INK}">AteneodeManilaU</span></td></tr>
<tr><td class="card px" bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:12px;padding:32px 32px 16px">
<h1 class="tx" style="margin:0 0 16px;font-family:${SANS};font-size:24px;line-height:31px;font-weight:700;letter-spacing:-0.3px;color:${INK}">${esc(e.heading)}</h1>
${paragraphs(e.body)}
${e.detail?detail(e.detail):''}
${e.button?button(e.button):''}
${e.after?paragraphs(e.after):''}
</td></tr>
<tr><td class="px" style="padding:20px 4px 8px">
<p class="mt" style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:20px;font-weight:600;color:${MUTED}">${esc(SIGNATURE)}</p>
<p class="mt" style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${esc(e.reason)}</p>
<p class="mt" style="margin:0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${esc(LICENSE_LINE)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

// Returns the HTML only when it fits the relay limit, so an oversized render falls back to text-only.
export function htmlPart(e:EmailLayout):{html?:string} {
  const html=renderEmail(e)
  return html.length<=MAX_HTML?{html}:{}
}
