// Tier-1 S4b: MailMergePanel wiring guards — record navigation controls and
// the fresh-snapshot subscription. The panel's runtime behaviour is also
// covered by the interactive harness; these guards pin the wiring so a
// future edit cannot silently restore the stale mount-time snapshot or
// drop the navigation controls.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const panel = readFileSync(resolve(process.cwd(), 'src/components/MailMergePanel.tsx'), 'utf8')

describe('Tier-1 S4b: panel freshness + navigation wiring', () => {
  it('the document snapshot refreshes on editor updates (no mount-only memo)', () => {
    expect(panel).toContain("editor.on('update', bump)")
    expect(panel).toContain("editor.off('update', bump)")
    expect(panel).toContain('useMemo(() => editor.getJSON(), [editor, docVersion])')
    expect(panel).not.toContain('useMemo(() => editor.getJSON(), [editor])')
  })
  it('editor updates never reset the selected record', () => {
    const bumpLine = panel.split('\n').find((l) => l.includes("editor.on('update'")) ?? ''
    const effectBlock = panel.slice(panel.indexOf("editor.on('update'"), panel.indexOf("editor.on('update'") + 200)
    expect(effectBlock).not.toContain('setRecordIdx')
    expect(bumpLine).not.toContain('setRecordIdx')
  })
  it('First/Previous/Next/Last controls exist, use the nav helpers, and disable at bounds', () => {
    for (const nav of ["'first'", "'prev'", "'next'", "'last'"]) {
      expect(panel).toContain(`navRecordIndex(safeIdx, records.length, ${nav})`)
    }
    expect(panel).toContain('disabled={safeIdx <= 0}')
    expect(panel).toContain('disabled={safeIdx >= records.length - 1}')
    expect(panel).toContain('{safeIdx + 1} / {records.length}')
  })
  it('the record select still drives the same index state', () => {
    expect(panel).toContain('value={safeIdx}')
    expect(panel).toContain('onChange={(e) => setRecordIdx(Number(e.target.value))}')
  })
})

describe('Tier-1 S4c: size gate + row-width warnings wiring', () => {
  it('the file picker enforces the size cap on the File object BEFORE reading it', () => {
    const gate = panel.indexOf('f.size > MAIL_MERGE_MAX_CSV_BYTES')
    const read = panel.indexOf('readAsText')
    expect(gate).toBeGreaterThan(-1)
    expect(read).toBeGreaterThan(gate)
  })
  it('the tooLarge parse error is mapped to its localized message', () => {
    expect(panel).toContain("tooLarge: 'mailCsvErrorTooLarge'")
    expect(panel).toContain("t('mailCsvErrorTooLarge')")
  })
  it('row-width warnings render with row numbers and both notes', () => {
    expect(panel).toContain('parsed.warnings.length > 0')
    expect(panel).toContain("t('mailRowWidthWarning')")
    expect(panel).toContain("t('mailRowShortNote')")
    expect(panel).toContain("t('mailRowLongNote')")
  })
})
