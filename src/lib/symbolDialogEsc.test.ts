// P2-15: SymbolDialog Esc must close from ANY focus, not only from
// inside the dialog. Root cause (P2-13 live observation): the Editor's
// insertSymbol focuses the editor after every insert, so the keypress
// lands on the editor, never on the dialog container that owns
// useDialogFocus's Esc listener. These guards pin the window-listener
// fix (IntelligencePanel/AccessibilityPanel pattern) so a future edit
// cannot silently restore the container-only behaviour.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dialog = readFileSync(resolve(process.cwd(), 'src/components/SymbolDialog.tsx'), 'utf8')

describe('P2-15: SymbolDialog window-level Escape', () => {
  it('registers a window keydown listener while open and removes it on cleanup', () => {
    expect(dialog).toContain("window.addEventListener('keydown', onKey)")
    expect(dialog).toContain("window.removeEventListener('keydown', onKey)")
  })
  it('the window listener closes on Escape only', () => {
    const effectStart = dialog.indexOf('useEffect(() => {', dialog.indexOf('useDialogFocus(open'))
    const effect = dialog.slice(effectStart, effectStart + 400)
    expect(effect).toContain("if (e.key === 'Escape') onClose()")
    expect(effect).toContain("window.addEventListener('keydown', onKey)")
  })
  it('the listener is gated on open (no listener while closed)', () => {
    const effectStart = dialog.indexOf('useEffect(() => {', dialog.indexOf('useDialogFocus(open'))
    const effect = dialog.slice(effectStart, effectStart + 400)
    expect(effect).toContain('if (!open) return')
  })
  it('useDialogFocus is retained (Tab trap + focus return are not dropped by the fix)', () => {
    expect(dialog).toContain('useDialogFocus(open, { containerRef, onClose, autofocus: false, trap: true, opener })')
  })
})
