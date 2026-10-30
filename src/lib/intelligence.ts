// Vyro Intelligence — ARCHITECTURE + UI ONLY (Mission 2, M2-10 = owner spec §1).
//
// There is NO real AI service connected, and this module deliberately
// contains NO network code: no fetch, no API key, no env secret, no
// document upload. The catalogue, validation and pure helpers below exist
// so a real provider can be plugged in later behind user consent; until
// then the single implementation is disconnected and can NEVER produce a
// suggestion. Nothing in this file generates, simulates or hard-codes AI
// output text — action entries carry only a stable id, an i18n label key,
// a group, a scope and an output mode.
//
// Applying a suggestion to a document is a SEPARATE, explicit accept step
// owned by future UI code. applySuggestion() here only builds the
// { original, suggestion } preview pair; it never touches a document.

export const INTELLIGENCE_MAX_SELECTION_CHARS = 20000
export const INTELLIGENCE_PREVIEW_CHARS = 300

export type IntelligenceGroup = 'rewrite' | 'improve' | 'summarize' | 'create' | 'translate'
export type IntelligenceScope = 'selection' | 'document'
export type IntelligenceOutput = 'replace' | 'insert' | 'append' | 'show-only'

export interface IntelligenceAction {
  id: string
  labelKey: string
  group: IntelligenceGroup
  scope: IntelligenceScope
  output: IntelligenceOutput
}

// The full owner-spec §1 catalogue. `scope` decides whether the action
// needs a selection (selection) or works on the whole document (document);
// `output` decides what an accepted suggestion would do later: replace the
// selection, insert at the cursor, append after the selection, or only be
// shown (summary / key points / explanations never replace text).
export const INTELLIGENCE_ACTIONS: readonly IntelligenceAction[] = [
  { id: 'rewrite-formal', labelKey: 'intelRewriteFormal', group: 'rewrite', scope: 'selection', output: 'replace' },
  { id: 'rewrite-friendly', labelKey: 'intelRewriteFriendly', group: 'rewrite', scope: 'selection', output: 'replace' },
  { id: 'rewrite-scientific', labelKey: 'intelRewriteScientific', group: 'rewrite', scope: 'selection', output: 'replace' },
  { id: 'rewrite-simple', labelKey: 'intelRewriteSimple', group: 'rewrite', scope: 'selection', output: 'replace' },
  { id: 'spelling-grammar', labelKey: 'intelSpellingGrammar', group: 'improve', scope: 'selection', output: 'replace' },
  { id: 'sentence-improve', labelKey: 'intelSentenceImprove', group: 'improve', scope: 'selection', output: 'replace' },
  { id: 'shorten', labelKey: 'intelShorten', group: 'improve', scope: 'selection', output: 'replace' },
  { id: 'expand', labelKey: 'intelExpand', group: 'improve', scope: 'selection', output: 'replace' },
  { id: 'tone-change', labelKey: 'intelToneChange', group: 'improve', scope: 'selection', output: 'replace' },
  { id: 'summarize', labelKey: 'intelSummarize', group: 'summarize', scope: 'document', output: 'show-only' },
  { id: 'key-points', labelKey: 'intelKeyPoints', group: 'summarize', scope: 'document', output: 'show-only' },
  { id: 'explain-terms', labelKey: 'intelExplainTerms', group: 'summarize', scope: 'selection', output: 'show-only' },
  { id: 'title-from-selection', labelKey: 'intelTitleFromSelection', group: 'create', scope: 'selection', output: 'insert' },
  { id: 'continuation', labelKey: 'intelContinuation', group: 'create', scope: 'selection', output: 'append' },
  { id: 'notes-to-text', labelKey: 'intelNotesToText', group: 'create', scope: 'selection', output: 'replace' },
  { id: 'text-to-tasks', labelKey: 'intelTextToTasks', group: 'create', scope: 'selection', output: 'replace' },
  { id: 'translate-dari', labelKey: 'intelTranslateDari', group: 'translate', scope: 'selection', output: 'replace' },
  { id: 'translate-persian', labelKey: 'intelTranslatePersian', group: 'translate', scope: 'selection', output: 'replace' },
  { id: 'translate-english', labelKey: 'intelTranslateEnglish', group: 'translate', scope: 'selection', output: 'replace' },
]

export const INTELLIGENCE_GROUPS: readonly IntelligenceGroup[] = ['rewrite', 'improve', 'summarize', 'create', 'translate']

export function getIntelligenceAction(id: string): IntelligenceAction | undefined {
  return INTELLIGENCE_ACTIONS.find((a) => a.id === id)
}

export function actionsForGroup(group: IntelligenceGroup): IntelligenceAction[] {
  return INTELLIGENCE_ACTIONS.filter((a) => a.group === group)
}

export function actionNeedsSelection(action: IntelligenceAction): boolean {
  return action.scope === 'selection'
}

// ---- Connection status + provider interface ----

export interface IntelligenceConnectionStatus {
  connected: boolean
  reason: 'needs-connection' | 'connected'
}

export class NotConnectedError extends Error {
  code = 'not-connected' as const
  constructor() {
    super('Vyro Intelligence is not connected to an AI service.')
    this.name = 'NotConnectedError'
  }
}

export interface IntelligenceRequestShape {
  actionId: string
  group: IntelligenceGroup
  scope: IntelligenceScope
  output: IntelligenceOutput
  inputLength: number
  inputPresent: boolean
}

export interface IntelligenceSuggestion {
  actionId: string
  original: string
  suggestion: string
}

export interface IntelligenceProvider {
  getConnectionStatus(): IntelligenceConnectionStatus
  requestSuggestion(request: IntelligenceRequestShape): Promise<IntelligenceSuggestion>
}

// The ONLY implementation shipped: disconnected. requestSuggestion() always
// rejects with the typed error and never resolves with text.
export const disconnectedProvider: IntelligenceProvider = {
  getConnectionStatus(): IntelligenceConnectionStatus {
    return { connected: false, reason: 'needs-connection' }
  },
  requestSuggestion(): Promise<IntelligenceSuggestion> {
    return Promise.reject(new NotConnectedError())
  },
}

// ---- Pure helpers (no network, no document mutation) ----

export type SelectionValidation =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'too-long' }

export function validateSelection(text: string): SelectionValidation {
  if (text.trim().length === 0) return { ok: false, reason: 'empty' }
  if (text.length > INTELLIGENCE_MAX_SELECTION_CHARS) return { ok: false, reason: 'too-long' }
  return { ok: true, text }
}

// Shape only, never sent: the request deliberately does NOT embed the
// input text — only its length and presence — so building it can never
// leak document content anywhere.
export function buildRequest(action: IntelligenceAction, inputLength: number): IntelligenceRequestShape {
  return {
    actionId: action.id,
    group: action.group,
    scope: action.scope,
    output: action.output,
    inputLength,
    inputPresent: inputLength > 0,
  }
}

// Preview pair only. This does NOT apply anything to a document; applying
// is a separate explicit accept step in future UI code.
export function applySuggestion(original: string, suggestion: string): { original: string; suggestion: string } {
  return { original, suggestion }
}

export function truncatePreview(text: string, max = INTELLIGENCE_PREVIEW_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

// Guard: while disconnected, no suggestion may exist. Throws if a
// suggestion value is present under a disconnected status.
export function assertNoSuggestionWhenDisconnected(
  status: IntelligenceConnectionStatus,
  suggestion: unknown,
): true {
  if (!status.connected && suggestion !== null && suggestion !== undefined) {
    throw new NotConnectedError()
  }
  return true
}
