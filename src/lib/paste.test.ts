import { describe, it, expect } from 'vitest'
import {
  sanitizePastedHtml, htmlToPlainText, classifyPaste, sanitizeStyle,
  isSafePasteUrl, getContextMenuItems, clampMenuPosition,
} from './paste'

describe('sanitizePastedHtml — danger path', () => {
  it('strips script/style/iframe/object/embed/form whole subtrees', () => {
    const out = sanitizePastedHtml('<p>keep</p><script>alert(1)</script><style>p{color:red}</style><iframe src="https://x"></iframe><object data="x"></object><embed src="x"><form><input value="v"></form>')
    expect(out).toContain('keep')
    expect(out).not.toMatch(/script|iframe|object|embed|form|alert/)
  })
  it('strips event-handler attributes', () => {
    const out = sanitizePastedHtml('<p onclick="evil()" onmouseover="evil()">text</p>')
    expect(out).toContain('text')
    expect(out).not.toMatch(/onclick|onmouseover|evil/)
  })
  it('blocks javascript:/vbscript:/data:text/html links but keeps their text', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>']) {
      const out = sanitizePastedHtml(`<p><a href="${href}">click me</a></p>`)
      expect(out).toContain('click me')
      expect(out.toLowerCase()).not.toContain('javascript:')
      expect(out.toLowerCase()).not.toContain('vbscript:')
      expect(out.toLowerCase()).not.toContain('data:text/html')
    }
  })
  it('strips dangerous CSS but keeps safe declarations', () => {
    expect(sanitizeStyle('position:fixed; top:0; color:red')).toBe('color:red')
    expect(sanitizeStyle('position:absolute; left:0')).toBe('')
    expect(sanitizeStyle('background:url(javascript:alert(1)); color:blue')).toBe('color:blue')
    expect(sanitizeStyle('width:expression(alert(1))')).toBe('')
    const out = sanitizePastedHtml('<p style="position:fixed; text-align:center">hi</p>')
    expect(out).toContain('hi')
    expect(out).not.toContain('position')
    expect(out).toContain('text-align')
  })
  // Oversized data-URL parsing is slow under jsdom in this environment.
  it('removes images with unsafe src, keeps safe ones', () => {
    expect(sanitizePastedHtml('<p><img src="javascript:alert(1)" alt="x"></p>')).not.toContain('<img')
    expect(sanitizePastedHtml('<p><img src="data:text/html;base64,xxx"></p>')).not.toContain('<img')
    const ok = sanitizePastedHtml('<p><img src="https://example.com/a.png" alt="photo"></p>')
    expect(ok).toContain('<img')
    expect(ok).toContain('photo')
    expect(sanitizePastedHtml('<p><img src="data:image/png;base64,AAA"></p>')).toContain('data:image/png')
  }, 30000)
  it('drops oversized pasted data-URL images (same 2 MB bound as local inserts)', () => {
    expect(sanitizePastedHtml(`<p><img src="data:image/png;base64,${'A'.repeat(3000000)}"></p>`)).not.toContain('<img')
  }, 60000)
  it('malformed HTML never throws and keeps its text', () => {
    const out = sanitizePastedHtml('<p>unclosed <b>bold <i>italic')
    expect(out).toContain('unclosed')
    expect(out).toContain('bold')
    expect(htmlToPlainText('<p>broken <b>text')).toContain('broken')
    expect(sanitizePastedHtml('')).toBe('')
  })
})

describe('sanitizePastedHtml — success path', () => {
  it('preserves supported structure and safe links', () => {
    const out = sanitizePastedHtml('<h2>Title</h2><p>Hello <b>bold</b> <i>it</i> <u>u</u></p><ul><li>one</li><li>two</li></ul><p><a href="https://example.com">safe</a> <a href="mailto:a@b.com">mail</a></p>')
    expect(out).toContain('<h2>Title</h2>')
    expect(out).toContain('<b>bold</b>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('href="mailto:a@b.com"')
    expect(out).toContain('<li>one</li>')
  })
  it('preserves tables and Persian/RTL text paste', () => {
    const out = sanitizePastedHtml('<table><tr><th>نام</th><td>سلام دنیا</td></tr></table><p dir="rtl">متن فارسی با کلمات</p>')
    expect(out).toContain('سلام دنیا')
    expect(out).toContain('dir="rtl"')
    expect(out).toContain('<table>')
  })
  it('unwraps unsupported wrappers without losing text', () => {
    const out = sanitizePastedHtml('<div><section><span>nested</span> text</section></div>')
    expect(out).toContain('nested')
    expect(out).toContain('text')
    expect(out).not.toContain('<div')
  })
})

describe('classifyPaste / isSafePasteUrl', () => {
  it('plain text paste is plain; structured HTML is formatted', () => {
    expect(classifyPaste(null)).toBe('plain')
    expect(classifyPaste('just words')).toBe('plain')
    expect(classifyPaste('<p><b>bold</b></p>')).toBe('formatted')
    expect(classifyPaste('<script>alert(1)</script>')).toBe('plain')
  })
  it('safe URL rule', () => {
    expect(isSafePasteUrl('https://example.com')).toBe(true)
    expect(isSafePasteUrl('mailto:a@b.com')).toBe(true)
    expect(isSafePasteUrl('javascript:alert(1)')).toBe(false)
    expect(isSafePasteUrl('')).toBe(false)
  })
})

describe('getContextMenuItems — applicability', () => {
  it('collapsed cursor offers only paste-as-plain-text', () => {
    expect(getContextMenuItems({ hasSelection: false, inTable: false, inImage: false, inLink: false }))
      .toEqual(['pastePlain'])
  })
  it('text selection offers cut/copy/clear/bold/italic/link', () => {
    const items = getContextMenuItems({ hasSelection: true, inTable: false, inImage: false, inLink: false })
    expect(items).toEqual(['cut', 'copy', 'pastePlain', 'clearFormatting', 'bold', 'italic', 'link'])
  })
  it('table cell adds row/column actions only', () => {
    const items = getContextMenuItems({ hasSelection: false, inTable: true, inImage: false, inLink: false })
    expect(items).toEqual(['pastePlain', 'addRow', 'addColumn', 'deleteRow', 'deleteColumn'])
  })
  it('image adds alt/alignment/delete', () => {
    const items = getContextMenuItems({ hasSelection: false, inTable: false, inImage: true, inLink: false })
    expect(items).toEqual(['pastePlain', 'imageAlt', 'alignLeft', 'alignCenter', 'alignRight', 'deleteImage'])
  })
  it('link adds edit/remove and open only for a safe href', () => {
    const safe = getContextMenuItems({ hasSelection: false, inTable: false, inImage: false, inLink: true, linkHref: 'https://example.com' })
    expect(safe).toContain('editLink')
    expect(safe).toContain('removeLink')
    expect(safe).toContain('openLink')
    const unsafe = getContextMenuItems({ hasSelection: false, inTable: false, inImage: false, inLink: true, linkHref: 'javascript:alert(1)' })
    expect(unsafe).not.toContain('openLink')
    expect(unsafe).toContain('editLink')
  })
  it('never duplicates an item', () => {
    const items = getContextMenuItems({ hasSelection: true, inTable: true, inImage: true, inLink: true, linkHref: 'https://x.com' })
    expect(new Set(items).size).toBe(items.length)
  })
})

describe('clampMenuPosition', () => {
  it('keeps the menu inside the viewport and off the edges', () => {
    expect(clampMenuPosition(900, 700, 280, 320, 1000, 800)).toEqual({ x: 712, y: 472 })
    expect(clampMenuPosition(0, 0, 280, 320, 1000, 800)).toEqual({ x: 8, y: 8 })
    expect(clampMenuPosition(100, 100, 280, 320, 1000, 800)).toEqual({ x: 100, y: 100 })
  })
})
