import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import {
  parseAssistantCommand, cleanupText, summarizeText, keyPoints,
  assembleResearch, buildAnswer, searchQueryFor, estimateResearchPages,
  type AssistantAction, type ResearchData,
} from '../lib/assistant'
import { nodesForBuildAction, linesToNodes, nodesToText } from '../lib/agentPage'
import { computeDocumentStats } from '../lib/stats'
import { supabase } from '../lib/supabase'

// The dedicated Agent section (owner order 2026-11-03 ~20:12: build ONE
// section inside Vyro that is only for the agent, like other AI
// assistants — users go to that one place, write their request, and
// the agent properly prepares it there). A full page, not a side
// panel: the conversation stays visible, every result is prepared HERE
// first, and from here the user can insert it into the open document,
// start a brand-new document from it, or copy it. The assistant is
// Vyro's OWN (src/lib/assistant.ts + our own assistant-search function)
// — no external AI anywhere, sources always credited.
type Entry = {
  id: number
  from: 'user' | 'agent'
  text?: string
  title?: string
  lines?: string[]
  asList?: boolean
  nodes?: object[]
}

export default function AgentPage({ lang, editor, onClose, onCreateDoc }: {
  lang: UiLang
  editor: Editor | null
  onClose: () => void
  onCreateDoc: (title: string, nodes: object[]) => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [notice, setNotice] = useState('')
  const idRef = useRef(0)
  const historyRef = useRef<HTMLDivElement | null>(null)

  const push = (e: Omit<Entry, 'id'>) => {
    idRef.current += 1
    const id = idRef.current
    setEntries((prev) => [...prev, { ...e, id }])
  }

  useEffect(() => {
    const el = historyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, busy])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(''), 2500)
    return () => clearTimeout(id)
  }, [notice])

  const entryNodes = (e: Entry): object[] | null =>
    e.nodes ?? (e.lines && e.lines.length > 0 ? linesToNodes(e.lines, e.asList) as object[] : null)

  const insertEntry = (e: Entry) => {
    const nodes = entryNodes(e)
    if (!editor || !nodes) return
    editor.chain().focus().insertContent(nodes).run()
    push({ from: 'agent', text: t('assistantDone') })
  }

  const createEntry = (e: Entry) => {
    const nodes = entryNodes(e)
    if (!nodes) return
    const title = e.title || (e.lines && e.lines[0]) || t('intelligence')
    onCreateDoc(title.slice(0, 80), nodes)
  }

  const copyEntry = (e: Entry) => {
    const nodes = entryNodes(e)
    const text = nodes ? nodesToText(nodes) : (e.text ?? '')
    if (!text) return
    try {
      void navigator.clipboard?.writeText(text)
      setNotice(t('agentCopied'))
    } catch {
      setNotice(t('agentCopied'))
    }
  }

  const fetchSources = async (body: Record<string, unknown>): Promise<ResearchData[] | 'offline' | 'failed' | 'notfound'> => {
    if (!supabase) return 'offline'
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string)
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/assistant-search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) return 'failed'
      const data = (await res.json()) as { found?: boolean; sources?: ResearchData[] } & Partial<ResearchData>
      const sources: ResearchData[] = data.sources && data.sources.length > 0
        ? data.sources
        : data.title && data.extract && data.url ? [{ title: data.title, extract: data.extract, url: data.url }] : []
      if (!data.found || sources.length === 0) return 'notfound'
      return sources
    } catch {
      return 'failed'
    }
  }

  const failText = (r: 'offline' | 'failed' | 'notfound') =>
    r === 'offline' ? t('assistantSearchOffline') : r === 'notfound' ? t('assistantSearchNotFound') : t('assistantSearchFailed')

  const doResearch = async (action: Extract<AssistantAction, { kind: 'research' }>) => {
    setBusy(true)
    try {
      const sources = await fetchSources({ query: action.topic, lang, pages: action.pages ?? 1 })
      if (typeof sources === 'string') { push({ from: 'agent', text: failText(sources) }); return }
      const built = assembleResearch(sources, lang, { pages: action.pages, paragraphs: action.paragraphs })
      const trueWords = computeDocumentStats({ type: 'doc', content: built.nodes }).words
      const meta = t('assistantResearchMeta')
        .replace('{w}', String(trueWords))
        .replace('{p}', String(estimateResearchPages(built.nodes)))
      const short = built.words < built.targetWords * 0.85 ? ` ${t('assistantResearchShort')}` : ''
      // The Agent page ALWAYS prepares the result here first (it is the
      // one place for requests); inserting or creating a document is
      // the user's tap on the result's own buttons.
      push({ from: 'agent', title: sources[0].title, text: `${meta}${short}`, nodes: built.nodes as object[] })
    } finally {
      setBusy(false)
    }
  }

  const doAnswer = async (action: Extract<AssistantAction, { kind: 'answer' }>) => {
    setBusy(true)
    try {
      const sources = await fetchSources({ query: searchQueryFor(action.question), lang, pages: 1, mode: 'answer' })
      if (typeof sources === 'string') { push({ from: 'agent', text: failText(sources) }); return }
      const answer = buildAnswer(sources, action.question, lang)
      if (!answer.found) { push({ from: 'agent', text: t('assistantAnswerNotFound') }); return }
      push({ from: 'agent', title: t('assistantAnswerTitle'), lines: answer.lines })
    } finally {
      setBusy(false)
    }
  }

  const runWithEditor = (action: AssistantAction): boolean => {
    // Selection and whole-document commands need the open document.
    const needsDoc = ['selection-heading', 'selection-bold', 'selection-cleanup', 'selection-summarize',
      'document-summarize', 'document-keypoints', 'document-stats'].includes(action.kind)
    if (!needsDoc) return false
    if (!editor) { push({ from: 'agent', text: t('agentNeedDoc') }); return true }
    const { from, to } = editor.state.selection
    const selectedText = from === to ? '' : editor.state.doc.textBetween(from, to, '\n')
    const hasSelection = selectedText.trim().length > 0
    switch (action.kind) {
      case 'selection-heading':
        if (!hasSelection) { push({ from: 'agent', text: t('assistantNeedsSelection') }); return true }
        editor.chain().focus().setHeading({ level: action.level }).run()
        push({ from: 'agent', text: t('assistantDone') }); return true
      case 'selection-bold':
        if (!hasSelection) { push({ from: 'agent', text: t('assistantNeedsSelection') }); return true }
        editor.chain().focus().toggleBold().run()
        push({ from: 'agent', text: t('assistantDone') }); return true
      case 'selection-cleanup': {
        if (!hasSelection) { push({ from: 'agent', text: t('assistantNeedsSelection') }); return true }
        const cleaned = cleanupText(selectedText)
        const nodes = cleaned.split('\n').map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] }))
        editor.chain().focus().insertContentAt({ from, to }, nodes).run()
        push({ from: 'agent', text: t('assistantDoneCleanup') }); return true
      }
      case 'selection-summarize':
        if (!hasSelection) { push({ from: 'agent', text: t('assistantNeedsSelection') }); return true }
        push({ from: 'agent', title: t('assistantSummaryTitle'), lines: summarizeText(selectedText, 3) }); return true
      case 'document-summarize': {
        const text = editor.getText().trim()
        if (!text) { push({ from: 'agent', text: t('assistantEmptyDoc') }); return true }
        push({ from: 'agent', title: t('assistantSummaryTitle'), lines: summarizeText(text, 3) }); return true
      }
      case 'document-keypoints': {
        const text = editor.getText().trim()
        if (!text) { push({ from: 'agent', text: t('assistantEmptyDoc') }); return true }
        push({ from: 'agent', title: t('assistantKeyPointsTitle'), lines: keyPoints(text, 5), asList: true }); return true
      }
      case 'document-stats': {
        const stats = computeDocumentStats(editor.getJSON())
        push({
          from: 'agent', title: t('assistantStatsTitle'),
          lines: [`${t('words')}: ${stats.words} · ${t('characters')}: ${stats.charsWithSpaces} · ${t('paragraphs')}: ${stats.paragraphs}`],
        }); return true
      }
      default:
        return false
    }
  }

  const runCommand = (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    push({ from: 'user', text })
    setInput('')
    const action = parseAssistantCommand(text)
    if (action.kind === 'research') { void doResearch(action); return }
    if (action.kind === 'answer') { void doAnswer(action); return }
    if (action.kind === 'answer-local') { push({ from: 'agent', title: t('assistantAnswerTitle'), lines: action.lines }); return }
    if (runWithEditor(action)) return
    const nodes = nodesForBuildAction(action, lang)
    if (nodes) {
      const note = action.kind === 'insert-template' && action.template === 'essay' ? t('assistantEssayNote') : undefined
      push({ from: 'agent', title: t('assistantResult'), text: note, nodes: nodes as object[] })
      return
    }
    if (action.kind === 'help') { push({ from: 'agent', text: t('assistantHelp') }); return }
    push({ from: 'agent', text: t('assistantUnknown') })
  }

  const CHIPS: { label: I18nKey; cmd: string }[] = lang === 'fa'
    ? [
        { label: 'chipTable', cmd: 'جدول ۳×۴ بساز' }, { label: 'chipCover', cmd: 'صفحه عنوان بساز' },
        { label: 'chipEssay', cmd: 'قالب مقاله بساز' }, { label: 'chipLetter', cmd: 'نامه رسمی بنویس' },
        { label: 'chipCv', cmd: 'سی‌وی بساز' },
        { label: 'agentChipQuestion', cmd: 'پایتخت فرانسه کجاست؟' },
        { label: 'agentChipResearch', cmd: 'درباره انرژی خورشیدی در اینترنت بگرد و دو صفحه بنویس' },
        { label: 'chipHelp', cmd: 'کمک' },
      ]
    : [
        { label: 'chipTable', cmd: 'make a table 3x4' }, { label: 'chipCover', cmd: 'make a cover page' },
        { label: 'chipEssay', cmd: 'essay template' }, { label: 'chipLetter', cmd: 'write a formal letter' },
        { label: 'chipCv', cmd: 'make a cv' },
        { label: 'agentChipQuestion', cmd: 'what is the capital of France?' },
        { label: 'agentChipResearch', cmd: 'research solar energy on the web and write two pages' },
        { label: 'chipHelp', cmd: 'help' },
      ]

  return (
    <div className="agent-page" role="dialog" aria-label={t('intelligence')}>
      <div className="agent-head">
        <span className="agent-title">🤖 {t('intelligence')}</span>
        <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      <div className="agent-banner" role="status">{t('assistantBanner')}</div>
      <div className="agent-history" ref={historyRef}>
        {entries.length === 0 && <div className="agent-empty" dir="auto">{t('agentWelcome')}</div>}
        {entries.map((e) => (
          <div key={e.id} className={`agent-entry ${e.from}`}>
            {e.from === 'user'
              ? <div className="agent-entry-text" dir="auto">{e.text}</div>
              : <>
                  {e.title && <div className="agent-entry-title" dir="auto">{e.title}</div>}
                  {e.text && <div className="agent-entry-text" dir="auto">{e.text}</div>}
                  {e.lines && (
                    <div className="agent-entry-text" dir="auto">
                      {e.asList ? e.lines.map((l) => `• ${l}`).join('\n') : e.lines.join('\n')}
                    </div>
                  )}
                  {e.nodes && (
                    <div className="agent-entry-text" dir="auto">
                      {nodesToText(e.nodes).slice(0, 600)}
                    </div>
                  )}
                  {entryNodes(e) && (
                    <div className="agent-entry-actions">
                      {editor && <button type="button" className="rbtn small" onClick={() => insertEntry(e)}>{t('assistantInsertResult')}</button>}
                      <button type="button" className="rbtn small" onClick={() => createEntry(e)}>{t('agentCreateDoc')}</button>
                      <button type="button" className="rbtn small" onClick={() => copyEntry(e)}>{t('agentCopy')}</button>
                    </div>
                  )}
                </>}
          </div>
        ))}
        {busy && <div className="agent-entry agent" role="status">{t('assistantSearching')}</div>}
      </div>
      <div className="agent-chips">
        <span className="find-preview-label">{t('assistantExamples')}</span>
        <div className="intelligence-actions">
          {CHIPS.map((chip) => (
            <button key={chip.label} type="button" className="rbtn small" disabled={busy} onClick={() => runCommand(chip.cmd)}>
              {t(chip.label)}
            </button>
          ))}
        </div>
      </div>
      <form className="agent-form" onSubmit={(e) => { e.preventDefault(); runCommand(input) }}>
        <input
          className="assistant-input agent-input" dir="auto" value={input} disabled={busy}
          placeholder={t('assistantPlaceholder')} aria-label={t('assistantPlaceholder')}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="primary" disabled={busy}>{t('assistantRun')}</button>
      </form>
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}
