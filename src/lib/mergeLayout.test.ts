// Tier-1 S4a: Mail Merge-generated documents inherit the SOURCE document's
// page setup (size, orientation, margins incl. custom) and header/footer,
// while remaining fully independent documents (own id, own title, fresh
// timestamps, no template link, no version history of their own yet).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDoc, saveDocs, loadDocs } from './store'
import type { VyroDoc } from './types'

const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

const sourceLayout = {
  margins: 'narrow' as const, orientation: 'landscape' as const,
  pageSize: 'A5', pageW: 148, pageH: 210,
  customMargins: { top: 10, bottom: 10, left: 12, right: 12 },
  headerText: 'شرکت نمونه', footerText: 'صفحه محرمانه',
}
const mergedPartial = (title: string) => ({
  title, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'نص مدمج' }] }] },
  dir: 'rtl' as const, folder: 'Letters', ...sourceLayout,
})

describe('Tier-1 S4a: createDoc propagates layout fields', () => {
  it('a generated doc carries page setup + header/footer from the partial', () => {
    const { doc } = createDoc([], mergedPartial('Letters — Ahmad'))
    expect(doc.pageSize).toBe('A5')
    expect(doc.pageW).toBe(148)
    expect(doc.pageH).toBe(210)
    expect(doc.orientation).toBe('landscape')
    expect(doc.margins).toBe('narrow')
    expect(doc.customMargins).toEqual({ top: 10, bottom: 10, left: 12, right: 12 })
    expect(doc.headerText).toBe('شرکت نمونه')
    expect(doc.footerText).toBe('صفحه محرمانه')
    expect(doc.dir).toBe('rtl')
    expect(doc.folder).toBe('Letters')
  })
  it('the layout survives the save/load round trip (sanitizeDoc keeps it)', () => {
    const m = new Map<string, string>()
    const fake = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    const { docs } = createDoc([], mergedPartial('Letters — Ahmad'))
    saveDocs(fake as any, docs)
    const loaded = loadDocs(fake as any)[0] as VyroDoc
    expect(loaded.pageSize).toBe('A5')
    expect(loaded.orientation).toBe('landscape')
    expect(loaded.customMargins).toEqual({ top: 10, bottom: 10, left: 12, right: 12 })
    expect(loaded.headerText).toBe('شرکت نمونه')
    expect(loaded.footerText).toBe('صفحه محرمانه')
  })
  it('generated docs are independent: own id/title/timestamps, no template link', () => {
    const a = createDoc([], mergedPartial('Letters — Ahmad')).doc
    const b = createDoc([], mergedPartial('Letters — Ahmad')).doc
    expect(a.id).not.toBe(b.id)
    expect(a.title).toBe('Letters — Ahmad')
    expect(a.templateId).toBeUndefined()
    expect(a.deletedAt).toBeUndefined()
    expect(a.favorite).toBe(false)
    expect(typeof a.createdAt).toBe('string')
    expect(a.createdAt).toBe(a.updatedAt)
  })
  it('without layout fields, creation keeps the legacy defaults (back-compat)', () => {
    const { doc } = createDoc([], { title: 'Plain' })
    expect(doc.margins).toBe('normal')
    expect(doc.orientation).toBe('portrait')
    expect(doc.pageSize).toBeUndefined()
    expect(doc.headerText).toBeUndefined()
    expect(doc.footerText).toBeUndefined()
  })
})

describe('Tier-1 S4a: the merge path passes the source layout', () => {
  it('App.createMergedDocs forwards every source layout field to createDoc', () => {
    for (const field of ['pageSize:src.pageSize', 'pageW:src.pageW', 'pageH:src.pageH', 'customMargins:src.customMargins', 'headerText:src.headerText', 'footerText:src.footerText', 'margins:src.margins', 'orientation:src.orientation']) {
      expect(appSrc).toContain(field)
    }
    // identity must NOT be forwarded
    expect(appSrc).not.toContain('id:src.id')
  })
})
