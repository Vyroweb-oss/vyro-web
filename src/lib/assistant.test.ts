// Vyro Assistant engine contract (owner order 2026-11-03): the app's
// OWN assistant — no external AI, no network. Commands in Persian/Dari
// and English parse into editor actions; the summarizer only ever
// returns the document's own sentences; templates are structures with
// placeholders, never invented content.
import { describe, it, expect } from 'vitest'
import {
  parseAssistantCommand, cleanupText, normalizeDariText, cleanupDocJson, summarizeText, keyPoints,
  formalizeText, shortenText,
  buildTemplate, buildResearchDoc, assembleResearch, parseSections, cleanWikiText,
  buildAnswer, searchQueryFor, normalizeDigits, splitSentences, sourceSiteName,
  isRankingOrCurrentQuestion, estimateResearchPages,
  analyzeQuestion, sentenceMatchesQuestionType, searchQueriesFor,
  decomposeQuestion, subQuestionQueries, refineQuery, assembleThoughtAnswer, findNumericConflict,
  detectFollowUp, expandResearchOpts, researchBodyText,
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
  it('routes free-form questions WITHOUT «؟» to answer (A-01e5: the ASCII-\\b hole)', () => {
    expect(parseAssistantCommand('کدام هوش مصنوعی در کدنویسی قوی‌تر است').kind).toBe('answer')
    expect(parseAssistantCommand('هوش مصنوعی قوی‌تر در کدنویسی کدام است').kind).toBe('answer')
    expect(parseAssistantCommand('پایتخت فرانسه چیست').kind).toBe('answer')
    expect(parseAssistantCommand('نویسنده شاهنامه کیست').kind).toBe('answer')
    expect(parseAssistantCommand('What is the capital of France').kind).toBe('answer')
    expect(parseAssistantCommand('آب و هوا امروز چطور است').kind).toBe('answer')
    // Known commands are matched earlier and still win.
    expect(parseAssistantCommand('یک جدول ۳×۴ بساز').kind).toBe('insert-table')
    // A plain statement with no question word or mark stays unknown.
    expect(parseAssistantCommand('رنگ مورد علاقه من آبی است').kind).toBe('unknown')
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
    // A-01e5: «آب و هوا امروز چطور است» used to sit here as 'unknown',
    // but that only documented the ASCII-\b hole — under the owner's
    // any-question order it is a question and routes to 'answer'
    // (pinned in the A-01e5 test above). A bare statement stays unknown.
    expect(parseAssistantCommand('رنگ مورد علاقه من آبی است').kind).toBe('unknown')
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
  it('buildAnswer NEVER answers a France question from a Korea article (live failure 2026-11-03)', () => {
    const korea = [{
      title: 'پایتخت کره', url: 'https://fa.wikipedia.org/wiki/KoreaCapitals',
      extract: 'پایتخت کره به پیشینه تاریخی آن سرزمین بستگی دارد که در طول تاریخ تغییر کرده است. کره شبه جزیره ای در شرق آسیا است که از دو کشور کره شمالی و کره جنوبی تشکیل شده است.',
    }]
    expect(buildAnswer(korea, 'پایتخت فرانسه کجاست؟', 'fa').found).toBe(false)
    const france = [{
      title: 'فرانسه', url: 'https://fa.wikipedia.org/wiki/France',
      extract: 'فرانسه کشوری در اروپای غربی است و پایتخت آن شهر پاریس می باشد. این کشور از اعضای بنیانگذار اتحادیه اروپا به شمار می رود و نقش مهمی در تاریخ اروپا داشته است.',
    }]
    const ans = buildAnswer([...korea, ...france], 'پایتخت فرانسه کجاست؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines.join(' ')).toContain('فرانسه')
    expect(ans.lines.join(' ')).not.toContain('کره')
  })
  it('A-01c fallback: Shahnameh author answered via the top source + نویسنده/اثر synonym', () => {
    const shahnameh = [{
      title: 'شاهنامه', url: 'https://fa.wikipedia.org/wiki/Shahnameh',
      extract: 'شاهنامه اثر حکیم ابوالقاسم فردوسی توسی است و از بزرگ‌ترین آثار حماسی جهان به شمار می‌رود. شاهنامه کتابی حماسی است که داستان‌های پهلوانان ایران را روایت می‌کند.',
    }]
    const ans = buildAnswer(shahnameh, 'نویسنده شاهنامه کیست؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines[0]).toContain('فردوسی')
    expect(ans.lines[ans.lines.length - 1]).toContain('منبع: ویکی‌پدیا')
    // EN mirror: wrote/written synonym, top source only.
    const hamlet = [{
      title: 'Hamlet', url: 'https://en.wikipedia.org/wiki/Hamlet',
      extract: 'Hamlet is a tragedy written by William Shakespeare. It is one of the most famous plays in English literature.',
    }]
    const en = buildAnswer(hamlet, 'Who wrote Hamlet?', 'en')
    expect(en.found).toBe(true)
    expect(en.lines[0]).toContain('Shakespeare')
  })
  it('assembleResearch balances sections — a huge lead cannot eat the whole document', () => {
    const s = (tag: string) => `این جمله درباره ${tag} است و اطلاعات مهم و دقیقی درباره آن ارائه می کند و شرح می دهد.`
    const extract = [
      Array.from({ length: 40 }, (_, i) => s(`مقدمه ${i}`)).join(' '),
      '== بخش الف ==',
      Array.from({ length: 10 }, (_, i) => s(`الف ${i}`)).join(' '),
      '== بخش ب ==',
      Array.from({ length: 10 }, (_, i) => s(`ب ${i}`)).join(' '),
    ].join('\n')
    const out = assembleResearch([{ title: 'موضوع', url: 'https://fa.wikipedia.org/wiki/X', extract }], 'fa', { pages: 2 })
    const headings = out.nodes.filter((n) => n.type === 'heading')
    expect(headings.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(out.nodes)).toContain('بخش الف')
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

describe('A-01d whole-web search (owner order 2026-11-03: any question from anywhere on the internet)', () => {
  it('answers the owner’s exact question from a web source when Wikipedia does not answer it', () => {
    const wiki = [{
      title: 'رایانه', url: 'https://fa.wikipedia.org/wiki/Computer',
      extract: 'رایانه دستگاهی الکترونیکی است که داده‌ها را پردازش می‌کند. پژوهشگران سامانه‌های رایانه‌ای می‌سازند و آنها را بهبود می‌دهند.',
    }]
    const web = [{
      title: 'بهترین هوش مصنوعی برای کدنویسی', url: 'https://example-blog.com/ai-coding', site: 'Example Blog',
      extract: 'ابزار ایکس قوی‌ترین هوش مصنوعی در کدنویسی است و برنامه‌نویسان بسیاری از آن استفاده می‌کنند. این ابزار کدهای پیچیده را سریع و دقیق می‌نویسد و خطاها را هم پیدا می‌کند.',
    }]
    const ans = buildAnswer([...wiki, ...web], 'کدام هوش مصنوعی در کدنویسی قوی‌تر است؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines.join(' ')).toContain('قوی‌ترین هوش مصنوعی در کدنویسی')
    expect(ans.lines[ans.lines.length - 1]).toContain('Example Blog')
    expect(ans.lines[ans.lines.length - 1]).toContain('https://example-blog.com/ai-coding')
    expect(ans.lines.join(' ')).not.toContain('ویکی‌پدیا')
  })
  it('assembleResearch lists BOTH a Wikipedia credit and a web site credit', () => {
    const s = (tag: string) => `این جمله درباره ${tag} است و اطلاعات مهم و دقیقی درباره آن ارائه می کند و شرح می دهد.`
    const wiki = { title: 'موضوع', url: 'https://fa.wikipedia.org/wiki/X', extract: Array.from({ length: 10 }, (_, i) => s(`ویکی ${i}`)).join(' ') }
    const web = { title: 'مقاله وب', url: 'https://example-blog.com/post', site: 'Example Blog', extract: Array.from({ length: 10 }, (_, i) => s(`وب ${i}`)).join(' ') }
    const out = assembleResearch([wiki, web], 'fa', { pages: 1 })
    const all = JSON.stringify(out.nodes)
    expect(all).toContain('منابع:')
    expect(all).toContain('ویکی‌پدیا — https://fa.wikipedia.org/wiki/X')
    expect(all).toContain('Example Blog — https://example-blog.com/post')
  })
  it('France/Korea guard survives: a Wikipedia secondary source is never rescued by the web fallback', () => {
    const generic = [{
      title: 'رایانه', url: 'https://fa.wikipedia.org/wiki/Computer',
      extract: 'رایانه دستگاهی الکترونیکی است که داده‌ها را پردازش می‌کند. پژوهشگران سامانه‌های رایانه‌ای می‌سازند و آنها را بهبود می‌دهند.',
    }]
    const korea = [{
      title: 'پایتخت کره', url: 'https://fa.wikipedia.org/wiki/KoreaCapitals',
      extract: 'پایتخت کره به پیشینه تاریخی آن سرزمین بستگی دارد که در طول تاریخ تغییر کرده است. کره شبه جزیره ای در شرق آسیا است که از دو کشور کره شمالی و کره جنوبی تشکیل شده است.',
    }]
    expect(buildAnswer([...generic, ...korea], 'پایتخت فرانسه کجاست؟', 'fa').found).toBe(false)
  })
  it('Shahnameh author case still passes after the web fallback was added', () => {
    const shahnameh = [{
      title: 'شاهنامه', url: 'https://fa.wikipedia.org/wiki/Shahnameh',
      extract: 'شاهنامه اثر حکیم ابوالقاسم فردوسی توسی است و از بزرگ‌ترین آثار حماسی جهان به شمار می‌رود. شاهنامه کتابی حماسی است که داستان‌های پهلوانان ایران را روایت می‌کند.',
    }]
    const ans = buildAnswer(shahnameh, 'نویسنده شاهنامه کیست؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines[0]).toContain('فردوسی')
  })
  it('a nonsense question against non-matching wiki + web sources still honestly returns not-found', () => {
    const wiki = [{
      title: 'رایانه', url: 'https://fa.wikipedia.org/wiki/Computer',
      extract: 'رایانه دستگاهی الکترونیکی است که داده‌ها را پردازش می‌کند. پژوهشگران سامانه‌های رایانه‌ای می‌سازند و آنها را بهبود می‌دهند.',
    }]
    const web = [{
      title: 'آشپزی خانگی', url: 'https://example-blog.com/cooking', site: 'Example Blog',
      extract: 'آشپزی خانگی غذایی سالم و خوشمزه به سفره می‌آورد. آشپزهای خانگی سبزی تازه و ادویه خوشبو به کار می‌برند و غذاهای سنتی می‌پزند.',
    }]
    expect(buildAnswer([...wiki, ...web], 'قیمت دلار امروز چند است؟', 'fa').found).toBe(false)
  })
  it('isRankingOrCurrentQuestion detects ranking/comparison/current questions only', () => {
    expect(isRankingOrCurrentQuestion('کدام هوش مصنوعی در کدنویسی قوی‌تر است؟')).toBe(true)
    expect(isRankingOrCurrentQuestion('What is the best AI for coding?')).toBe(true)
    expect(isRankingOrCurrentQuestion('پایتخت فرانسه کجاست؟')).toBe(false)
    expect(isRankingOrCurrentQuestion('نویسنده شاهنامه کیست؟')).toBe(false)
    expect(isRankingOrCurrentQuestion('قیمت دلار امروز چند است؟')).toBe(false)
  })
})

describe('A-01d2 ranking preference (live failure 2026-11-03: generic wiki match pre-empted the web answer)', () => {
  const QUESTION = 'کدام هوش مصنوعی در کدنویسی قوی‌تر است؟'
  const genericWiki = [{
    title: 'کلاد', url: 'https://fa.wikipedia.org/wiki/Claude',
    extract: 'کلاد یک چت‌بات هوش مصنوعی است که قابلیت نوشتن، کدنویسی و گفتگو دارد. کاربران از کلاد برای پرسش و پاسخ روزمره استفاده می‌کنند و پاسخ‌های طولانی دریافت می‌نمایند.',
  }]
  const webWinner = [{
    title: 'بهترین هوش مصنوعی برای کدنویسی', url: 'https://example-blog.com/ai-coding', site: 'Example Blog',
    extract: 'ابزار ایکس قوی‌ترین هوش مصنوعی در کدنویسی است و برنامه‌نویسان بسیاری از آن استفاده می‌کنند. این ابزار کدهای پیچیده را سریع و دقیق می‌نویسد و خطاها را هم پیدا می‌کند.',
  }]
  it('a generic Wikipedia match must NOT pre-empt the web answer for a ranking question', () => {
    const ans = buildAnswer([...genericWiki, ...webWinner], QUESTION, 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines.join(' ')).toContain('قوی‌ترین هوش مصنوعی در کدنویسی')
    expect(ans.lines[ans.lines.length - 1]).toContain('Example Blog')
    expect(ans.lines.join(' ')).not.toContain('ویکی‌پدیا')
  })
  it('a Wikipedia sentence that ITSELF states the ranking still wins over the web', () => {
    const wikiRanking = [{
      title: 'هوش مصنوعی', url: 'https://fa.wikipedia.org/wiki/AI',
      extract: 'ابزار ایکس قوی‌ترین هوش مصنوعی در کدنویسی است و برنامه‌نویسان بسیاری از آن استفاده می‌کنند. هوش مصنوعی شاخه‌ای از علوم رایانه است که سامانه‌های هوشمند می‌سازد و داده‌ها را پردازش می‌کند.',
    }]
    const ans = buildAnswer([...wikiRanking, ...webWinner], QUESTION, 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines.join(' ')).toContain('قوی‌ترین هوش مصنوعی در کدنویسی')
    expect(ans.lines[ans.lines.length - 1]).toContain('منبع: ویکی‌پدیا')
  })
  it('EN mirror: generic wiki AI sentence loses to the web best-coding answer', () => {
    const wiki = [{
      title: 'Claude', url: 'https://en.wikipedia.org/wiki/Claude',
      extract: 'Claude is an AI tool for coding and writing. Users ask Claude questions and receive long detailed answers every day.',
    }]
    const web = [{
      title: 'Best AI coding tools', url: 'https://example-blog.com/best-ai-coding', site: 'Example Blog',
      extract: 'Tool X is the best AI coding assistant, ranked first for developers. It writes complex code quickly and finds errors accurately for many programmers.',
    }]
    const ans = buildAnswer([...wiki, ...web], 'Which AI is best for coding?', 'en')
    expect(ans.found).toBe(true)
    expect(ans.lines.join(' ')).toContain('best AI coding assistant')
    expect(ans.lines[ans.lines.length - 1]).toContain('Example Blog')
  })
  it('SUPERSEDED BY A-01e2: with no web answer and no comparative sentence, a ranking question is honestly not-found — a generic definition is NOT an answer (the A-01e live failure was exactly this Claude-definition shape returning for the owner\'s question)', () => {
    const ans = buildAnswer(genericWiki, QUESTION, 'fa')
    expect(ans.found).toBe(false)
  })
  it('ranking preference does not rescue a France question from a Korea article', () => {
    const korea = [{
      title: 'پایتخت کره', url: 'https://fa.wikipedia.org/wiki/KoreaCapitals',
      extract: 'پایتخت کره به پیشینه تاریخی آن سرزمین بستگی دارد که در طول تاریخ تغییر کرده است. کره شبه جزیره ای در شرق آسیا است که از دو کشور کره شمالی و کره جنوبی تشکیل شده است.',
    }]
    expect(buildAnswer(korea, 'پایتخت فرانسه کجاست؟', 'fa').found).toBe(false)
  })
  it('A-01d3: a weak-marker wiki sentence (leading textbooks) must NOT pre-empt the web answer', () => {
    const wikiSpurious = [{
      title: 'هوش مصنوعی', url: 'https://fa.wikipedia.org/wiki/AI',
      extract: 'کتاب‌های هوش مصنوعی پیشرو، این شاخه را به عنوان شاخه مطالعه بر روی عوامل هوشمند تعریف می‌کنند که سامانه‌های هوشمند می‌سازند و داده‌ها را پردازش می‌کنند.',
    }]
    const ans = buildAnswer([...wikiSpurious, ...webWinner], QUESTION, 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines.join(' ')).toContain('قوی‌ترین هوش مصنوعی در کدنویسی')
    expect(ans.lines[ans.lines.length - 1]).toContain('Example Blog')
    expect(ans.lines.join(' ')).not.toContain('ویکی‌پدیا')
  })
  it('A-01d3: a nav-boilerplate mega-sentence (>60 words, no terminators) is never served as an answer', () => {
    const navBlob = Array(80).fill('منو').join(' ') + ' هوش مصنوعی کدنویسی قوی'
    const web = [{
      title: 'بهترین هوش مصنوعی برای کدنویسی', url: 'https://example-blog.com/ai-coding', site: 'Example Blog',
      extract: `${navBlob}. ابزار ایکس قوی‌ترین هوش مصنوعی در کدنویسی است و برنامه‌نویسان بسیاری از آن استفاده می‌کنند.`,
    }]
    const ans = buildAnswer(web, QUESTION, 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines.join(' ')).not.toContain('منو')
    expect(ans.lines.join(' ')).toContain('قوی‌ترین هوش مصنوعی در کدنویسی')
    expect(ans.lines[ans.lines.length - 1]).toContain('Example Blog')
  })
  it('A-01d3: a true 3-token wiki ranking sentence (largest ocean) still wins over the web', () => {
    const wiki = [{
      title: 'اقیانوس آرام', url: 'https://fa.wikipedia.org/wiki/Pacific',
      extract: 'اقیانوس آرام بزرگ‌ترین اقیانوس جهان است که مساحت آن از مجموع خشکی‌های زمین بیشتر است و ژرف‌ترین گودال‌های اقیانوسی جهان را در خود جای داده است.',
    }]
    const ans = buildAnswer(wiki, 'بزرگ‌ترین اقیانوس جهان کدام است؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines.join(' ')).toContain('اقیانوس آرام بزرگ‌ترین اقیانوس جهان است')
    expect(ans.lines[ans.lines.length - 1]).toContain('منبع: ویکی‌پدیا')
  })
  it('sourceSiteName: wikipedia URL → ویکی‌پدیا in FA, web URL → site field or bare hostname', () => {
    expect(sourceSiteName({ url: 'https://fa.wikipedia.org/wiki/X' }, 'fa')).toBe('ویکی‌پدیا')
    expect(sourceSiteName({ url: 'https://en.wikipedia.org/wiki/X' }, 'en')).toBe('Wikipedia')
    expect(sourceSiteName({ url: 'https://example-blog.com/post', site: 'Example Blog' }, 'fa')).toBe('Example Blog')
    expect(sourceSiteName({ url: 'https://www.example-blog.com/post' }, 'fa')).toBe('example-blog.com')
  })
})

describe('A-01b real page measurement (A-01 failure: 713-word sectioned draft reported ≈2, rendered 3)', () => {
  const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const head = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
  it('a short draft is one page', () => {
    expect(estimateResearchPages([head(1, 'موضوع'), para('یک پاراگراف کوتاه.')])).toBe(1)
  })
  it('a sectioned draft the word formula calls 2 pages measures 3 with the app pagination engine', () => {
    const nodes: { type: string; attrs?: { level: number }; content: { type: string; text: string }[] }[] = [head(1, 'موضوع پژوهش')]
    for (let i = 0; i < 10; i++) {
      nodes.push(head(2, 'بخش'))
      nodes.push(para(Array(60).fill('نمونه').join(' ')))
    }
    nodes.push(para('منبع: ویکی‌پدیا — https://fa.wikipedia.org/wiki/X'))
    nodes.push(para('منابع دیگر'))
    const words = nodes.flatMap((n) => (n.content as { text?: string }[]).map((c) => c.text ?? ''))
      .join(' ').split(/\s+/).filter(Boolean).length
    expect(words).toBeLessThan(750)
    expect(Math.round(words / 300)).toBe(2) // the old, wrong answer
    expect(estimateResearchPages(nodes)).toBe(3) // the rendered answer
  })
  it('an unsectioned ~1020-word draft measures 3 (live calibration behind WORDS_PER_PAGE)', () => {
    const nodes: { type: string; attrs?: { level: number }; content: { type: string; text: string }[] }[] = [head(1, 'موضوع')]
    for (let i = 0; i < 10; i++) nodes.push(para(Array(102).fill('نمونه').join(' ')))
    expect(estimateResearchPages(nodes)).toBe(3)
  })
  it('a single block taller than one usable page is chunked, not parked on one page', () => {
    expect(estimateResearchPages([para('x'.repeat(10000))])).toBe(4)
  })
})

describe('A-01e question analysis (owner order 2026-11-03: analyze the question, then analyze the answers)', () => {
  it('classifies questions into types with the right answer kind', () => {
    expect(analyzeQuestion('کدام هوش مصنوعی در کدنویسی قوی‌تر است؟').type).toBe('ranking')
    expect(analyzeQuestion('کدام هوش مصنوعی در کدنویسی قوی‌تر است؟').answerKind).toBe('comparative')
    expect(analyzeQuestion('نویسنده شاهنامه کیست؟').type).toBe('person')
    expect(analyzeQuestion('نویسنده شاهنامه کیست؟').answerKind).toBe('name')
    expect(analyzeQuestion('پایتخت فرانسه کجاست؟').type).toBe('place')
    expect(analyzeQuestion('سرعت نور چقدر است؟').type).toBe('quantity')
    expect(analyzeQuestion('فوتوسنتز چیست؟').type).toBe('definition')
    expect(analyzeQuestion('چرا آسمان آبی است؟').type).toBe('why')
    expect(analyzeQuestion('What is the best AI for coding?').type).toBe('ranking')
  })
  it('person query variants rephrase نویسنده as اثر (source phrasing) without changing searchQueryFor', () => {
    expect(searchQueryFor('نویسنده شاهنامه کیست؟')).toBe('نویسنده شاهنامه')
    expect(searchQueriesFor('نویسنده شاهنامه کیست؟')).toContain('اثر شاهنامه')
    expect(searchQueriesFor('نویسنده شاهنامه کیست؟')[0]).toBe('نویسنده شاهنامه')
  })
  it('owner ranking question still yields a comparative answer via existing fixtures', () => {
    const wiki = [{
      title: 'رایانه', url: 'https://fa.wikipedia.org/wiki/Computer',
      extract: 'رایانه دستگاهی الکترونیکی است که داده‌ها را پردازش می‌کند. پژوهشگران سامانه‌های رایانه‌ای می‌سازند و آنها را بهبود می‌دهند.',
    }]
    const web = [{
      title: 'بهترین هوش مصنوعی برای کدنویسی', url: 'https://example-blog.com/ai-coding', site: 'Example Blog',
      extract: 'ابزار ایکس قوی‌ترین هوش مصنوعی در کدنویسی است و برنامه‌نویسان بسیاری از آن استفاده می‌کنند. این ابزار کدهای پیچیده را سریع و دقیق می‌نویسد و خطاها را هم پیدا می‌کند.',
    }]
    const ans = buildAnswer([...wiki, ...web], 'کدام هوش مصنوعی در کدنویسی قوی‌تر است؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines.join(' ')).toContain('قوی‌ترین هوش مصنوعی در کدنویسی')
  })
  it('A-01e6: web comparative gate — generic openings and time-phrase «اول» lose, a tool-naming superlative wins', () => {
    // Modeled on the live 2026-11-04 Tavily payload for the owner's
    // question: the first web source opens with generic sentences,
    // carries a false-positive «اول» in a time phrase, and states
    // its ranking later with a colloquially glued form («کدنویسیه»).
    const web = [{
      title: 'بهترین ابزارهای هوش مصنوعی برای برنامه‌نویسی', url: 'https://video.example.com/ai-coding', site: 'video.example.com',
      extract: 'دستیارهای هوش مصنوعی در کدنویسی شناخته می‌شوند و به برنامه‌نویسان در تکمیل کد و رفع باگ‌ها کمک می‌کنند و یادگیری را سریع‌تر می‌سازند. در روزهای اول کار کردن با آن کمی سخت‌تر بود و کاربران تازه‌کار چندان راضی نبودند. تبنا یکی از قدیمی‌ترین دستیارهای هوش مصنوعی توی کدنویسیه که تمرکز خاصی بر مسائل امنیتی و حفظ حریم خصوصی کد دارد و برای سازمان‌ها گزینه مناسبی است.',
    }]
    const ans = buildAnswer(web, 'کدام هوش مصنوعی در کدنویسی قوی‌تر است', 'fa')
    expect(ans.found).toBe(true)
    const joined = ans.lines.join(' ')
    expect(joined).toContain('تبنا')
    expect(joined).toContain('قدیمی‌ترین')
    expect(joined).not.toContain('روزهای اول')
    expect(joined).not.toContain('تکمیل کد و رفع باگ')
    expect(joined).toContain('video.example.com')
  })
  it('Shahnameh author: a name-bearing sentence wins', () => {
    const src = [{
      title: 'شاهنامه', url: 'https://fa.wikipedia.org/wiki/Shahnameh',
      extract: 'شاهنامه اثر حکیم ابوالقاسم فردوسی توسی است و از بزرگ‌ترین آثار حماسی جهان به شمار می‌رود. شاهنامه کتابی حماسی است که داستان‌های پهلوانان ایران را روایت می‌کند.',
    }]
    const ans = buildAnswer(src, 'نویسنده شاهنامه کیست؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines[0]).toContain('فردوسی')
  })
  it('France capital: a place-bearing sentence wins', () => {
    const src = [{
      title: 'فرانسه', url: 'https://fa.wikipedia.org/wiki/France',
      extract: 'فرانسه کشوری در اروپای غربی است و پایتخت آن شهر پاریس می باشد. این کشور از اعضای بنیانگذار اتحادیه اروپا به شمار می رود و نقش مهمی در تاریخ اروپا داشته است.',
    }]
    const ans = buildAnswer(src, 'پایتخت فرانسه کجاست؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines[0]).toContain('پاریس')
  })
  it('speed of light: a quantity-bearing sentence beats a word-sharing generic sentence', () => {
    const src = [{
      title: 'سرعت نور', url: 'https://fa.wikipedia.org/wiki/SpeedOfLight',
      extract: 'نور موجی الکترومغناطیسی است که سرعت آن در خلأ ثابت است و در فیزیک اهمیت دارد. سرعت نور در خلأ ۲۹۹۷۹۲۴۵۸ متر بر ثانیه است و یکی از ثابت‌های بنیادی فیزیک به شمار می‌رود.',
    }]
    const ans = buildAnswer(src, 'سرعت نور چقدر است؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines[0]).toContain('۲۹۹۷۹۲۴۵۸')
    expect(ans.lines[0]).toContain('متر بر ثانیه')
  })
  it('definition question: a definition sentence (subject + است) wins', () => {
    const src = [{
      title: 'فوتوسنتز', url: 'https://fa.wikipedia.org/wiki/Photosynthesis',
      extract: 'گیاهان سبز در برگ‌های خود رنگدانه دارند و نور خورشید را جذب می‌کنند. فوتوسنتز فرایندی است که گیاهان با آن نور خورشید را به انرژی شیمیایی تبدیل می‌کنند.',
    }]
    const ans = buildAnswer(src, 'فوتوسنتز چیست؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines[0]).toContain('فوتوسنتز فرایندی است')
  })
  it('nonsense question: honest not-found, never a topical paragraph', () => {
    const src = [{
      title: 'رایانه', url: 'https://fa.wikipedia.org/wiki/Computer',
      extract: 'رایانه دستگاهی الکترونیکی است که داده‌ها را پردازش می‌کند. پژوهشگران سامانه‌های رایانه‌ای می‌سازند و آنها را بهبود می‌دهند.',
    }]
    expect(buildAnswer(src, 'قیمت دلار امروز چند است؟', 'fa').found).toBe(false)
  })
  it('word-sharing non-answer REJECTED: generic definition sharing نویسنده+شاهنامه loses to the name-bearing sentence', () => {
    const src = [{
      title: 'شاهنامه', url: 'https://fa.wikipedia.org/wiki/Shahnameh',
      extract: 'شاهنامه کتابی حماسی است و نویسنده آن داستان‌های پهلوانان ایران را روایت می‌کند و شاهنامه در ادبیات فارسی جایگاه ویژه‌ای دارد. شاهنامه اثر حکیم ابوالقاسم فردوسی توسی است.',
    }]
    const ans = buildAnswer(src, 'نویسنده شاهنامه کیست؟', 'fa')
    expect(ans.found).toBe(true)
    // The generic first sentence shares BOTH subject words and comes
    // first, yet must NOT win: it names nobody.
    expect(ans.lines[0]).toContain('فردوسی')
    expect(ans.lines[0]).not.toContain('کتابی حماسی است و نویسنده آن')
    // Unit-level proof: the generic sentence is not name-bearing,
    // the اثر sentence is.
    const person = analyzeQuestion('نویسنده شاهنامه کیست؟')
    expect(sentenceMatchesQuestionType('شاهنامه کتابی حماسی است و نویسنده آن داستان‌های پهلوانان ایران را روایت می‌کند.', person)).toBe(false)
    expect(sentenceMatchesQuestionType('شاهنامه اثر فردوسی است.', person)).toBe(true)
  })
  it('France/Korea guard survives the analysis pass', () => {
    const korea = [{
      title: 'پایتخت کره', url: 'https://fa.wikipedia.org/wiki/KoreaCapitals',
      extract: 'پایتخت کره به پیشینه تاریخی آن سرزمین بستگی دارد که در طول تاریخ تغییر کرده است. کره شبه جزیره ای در شرق آسیا است که از دو کشور کره شمالی و کره جنوبی تشکیل شده است.',
    }]
    expect(buildAnswer(korea, 'پایتخت فرانسه کجاست؟', 'fa').found).toBe(false)
  })
})

describe('A-01e2 fix the A-01e live gaps (general method only — no per-question branches)', () => {
  const QUESTION = 'کدام هوش مصنوعی در کدنویسی قوی‌تر است؟'
  it('A-01e live regression CLOSED: a weak-marker generic wiki sentence (2-token match) must NOT win in the strict pass or A-01c', () => {
    const wiki = [{
      title: 'هوش مصنوعی', url: 'https://fa.wikipedia.org/wiki/AI',
      extract: 'کتابهای هوش مصنوعی پیشرو جهان بسیار خوانده میشوند.',
    }]
    expect(buildAnswer(wiki, QUESTION, 'fa').found).toBe(false)
  })
  it('A-01d3 rule preserved: a weak-marker sentence with ≥3 subject-token matches still wins', () => {
    const wiki = [{
      title: 'هوش مصنوعی', url: 'https://fa.wikipedia.org/wiki/AI',
      extract: 'ابزارهای هوش مصنوعی پیشرو در کدنویسی کاربرد گسترده دارند.',
    }]
    const ans = buildAnswer(wiki, QUESTION, 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines[0]).toContain('پیشرو')
  })
  it('nonsense place question: topical Saturn facts are honestly not-found, never served', () => {
    const src = [{
      title: 'زحل', url: 'https://fa.wikipedia.org/wiki/Saturn',
      extract: 'زحل ششمین سیاره منظومه شمسی است و حلقه های زیبایی دارد. زحل سیاره ای گازی است که قمرهای بسیاری دارد.',
    }]
    expect(buildAnswer(src, 'پایتخت سیاره زحل کجاست؟', 'fa').found).toBe(false)
  })
  it('fresh unseen person question: Masnavi names the author explicitly with full name', () => {
    const src = [{
      title: 'مثنوی معنوی', url: 'https://fa.wikipedia.org/wiki/Masnavi',
      extract: 'مثنوی معنوی کتابی منظوم است که در ادبیات فارسی جایگاه ویژه ای دارد. مثنوی معنوی اثر مولانا جلال الدین محمد بلخی است و شش دفتر دارد.',
    }]
    const ans = buildAnswer(src, 'نویسنده مثنوی معنوی کیست؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines[0]).toContain('مولانا')
    expect(ans.lines[0]).toContain('بلخی')
  })
  it('person evidence, unit level: cue + work title + copula-closed name counts; cue + آن + generic noun does not', () => {
    const person = analyzeQuestion('نویسنده مثنوی معنوی کیست؟')
    expect(sentenceMatchesQuestionType('نویسنده مثنوی معنوی، مولانا است.', person)).toBe(true)
    expect(sentenceMatchesQuestionType('نویسنده آن داستان های پهلوانان ایران را روایت می کند.', person)).toBe(false)
    expect(sentenceMatchesQuestionType('مولانا شاعر پارسی گوی بزرگی است.', person)).toBe(false)
  })
  it('quantity with a count unit (میلیون نفر) still answers — type gating must not drop real counts', () => {
    const src = [{
      title: 'فرانسه', url: 'https://fa.wikipedia.org/wiki/France',
      extract: 'فرانسه کشوری در اروپای غربی است. جمعیت فرانسه حدود ۶۸ میلیون نفر است و این کشور در اروپا قرار دارد.',
    }]
    const ans = buildAnswer(src, 'جمعیت فرانسه چقدر است؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines.join(' ')).toContain('میلیون')
  })
})

describe('A-01e2 live-check fixes (diagnosed by replaying the 2026-11-03 live check against the new code)', () => {
  const QUESTION = 'کدام هوش مصنوعی در کدنویسی قوی‌تر است؟'
  it('H1: a weak-marker definition scores only CONTENT tokens — هوش+مصنوعی+در is 2, not 3, so the live پیشرو definition is rejected', () => {
    const wiki = [{
      title: 'هوش مصنوعی', url: 'https://fa.wikipedia.org/wiki/AI',
      extract: 'کتاب‌های هوش مصنوعی پیشرو، این شاخه را به عنوان شاخه مطالعه بر روی عوامل هوشمند تعریف می‌کنند: هر سامانه‌ای که محیط خود را درک کرده و کنش‌هایی را انجام می‌دهد که شانسش را در دستیابی به اهدافش بیشینه می‌سازد.',
    }]
    expect(buildAnswer(wiki, QUESTION, 'fa').found).toBe(false)
  })
  it('H2: «در ردیف ششم قرار دارد» is NOT place-bearing, and the live Saturn sentence is honestly not-found', () => {
    const place = analyzeQuestion('پایتخت سیاره زحل کجاست؟')
    expect(sentenceMatchesQuestionType('زحل دومین سیاره بیرونی و دومین سیاره بزرگ سامانه خورشیدی است که در ردیف ششم سیاره‌های این سامانه قرار دارد.', place)).toBe(false)
    const src = [
      { title: 'زحل', url: 'https://fa.wikipedia.org/wiki/Saturn', extract: 'زحل ششمین سیاره منظومه شمسی است و حلقه های زیبایی دارد.' },
      { title: 'سیاره‌های بیرونی', url: 'https://fa.wikipedia.org/wiki/OuterPlanets', extract: 'زحل دومین سیاره بیرونی و دومین سیاره بزرگ سامانه خورشیدی است که در ردیف ششم سیاره‌های این سامانه قرار دارد.' },
    ]
    expect(buildAnswer(src, 'پایتخت سیاره زحل کجاست؟', 'fa').found).toBe(false)
  })
  it('H3: the real Masnavi lead («کتاب شعری از مولانا…») names the author explicitly via the از-pattern', () => {
    const person = analyzeQuestion('نویسنده مثنوی معنوی کیست؟')
    expect(sentenceMatchesQuestionType('مثنوی، مشهور به مثنوی معنوی، نام کتاب شعری از مولانا جلال‌الدین محمد بلخی شاعر و عارف ایرانی است.', person)).toBe(true)
    const src = [{
      title: 'مثنوی معنوی', url: 'https://fa.wikipedia.org/wiki/Masnavi',
      extract: 'مثنوی، مشهور به مثنوی معنوی (یا مثنوی مولوی)، نام کتاب شعری از مولانا جلال‌الدین محمد بلخی شاعر و عارف ایرانی است. این کتاب حدودا از ۲۶ هزار بیت و ۶ دفتر تشکیل شده است.',
    }]
    const ans = buildAnswer(src, 'نویسنده مثنوی معنوی کیست؟', 'fa')
    expect(ans.found).toBe(true)
    expect(ans.lines[0]).toContain('مولانا')
    expect(ans.lines[0]).toContain('بلخی')
  })
  it('H3 guard: bare «از X» with no role/copula confirmation is still not name-bearing', () => {
    const person = analyzeQuestion('نویسنده شاهنامه کیست؟')
    expect(sentenceMatchesQuestionType('این کتاب از تهران به دست ما رسیده است.', person)).toBe(false)
  })
})

describe('A-01f thinking brain (owner order 2026-11-03: a reasoning layer, general method only)', () => {
  it('DECOMPOSE: a true two-question ask splits; a two-topic question with a trigger-less first part stays whole', () => {
    expect(decomposeQuestion('پایتخت فرانسه چیست و جمعیتش چقدر است؟')).toEqual(['پایتخت فرانسه چیست', 'جمعیتش چقدر است'])
    expect(decomposeQuestion('What is the capital of France and what is its population?')).toHaveLength(2)
    expect(decomposeQuestion('پایتخت فرانسه و آلمان چیست؟')).toEqual(['پایتخت فرانسه و آلمان چیست؟'])
    expect(decomposeQuestion('پایتخت فرانسه کجاست؟')).toEqual(['پایتخت فرانسه کجاست؟'])
  })
  it('DECOMPOSE: a follow-up part inherits the first part subject noun with possessives stripped', () => {
    const subs = subQuestionQueries('پایتخت فرانسه چیست و جمعیتش چقدر است؟')
    expect(subs).toHaveLength(2)
    expect(subs[1].question).toBe('جمعیتش چقدر است')
    expect(subs[1].query).toContain('فرانسه')
    expect(subs[1].query).toContain('جمعیت')
    expect(subs[1].query).not.toContain('جمعیتش')
  })
  it('MULTI-STEP: refineQuery adds distinctive title tokens and stops when titles add nothing new', () => {
    const refined = refineQuery('جمعیت فرانسه چقدر است؟', ['آمار جمعیت فرانسه در سال ۲۰۲۴'])
    expect(refined).not.toBe('جمعیت فرانسه چقدر')
    expect(refined).toContain('آمار')
    expect(refineQuery('جمعیت فرانسه چقدر است؟', ['جمعیت فرانسه'])).toBe('جمعیت فرانسه چقدر')
  })
  it('ASSEMBLY: definition first, every part covered, an unanswered part named honestly, never guessed', () => {
    const assembled = assembleThoughtAnswer([
      { question: 'جمعیت فرانسه چقدر است؟', lines: ['جمعیت فرانسه حدود ۶۸ میلیون نفر است.', 'منبع: ویکی‌پدیا — https://fa.wikipedia.org/wiki/France'], found: true },
      { question: 'فوتوسنتز چیست؟', lines: ['فوتوسنتز فرایندی است که گیاهان با آن غذا می سازند.', 'منبع: ویکی‌پدیا — https://fa.wikipedia.org/wiki/Photo'], found: true },
    ], 'fa')
    expect(assembled.found).toBe(true)
    expect(assembled.lines.join(' ').indexOf('فوتوسنتز')).toBeLessThan(assembled.lines.join(' ').indexOf('جمعیت فرانسه'))
    const partial = assembleThoughtAnswer([
      { question: 'پایتخت فرانسه چیست؟', lines: ['پاریس پایتخت فرانسه است.', 'منبع: ویکی‌پدیا — https://fa.wikipedia.org/wiki/France'], found: true },
      { question: 'جمعیت فرانسه چقدر است؟', lines: [], found: false },
    ], 'fa')
    expect(partial.found).toBe(true)
    expect(partial.lines.join(' ')).toContain('برای این بخش پاسخی در منابع پیدا نشد')
    expect(partial.lines.join(' ')).toContain('جمعیت فرانسه چقدر است؟')
    expect(assembleThoughtAnswer([{ question: 'پایتخت سیاره زحل کجاست؟', lines: [], found: false }], 'fa').found).toBe(false)
  })
  it('MULTI-PART end to end (spec example): capital + population both answered from their own sources', () => {
    const capital = [{ title: 'فرانسه', url: 'https://fa.wikipedia.org/wiki/France', extract: 'فرانسه کشوری در اروپای غربی است. پاریس پایتخت فرانسه است و این شهر بزرگ است.' }]
    const population = [{ title: 'فرانسه', url: 'https://fa.wikipedia.org/wiki/France', extract: 'فرانسه کشوری در اروپای غربی است. جمعیت فرانسه حدود ۶۸ میلیون نفر است و این کشور در اروپا قرار دارد.' }]
    const parts = subQuestionQueries('پایتخت فرانسه چیست و جمعیتش چقدر است؟')
    const results = parts.map((sub, i) => {
      const ans = buildAnswer(i === 0 ? capital : population, sub.query, 'fa')
      return { question: sub.question, lines: ans.lines, found: ans.found }
    })
    const out = assembleThoughtAnswer(results, 'fa')
    expect(out.found).toBe(true)
    expect(out.lines.join(' ')).toContain('پاریس')
    expect(out.lines.join(' ')).toContain('۶۸ میلیون')
  })
  it('CROSS-CHECK: two sources with different population numbers show the disagreement with both credits, never one silently', () => {
    const a = [{ title: 'فرانسه', url: 'https://fa.wikipedia.org/wiki/France', extract: 'جمعیت فرانسه حدود ۶۸ میلیون نفر است.' }]
    const b = [{ title: 'جمعیت فرانسه', url: 'https://example.org/fr-pop', extract: 'جمعیت فرانسه حدود ۶۶ میلیون نفر است.' }]
    const conflict = findNumericConflict([...a, ...b], 'جمعیت فرانسه چقدر است؟', 'fa')
    expect(conflict).not.toBeNull()
    expect(conflict!.join(' ')).toContain('اختلاف دارند')
    expect(conflict!.join(' ')).toContain('۶۸ میلیون')
    expect(conflict!.join(' ')).toContain('۶۶ میلیون')
    expect(conflict!.join(' ')).toContain('https://fa.wikipedia.org/wiki/France')
    expect(conflict!.join(' ')).toContain('https://example.org/fr-pop')
  })
  it('CROSS-CHECK: agreeing numbers (even across scales: ۶۸ میلیون vs 68,000,000) and non-quantity questions give no conflict', () => {
    const a = [{ title: 'فرانسه', url: 'https://fa.wikipedia.org/wiki/France', extract: 'جمعیت فرانسه حدود ۶۸ میلیون نفر است.' }]
    const b = [{ title: 'جمعیت فرانسه', url: 'https://example.org/fr-pop', extract: 'جمعیت فرانسه حدود 68,000,000 نفر است.' }]
    expect(findNumericConflict([...a, ...b], 'جمعیت فرانسه چقدر است؟', 'fa')).toBeNull()
    const cap = [{ title: 'فرانسه', url: 'https://fa.wikipedia.org/wiki/France', extract: 'پاریس پایتخت فرانسه است.' }]
    expect(findNumericConflict([...cap, ...cap], 'پایتخت فرانسه کجاست؟', 'fa')).toBeNull()
    expect(findNumericConflict(a, 'جمعیت فرانسه چقدر است؟', 'fa')).toBeNull()
  })
})

describe('A-03 long-document structure (TOC for long research only)', () => {
  // Recursive node text (bullet lists nest listItem > paragraph >
  // text, so a one-level read would miss TOC items entirely).
  const nodeTextAll = (n: any): string => {
    const own = typeof n.text === 'string' ? n.text : ''
    const kids = Array.isArray(n.content) ? (n.content as any[]).map(nodeTextAll).join(' ') : ''
    return [own, kids].filter(Boolean).join(' ')
  }
  const headingTexts = (nodes: any[]) =>
    nodes.filter((n) => n.type === 'heading').map((n) => nodeTextAll(n))
  const tocOf = (nodes: any[]) => {
    const list = nodes.find((n) => n.type === 'bulletList')
    if (!list) return null
    return (list.content as any[]).map((li) => nodeTextAll(li))
  }
  // The index sits EARLY in each sentence so distinct sentences stay
  // distinct under the engine's 36-char fingerprint.
  const faSent = (tag: string, i: number) =>
    `جمله شماره ${i} درباره ${tag} است و اطلاعات مهم و دقیقی درباره آن ارائه می کند و شرح می دهد و توضیح می دهد.`
  const enSent = (tag: string, i: number) =>
    `Sentence number ${i} about ${tag} presents important and precise information and explains it clearly and thoroughly.`
  const faExtract = [
    `${faSent('مقدمه', 1)} ${faSent('مقدمه', 2)} ${faSent('مقدمه', 3)}`,
    '== تاریخچه ==',
    Array.from({ length: 40 }, (_, i) => faSent('تاریخچه', i)).join(' '),
    '== کاربردها ==',
    Array.from({ length: 40 }, (_, i) => faSent('کاربردها', i)).join(' '),
  ].join('\n')
  const faSrc = { title: 'موضوع', url: 'https://fa.wikipedia.org/wiki/X', extract: faExtract }

  it('(a) 3-page research with real sections gets a TOC as the second node, listing exactly the emitted headings in order, credits intact', () => {
    const out = assembleResearch([faSrc], 'fa', { pages: 3 })
    expect(out.nodes[0].type).toBe('heading')
    expect(nodeTextAll(out.nodes[1])).toBe('فهرست')
    expect(out.nodes[2].type).toBe('bulletList')
    expect(tocOf(out.nodes)).toEqual(['تاریخچه', 'کاربردها'])
    // The TOC items are exactly the section headings emitted later
    // in the same draft (title and credits never appear in it).
    const heads = headingTexts(out.nodes)
    expect(heads).toContain('تاریخچه')
    expect(heads).toContain('کاربردها')
    expect(heads[0]).toBe('موضوع')
    // Credits still close the draft with the source URL, and the
    // reported word count still covers every node, TOC included.
    const last = nodeTextAll(out.nodes[out.nodes.length - 1])
    expect(last).toContain('منبع: ویکی‌پدیا')
    expect(last).toContain('https://fa.wikipedia.org/wiki/X')
    const actual = out.nodes.map((n) => nodeTextAll(n)).join(' ')
      .split(/[^\p{L}\p{N}\u200C]+/u).filter((t) => t.length > 0).length
    expect(out.words).toBe(actual)
  })
  it('(b) 1-page research with the same sections gets NO TOC', () => {
    const out = assembleResearch([faSrc], 'fa', { pages: 1 })
    expect(nodeTextAll(out.nodes[1])).not.toBe('فهرست')
    expect(out.nodes.some((n) => n.type === 'bulletList')).toBe(false)
    // The sections themselves are still emitted — only the TOC is absent.
    expect(headingTexts(out.nodes)).toContain('تاریخچه')
    expect(headingTexts(out.nodes)).toContain('کاربردها')
  })
  it('(c) a long research where the same heading appears twice lists it only once in the TOC', () => {
    const dup = [
      `${faSent('مقدمه', 1)} ${faSent('مقدمه', 2)}`,
      '== تاریخچه ==',
      Array.from({ length: 40 }, (_, i) => faSent('تاریخچه نخست', i)).join(' '),
      '== تاریخچه ==',
      Array.from({ length: 40 }, (_, i) => faSent('تاریخچه دوم', i)).join(' '),
    ].join('\n')
    const out = assembleResearch([{ title: 'موضوع', url: 'https://fa.wikipedia.org/wiki/X', extract: dup }], 'fa', { pages: 3 })
    expect(nodeTextAll(out.nodes[1])).toBe('فهرست')
    expect(tocOf(out.nodes)).toEqual(['تاریخچه'])
    // Both sections were emitted (the heading occurs twice in the body)…
    expect(headingTexts(out.nodes).filter((h) => h === 'تاریخچه').length).toBe(2)
  })
  it('(d) EN 3-page research gets a Contents TOC', () => {
    const enExtract = [
      `${enSent('introduction', 1)} ${enSent('introduction', 2)} ${enSent('introduction', 3)}`,
      '== History ==',
      Array.from({ length: 40 }, (_, i) => enSent('history', i)).join(' '),
      '== Applications ==',
      Array.from({ length: 40 }, (_, i) => enSent('applications', i)).join(' '),
    ].join('\n')
    const out = assembleResearch([{ title: 'Topic', url: 'https://en.wikipedia.org/wiki/X', extract: enExtract }], 'en', { pages: 3 })
    expect(nodeTextAll(out.nodes[1])).toBe('Contents')
    expect(tocOf(out.nodes)).toEqual(['History', 'Applications'])
    const last = nodeTextAll(out.nodes[out.nodes.length - 1])
    expect(last).toContain('Source: Wikipedia')
    expect(last).toContain('https://en.wikipedia.org/wiki/X')
  })
})

describe('A-04 follow-up context (last research remembered; general method only)', () => {
  it('detects the three spec phrases as follow-ups, FA + EN, with and without the ZWNJ form', () => {
    expect(detectFollowUp('بیشتر بنویس')).toBe('expand')
    expect(detectFollowUp('ادامه بده')).toBe('expand')
    expect(detectFollowUp('ادامه')).toBe('expand')
    expect(detectFollowUp('write more')).toBe('expand')
    expect(detectFollowUp('continue')).toBe('expand')
    expect(detectFollowUp('خلاصه‌اش کن')).toBe('summarize')
    expect(detectFollowUp('خلاصه اش کن')).toBe('summarize')
    expect(detectFollowUp('summarize it')).toBe('summarize')
  })
  it('does NOT hijack longer sentences or the plain document-summary forms', () => {
    // A longer sentence keeps its old meaning (anchored match only).
    expect(detectFollowUp('ادامه مقاله را بنویس')).toBeNull()
    expect(detectFollowUp('بیشتر درباره فرانسه بگو')).toBeNull()
    // Plain «خلاصه کن» / "summarize" stay document-summary commands.
    expect(detectFollowUp('خلاصه کن')).toBeNull()
    expect(detectFollowUp('summarize')).toBeNull()
    expect(detectFollowUp('پایتخت فرانسه کجاست؟')).toBeNull()
    expect(detectFollowUp('جدول ۳×۴ بساز')).toBeNull()
  })
  it('expand target: one more page than asked, at least one page beyond what was built, capped at 30', () => {
    expect(expandResearchOpts({ pages: 2, words: 500 })).toEqual({ pages: 3 })
    expect(expandResearchOpts({ pages: 1, words: 290 })).toEqual({ pages: 2 })
    // Paragraph-mode research (no page count): the word leg guarantees growth.
    expect(expandResearchOpts({ words: 330 }).pages).toBeGreaterThan(1)
    expect(expandResearchOpts({ pages: 30, words: 9000 })).toEqual({ pages: 30 })
  })
  it('expanding from the SAME sources raises the target but invents nothing new', () => {
    const sent = (i: number) =>
      `جمله شماره ${i} درباره موضوع است و اطلاعات مهم و دقیقی درباره آن ارائه می کند و شرح می دهد و توضیح می دهد.`
    const src = { title: 'موضوع', url: 'https://fa.wikipedia.org/wiki/X', extract: Array.from({ length: 30 }, (_, i) => sent(i)).join(' ') }
    const first = assembleResearch([src], 'fa', { pages: 1 })
    const expanded = assembleResearch([src], 'fa', expandResearchOpts({ pages: 1, words: first.words }))
    expect(expanded.targetWords).toBeGreaterThan(first.targetWords)
    // Every expanded sentence still comes from the one source extract.
    const body = researchBodyText(expanded.nodes)
    expect(body).toContain('درباره موضوع است')
    expect(body).not.toContain('https://fa.wikipedia.org/wiki/X')
  })
  it('researchBodyText keeps body paragraphs only — no title, headings, TOC or credit lines', () => {
    const sent = (i: number) =>
      `جمله شماره ${i} درباره موضوع است و اطلاعات مهم و دقیقی درباره آن ارائه می کند و شرح می دهد و توضیح می دهد.`
    const extract = [
      `${sent(1)} ${sent(2)} ${sent(3)}`,
      '== تاریخچه ==',
      Array.from({ length: 40 }, (_, i) => sent(100 + i)).join(' '),
    ].join('\n')
    const out = assembleResearch([{ title: 'موضوع', url: 'https://fa.wikipedia.org/wiki/X', extract }], 'fa', { pages: 3 })
    const body = researchBodyText(out.nodes)
    expect(body).toContain('درباره موضوع است')
    expect(body).not.toContain('منبع:')
    expect(body).not.toContain('https://fa.wikipedia.org/wiki/X')
    // A summary built from the body is short and credit-free.
    const summary = summarizeText(body, 3)
    expect(summary.length).toBeLessThanOrEqual(3)
    expect(summary.join(' ')).not.toContain('ویکی‌پدیا')
  })
})

describe('A-05 Dari cleanup', () => {
  const Z = '\u200C'
  it('maps all seven Arabic letters to Persian and leaves Latin untouched', () => {
    // Separated by '|' so the spaced-ezafe rule (which would rightly
    // join «و ی») does not merge two single-letter test tokens.
    expect(normalizeDariText('ي|ك|ة|ؤ|ى|أ|إ')).toBe('ی|ک|ه|و|ی|ا|ا')
    expect(normalizeDariText('Hello world')).toBe('Hello world')
    expect(normalizeDariText('Hello می شود')).toBe(`Hello می${Z}شود`)
  })
  it('repairs ZWNJ: می/نمی prefix, ها/تر/ترین suffix, ezafe ی, spaces around an existing ZWNJ', () => {
    expect(normalizeDariText('می شود')).toBe(`می${Z}شود`)
    expect(normalizeDariText('نمی روم')).toBe(`نمی${Z}روم`)
    expect(normalizeDariText('کتاب ها')).toBe(`کتاب${Z}ها`)
    expect(normalizeDariText('بزرگ تر')).toBe(`بزرگ${Z}تر`)
    expect(normalizeDariText('بزرگ ترین')).toBe(`بزرگ${Z}ترین`)
    expect(normalizeDariText('خانه ی من')).toBe(`خانه${Z}ی من`)
    expect(normalizeDariText(`می${Z} شود`)).toBe(`می${Z}شود`)
    expect(normalizeDariText(`کتاب ${Z}ها`)).toBe(`کتاب${Z}ها`)
  })
  it('never de-glues glued words and never touches a standalone suffix word', () => {
    expect(normalizeDariText(`می${Z}شود`)).toBe(`می${Z}شود`)
    expect(normalizeDariText('ها')).toBe('ها')
    expect(normalizeDariText('تر')).toBe('تر')
  })
  it('cleanupText gains Dari normalization while keeping a Latin punctuation case', () => {
    expect(cleanupText('می شود ،خوبی ؟')).toBe(`می${Z}شود، خوبی؟`)
    expect(cleanupText('a  b ?c')).toBe('a b? c')
  })
  it('cleanupDocJson preserves a heading and a bold-marked node while cleaning their text', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'كتاب  ها ،خوبی ؟' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'می شود', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' و کتاب ها ' },
          ],
        },
      ],
    }
    const cleaned = cleanupDocJson(doc)
    expect(cleaned).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `کتاب${Z}ها، خوبی؟` }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: `می${Z}شود`, marks: [{ type: 'bold' }] },
            { type: 'text', text: ` و کتاب${Z}ها ` },
          ],
        },
      ],
    })
    // The input doc is not mutated (deep copy).
    expect(doc.content[0].content[0].text).toBe('كتاب  ها ،خوبی ؟')
  })
  it('parses document-cleanup, extended selection-cleanup, and keeps bare دری on the template branch', () => {
    expect(parseAssistantCommand('کل سند را تمیز کن')).toEqual({ kind: 'document-cleanup' })
    expect(parseAssistantCommand('سند را دری کن')).toEqual({ kind: 'document-cleanup' })
    expect(parseAssistantCommand('clean up the document')).toEqual({ kind: 'document-cleanup' })
    expect(parseAssistantCommand('متن را تمیز کن')).toEqual({ kind: 'selection-cleanup' })
    expect(parseAssistantCommand('نیم فاصله را درست کن')).toEqual({ kind: 'selection-cleanup' })
    expect(parseAssistantCommand('نامه رسمی دری بنویس')).toEqual({ kind: 'insert-template', template: 'letter' })
  })
})

describe('A-06 selection transforms (rule-based only — no rewriting, no invented words)', () => {
  const Z = '\u200C'
  it('formalizes colloquial Dari across persons, with or without ZWNJ, and leaves unknown words alone', () => {
    expect(formalizeText('من میخوام برم خونه دیگه')).toBe(`من می${Z}خواهم برم خانه دیگر`)
    // «برم» is not in the dictionary: it stays, proving no guessing.
    expect(formalizeText(`می‌خوای اونجا بمونی؟`)).toBe(`می${Z}خواهی آنجا بمونی؟`)
    expect(formalizeText('داره میره اومدن')).toBe(`دارد می${Z}رود آمدند`)
    expect(formalizeText('میدونم چیه')).toBe(`می${Z}دانم چیست`)
    expect(formalizeText('سلام دنیا')).toBe('سلام دنیا')
  })
  it('formalizes glued verb prefixes and English informal forms', () => {
    expect(formalizeText('میکنم این کار را')).toBe(`می${Z}کنم این کار را`)
    expect(formalizeText('I wanna go, yeah')).toBe('I want to go, yes')
    expect(formalizeText('Yeah, I gotta go')).toBe('Yes, I have to go')
  })
  it('shortens a multi-sentence selection to about half its words, in original order, from its own sentences', () => {
    const text = 'پاریس پایتخت فرانسه است. فرانسه کشوری در اروپای غربی است. جمعیت پاریس بیش از دو میلیون نفر است. رود سن از میان پاریس می‌گذرد. برج ایفل مشهورترین نماد پاریس است. پاریس هر سال میلیون‌ها گردشگر دارد.'
    const short = shortenText(text)
    const words = (s: string) => s.split(/\s+/).filter(Boolean).length
    expect(words(short)).toBeLessThanOrEqual(Math.ceil(words(text) / 2) + 12)
    expect(words(short)).toBeGreaterThanOrEqual(1)
    // Every output sentence is one of the input's own sentences.
    for (const s of splitSentences(short)) expect(splitSentences(text)).toContain(s)
    // Original order preserved.
    const idx = splitSentences(short).map((s) => splitSentences(text).indexOf(s))
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })
  it('leaves a one-sentence selection unchanged (halving it would invent a cut)', () => {
    expect(shortenText('فقط یک جمله است.')).toBe('فقط یک جمله است.')
  })
  it('parses formalize and shorten commands, and keeps a bare رسمی on the template branch', () => {
    expect(parseAssistantCommand('متن انتخاب‌شده را رسمی‌اش کن')).toEqual({ kind: 'selection-formalize' })
    expect(parseAssistantCommand('رسمیش کن')).toEqual({ kind: 'selection-formalize' })
    expect(parseAssistantCommand('make it formal')).toEqual({ kind: 'selection-formalize' })
    expect(parseAssistantCommand('متن را کوتاه‌اش کن')).toEqual({ kind: 'selection-shorten' })
    expect(parseAssistantCommand('shorten this text')).toEqual({ kind: 'selection-shorten' })
    expect(parseAssistantCommand('نامه رسمی دری بنویس')).toEqual({ kind: 'insert-template', template: 'letter' })
  })
})
