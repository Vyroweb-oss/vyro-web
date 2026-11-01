import { Document, Packer, Paragraph, TextRun, ExternalHyperlink, AlignmentType, HeadingLevel } from 'docx'
import { saveAs } from 'file-saver'
import { isSafeLinkUrl } from './docText'
// P2-4: the pure helpers (escapeHtml, isSafeLinkUrl, jsonToPlainText) moved
// to docText.ts so hot paths no longer pull `docx`/`file-saver` into the
// initial bundle. They are re-exported here so existing imports keep working.
export { escapeHtml, isSafeLinkUrl, jsonToPlainText } from './docText'
function align(a?:string){ switch(a){case 'center': return AlignmentType.CENTER; case 'right': return AlignmentType.RIGHT; case 'justify': return AlignmentType.JUSTIFIED; default: return AlignmentType.LEFT} }
/** Paragraph children for one block node. Safe link marks become ExternalHyperlink
 *  (M2-07 §14: allowed links survive DOCX export); unsafe links degrade to plain
 *  text so the visible text is never lost. Exported for unit tests. */
export function paragraphRuns(node:any): (TextRun|ExternalHyperlink)[] { if(!node?.content) return [new TextRun({text:''})]; const texts=node.content.filter((c:any)=>c.type==='text'); if(!texts.length) return [new TextRun({text:''})]; return texts.map((c:any)=>{ const m=(c.marks||[]); const has=(t:string)=>m.some((x:any)=>x.type===t); const ts=m.find((x:any)=>x.type==='textStyle'); const col=ts?.attrs?.color?.replace('#',''); const run=new TextRun({ text:c.text||'', bold:has('bold')||undefined, italics:has('italic')||undefined, underline: has('underline')?{}:undefined, strike:has('strike')||undefined, ...(col?{color:col}:{}) }); const link=m.find((x:any)=>x.type==='link'); const href=link?.attrs?.href as string|undefined; return (href && isSafeLinkUrl(href)) ? new ExternalHyperlink({ children:[run], link:href }) : run }) }
function runs(node:any): (TextRun|ExternalHyperlink)[] { return paragraphRuns(node) }
/**
 * Tier-1 S5: DOCX export for the TOC block (previously dropped silently).
 * The TOC model stores only { level, text } per entry — it has NO page
 * numbers, so none are exported (fabricating them would be worse than
 * omitting them; Word can generate real numbers from its own TOC field
 * after the user rebuilds it). Export shape: a bold title paragraph,
 * then one paragraph per entry, indented by heading level with the
 * LOGICAL OOXML indent (w:start), so RTL documents indent from the
 * correct side in Word. Malformed data is sanitized, never fatal:
 * non-array items export as an empty TOC (title only), entries without
 * usable text are skipped, levels clamp to 1..6 (default 1).
 * Exported for unit tests.
 */
export function tocParagraphs(node:any): Paragraph[] {
  const titleRaw = node?.attrs?.title
  const title = typeof titleRaw === 'string' && titleRaw.trim() !== '' ? titleRaw : 'Contents'
  const out: Paragraph[] = [new Paragraph({ children: [new TextRun({ text: title, bold: true })] })]
  const items = Array.isArray(node?.attrs?.items) ? node.attrs.items : []
  for (const item of items) {
    const rawText = (item as any)?.text
    const text = typeof rawText === 'string' ? rawText : rawText != null && typeof rawText !== 'object' ? String(rawText) : ''
    if (text.trim() === '') continue
    const rawLevel = Number((item as any)?.level)
    const level = Number.isFinite(rawLevel) ? Math.min(6, Math.max(1, Math.trunc(rawLevel))) : 1
    out.push(new Paragraph({ indent: { start: (level - 1) * 360 }, children: [new TextRun({ text })] }))
  }
  return out
}
function walk(node:any, out:Paragraph[]){ if(!node) return
  if(node.type==='heading'){ const lvl=node.attrs?.level||1; out.push(new Paragraph({ heading: lvl===1?HeadingLevel.HEADING_1:lvl===2?HeadingLevel.HEADING_2:HeadingLevel.HEADING_3, alignment:align(node.attrs?.textAlign), children:runs(node)})) }
  else if(node.type==='paragraph'){ out.push(new Paragraph({alignment:align(node.attrs?.textAlign), children:runs(node)})) }
  else if(node.type==='bulletList'||node.type==='orderedList'){ let i=1; for(const item of node.content||[]){ for(const inner of item.content||[]){ const prefix=node.type==='bulletList'?'• ':`${i}. `; out.push(new Paragraph({children:[new TextRun({text:prefix}), ...runs(inner)]})) } i++ } }
  else if(node.type==='horizontalRule'){ out.push(new Paragraph({children:[new TextRun({text:'— — —'})]})) }
  else if(node.type==='tocBlock'){ out.push(...tocParagraphs(node)) }
  else if(node.content){ for(const c of node.content) walk(c,out) }
}
/** The full DOCX paragraph traversal, exported for unit tests. */
export function buildParagraphs(json:any): Paragraph[] { const paras:Paragraph[]=[]; walk(json,paras); return paras }
export async function exportDocx(json:any, title:string){ const paras=buildParagraphs(json); if(!paras.length) paras.push(new Paragraph('')); const doc=new Document({sections:[{children:paras}]}); const blob=await Packer.toBlob(doc); saveAs(blob, `${title||'document'}.docx`) }
