import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx'
import { saveAs } from 'file-saver'
function align(a?:string){ switch(a){case 'center': return AlignmentType.CENTER; case 'right': return AlignmentType.RIGHT; case 'justify': return AlignmentType.JUSTIFIED; default: return AlignmentType.LEFT} }
function runs(node:any): TextRun[] { if(!node?.content) return [new TextRun({text:''})]; const texts=node.content.filter((c:any)=>c.type==='text'); if(!texts.length) return [new TextRun({text:''})]; return texts.map((c:any)=>{ const m=(c.marks||[]); const has=(t:string)=>m.some((x:any)=>x.type===t); const ts=m.find((x:any)=>x.type==='textStyle'); const col=ts?.attrs?.color?.replace('#',''); return new TextRun({ text:c.text||'', bold:has('bold')||undefined, italics:has('italic')||undefined, underline: has('underline')?{}:undefined, strike:has('strike')||undefined, ...(col?{color:col}:{}) }) }) }
function walk(node:any, out:Paragraph[]){ if(!node) return
  if(node.type==='heading'){ const lvl=node.attrs?.level||1; out.push(new Paragraph({ heading: lvl===1?HeadingLevel.HEADING_1:lvl===2?HeadingLevel.HEADING_2:HeadingLevel.HEADING_3, alignment:align(node.attrs?.textAlign), children:runs(node)})) }
  else if(node.type==='paragraph'){ out.push(new Paragraph({alignment:align(node.attrs?.textAlign), children:runs(node)})) }
  else if(node.type==='bulletList'||node.type==='orderedList'){ let i=1; for(const item of node.content||[]){ for(const inner of item.content||[]){ const prefix=node.type==='bulletList'?'• ':`${i}. `; out.push(new Paragraph({children:[new TextRun({text:prefix}), ...runs(inner)]})) } i++ } }
  else if(node.type==='horizontalRule'){ out.push(new Paragraph({children:[new TextRun({text:'— — —'})]})) }
  else if(node.content){ for(const c of node.content) walk(c,out) }
}
/** Escape text for safe interpolation into generated HTML (titles, imported plain text). */
export function escapeHtml(s: string): string { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
/** Validate a user-supplied link URL — only web/mail protocols may be stored or exported. */
export function isSafeLinkUrl(url: string): boolean { const u=(url||'').trim(); if(!u) return false; try{ const p=new URL(u, 'https://example.invalid'); return p.protocol==='http:'||p.protocol==='https:'||p.protocol==='mailto:' }catch{ return false } }
export async function exportDocx(json:any, title:string){ const paras:Paragraph[]=[]; walk(json,paras); if(!paras.length) paras.push(new Paragraph('')); const doc=new Document({sections:[{children:paras}]}); const blob=await Packer.toBlob(doc); saveAs(blob, `${title||'document'}.docx`) }
export function jsonToPlainText(node:any): string { let out=''; const rec=(n:any)=>{ if(!n) return; if(n.type==='text') out+=n.text||''; if(n.content) n.content.forEach(rec); if(['paragraph','heading','listItem'].includes(n.type)) out+='\n' }; rec(node); return out.replace(/\n{3,}/g,'\n\n').trim() }
