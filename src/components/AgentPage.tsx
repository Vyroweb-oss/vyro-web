import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import {
  parseAssistantCommand, cleanupText, summarizeText, keyPoints,
  assembleResearch, buildAnswer, searchQueryFor, estimateResearchPages,
  subQuestionQueries, refineQuery, assembleThoughtAnswer, findNumericConflict,
  detectFollowUp, expandResearchOpts, researchBodyText,
  type AssistantAction, type ResearchData,
} from '../lib/assistant'
import { nodesForBuildAction, linesToNodes, nodesToText } from '../lib/agentPage'
import { computeDocumentStats } from '../lib/stats'
import { supabase } from '../lib/supabase'
import {
  recordFeedback, feedbackPreference, applyDetailPreference, countAnswerWords,
  recordWeakQuestion, getWeakQuestions, clearWeakQuestions,
  recordUserLanguage, preferredReplyLanguage, detectSocial, isAmbiguousQuestion,
  type WeakEntry,
} from '../lib/assistantLearning'

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
  // A-01g: the question behind an answer, so feedback and the local
  // weak list can attach to it (never leaves this device).
  question?: string
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
  // A-01g learning from users (local only): voted answer ids and the
  // device-local weak-question list shown on this page.
  const [voted, setVoted] = useState<number[]>([])
  const [weakList, setWeakList] = useState<WeakEntry[]>([])
  // A-04 follow-up context: the last research (topic + its SAME
  // sources + nodes), so «بیشتر بنویس» / «ادامه بده» /
  // «خلاصه‌اش کن» act on it without a new search.
  const [lastResearch, setLastResearch] = useState<{
    topic: string; pages?: number; paragraphs?: number; words: number
    sources: ResearchData[]; nodes: object[]
  } | null>(null)
  const refreshWeak = () => setWeakList(getWeakQuestions())
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

  useEffect(() => { refreshWeak() }, [entries])

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
      setLastResearch({ topic: action.topic, pages: action.pages, paragraphs: action.paragraphs, words: trueWords, sources, nodes: built.nodes as object[] })
      // The Agent page ALWAYS prepares the result here first (it is the
      // one place for requests); inserting or creating a document is
      // the user's tap on the result's own buttons.
      push({ from: 'agent', title: sources[0].title, text: `${meta}${short}`, nodes: built.nodes as object[] })
    } finally {
      setBusy(false)
    }
  }

  // A-01f thinking brain: multi-part questions are decomposed and
  // each part answered in turn (with up to 3 search hops per part),
  // then assembled in reasoning order with unanswered parts named
  // honestly; single quantity/date questions get a cross-check that
  // shows a disagreement instead of silently picking one number.
  const doAnswer = async (action: Extract<AssistantAction, { kind: 'answer' }>) => {
    setBusy(true)
    try {
      // A-01g: a Dari-speaking user's question is searched and
      // answered in Dari even when the UI language is English.
      const qLang = preferredReplyLanguage(action.question) ?? lang
      const subs = subQuestionQueries(action.question)
      if (subs.length === 1) {
        const sources = await fetchSources({ query: searchQueryFor(action.question), lang: qLang, pages: 1, mode: 'answer' })
        if (typeof sources === 'string') {
          if (sources === 'notfound') recordWeakQuestion(action.question, 'not-found')
          push({ from: 'agent', text: failText(sources) }); return
        }
        const conflict = findNumericConflict(sources, action.question, qLang)
        if (conflict) { push({ from: 'agent', title: t('assistantAnswerTitle'), lines: applyDetailPreference(conflict, feedbackPreference()), question: action.question }); return }
        const answer = buildAnswer(sources, action.question, qLang)
        if (!answer.found) { recordWeakQuestion(action.question, 'not-found'); push({ from: 'agent', text: t('assistantAnswerNotFound') }); return }
        push({ from: 'agent', title: t('assistantAnswerTitle'), lines: applyDetailPreference(answer.lines, feedbackPreference()), question: action.question })
        return
      }
      const results: { question: string; lines: string[]; found: boolean }[] = []
      for (const sub of subs) {
        let sources = await fetchSources({ query: searchQueryFor(sub.query), lang: qLang, pages: 1, mode: 'answer' })
        if (typeof sources === 'string') {
          if (sources === 'notfound') { results.push({ question: sub.question, lines: [], found: false }); continue }
          push({ from: 'agent', text: failText(sources) }); return
        }
        let answer = buildAnswer(sources, sub.query, qLang)
        const tried = new Set([searchQueryFor(sub.query)])
        let attempts = 1
        while (!answer.found && attempts < 3) {
          const refined = refineQuery(sub.query, sources.map((s) => s.title))
          if (tried.has(refined)) break
          tried.add(refined)
          attempts += 1
          const next = await fetchSources({ query: refined, lang: qLang, pages: 1, mode: 'answer' })
          if (typeof next === 'string') break
          sources = next
          answer = buildAnswer(sources, refined, qLang)
        }
        results.push({ question: sub.question, lines: answer.lines, found: answer.found })
      }
      const assembled = assembleThoughtAnswer(results, qLang)
      if (!assembled.found) {
        for (const r of results) if (!r.found) recordWeakQuestion(r.question, 'not-found')
        push({ from: 'agent', text: t('assistantAnswerNotFound') }); return
      }
      push({ from: 'agent', title: t('assistantAnswerTitle'), lines: applyDetailPreference(assembled.lines, feedbackPreference()), question: action.question })
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

  // A-01g: feedback on an answer is stored locally; a «not helpful»
  // vote also mines the question into the device-local weak list.
  const vote = (e: Entry, useful: boolean) => {
    if (!e.question || !e.lines) return
    recordFeedback(e.question, useful, countAnswerWords(e.lines))
    if (!useful) recordWeakQuestion(e.question, 'generic')
    setVoted((prev) => [...prev, e.id])
    refreshWeak()
    setNotice(t('assistantFeedbackThanks'))
  }

  // A-04 follow-up on the last research: expand re-assembles from
  // the SAME sources with a larger page target (no new search, no
  // invented text — the short note says so if the sources run out);
  // summarize extracts the draft's own body sentences. The result is
  // prepared here first, like every Agent-page result: nothing is
  // typed into a document until the user taps insert or create.
  const doFollowUp = (kind: 'expand' | 'summarize') => {
    if (!lastResearch) return
    if (kind === 'summarize') {
      push({ from: 'agent', title: t('assistantSummaryTitle'), lines: summarizeText(researchBodyText(lastResearch.nodes), 3) })
      return
    }
    const pages = expandResearchOpts(lastResearch).pages
    const built = assembleResearch(lastResearch.sources, lang, { pages })
    const trueWords = computeDocumentStats({ type: 'doc', content: built.nodes }).words
    const meta = t('assistantResearchMeta')
      .replace('{w}', String(trueWords))
      .replace('{p}', String(estimateResearchPages(built.nodes)))
    const short = built.words < built.targetWords * 0.85 ? ` ${t('assistantResearchShort')}` : ''
    push({ from: 'agent', title: lastResearch.sources[0].title, text: `${meta}${short}`, nodes: built.nodes as object[] })
    setLastResearch({ ...lastResearch, pages, words: trueWords, nodes: built.nodes as object[] })
  }

  const runCommand = (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    push({ from: 'user', text })
    setInput('')
    // A-01g behaviour learning, before any search: the user's own
    // wording is remembered on this device; greetings/thanks get a
    // social reply (never a search); a pronoun-only question with
    // no prior topic gets a short clarification, never a guess.
    recordUserLanguage(text)
    const replyLang = preferredReplyLanguage(text) ?? lang
    const social = detectSocial(text)
    if (social) { push({ from: 'agent', text: tr(replyLang, social === 'greeting' ? 'assistantGreeting' : 'assistantThanksReply') }); return }
    // A-04: a follow-up phrase acts on the last research when there
    // is one; with none yet it says so honestly instead of guessing.
    const follow = detectFollowUp(text)
    if (follow) {
      if (!lastResearch) { push({ from: 'agent', text: t('assistantFollowUpNoResearch') }); return }
      doFollowUp(follow)
      return
    }
    const action = parseAssistantCommand(text)
    if (action.kind === 'answer') {
      const lastTopic = [...entries].reverse().find((e) => e.question)?.question ?? null
      if (isAmbiguousQuestion(text, lastTopic)) { push({ from: 'agent', text: tr(replyLang, 'assistantClarifyPronoun') }); return }
    }
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
                  {e.lines && e.question && !voted.includes(e.id) && (
                    <div className="agent-entry-actions">
                      <button type="button" className="rbtn small" onClick={() => vote(e, true)}>{t('assistantFeedbackUseful')}</button>
                      <button type="button" className="rbtn small" onClick={() => vote(e, false)}>{t('assistantFeedbackNotUseful')}</button>
                    </div>
                  )}
                </>}
          </div>
        ))}
        {busy && <div className="agent-entry agent" role="status">{t('assistantSearching')}</div>}
      </div>
      {weakList.length > 0 && (
        <div className="agent-chips">
          <span className="find-preview-label">{t('assistantWeakTitle')}</span>
          <div className="intelligence-actions">
            {weakList.map((w) => (
              <span key={w.q} className="find-meta" dir="auto">{w.q}</span>
            ))}
            <button type="button" className="rbtn small" onClick={() => { clearWeakQuestions(); refreshWeak() }}>{t('assistantWeakClear')}</button>
          </div>
        </div>
      )}
      {lastResearch && (
        <div className="agent-chips">
          <span className="find-preview-label" dir="auto">{t('assistantFollowUpTitle')}: {lastResearch.topic}</span>
          <div className="intelligence-actions">
            <button type="button" className="rbtn small" disabled={busy} onClick={() => runCommand(lang === 'fa' ? 'بیشتر بنویس' : 'write more')}>
              {t('assistantFollowUpMore')}
            </button>
            <button type="button" className="rbtn small" disabled={busy} onClick={() => runCommand(lang === 'fa' ? 'ادامه بده' : 'continue')}>
              {t('assistantFollowUpContinue')}
            </button>
            <button type="button" className="rbtn small" disabled={busy} onClick={() => runCommand(lang === 'fa' ? 'خلاصه‌اش کن' : 'summarize it')}>
              {t('assistantFollowUpSummarize')}
            </button>
          </div>
        </div>
      )}
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
