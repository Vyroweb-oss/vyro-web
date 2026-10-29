import { describe,it,expect } from 'vitest'
import { TEMPLATES, getTemplate, templateName, templateDesc } from './templates'
import { createDoc, saveDocs, loadDocs } from './store'
describe('templates integrity',()=>{
 it('has required templates',()=>{ const ids=TEMPLATES.map(t=>t.id); for(const id of ['blank','formal-letter','cv','formal-report','academic-report','assignment']) expect(ids).toContain(id) })
 it('each has content doc',()=>{ for(const t of TEMPLATES){ expect(t.content.type).toBe('doc'); expect(Array.isArray(t.content.content)).toBe(true); expect(t.name.length).toBeGreaterThan(0) } })
 it('dari template is rtl',()=>{ expect(getTemplate('dari-letter')?.dir).toBe('rtl') })
 it('ids unique',()=>{ expect(new Set(TEMPLATES.map(t=>t.id)).size).toBe(TEMPLATES.length) })
 it('each has non-empty FA name and description',()=>{ for(const t of TEMPLATES){ expect(t.nameFa.length).toBeGreaterThan(0); expect(t.descFa.length).toBeGreaterThan(0) } })
 it('templateName/templateDesc honour the UI language',()=>{ for(const t of TEMPLATES){ expect(templateName(t,'en')).toBe(t.name); expect(templateName(t,'fa')).toBe(t.nameFa); expect(templateDesc(t,'en')).toBe(t.description); expect(templateDesc(t,'fa')).toBe(t.descFa) } })
 it('FA names differ from EN names (actually localised)',()=>{ for(const t of TEMPLATES){ expect(t.nameFa).not.toBe(t.name); expect(t.descFa).not.toBe(t.description) } })
})
describe('R5 FA/RTL templates (meeting minutes + official request)',()=>{
 const NEW_IDS=['meeting-minutes','official-request']
 it('both new templates exist with unique ids',()=>{ const ids=TEMPLATES.map(t=>t.id); for(const id of NEW_IDS) expect(ids).toContain(id); expect(new Set(ids).size).toBe(ids.length) })
 it('both are RTL with complete FA + EN names and descriptions',()=>{ for(const id of NEW_IDS){ const t=getTemplate(id)!; expect(t).toBeTruthy(); expect(t.dir).toBe('rtl'); expect(t.name.length).toBeGreaterThan(0); expect(t.description.length).toBeGreaterThan(0); expect(t.nameFa.length).toBeGreaterThan(0); expect(t.descFa.length).toBeGreaterThan(0); expect(templateName(t,'fa')).toBe(t.nameFa); expect(templateDesc(t,'fa')).toBe(t.descFa); expect(templateName(t,'en')).toBe(t.name) } })
 it('both have non-empty structured content with at least one heading',()=>{ for(const id of NEW_IDS){ const t=getTemplate(id)!; expect(t.content.type).toBe('doc'); expect(t.content.content.length).toBeGreaterThan(3); expect(t.content.content.some((n:any)=>n.type==='heading')).toBe(true) } })
 it('meeting minutes carries a structured task list (responsible + deadline fields)',()=>{ const t=getTemplate('meeting-minutes')!; const lists=t.content.content.filter((n:any)=>n.type==='bulletList'); expect(lists.length).toBeGreaterThan(0); const texts=JSON.stringify(t.content); expect(texts).toContain('مسئول'); expect(texts).toContain('مهلت') })
 it('creating a doc via the store path keeps template content intact (incl. save/load round-trip)',()=>{ const m=new Map<string,string>(); const fake={getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)}}; for(const id of NEW_IDS){ const tpl=getTemplate(id)!; const before=JSON.stringify(tpl.content); const {docs,doc}=createDoc([],{title: tpl.name+' — Untitled', content: JSON.parse(JSON.stringify(tpl.content)), dir: tpl.dir, templateId: tpl.id}); expect(doc.dir).toBe('rtl'); expect(doc.templateId).toBe(id); expect(doc.content).toEqual(tpl.content); saveDocs(fake as any, docs); const back=loadDocs(fake as any); expect(back[0].content).toEqual(tpl.content); expect(back[0].dir).toBe('rtl'); expect(JSON.stringify(tpl.content)).toBe(before) } })
})
