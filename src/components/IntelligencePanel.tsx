import { useEffect, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import { usePanelFocusReturn } from './useDialogFocus'
import { truncatePreview } from '../lib/intelligence'
import {
  parseAssistantCommand, cleanupText, cleanupDocJson, summarizeText, keyPoints, formalizeText, shortenText,
  buildTemplate, assembleResearch, buildAnswer, searchQueryFor, estimateResearchPages,
  subQuestionQueries, refineQuery, assembleThoughtAnswer, findNumericConflict,
  splitComparison, assembleComparisonAnswer,
  detectFollowUp, expandResearchOpts, researchBodyText,
  type AssistantAction, type ResearchData,
} from '../lib/assistant'
import { formatResultLines } from '../lib/agentPage'
import { assistantCacheKey, getCachedAssistantSources, setCachedAssistantSources } from '../lib/assistantCache'
import { computeDocumentStats } from '../lib/stats'
import { supabase } from '../lib/supabase'
import {
  recordFeedback, feedbackPreference, applyDetailPreference, countAnswerWords,
  recordWeakQuestion,
  recordUserLanguage, preferredReplyLanguage, detectSocial, isAmbiguousQuestion,
} from '../lib/assistantLearning'

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
  const [result, setResult] = useState<{ title: string; lines: string[]; asList: boolean; question?: string; kind?: 'answer' | 'research' } | null>(null)
  // A-09: which search is in flight, so the progress state can say
  // so (an answer search and a research draft are not the same wait).
  const [busyKind, setBusyKind] = useState<'answer' | 'research' | null>(null)
  const [pendingResearch, setPendingResearch] = useState<object[] | null>(null)
  // A-01g: the last answered question (follow-up topic) + whether
  // the current answer already received feedback (local only).
  const [lastQuestion, setLastQuestion] = useState('')
  const [votedResult, setVotedResult] = useState(false)
  // A-04 follow-up context: the last research (topic + its SAME
  // sources + nodes), so «بیشتر بنویس» / «ادامه بده» /
  // «خلاصه‌اش کن» act on it without a new search.
  const [lastResearch, setLastResearch] = useState<{
    topic: string; pages?: number; paragraphs?: number; words: number
    sources: ResearchData[]; nodes: object[]
  } | null>(null)

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
      case 'document-cleanup': {
        if (!docText()) return setMessage(t('assistantEmptyDoc'))
        editor.chain().focus().setContent(cleanupDocJson(editor.getJSON())).run()
        setResult(null)
        return setMessage(t('assistantDoneCleanup'))
      }
      case 'selection-formalize': {
        if (!hasSelection) return needsSelection()
        const formal = formalizeText(selectedText)
        const nodes = formal.split('\n').map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] }))
        editor.chain().focus().insertContentAt({ from: sel!.from, to: sel!.to }, nodes).run()
        setResult(null)
        return setMessage(t('assistantDoneFormalize'))
      }
      case 'selection-shorten': {
        if (!hasSelection) return needsSelection()
        const short = shortenText(selectedText)
        const nodes = short.split('\n').map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] }))
        editor.chain().focus().insertContentAt({ from: sel!.from, to: sel!.to }, nodes).run()
        setResult(null)
        return setMessage(t('assistantDoneShorten'))
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
    setBusyKind('research')
    setResult(null)
    setPendingResearch(null)
    try {
      // A-10: a repeated research topic in this page session replays
      // its sources from memory instead of searching again.
      const cacheKey = assistantCacheKey({ query: action.topic, lang, pages: action.pages ?? 1, mode: 'research' })
      let sources: ResearchData[]
      const cached = getCachedAssistantSources(cacheKey)
      if (cached) {
        sources = cached
      } else {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess.session?.access_token ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string)
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/assistant-search`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: action.topic, lang, pages: action.pages ?? 1 }),
        })
        if (!res.ok) { setMessage(t('assistantSearchFailed')); return }
        const data = (await res.json()) as { found?: boolean; sources?: ResearchData[] } & Partial<ResearchData>
        sources = data.sources && data.sources.length > 0
          ? data.sources
          : data.title && data.extract && data.url ? [{ title: data.title, extract: data.extract, url: data.url }] : []
        if (!data.found || sources.length === 0) { setMessage(t('assistantSearchNotFound')); return }
        setCachedAssistantSources(cacheKey, sources)
      }
      const built = assembleResearch(sources, lang, { pages: action.pages, paragraphs: action.paragraphs })
      // Report the word count with the app's OWN statistics engine,
      // so the number always matches the document's status bar.
      const trueWords = computeDocumentStats({ type: 'doc', content: built.nodes }).words
      const meta = t('assistantResearchMeta')
        .replace('{w}', String(trueWords))
        .replace('{p}', String(estimateResearchPages(built.nodes)))
      const short = built.words < built.targetWords * 0.85 ? ` ${t('assistantResearchShort')}` : ''
      setLastResearch({ topic: action.topic, pages: action.pages, paragraphs: action.paragraphs, words: trueWords, sources, nodes: built.nodes as object[] })
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
        setResult({ title: sources[0].title, lines: preview, asList: false, kind: 'research' })
        setMessage(`${t('assistantPreviewReady')} ${meta}${short}`)
      }
    } catch {
      setMessage(t('assistantSearchFailed'))
    } finally {
      setBusy(false)
      setBusyKind(null)
    }
  }

  // Free-form questions (owner order 2026-11-03: ANY question gets
  // searched and answered in seconds, not just preset commands).
  // A-01f thinking brain: same decomposition / multi-hop / assembly /
  // cross-check as the Agent page, so both homes answer alike.
  const doAnswer = async (action: Extract<AssistantAction, { kind: 'answer' }>) => {
    if (!supabase) { setMessage(t('assistantSearchOffline')); return }
    setBusy(true)
    setBusyKind('answer')
    setResult(null)
    setPendingResearch(null)
    try {
      const fetchAnswer = async (query: string, qLang: UiLang = lang): Promise<ResearchData[] | 'failed' | 'notfound'> => {
        if (!supabase) return 'failed'
        // A-10: a repeated question in this page session replays its
        // sources from memory instead of searching again.
        const cacheKey = assistantCacheKey({ query, lang: qLang, mode: 'answer' })
        const cached = getCachedAssistantSources(cacheKey)
        if (cached) return cached
        const { data: sess } = await supabase.auth.getSession()
        const token = sess.session?.access_token ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string)
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/assistant-search`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, lang: qLang, pages: 1, mode: 'answer' }),
        })
        if (!res.ok) return 'failed'
        const data = (await res.json()) as { found?: boolean; sources?: ResearchData[] } & Partial<ResearchData>
        const sources: ResearchData[] = data.sources && data.sources.length > 0
          ? data.sources
          : data.title && data.extract && data.url ? [{ title: data.title, extract: data.extract, url: data.url }] : []
        if (!data.found || sources.length === 0) return 'notfound'
        setCachedAssistantSources(cacheKey, sources)
        return sources
      }
      // A-01g: answer in the user's own language; trim to their
      // feedback-derived detail; mine not-found questions locally.
      const qLang = preferredReplyLanguage(action.question) ?? lang
      // A-07: a two-topic comparison question is answered per topic
      // and assembled side by side, each side separately credited;
      // no multi-hop retry here — each side stands on its own search.
      const cmp = splitComparison(action.question)
      if (cmp) {
        const sides: { lines: string[]; found: boolean }[] = []
        for (const topic of cmp) {
          const sources = await fetchAnswer(searchQueryFor(topic), qLang)
          if (sources === 'failed') { setMessage(t('assistantSearchFailed')); return }
          if (sources === 'notfound') { sides.push({ lines: [], found: false }); continue }
          sides.push(buildAnswer(sources, topic, qLang))
        }
        const compared = assembleComparisonAnswer(cmp as [string, string], sides, qLang)
        if (!compared.found) { recordWeakQuestion(action.question, 'not-found'); setMessage(t('assistantAnswerNotFound')); return }
        setMessage('')
        // No applyDetailPreference here: its short mode keeps only
        // the first sentence plus credits, which would break the
        // two-side structure.
        setResult({ title: t('assistantAnswerTitle'), lines: compared.lines, asList: false, question: action.question, kind: 'answer' })
        return
      }
      const subs = subQuestionQueries(action.question)
      if (subs.length === 1) {
        const sources = await fetchAnswer(searchQueryFor(action.question), qLang)
        if (sources === 'failed') { setMessage(t('assistantSearchFailed')); return }
        if (sources === 'notfound') { recordWeakQuestion(action.question, 'not-found'); setMessage(t('assistantSearchNotFound')); return }
        const conflict = findNumericConflict(sources, action.question, qLang)
        if (conflict) { setMessage(''); setResult({ title: t('assistantAnswerTitle'), lines: applyDetailPreference(conflict, feedbackPreference()), asList: false, question: action.question, kind: 'answer' }); return }
        const answer = buildAnswer(sources, action.question, qLang)
        if (!answer.found) { recordWeakQuestion(action.question, 'not-found'); setMessage(t('assistantAnswerNotFound')); return }
        setMessage('')
        setResult({ title: t('assistantAnswerTitle'), lines: applyDetailPreference(answer.lines, feedbackPreference()), asList: false, question: action.question, kind: 'answer' })
        return
      }
      const results: { question: string; lines: string[]; found: boolean }[] = []
      for (const sub of subs) {
        let sources = await fetchAnswer(searchQueryFor(sub.query), qLang)
        if (sources === 'failed') { setMessage(t('assistantSearchFailed')); return }
        if (sources === 'notfound') { results.push({ question: sub.question, lines: [], found: false }); continue }
        let answer = buildAnswer(sources, sub.query, qLang)
        const tried = new Set([searchQueryFor(sub.query)])
        let attempts = 1
        while (!answer.found && attempts < 3) {
          const refined = refineQuery(sub.query, sources.map((s) => s.title))
          if (tried.has(refined)) break
          tried.add(refined)
          attempts += 1
          const next = await fetchAnswer(refined, qLang)
          if (typeof next === 'string') break
          sources = next
          answer = buildAnswer(sources, refined, qLang)
        }
        results.push({ question: sub.question, lines: answer.lines, found: answer.found })
      }
      const assembled = assembleThoughtAnswer(results, qLang)
      if (!assembled.found) {
        for (const r of results) if (!r.found) recordWeakQuestion(r.question, 'not-found')
        setMessage(t('assistantAnswerNotFound')); return
      }
      setMessage('')
      setResult({ title: t('assistantAnswerTitle'), lines: applyDetailPreference(assembled.lines, feedbackPreference()), asList: false, question: action.question, kind: 'answer' })
    } catch {
      setMessage(t('assistantSearchFailed'))
    } finally {
      setBusy(false)
      setBusyKind(null)
    }
  }

  // A-01g feedback on the panel's current answer (local only).
  const voteResult = (useful: boolean) => {
    if (!result?.question) return
    recordFeedback(result.question, useful, countAnswerWords(result.lines))
    if (!useful) recordWeakQuestion(result.question, 'generic')
    setVotedResult(true)
    setMessage(t('assistantFeedbackThanks'))
  }

  // A-04 follow-up on the last research: expand re-assembles from
  // the SAME sources with a larger page target (no new search, no
  // invented text) and stays a preview — the user taps insert;
  // summarize shows the draft's own body sentences as the result.
  const doFollowUp = (kind: 'expand' | 'summarize') => {
    if (!lastResearch) return
    if (kind === 'summarize') {
      setMessage('')
      setResult({ title: t('assistantSummaryTitle'), lines: summarizeText(researchBodyText(lastResearch.nodes), 3), asList: false })
      return
    }
    const pages = expandResearchOpts(lastResearch).pages
    const built = assembleResearch(lastResearch.sources, lang, { pages })
    const trueWords = computeDocumentStats({ type: 'doc', content: built.nodes }).words
    const meta = t('assistantResearchMeta')
      .replace('{w}', String(trueWords))
      .replace('{p}', String(estimateResearchPages(built.nodes)))
    const short = built.words < built.targetWords * 0.85 ? ` ${t('assistantResearchShort')}` : ''
    setPendingResearch(built.nodes as object[])
    const preview = built.nodes
      .map((n) => (n as { content?: { text?: string }[] }).content?.map((c) => c.text ?? '').join(' ') ?? '')
      .filter(Boolean).slice(0, 3)
    setResult({ title: lastResearch.sources[0].title, lines: preview, asList: false })
    setMessage(`${t('assistantPreviewReady')} ${meta}${short}`)
    setLastResearch({ ...lastResearch, pages, words: trueWords, nodes: built.nodes as object[] })
  }

  const runCommand = (raw: string) => {
    if (!raw.trim() || busy) return
    // A-01g behaviour learning, before any search: remember the
    // user's language, answer greetings/thanks socially, and ask
    // for clarification on pronoun-only questions with no topic.
    recordUserLanguage(raw)
    const replyLang = preferredReplyLanguage(raw) ?? lang
    const social = detectSocial(raw)
    if (social) {
      setResult(null)
      setMessage(tr(replyLang, social === 'greeting' ? 'assistantGreeting' : 'assistantThanksReply'))
      setCommand('')
      return
    }
    // A-04: a follow-up phrase acts on the last research when there
    // is one; with none yet it says so honestly instead of guessing.
    const follow = detectFollowUp(raw)
    if (follow) {
      if (!lastResearch) { setResult(null); setMessage(t('assistantFollowUpNoResearch')); setCommand(''); return }
      setVotedResult(false)
      doFollowUp(follow)
      setCommand('')
      return
    }
    setVotedResult(false)
    const action = parseAssistantCommand(raw)
    if (action.kind === 'answer') {
      setLastQuestion(action.question)
      if (isAmbiguousQuestion(raw, lastQuestion || null)) {
        setResult(null)
        setMessage(tr(replyLang, 'assistantClarifyPronoun'))
        setCommand('')
        return
      }
    }
    if (action.kind === 'research') void doResearch(action)
    else if (action.kind === 'answer') void doAnswer(action)
    else if (action.kind === 'answer-local') {
      setResult({ title: t('assistantAnswerTitle'), lines: action.lines, asList: false })
      setMessage('')
    } else execute(action)
    setCommand('')
  }

  // A-09: copy the result exactly as shown (list bullets included).
  const copyResult = () => {
    if (!result) return
    const text = formatResultLines(result.lines, result.asList)
    if (!text) return
    try {
      void navigator.clipboard?.writeText(text)
      setMessage(t('agentCopied'))
    } catch {
      setMessage(t('agentCopied'))
    }
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
        { label: 'agentChipQuestion', cmd: 'پایتخت فرانسه کجاست؟' },
        { label: 'agentChipResearch', cmd: 'درباره انرژی خورشیدی در اینترنت بگرد و دو صفحه بنویس' },
        { label: 'chipHelp', cmd: 'کمک' },
      ]
    : [
        { label: 'chipTable', cmd: 'make a table 3x4' }, { label: 'chipCover', cmd: 'make a cover page' },
        { label: 'chipEssay', cmd: 'essay template' }, { label: 'chipLetter', cmd: 'write a formal letter' },
        { label: 'chipCv', cmd: 'make a cv' }, { label: 'chipSummarize', cmd: 'summarize the document' },
        { label: 'chipKeyPoints', cmd: 'key points' }, { label: 'chipCleanup', cmd: 'clean up the text' },
        { label: 'agentChipQuestion', cmd: 'what is the capital of France?' },
        { label: 'agentChipResearch', cmd: 'research solar energy on the web and write two pages' },
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
      {busy && (
        <div className="find-meta assistant-message" role="status" dir="auto">
          {t('assistantSearching')}{busyKind ? ` — ${t(busyKind === 'answer' ? 'assistantResultAnswer' : 'assistantResultResearch')}` : ''}
        </div>
      )}
      <div className="find-row">
        <span className="find-preview-label">{t('assistantExamples')}</span>
        <div className="intelligence-actions">
          {CHIPS.map((chip) => (
            <button key={chip.label} type="button" className="rbtn small" disabled={busy} onClick={() => runCommand(chip.cmd)}>
              {t(chip.label)}
            </button>
          ))}
        </div>
      </div>
      {lastResearch && (
        <div className="find-row">
          <span className="find-preview-label" dir="auto">{t('assistantFollowUpTitle')}: {lastResearch.topic}</span>
          <div className="intelligence-actions">
            <button type="button" className="rbtn small" onClick={() => runCommand(lang === 'fa' ? 'بیشتر بنویس' : 'write more')}>
              {t('assistantFollowUpMore')}
            </button>
            <button type="button" className="rbtn small" onClick={() => runCommand(lang === 'fa' ? 'ادامه بده' : 'continue')}>
              {t('assistantFollowUpContinue')}
            </button>
            <button type="button" className="rbtn small" onClick={() => runCommand(lang === 'fa' ? 'خلاصه‌اش کن' : 'summarize it')}>
              {t('assistantFollowUpSummarize')}
            </button>
          </div>
        </div>
      )}
      {message && <div className="find-meta assistant-message" role="status" dir="auto">{message}</div>}
      {result && (
        <div className="intelligence-compare">
          <div className="find-preview-label">
            {result.kind && <span className="find-meta">{t(result.kind === 'answer' ? 'assistantResultAnswer' : 'assistantResultResearch')} · </span>}
            {result.title}
          </div>
          <div className="diff-line" dir="auto">
            {formatResultLines(result.lines, result.asList)}
          </div>
          <div className="find-row">
            <button type="button" className="rbtn small" onClick={insertResult}>{t('assistantInsertResult')}</button>
            <button type="button" className="rbtn small" onClick={copyResult}>{t('agentCopy')}</button>
          </div>
          {result.question && !votedResult && (
            <div className="find-row">
              <button type="button" className="rbtn small" onClick={() => voteResult(true)}>{t('assistantFeedbackUseful')}</button>
              <button type="button" className="rbtn small" onClick={() => voteResult(false)}>{t('assistantFeedbackNotUseful')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
