import { describe,it,expect } from 'vitest'
import { TEMPLATES, getTemplate } from './templates'
describe('templates integrity',()=>{
 it('has required templates',()=>{ const ids=TEMPLATES.map(t=>t.id); for(const id of ['blank','formal-letter','cv','formal-report','academic-report','assignment']) expect(ids).toContain(id) })
 it('each has content doc',()=>{ for(const t of TEMPLATES){ expect(t.content.type).toBe('doc'); expect(Array.isArray(t.content.content)).toBe(true); expect(t.name.length).toBeGreaterThan(0) } })
 it('dari template is rtl',()=>{ expect(getTemplate('dari-letter')?.dir).toBe('rtl') })
 it('ids unique',()=>{ expect(new Set(TEMPLATES.map(t=>t.id)).size).toBe(TEMPLATES.length) })
})
