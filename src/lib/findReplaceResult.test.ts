// P2-11: Replace-all result count — source guards for FindReplacePanel.
// The panel has no DOM harness (same as MailMergePanel guards): these pin
// the wiring so a future edit cannot silently drop the count, show a stale
// count next to a new search, or reorder the M2-04 snapshot call.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { STRINGS, tr } from './i18n'

const panel = readFileSync(resolve(process.cwd(), 'src/components/FindReplacePanel.tsx'), 'utf8')

// The doReplaceAll handler body, from its declaration to the next blank-line
// separated top-level const.
const doReplaceAll = panel.slice(
  panel.indexOf('const doReplaceAll'),
  panel.indexOf('\n  // Preview:'),
)

describe('P2-11: replace-all result count', () => {
  it('doReplaceAll captures matches.length BEFORE replaceAllMatches runs', () => {
    // The exact capture line (not the early-return guard above it) must
    // precede the bulk replacement, and the stored value is that capture.
    expect(doReplaceAll).toContain('const count = matches.length')
    const capture = doReplaceAll.indexOf('const count = matches.length')
    const replace = doReplaceAll.indexOf('replaceAllMatches(')
    expect(capture).toBeLessThan(replace)
    expect(doReplaceAll).toContain('setReplacedCount(count)')
    const store = doReplaceAll.indexOf('setReplacedCount(count)')
    expect(store).toBeGreaterThan(replace)
  })

  it('the panel renders the new i18n key in a role="status" element', () => {
    const render = panel.slice(panel.indexOf('replacedCount !== null'))
    expect(render).toContain('role="status"')
    expect(render).toContain("t('replacementsMade')")
    // Only after a Replace All has run — the line is gated on the count.
    expect(panel).toContain('replacedCount !== null')
  })

  it('the result state is cleared on query change and on replacement change', () => {
    const queryInput = panel.slice(panel.indexOf('value={query}'), panel.indexOf('value={replacement}'))
    expect(queryInput).toContain('setReplacedCount(null)')
    const replaceInput = panel.slice(panel.indexOf('value={replacement}'), panel.indexOf(">{t('replaceOne')}"))
    expect(replaceInput).toContain('setReplacedCount(null)')
  })

  it('the M2-04 onBeforeReplaceAll call still precedes replaceAllMatches', () => {
    const snapshot = doReplaceAll.indexOf('onBeforeReplaceAll?.()')
    const replace = doReplaceAll.indexOf('replaceAllMatches(')
    expect(snapshot).toBeGreaterThan(-1)
    expect(snapshot).toBeLessThan(replace)
  })

  it('the new key exists in both dictionaries with natural wording', () => {
    expect(STRINGS.en.replacementsMade).toBe('replacements made')
    expect(STRINGS.fa.replacementsMade).toBe('مورد جایگزین شد')
    expect(tr('en', 'replacementsMade')).toBe('replacements made')
    expect(tr('fa', 'replacementsMade')).toBe('مورد جایگزین شد')
  })
})
