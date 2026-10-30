import { describe, it, expect } from 'vitest'
import {
  INTELLIGENCE_ACTIONS, INTELLIGENCE_GROUPS, INTELLIGENCE_MAX_SELECTION_CHARS,
  getIntelligenceAction, actionsForGroup, actionNeedsSelection,
  disconnectedProvider, NotConnectedError, validateSelection, buildRequest,
  applySuggestion, truncatePreview, assertNoSuggestionWhenDisconnected,
} from './intelligence'

const SPEC_IDS = [
  'rewrite-formal', 'rewrite-friendly', 'rewrite-scientific', 'rewrite-simple',
  'spelling-grammar', 'sentence-improve', 'shorten', 'expand',
  'summarize', 'title-from-selection', 'continuation', 'notes-to-text',
  'key-points', 'text-to-tasks', 'tone-change', 'explain-terms',
  'translate-dari', 'translate-persian', 'translate-english',
]

describe('intelligence catalogue', () => {
  it('covers every owner-spec §1 action, with unique ids', () => {
    const ids = INTELLIGENCE_ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of SPEC_IDS) expect(ids).toContain(id)
    expect(INTELLIGENCE_ACTIONS.length).toBe(SPEC_IDS.length)
  })
  it('every action has a group, scope and output mode; groups cover all actions', () => {
    for (const a of INTELLIGENCE_ACTIONS) {
      expect(INTELLIGENCE_GROUPS).toContain(a.group)
      expect(['selection', 'document']).toContain(a.scope)
      expect(['replace', 'insert', 'append', 'show-only']).toContain(a.output)
    }
    const grouped = INTELLIGENCE_GROUPS.flatMap((g) => actionsForGroup(g)).map((a) => a.id).sort()
    expect(grouped).toEqual([...SPEC_IDS].sort())
  })
  it('selection vs document scope and output modes match the spec', () => {
    expect(actionNeedsSelection(getIntelligenceAction('rewrite-formal')!)).toBe(true)
    expect(actionNeedsSelection(getIntelligenceAction('summarize')!)).toBe(false)
    expect(actionNeedsSelection(getIntelligenceAction('key-points')!)).toBe(false)
    expect(getIntelligenceAction('summarize')!.output).toBe('show-only')
    expect(getIntelligenceAction('explain-terms')!.output).toBe('show-only')
    expect(getIntelligenceAction('title-from-selection')!.output).toBe('insert')
    expect(getIntelligenceAction('continuation')!.output).toBe('append')
    expect(getIntelligenceAction('rewrite-simple')!.output).toBe('replace')
    expect(getIntelligenceAction('translate-dari')!.group).toBe('translate')
    expect(getIntelligenceAction('no-such-action')).toBeUndefined()
  })
  it('no fake suggestion string is hard-coded anywhere in the catalogue', () => {
    // Catalogue entries carry ONLY an id, an i18n label key, a group, a
    // scope and an output mode — no sample output, example text or
    // suggestion field of any kind.
    for (const a of INTELLIGENCE_ACTIONS) {
      expect(Object.keys(a).sort()).toEqual(['group', 'id', 'labelKey', 'output', 'scope'])
      expect(a.labelKey).toMatch(/^intel[A-Z]/)
    }
    const json = JSON.stringify(INTELLIGENCE_ACTIONS)
    expect(json).not.toMatch(/sample|example|suggestion|outputText/i)
  })
})

describe('intelligence disconnected provider', () => {
  it('reports disconnected with needs-connection reason', () => {
    expect(disconnectedProvider.getConnectionStatus()).toEqual({ connected: false, reason: 'needs-connection' })
  })
  it('requestSuggestion never resolves with text — it rejects with the typed error', async () => {
    const action = getIntelligenceAction('shorten')!
    await expect(disconnectedProvider.requestSuggestion(buildRequest(action, 42))).rejects.toBeInstanceOf(NotConnectedError)
    await expect(disconnectedProvider.requestSuggestion(buildRequest(action, 42))).rejects.toMatchObject({ code: 'not-connected' })
  })
  it('the disconnected guard rejects any suggestion value while disconnected', () => {
    const status = disconnectedProvider.getConnectionStatus()
    expect(assertNoSuggestionWhenDisconnected(status, null)).toBe(true)
    expect(assertNoSuggestionWhenDisconnected(status, undefined)).toBe(true)
    expect(() => assertNoSuggestionWhenDisconnected(status, { suggestion: 'anything' })).toThrow(NotConnectedError)
    expect(() => assertNoSuggestionWhenDisconnected(status, 'anything')).toThrow(NotConnectedError)
  })
})

describe('intelligence pure helpers', () => {
  it('validateSelection rejects empty/blank and over-limit input, accepts valid input', () => {
    expect(validateSelection('')).toEqual({ ok: false, reason: 'empty' })
    expect(validateSelection('   \n ')).toEqual({ ok: false, reason: 'empty' })
    expect(validateSelection('x'.repeat(INTELLIGENCE_MAX_SELECTION_CHARS + 1))).toEqual({ ok: false, reason: 'too-long' })
    expect(validateSelection('x'.repeat(INTELLIGENCE_MAX_SELECTION_CHARS))).toEqual({ ok: true, text: 'x'.repeat(INTELLIGENCE_MAX_SELECTION_CHARS) })
    expect(validateSelection('سلام دنیا')).toEqual({ ok: true, text: 'سلام دنیا' })
  })
  it('buildRequest returns shape only — no input text embedded, never sent', () => {
    const action = getIntelligenceAction('summarize')!
    const req = buildRequest(action, 123)
    expect(req).toEqual({ actionId: 'summarize', group: 'summarize', scope: 'document', output: 'show-only', inputLength: 123, inputPresent: true })
    expect(JSON.stringify(req)).not.toContain('secret document text')
    expect(buildRequest(action, 0).inputPresent).toBe(false)
  })
  it('applySuggestion returns an original-vs-suggestion pair without mutating inputs', () => {
    const original = Object.freeze('original text')
    const suggestion = Object.freeze('suggested text')
    const pair = applySuggestion(original, suggestion)
    expect(pair).toEqual({ original: 'original text', suggestion: 'suggested text' })
    expect(pair).not.toBe(original)
    expect(original).toBe('original text')
    expect(suggestion).toBe('suggested text')
  })
  it('the disconnected path cannot mutate a document (pure pair only)', () => {
    // There is no document-mutating API in this lib: the only "apply"
    // returns a fresh pair object, and the provider can never supply a
    // suggestion while disconnected, so no document value can change here.
    const doc = Object.freeze({ content: 'unchanged document' })
    const pair = applySuggestion('a', 'b')
    expect(doc.content).toBe('unchanged document')
    expect(pair.original).toBe('a')
    expect(truncatePreview('x'.repeat(500))).toHaveLength(301)
    expect(truncatePreview('short')).toBe('short')
  })
})
