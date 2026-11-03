// Vyro Assistant engine contract (owner order 2026-11-03): the app's
// OWN assistant — no external AI, no network. Commands in Persian/Dari
// and English parse into editor actions; the summarizer only ever
// returns the document's own sentences; templates are structures with
// placeholders, never invented content.
import { describe, it, expect } from 'vitest'
import {
  parseAssistantCommand, cleanupText, summarizeText, keyPoints,
  buildTemplate, buildResearchDoc, assembleResearch, parseSections, cleanWikiText,
  buildAnswer, searchQueryFor, normalizeDigits, splitSentences,
} from './assistant'

describe('assistant command parsing — create/build', () => {
  it('parses a Persian table command with Persian digits', () => {
    expect(parseAssistantCommand('یک جدول ۳×۴ بساز')).toEqual({ kind: 'insert-table', rows: 3, cols: 4 })
  })
  it('parses an English table command', () => {
    expect(parseAssistantCommand('insert a table 5x2')).toEqual({ kind: 'insert-table', rows: 5, cols: 2 })
  })
  it('defaults and clamps table sizes', () => {
    expect(parseAssistantCommand('جدول بساز')).toEqual({ kind: 'insert-table', rows: 3, cols: 3 })
    const big = parseAssistantCommand('جدول 99 در 99')
    expect(big.kind).toBe('insert-table')
    if (big.kind === 'insert-table') { expect(big.rows).toBeLessThanOrEqual(15); expect(big.cols).toBeLessThanOrEqual(8) }
  })
  it('parses templates: cover, letter, cv', () => {
    expect(parseAssistantCommand('صفحه عنوان اساینمنت بساز')).toEqual({ kind: 'insert-template', template: 'cover' })
    expect(parseAssistantCommand('یک نامه رسمی بنویس')).toEqual({ kind: 'insert-template', template: 'letter' })
    expect(parseAssistantCommand('سی وی بساز')).toEqual({ kind: 'insert-template', template: 'cv' })
  })
  it('turns a free-writing request into the essay template with its topic — never invented prose', () => {
    const a = parseAssistantCommand('مقاله درباره آلودگی هوا بنویس')
    expect(a.kind).toBe('insert-template')
    if (a.kind === 'insert-template') { expect(a.template).toBe('essay'); expect(a.topic).toContain('آلودگی هوا') }
  })
  it('parses heading with literal text after a colon', () => {
    expect(parseAssistantCommand('تیتر: فصل اول')).toEqual({ kind: 'insert-heading', level: 1, text: 'فصل اول' })
  })
  it('parses lists with items and ordered variant', () => {
    const a = parseAssistantCommand('فهرست: سیب، موز، انگور')
    expect(a.kind).toBe('insert-list')
    if (a.kind === 'insert-list') { expect(a.ordered).toBe(false); expect(a.items).toEqual(['سیب', 'موز', 'انگور']) }
    const b = parseAssistantCommand('یک فهرست شماره‌دار بساز')
    expect(b.kind).toBe('insert-list')
    if (b.kind === 'insert-list') expect(b.ordered).toBe(true)
  })
  it('parses page break and date', () => {
    expect(parseAssistantCommand('صفحه جدید بگذار')).toEqual({ kind: 'insert-page-break' })
    expect(parseAssistantCommand('تاریخ امروز را بنویس')).toEqual({ kind: 'insert-date' })
  })
  it('parses a literal write command verbatim', () => {
    expect(parseAssistantCommand('بنویس: سلام دنیا')).toEqual({ kind: 'insert-text', text: 'سلام دنیا' })
  })
})

describe('assistant command parsing — selection & document ops', () => {
  it('parses selection transforms', () => {
    expect(parseAssistantCommand('تیترش کن')).toEqual({ kind: 'selection-heading', level: 1 })
    expect(parseAssistantCommand('درشتش کن')).toEqual({ kind: 'selection-bold' })
    expect(parseAssistantCommand('متن را تمیز کن')).toEqual({ kind: 'selection-cleanup' })
    expect(parseAssistantCommand('این پاراگراف را خلاصه کن')).toEqual({ kind: 'selection-summarize' })
  })
  it('parses document ops and help', () => {
    expect(parseAssistantCommand('سند را خلاصه کن')).toEqual({ kind: 'document-summarize' })
    expect(parseAssistantCommand('نکات کلیدی سند را بگو')).toEqual({ kind: 'document-keypoints' })
    expect(parseAssistantCommand('این سند چند کلمه است')).toEqual({ kind: 'document-stats' })
    expect(parseAssistantCommand('کمک')).toEqual({ kind: 'help' })
  })
  it('returns unknown for things it cannot do — honestly, no fake action', () => {
    expect(parseAssistantCommand('آب و هوا امروز چطور است').kind).toBe('unknown')
    expect(parseAssistantCommand('').kind).toBe('unknown')
  })
})

describe('assistant web research (owner order 2026-11-03)', () => {
  it('parses a Persian research command and extracts the topic', () => {
    const a = parseAssistantCommand('درباره آلودگی هوا در اینترنت بگرد و بنویس')
    expect(a.kind).toBe('research')
    if (a.kind === 'research') { expect(a.topic).toBe('آلودگی هوا'); expect(a.paragraphs).toBe(3) }
  })
  it('parses an English research command and a paragraph count', () => {
    const a = parseAssistantCommand('search the web for climate change and write 5 paragraphs')
    expect(a.kind).toBe('research')
    if (a.kind === 'research') { expect(a.topic).toBe('climate change'); expect(a.paragraphs).toBe(5) }
  })
  it('a plain essay request without the web stays a local template', () => {
    expect(parseAssistantCommand('مقاله درباره آلودگی هوا بنویس').kind).toBe('insert-template')
  })
  it('parses page counts — digits and Persian number words (owner: write as many pages as asked)', () => {
    const a = parseAssistantCommand('درباره انرژی خورشیدی در اینترنت بگرد و ۲ صفحه بنویس')
    expect(a.kind).toBe('research')
    if (a.kind === 'research') { expect(a.pages).toBe(2); expect(a.topic).toContain('انرژی خورشیدی') }
    const b = parseAssistantCommand('درباره تاریخ افغانستان در اینترنت تحقیق کن و بیست صفحه بنویس')
    expect(b.kind).toBe('research')
    if (b.kind === 'research') expect(b.pages).toBe(20)
    const c = parseAssistantCommand('search the web for gravity and write 1 page')
    expect(c.kind).toBe('research')
    if (c.kind === 'research') expect(c.pages).toBe(1)
  })
  it('assembleResearch fills the requested page length from several sources and credits them all', () => {
    const mk = (n: number, title: string, url: string) => ({
      title, url, extract: Array.from({ length: n }, (_, i) => `این جمله شماره ${i + 1} درباره ${title} است و اطلاعات مهمی درباره آن می دهد و شرح می کند.`).join(' '),
    })
    const one = mk(30, 'موضوع الف', 'https://fa.wikipedia.org/wiki/A')
    const two = mk(30, 'موضوع ب', 'https://fa.wikipedia.org/wiki/B')
    const out = assembleResearch([one, two], 'fa', { pages: 2 })
    expect(out.targetWords).toBe(600)
    expect(out.words).toBeGreaterThanOrEqual(480)
    const all = JSON.stringify(out.nodes)
    expect(all).toContain('منابع:')
    expect(all).toContain('https://fa.wikipedia.org/wiki/A')
    expect(all).toContain('https://fa.wikipedia.org/wiki/B')
  })
  it('assembleResearch is honestly shorter when sources run out — never padded', () => {
    const small = { title: 'کوچک', url: 'https://fa.wikipedia.org/wiki/S', extract: 'یک جمله کوتاه است. جمله دوم هم هست. و جمله سوم.' }
    const out = assembleResearch([small], 'fa', { pages: 10 })
    expect(out.words).toBeLessThan(out.targetWords)
  })
  it('obeys the user about typing into the document (owner: طبق درخواست کاربر)', () => {
    const show = parseAssistantCommand('درباره انرژی خورشیدی در اینترنت بگرد و بنویس، فقط نشان بده تایپ نکن')
    expect(show.kind).toBe('research')
    if (show.kind === 'research') { expect(show.insert).toBe(false); expect(show.topic).toContain('انرژی خورشیدی') }
    const type = parseAssistantCommand('درباره انرژی خورشیدی در اینترنت بگرد و در سند بنویس')
    expect(type.kind).toBe('research')
    if (type.kind === 'research') expect(type.insert).toBe(true)
  })
  it('parseSections reads a wiki extract’s real sections; cleanWikiText strips markup', () => {
    const extract = "مقدمه درباره '''موضوع''' است و [[پیوند|شرح]] دارد.[۲]\n== بخش اول ==\nمتن بخش اول اینجاست و ادامه دارد.\n== بخش دوم ==\nمتن بخش دوم هم اینجاست."
    const sections = parseSections(extract)
    expect(sections.length).toBe(3)
    expect(sections[0].heading).toBeNull()
    expect(sections[0].text).toContain('موضوع')
    expect(sections[0].text).not.toContain("'''")
    expect(sections[0].text).not.toContain('[۲]')
    expect(sections[1].heading).toBe('بخش اول')
    expect(sections[2].heading).toBe('بخش دوم')
    expect(cleanWikiText("'''پررنگ''' و [[الف|ب]]")).toBe('پررنگ و ب')
  })
  it('assembleResearch uses the article’s real section headings and reports the TRUE word count', () => {
    const s = 'این جمله کامل درباره موضوع اصلی است و اطلاعات دقیق و مهمی ارائه می کند.'
    const extract = [
      `${s} ${s.replace('اصلی', 'دوم')}`,
      '== تاریخچه ==',
      Array.from({ length: 8 }, (_, i) => s.replace('کامل', `کامل${i}`)).join(' '),
      '== کاربردها ==',
      Array.from({ length: 8 }, (_, i) => s.replace('دقیق', `دقیق${i}`)).join(' '),
    ].join('\n')
    const out = assembleResearch([{ title: 'موضوع', url: 'https://fa.wikipedia.org/wiki/X', extract }], 'fa', { pages: 1 })
    const types = out.nodes.map((n) => n.type)
    expect(types).toContain('heading')
    const texts = JSON.stringify(out.nodes)
    expect(texts).toContain('تاریخچه')
    const actual = out.nodes
      .map((n) => ((n.content as { text?: string }[] | undefined) ?? []).map((c) => c.text ?? '').join(' '))
      .join(' ').split(/[^\p{L}\p{N}\u200C]+/u).filter((t) => t.length > 0).length
    expect(out.words).toBe(actual)
  })
  it('topic extraction survives commas and no-type words (live failure 2026-11-03)', () => {
    const a = parseAssistantCommand('درباره انرژی خورشیدی در اینترنت بگرد و بنویس، فقط نشان بده تایپ نکن')
    expect(a.kind).toBe('research')
    if (a.kind === 'research') {
      expect(a.topic).toBe('انرژی خورشیدی')
      expect(a.insert).toBe(false)
    }
  })
  it('answers ANY free-form question — not just preset commands (owner order)', () => {
    expect(parseAssistantCommand('پایتخت فرانسه کجاست؟').kind).toBe('answer')
    expect(parseAssistantCommand('چرا آسمان آبی است؟').kind).toBe('answer')
    expect(parseAssistantCommand('what is the capital of France?').kind).toBe('answer')
    expect(searchQueryFor('پایتخت فرانسه کجاست؟')).toBe('پایتخت فرانسه')
    expect(searchQueryFor('چرا آسمان آبی است؟')).toBe('آسمان آبی')
    // …while build commands are never hijacked:
    expect(parseAssistantCommand('جدول ۳×۴ بساز').kind).toBe('insert-table')
    expect(parseAssistantCommand('درباره آب در اینترنت بگرد و بنویس').kind).toBe('research')
  })
  it('computes simple arithmetic itself, instantly, with no internet', () => {
    const a = parseAssistantCommand('۲۵ × ۴ چند می‌شود؟')
    expect(a.kind).toBe('answer-local')
    if (a.kind === 'answer-local') expect(a.lines[0]).toContain('= 100')
    const p = parseAssistantCommand('۲۰ درصد از ۵۰۰ چند می‌شود؟')
    expect(p.kind).toBe('answer-local')
    if (p.kind === 'answer-local') expect(p.lines[0]).toContain('= 100')
  })
  it('buildAnswer picks the sentences matching the question and credits the source', () => {
    const src = [{
      title: 'پاریس', url: 'https://fa.wikipedia.org/wiki/Paris',
      extract: 'پاریس پایتخت و پرجمعیت ترین شهر فرانسه است و در شمال این کشور قرار دارد. رود سن از میان این شهر می گذرد و زیبایی آن را دوچندان می کند. برج ایفل نماد معروف این شهر در جهان شناخته می شود.',
    }]
    const ans = buildAnswer(src, 'پایتخت فرانسه کجاست؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines[0]).toContain('پایتخت')
    expect(ans.lines[ans.lines.length - 1]).toContain('منبع: ویکی‌پدیا')
    const none = buildAnswer(src, 'قیمت دلار امروز چند است؟', 'fa')
    expect(none.found).toBe(false)
  })
  it('buildResearchDoc assembles title, lead, body — and ALWAYS the source line', () => {
    const extract = 'آلودگی هوا یک مشکل بزرگ است. دود کارخانه ها هوا را خراب می کند. مردم مریض می شوند. دولت ها باید قانون بگذارند. در شهرهای بزرگ ترافیک زیاد است. کودکان بیشتر آسیب می بینند. انرژی پاک یک راه حل است.'
    const nodes = buildResearchDoc({ title: 'آلودگی هوا', extract, url: 'https://fa.wikipedia.org/wiki/X' }, 'fa', 2)
    const all = JSON.stringify(nodes)
    expect(nodes[0].type).toBe('heading')
    expect(all).toContain('منبع: ویکی‌پدیا')
    expect(all).toContain('https://fa.wikipedia.org/wiki/X')
    // every body sentence comes from the source extract — nothing invented
    expect(all).toContain('آلودگی هوا یک مشکل بزرگ است')
  })
})

describe('assistant text algorithms', () => {
  it('normalizes Persian and Arabic digits', () => {
    expect(normalizeDigits('۳٤۵')).toBe('345')
  })
  it('cleanup fixes spacing and punctuation', () => {
    expect(cleanupText('سلام  دنیا ،خوبی ؟')).toBe('سلام دنیا، خوبی؟')
    expect(cleanupText('a\n\n\n\nb')).toBe('a\n\nb')
  })
  it('splits sentences on Persian and Latin terminators', () => {
    expect(splitSentences('اول است. دوم است؟ سوم است!')).toHaveLength(3)
  })
  it('summary returns ONLY sentences from the source, at most the cap', () => {
    const doc = 'گربه حیوان خانگی است. گربه ها مستقل هستند. ماهی در آب زندگی می کند. گربه از قدیم کنار انسان بوده است. پرنده ها پرواز می کنند.'
    const sum = summarizeText(doc, 2)
    expect(sum.length).toBe(2)
    for (const s of sum) expect(doc).toContain(s)
    expect(keyPoints(doc, 3).length).toBe(3)
  })
  it('summary of a short text returns it whole', () => {
    expect(summarizeText('یک جمله تنها.', 3)).toEqual(['یک جمله تنها.'])
  })
})

describe('assistant templates', () => {
  it('builds TipTap JSON structures with placeholders, in both languages', () => {
    const cover = buildTemplate('cover', 'fa')
    expect(cover[0].type).toBe('heading')
    const cv = buildTemplate('cv', 'en')
    expect(JSON.stringify(cv)).toContain('Education')
    const essay = buildTemplate('essay', 'fa', 'آلودگی هوا')
    expect(JSON.stringify(essay)).toContain('آلودگی هوا')
  })
  it('no template contains invented essay prose — placeholders only', () => {
    for (const kind of ['cover', 'letter', 'cv', 'essay'] as const) {
      const json = JSON.stringify(buildTemplate(kind, 'fa'))
      expect(json.length).toBeLessThan(1200)
    }
  })
})
