import { describe, it, expect } from 'vitest'
import { Document, Packer } from 'docx'
import JSZip from 'jszip'
import { tocParagraphs, buildParagraphs } from './docx'
// @ts-ignore raw source import, the established pattern for wiring guards
import editorSrcRaw from '../components/Editor.tsx?raw'

// Collect every w:t text value from a docx element graph, in order.
function textsOf(v: any, out: string[] = []): string[] {
  if (!v || typeof v !== 'object') return out
  if (v.rootKey === 'w:t' && Array.isArray(v.root)) {
    for (const c of v.root) if (typeof c === 'string') out.push(c)
    return out
  }
  if (Array.isArray(v.root)) v.root.forEach((c: any) => textsOf(c, out))
  return out
}
const allTexts = (paras: any[]) => paras.flatMap((p) => textsOf(p))
// The logical (w:start) indent of a paragraph, in twips — undefined at level 1.
function startIndent(p: any): number | undefined {
  const s = JSON.stringify(p)
  const m = s.match(/"start":\{"key":"w:start","value":(\d+)\}/)
  return m ? Number(m[1]) : undefined
}

const tocNode = (items: any, title?: any) => ({ type: 'tocBlock', attrs: { title, items } })

describe('Tier-1 S5: TOC DOCX export', () => {
  it('exports the title and every entry with its level as logical indent', () => {
    const paras = tocParagraphs(tocNode([
      { level: 1, text: 'Introduction' },
      { level: 2, text: 'Background' },
      { level: 3, text: 'Deep dive' },
    ], 'Contents'))
    expect(paras).toHaveLength(4)
    expect(allTexts(paras)).toEqual(['Contents', 'Introduction', 'Background', 'Deep dive'])
    expect(startIndent(paras[1])).toBe(0) // level 1 → no indent
    expect(startIndent(paras[2])).toBe(360)
    expect(startIndent(paras[3])).toBe(720)
  })
  it('does NOT fabricate page numbers (entries export as their exact text)', () => {
    const paras = tocParagraphs(tocNode([{ level: 1, text: 'Introduction' }, { level: 2, text: 'Methods' }]))
    const texts = allTexts(paras)
    expect(texts).toEqual(['Contents', 'Introduction', 'Methods'])
    expect(texts.every((t) => !/\d/.test(t))).toBe(true)
  })
  it('regression: the full traversal no longer omits the TOC block', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
        tocNode([{ level: 1, text: 'Introduction' }, { level: 2, text: 'Background' }]),
        { type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
      ],
    }
    const texts = allTexts(buildParagraphs(doc))
    expect(texts).toContain('Contents')
    expect(texts).toContain('Background')
    expect(texts.indexOf('Contents')).toBeLessThan(texts.indexOf('Body text'))
  })
  it('empty and missing-item TOCs still export their title (never crash, never vanish)', () => {
    expect(allTexts(tocParagraphs(tocNode([])))).toEqual(['Contents'])
    expect(allTexts(tocParagraphs(tocNode(undefined, 'My Contents')))).toEqual(['My Contents'])
    expect(allTexts(tocParagraphs({ type: 'tocBlock' }))).toEqual(['Contents'])
    expect(allTexts(tocParagraphs(null))).toEqual(['Contents'])
  })
  it('malformed entries are sanitized: skipped text, coerced scalars, clamped levels', () => {
    const paras = tocParagraphs(tocNode([
      null,
      { level: 2 }, // no text → skipped
      { level: 'x', text: 'Loose' }, // bad level → 1
      { level: 99, text: 'Too deep' }, // clamped to 6 → 5*360
      { level: 1, text: 42 }, // scalar coerced
      { level: 1, text: '   ' }, // whitespace-only → skipped
    ]))
    expect(allTexts(paras)).toEqual(['Contents', 'Loose', 'Too deep', '42'])
    expect(startIndent(paras[2])).toBe(1800)
  })
  it('the real DOCX file bytes contain the TOC entries and logical indents', async () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
        tocNode([{ level: 1, text: 'Introduction' }, { level: 2, text: 'Background' }], 'Contents'),
      ],
    }
    const buf = await Packer.toBuffer(new Document({ sections: [{ children: buildParagraphs(doc) }] }))
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Contents')
    expect(xml).toContain('Background')
    expect(xml).toContain('w:start="360"') // level-2 logical indent in the file itself
  })
})

describe('Tier-1 S5: editor TOC indentation is direction-aware', () => {
  const editorSrc = editorSrcRaw as unknown as string
  it('TOC items use margin-inline-start, not physical margin-left', () => {
    expect(editorSrc).toContain('margin-inline-start:${(lvl - 1) * 18}px')
    expect(editorSrc).not.toContain('toc-block-item\', style: `margin-left:')
  })
})
