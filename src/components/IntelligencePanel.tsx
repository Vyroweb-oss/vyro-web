import { useEffect, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import { usePanelFocusReturn } from './useDialogFocus'
import { truncatePreview } from '../lib/intelligence'
import {
  parseAssistantCommand, cleanupText, summarizeText, keyPoints,
  buildTemplate, assembleResearch, buildAnswer, searchQueryFor, estimateResearchPages,
  type AssistantAction, type ResearchData,
} from '../lib/assistant'
import { computeDocumentStats } from '../lib/stats'
import { supabase } from '../lib/supabase'

// Vyro Assistant panel (دستیار وایرو) — owner order 2026-11-03,
// replacing the Mission-2 architecture-only shell. The assistant is
// Vyro's OWN: a local command engine (src/lib/assistant.ts), no
// external AI service, no network, nothing leaves the app. The user
// types what to build; the panel executes it in the document with the
// editor's own features. It cannot free-write: a request for an essay
// builds the essay STRUCTURE and says so honestly.
export default function IntelligencePanel({ editor, lang, onClose }: {
  editor: Editor
  lang: UiLang
  onClose: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  usePanelFocusReturn()
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<{ title: string; lines: string[]; asList: boolean } | null>(null)
  const [pendingResearch, setPendingResearch] = useState<object[] | null>(null)

  const sel = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return { text: '', from: 0, to: 0 }
      const { from, to } = ed.state.selection
      return { text: from === to ? '' : ed.state.doc.textBetween(from, to, '\n'), from, to }
    },
  })
  const selectedText = sel?.text ?? ''
  const hasSelection = selectedText.trim().length > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const done = (essayNote = false) => {
    setResult(null)
    setMessage(essayNote ? `${t('assistantDone')} ${t('assistantEssayNote')}` : t('assistantDone'))
  }
  const needsSelection = () => setMessage(t('assistantNeedsSelection'))
  const docText = () => editor.getText().trim()

  const execute = (action: AssistantAction) => {
    const chain = () => editor.chain().focus()
    switch (action.kind) {
      case 'insert-table':
        chain().insertTable({ rows: action.rows, cols: action.cols, withHeaderRow: true }).run()
        return done()
      case 'insert-heading': {
        const nodes: object[] = [
          { type: 'heading', attrs: { level: action.level }, content: action.text ? [{ type: 'text', text: action.text }] : [] },
          { type: 'paragraph' },
        ]
        chain().insertContent(nodes).run()
        return done()
      }
      case 'insert-list': {
        const items = action.items.length > 0 ? action.items : ['', '', '']
        const node = {
          type: action.ordered ? 'orderedList' : 'bulletList',
          content: items.map((i) => ({ type: 'listItem', content: [{ type: 'paragraph', content: i ? [{ type: 'text', text: i }] : [] }] })),
        }
        chain().insertContent(node).run()
        return done()
      }
      case 'insert-text': {
        const nodes = action.text.split('\n').map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] }))
        chain().insertContent(nodes).run()
        return done()
      }
      case 'insert-template':
        chain().insertContent(buildTemplate(action.template, lang, action.topic) as object[]).run()
        return done(action.template === 'essay')
      case 'insert-page-break':
        chain().insertPageBreak().run()
        return done()
      case 'insert-date': {
        const date = new Date().toLocaleDateString(lang === 'fa' ? 'fa-AF' : 'en-GB', { dateStyle: 'full' })
        chain().insertContent({ type: 'text', text: date }).run()
        return done()
      }
      case 'selection-heading':
        if (!hasSelection) return needsSelection()
        chain().setHeading({ level: action.level }).run()
        return done()
      case 'selection-bold':
        if (!hasSelection) return needsSelection()
        chain().toggleBold().run()
        return done()
      case 'selection-cleanup': {
        if (!hasSelection) return needsSelection()
        const cleaned = cleanupText(selectedText)
        const nodes = cleaned.split('\n').map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] }))
        editor.chain().focus().insertContentAt({ from: sel!.from, to: sel!.to }, nodes).run()
        setResult(null)
        return setMessage(t('assistantDoneCleanup'))
      }
      case 'selection-summarize': {
        if (!hasSelection) return needsSelection()
        const lines = summarizeText(selectedText, 3)
        setMessage('')
        return setResult({ title: t('assistantSummaryTitle'), lines, asList: false })
      }
      case 'document-summarize': {
        const text = docText()
        if (!text) return setMessage(t('assistantEmptyDoc'))
        setMessage('')
        return setResult({ title: t('assistantSummaryTitle'), lines: summarizeText(text, 3), asList: false })
      }
      case 'document-keypoints': {
        const text = docText()
        if (!text) return setMessage(t('assistantEmptyDoc'))
        setMessage('')
        return setResult({ title: t('assistantKeyPointsTitle'), lines: keyPoints(text, 5), asList: true })
      }
      case 'document-stats': {
        const stats = computeDocumentStats(editor.getJSON())
        setMessage('')
        return setResult({
          title: t('assistantStatsTitle'), asList: false,
          lines: [`${t('words')}: ${stats.words} · ${t('characters')}: ${stats.charsWithSpaces} · ${t('paragraphs')}: ${stats.paragraphs}`],
        })
      }
      case 'help':
        setResult(null)
        return setMessage(t('assistantHelp'))
      case 'unknown':
        setResult(null)
        return setMessage(t('assistantUnknown'))
      case 'research':
        return // handled by doResearch (async)
    }
  }

  // Web research (owner order 2026-11-03): our own Supabase function
  // searches Wikipedia; the draft is assembled locally from the
  // article's own sentences, source credited at the end of the draft.
  const doResearch = async (action: Extract<AssistantAction, { kind: 'research' }>) => {
    if (!supabase) { setMessage(t('assistantSearchOffline')); return }
    setBusy(true)
    setResult(null)
    setPendingResearch(null)
    setMessage(t('assistantSearching'))
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string)
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/assistant-search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: action.topic, lang, pages: action.pages ?? 1 }),
      })
      if (!res.ok) { setMessage(t('assistantSearchFailed')); return }
      const data = (await res.json()) as { found?: boolean; sources?: ResearchData[] } & Partial<ResearchData>
      const sources: ResearchData[] = data.sources && data.sources.length > 0
        ? data.sources
        : data.title && data.extract && data.url ? [{ title: data.title, extract: data.extract, url: data.url }] : []
      if (!data.found || sources.length === 0) { setMessage(t('assistantSearchNotFound')); return }
      const built = assembleResearch(sources, lang, { pages: action.pages, paragraphs: action.paragraphs })
      // Report the word count with the app's OWN statistics engine,
      // so the number always matches the document's status bar.
      const trueWords = computeDocumentStats({ type: 'doc', content: built.nodes }).words
      const meta = t('assistantResearchMeta')
        .replace('{w}', String(trueWords))
        .replace('{p}', String(estimateResearchPages(built.nodes)))
      const short = built.words < built.targetWords * 0.85 ? ` ${t('assistantResearchShort')}` : ''
      if (action.insert) {
        editor.chain().focus().insertContent(built.nodes as object[]).run()
        setPendingResearch(null)
        setMessage(`${t('assistantResearchDone')} ${meta}${short}`)
      } else {
        // The user said "don't type it, just show me" (owner order
        // 2026-11-03): keep the draft OUT of the document, preview
        // its opening in the panel, and offer one-tap insertion.
        setPendingResearch(built.nodes as object[])
        const preview = built.nodes
          .map((n) => (n as { content?: { text?: string }[] }).content?.map((c) => c.text ?? '').join(' ') ?? '')
          .filter(Boolean).slice(0, 3)
        setResult({ title: sources[0].title, lines: preview, asList: false })
        setMessage(`${t('assistantPreviewReady')} ${meta}${short}`)
      }
    } catch {
      setMessage(t('assistantSearchFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Free-form questions (owner order 2026-11-03: ANY question gets
  // searched and answered in seconds, not just preset commands).
  const doAnswer = async (action: Extract<AssistantAction, { kind: 'answer' }>) => {
    if (!supabase) { setMessage(t('assistantSearchOffline')); return }
    setBusy(true)
    setResult(null)
    setPendingResearch(null)
    setMessage(t('assistantSearching'))
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string)
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/assistant-search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQueryFor(action.question), lang, pages: 1, mode: 'answer' }),
      })
      if (!res.ok) { setMessage(t('assistantSearchFailed')); return }
      const data = (await res.json()) as { found?: boolean; sources?: ResearchData[] } & Partial<ResearchData>
      const sources: ResearchData[] = data.sources && data.sources.length > 0
        ? data.sources
        : data.title && data.extract && data.url ? [{ title: data.title, extract: data.extract, url: data.url }] : []
      if (!data.found || sources.length === 0) { setMessage(t('assistantSearchNotFound')); return }
      const answer = buildAnswer(sources, action.question, lang)
      if (!answer.found) { setMessage(t('assistantAnswerNotFound')); return }
      setMessage('')
      setResult({ title: t('assistantAnswerTitle'), lines: answer.lines, asList: false })
    } catch {
      setMessage(t('assistantSearchFailed'))
    } finally {
      setBusy(false)
    }
  }

  const runCommand = (raw: string) => {
    if (!raw.trim() || busy) return
    const action = parseAssistantCommand(raw)
    if (action.kind === 'research') void doResearch(action)
    else if (action.kind === 'answer') void doAnswer(action)
    else if (action.kind === 'answer-local') {
      setResult({ title: t('assistantAnswerTitle'), lines: action.lines, asList: false })
      setMessage('')
    } else execute(action)
    setCommand('')
  }

  const insertResult = () => {
    if (pendingResearch) {
      editor.chain().focus().insertContent(pendingResearch).run()
      setPendingResearch(null)
      setResult(null)
      done()
      return
    }
    if (!result) return
    if (result.asList) {
      const node = {
        type: 'bulletList',
        content: result.lines.map((l) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: l }] }] })),
      }
      editor.chain().focus().insertContent(node).run()
    } else {
      const nodes = result.lines.map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] }))
      editor.chain().focus().insertContent(nodes).run()
    }
    done()
  }

  const CHIPS: { label: I18nKey; cmd: string }[] = lang === 'fa'
    ? [
        { label: 'chipTable', cmd: 'جدول ۳×۴ بساز' }, { label: 'chipCover', cmd: 'صفحه عنوان بساز' },
        { label: 'chipEssay', cmd: 'قالب مقاله بساز' }, { label: 'chipLetter', cmd: 'نامه رسمی بنویس' },
        { label: 'chipCv', cmd: 'سی‌وی بساز' }, { label: 'chipSummarize', cmd: 'سند را خلاصه کن' },
        { label: 'chipKeyPoints', cmd: 'نکات کلیدی سند را بگو' }, { label: 'chipCleanup', cmd: 'متن را تمیز کن' },
        { label: 'chipHelp', cmd: 'کمک' },
      ]
    : [
        { label: 'chipTable', cmd: 'make a table 3x4' }, { label: 'chipCover', cmd: 'make a cover page' },
        { label: 'chipEssay', cmd: 'essay template' }, { label: 'chipLetter', cmd: 'write a formal letter' },
        { label: 'chipCv', cmd: 'make a cv' }, { label: 'chipSummarize', cmd: 'summarize the document' },
        { label: 'chipKeyPoints', cmd: 'key points' }, { label: 'chipCleanup', cmd: 'clean up the text' },
        { label: 'chipHelp', cmd: 'help' },
      ]

  return (
    <div className="versions-panel intelligence-panel" role="region" aria-label={t('intelligence')}>
      <div className="find-row">
        <span className="find-preview-label">{t('intelligence')}</span>
        <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      <div className="intelligence-banner assistant-banner" role="status">{t('assistantBanner')}</div>
      <div className="find-row">
        <span className="find-preview-label">{t('intelligenceSelectedPreview')}</span>
        {hasSelection
          ? <span className="find-meta" dir="auto">{truncatePreview(selectedText)}</span>
          : <span className="muted">{t('intelligenceNoSelection')}</span>}
      </div>
      <form className="assistant-form" onSubmit={(e) => { e.preventDefault(); runCommand(command) }}>
        <input
          className="assistant-input" dir="auto" value={command} disabled={busy}
          placeholder={t('assistantPlaceholder')} aria-label={t('assistantPlaceholder')}
          onChange={(e) => setCommand(e.target.value)}
        />
        <button type="submit" className="rbtn small" disabled={busy}>{t('assistantRun')}</button>
      </form>
      <div className="find-row">
        <span className="find-preview-label">{t('assistantExamples')}</span>
        <div className="intelligence-actions">
          {CHIPS.map((chip) => (
            <button key={chip.label} type="button" className="rbtn small" onClick={() => runCommand(chip.cmd)}>
              {t(chip.label)}
            </button>
          ))}
        </div>
      </div>
      {message && <div className="find-meta assistant-message" role="status" dir="auto">{message}</div>}
      {result && (
        <div className="intelligence-compare">
          <div className="find-preview-label">{result.title}</div>
          <div className="diff-line" dir="auto">
            {result.asList ? result.lines.map((l) => `• ${l}`).join('\n') : result.lines.join('\n')}
          </div>
          <div className="find-row">
            <button type="button" className="rbtn small" onClick={insertResult}>{t('assistantInsertResult')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
