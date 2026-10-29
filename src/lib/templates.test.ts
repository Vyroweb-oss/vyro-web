import { describe,it,expect } from 'vitest'
import { TEMPLATES, getTemplate, templateName, templateDesc } from './templates'
describe('templates integrity',()=>{
 it('has required templates',()=>{ const ids=TEMPLATES.map(t=>t.id); for(const id of ['blank','formal-letter','cv','formal-report','academic-report','assignment']) expect(ids).toContain(id) })
 it('each has content doc',()=>{ for(const t of TEMPLATES){ expect(t.content.type).toBe('doc'); expect(Array.isArray(t.content.content)).toBe(true); expect(t.name.length).toBeGreaterThan(0) } })
 it('dari template is rtl',()=>{ expect(getTemplate('dari-letter')?.dir).toBe('rtl') })
 it('ids unique',()=>{ expect(new Set(TEMPLATES.map(t=>t.id)).size).toBe(TEMPLATES.length) })
 it('each has non-empty FA name and description',()=>{ for(const t of TEMPLATES){ expect(t.nameFa.length).toBeGreaterThan(0); expect(t.descFa.length).toBeGreaterThan(0) } })
 it('templateName/templateDesc honour the UI language',()=>{ for(const t of TEMPLATES){ expect(templateName(t,'en')).toBe(t.name); expect(templateName(t,'fa')).toBe(t.nameFa); expect(templateDesc(t,'en')).toBe(t.description); expect(templateDesc(t,'fa')).toBe(t.descFa) } })
 it('FA names differ from EN names (actually localised)',()=>{ for(const t of TEMPLATES){ expect(t.nameFa).not.toBe(t.name); expect(t.descFa).not.toBe(t.description) } })
})
