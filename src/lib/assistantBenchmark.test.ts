// A-02 BENCHMARK SET — Vyro Assistant automated question benchmark.
//
// Measuring instruments ONLY (owner hard rule: training targets the
// general method, never preset questions). Every case below exercises
// the GENERAL engine via existing exported functions — analyzeQuestion
// for classification, buildAnswer for the sourced answer. Nothing here
// is a per-question branch, and nothing here is a claim about the real
// world: the fixture extracts are composed plausible source text shaped
// like Wikipedia-style extracts, used only to probe the engine.
//
// Coverage: ~30 real student-style questions, Persian (Dari) and
// English mixed, across definitions, capitals/places, dates, persons
// (authors), why/how explanations, enumerations/lists,
// ranking/comparison (including one current/recency question),
// quantity (numbers+units), and nonsense questions that must honestly
// return not-found. Includes questions typed WITHOUT «؟» and one
// multi-part question (via decomposeQuestion / subQuestionQueries).
//
// Pass rule per case: the classification matches where the API exposes
// it, AND buildAnswer either returns the expected key fact with a
// source-credit line, or honestly reports not-found for nonsense.
import { describe, it, expect } from 'vitest'
import {
  analyzeQuestion, buildAnswer, decomposeQuestion, subQuestionQueries,
  type QuestionType, type ResearchData,
} from './assistant'

const wikiFa = (title: string, extract: string): ResearchData => ({
  title, extract, url: `https://fa.wikipedia.org/wiki/${encodeURIComponent(title)}`,
})
const wikiEn = (title: string, extract: string): ResearchData => ({
  title, extract, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
})

interface BenchCase {
  category: string
  question: string
  lang: 'fa' | 'en'
  sources: ResearchData[]
  expectType: QuestionType
  /** Key fact the answer must contain (found cases). */
  expectContains?: string
  /** Nonsense cases: the honest answer is not-found. */
  expectFound?: boolean
}

const CASES: BenchCase[] = [
  // ---- definitions -------------------------------------------------
  {
    category: 'definitions', question: 'فوتوسنتز چیست؟', lang: 'fa',
    sources: [wikiFa('فوتوسنتز', 'گیاهان سبز در برگ‌های خود رنگدانه کلروفیل دارند و نور خورشید را جذب می‌کنند. فوتوسنتز فرایندی است که گیاهان با آن نور خورشید را به انرژی شیمیایی تبدیل می‌کنند.')],
    expectType: 'definition', expectContains: 'انرژی شیمیایی',
  },
  {
    category: 'definitions', question: 'What is photosynthesis?', lang: 'en',
    sources: [wikiEn('Photosynthesis', 'Plants contain the pigment chlorophyll in their leaves. Photosynthesis is the process by which plants convert sunlight into chemical energy.')],
    expectType: 'definition', expectContains: 'process',
  },
  {
    category: 'definitions', question: 'گرانش چیست؟', lang: 'fa',
    sources: [wikiFa('گرانش', 'گرانش نیرویی است که اجسام را به سوی یکدیگر می‌کشد و سیاره‌ها را در مدار نگه می‌دارد. این نیرو در زندگی روزمره ما نیز اثر دارد.')],
    expectType: 'definition', expectContains: 'نیرویی',
  },
  // ---- capitals / places -------------------------------------------
  {
    category: 'capitals/places', question: 'پایتخت فرانسه کجاست؟', lang: 'fa',
    sources: [wikiFa('فرانسه', 'فرانسه کشوری در اروپای غربی است و پایتخت آن شهر پاریس می باشد. این کشور از اعضای بنیانگذار اتحادیه اروپا به شمار می رود.')],
    expectType: 'place', expectContains: 'پاریس',
  },
  {
    // Typed WITHOUT «؟» (A-01e5 regression area: question words must
    // still classify without the question mark).
    category: 'capitals/places', question: 'پایتخت ژاپن کجاست', lang: 'fa',
    sources: [wikiFa('ژاپن', 'ژاپن کشوری جزیره‌ای در شرق آسیا است. توکیو پایتخت ژاپن است و بزرگ‌ترین شهر این کشور به شمار می‌رود.')],
    expectType: 'place', expectContains: 'توکیو',
  },
  {
    category: 'capitals/places', question: 'What is the capital of Japan?', lang: 'en',
    sources: [wikiEn('Japan', 'Japan is an island country in East Asia. Tokyo is the capital of Japan and its largest city.')],
    expectType: 'place', expectContains: 'Tokyo',
  },
  {
    category: 'capitals/places', question: 'Where is the Eiffel Tower located?', lang: 'en',
    sources: [wikiEn('Eiffel Tower', 'The Eiffel Tower is located in Paris, France. It was completed in 1889 for the Paris World Fair.')],
    expectType: 'place', expectContains: 'Paris',
  },
  // ---- dates --------------------------------------------------------
  {
    category: 'dates', question: 'جنگ جهانی دوم در چه سالی آغاز شد؟', lang: 'fa',
    sources: [wikiFa('جنگ جهانی دوم', 'جنگ جهانی دوم در سال 1939 آغاز شد و تا سال 1945 ادامه یافت. این جنگ گسترده‌ترین درگیری نظامی تاریخ بشر به شمار می‌رود.')],
    expectType: 'date', expectContains: '1939',
  },
  {
    category: 'dates', question: 'When did World War II begin?', lang: 'en',
    sources: [wikiEn('World War II', 'World War II began in 1939 and lasted until 1945. It was the largest armed conflict in human history.')],
    expectType: 'date', expectContains: '1939',
  },
  {
    category: 'dates', question: 'انقلاب فرانسه در چه سالی رخ داد؟', lang: 'fa',
    sources: [wikiFa('انقلاب فرانسه', 'انقلاب فرانسه در سال 1789 رخ داد و نظام پادشاهی را سرنگون کرد. این انقلاب بر اندیشه سیاسی اروپا اثر عمیقی گذاشت.')],
    expectType: 'date', expectContains: '1789',
  },
  // ---- persons (authors) --------------------------------------------
  {
    category: 'persons', question: 'نویسنده شاهنامه کیست؟', lang: 'fa',
    sources: [wikiFa('شاهنامه', 'شاهنامه اثر حکیم ابوالقاسم فردوسی توسی است و از بزرگ‌ترین آثار حماسی جهان به شمار می‌رود. شاهنامه کتابی حماسی است که داستان‌های پهلوانان ایران را روایت می‌کند.')],
    expectType: 'person', expectContains: 'فردوسی',
  },
  {
    category: 'persons', question: 'نویسنده مثنوی معنوی کیست؟', lang: 'fa',
    sources: [wikiFa('مثنوی معنوی', 'مثنوی معنوی اثر مولانا جلال‌الدین محمد بلخی است و از مهم‌ترین آثار عرفانی زبان فارسی به شمار می‌رود. این کتاب شش دفتر دارد.')],
    expectType: 'person', expectContains: 'مولانا',
  },
  {
    category: 'persons', question: 'Who wrote Hamlet?', lang: 'en',
    sources: [wikiEn('Hamlet', 'Hamlet is a tragedy written by William Shakespeare. It is one of the most famous plays in English literature.')],
    expectType: 'person', expectContains: 'Shakespeare',
  },
  {
    category: 'persons', question: 'Who wrote Romeo and Juliet?', lang: 'en',
    sources: [wikiEn('Romeo and Juliet', 'Romeo and Juliet is a tragedy written by William Shakespeare. The play tells of two young lovers from feuding families.')],
    expectType: 'person', expectContains: 'Shakespeare',
  },
  // ---- why / how explanations ---------------------------------------
  {
    category: 'why/how', question: 'چرا آسمان آبی است؟', lang: 'fa',
    sources: [wikiFa('آسمان', 'آسمان آبی به نظر می‌رسد چون مولکول‌های هوا نور آبی خورشید را بیشتر پراکنده می‌کنند. در غروب، نور مسیر طولانی‌تری در جو می‌پیماید.')],
    expectType: 'why', expectContains: 'پراکنده',
  },
  {
    category: 'why/how', question: 'Why is the sky blue?', lang: 'en',
    sources: [wikiEn('Sky', 'The sky looks blue because air molecules scatter blue sunlight more than other colors. At sunset the light travels a longer path through the air.')],
    expectType: 'why', expectContains: 'scatter',
  },
  {
    category: 'why/how', question: 'نان خانگی چگونه تهیه می‌شود؟', lang: 'fa',
    sources: [wikiFa('نان خانگی', 'روش تهیه نان خانگی این است که ابتدا آرد و آب مخلوط می‌شوند و سپس خمیر ورز داده می‌شود و در فر پخته می‌شود. نان تازه بوی دلپذیری دارد.')],
    expectType: 'how', expectContains: 'فر',
  },
  {
    category: 'why/how', question: 'How do bees make honey?', lang: 'en',
    sources: [wikiEn('Honey', 'Bees make honey in several steps: they collect nectar, carry it to the hive, and fan it until it thickens. Honey has been valued as food for thousands of years.')],
    expectType: 'how', expectContains: 'nectar',
  },
  // ---- enumerations / lists ------------------------------------------
  {
    category: 'enumerations', question: 'سه میوه استوایی نام ببر', lang: 'fa',
    sources: [wikiFa('میوه‌های استوایی', 'میوه‌های استوایی عبارت‌اند از انبه، موز، آناناس و پاپایا. این میوه‌ها در مناطق گرم و مرطوب جهان می‌رویند.')],
    expectType: 'enumeration', expectContains: 'انبه',
  },
  {
    category: 'enumerations', question: 'List three primary colors', lang: 'en',
    sources: [wikiEn('Primary colors', 'The three primary colors are red, blue, and yellow. Mixing them in different proportions produces the other colors.')],
    expectType: 'enumeration', expectContains: 'red',
  },
  {
    category: 'enumerations', question: 'فهرست سه سیاره نزدیک به خورشید', lang: 'fa',
    sources: [wikiFa('سیاره‌های نزدیک خورشید', 'سیاره‌های نزدیک به خورشید عبارت‌اند از عطارد، زهره و زمین. عطارد کوچک‌ترین سیاره منظومه شمسی است.')],
    expectType: 'enumeration', expectContains: 'عطارد',
  },
  // ---- ranking / comparison (incl. one current question) -------------
  {
    category: 'ranking/comparison', question: 'کدام هوش مصنوعی در کدنویسی قوی‌تر است؟', lang: 'fa',
    sources: [wikiFa('هوش مصنوعی', 'در میان ابزارهای هوش مصنوعی، ابزار کدنویسی گیت‌هاب کوپایلت قوی‌ترین گزینه است. این ابزار به برنامه‌نویسان در نوشتن کد کمک می‌کند.')],
    expectType: 'ranking', expectContains: 'کوپایلت',
  },
  {
    category: 'ranking/comparison', question: 'Which AI is best for coding?', lang: 'en',
    sources: [wikiEn('Artificial intelligence', 'GitHub Copilot is the best AI tool for coding, outperforming other assistants on benchmarks. It helps programmers write code faster.')],
    expectType: 'ranking', expectContains: 'Copilot',
  },
  {
    category: 'ranking/comparison', question: 'بزرگ‌ترین سیاره منظومه شمسی کدام است؟', lang: 'fa',
    sources: [wikiFa('منظومه شمسی', 'مشتری بزرگ‌ترین سیاره منظومه شمسی است و از همه سیاره‌های دیگر بزرگ‌تر است. این سیاره گازی غول‌پیکر است.')],
    expectType: 'ranking', expectContains: 'مشتری',
  },
  {
    category: 'ranking/comparison', question: 'جدیدترین نسخه اندروید کدام است؟', lang: 'fa',
    sources: [wikiFa('اندروید', 'جدیدترین نسخه اندروید، اندروید 15 است که در سال 2024 منتشر شد. این نسخه بهبودهایی در حریم خصوصی دارد.')],
    expectType: 'current', expectContains: '15',
  },
  // ---- quantity (numbers + units) -------------------------------------
  {
    category: 'quantity', question: 'سرعت نور چقدر است؟', lang: 'fa',
    sources: [wikiFa('سرعت نور', 'نور موجی الکترومغناطیسی است که سرعت آن در خلأ ثابت است. سرعت نور در خلأ 299792458 متر بر ثانیه است و یکی از ثابت‌های بنیادی فیزیک به شمار می‌رود.')],
    expectType: 'quantity', expectContains: '299792458',
  },
  {
    category: 'quantity', question: 'جمعیت ایران چقدر است؟', lang: 'fa',
    sources: [wikiFa('ایران', 'ایران کشوری در غرب آسیا است. جمعیت ایران حدود 85 میلیون نفر است.')],
    expectType: 'quantity', expectContains: 'میلیون',
  },
  {
    category: 'quantity', question: 'What is the speed of light?', lang: 'en',
    sources: [wikiEn('Speed of light', 'Light is an electromagnetic wave whose speed in vacuum is constant. The speed of light in vacuum is 299792458 m/s.')],
    expectType: 'quantity', expectContains: '299792458',
  },
  // ---- nonsense: honest not-found, never a topical paragraph -----------
  {
    category: 'nonsense', question: 'پایتخت سیاره مریخ کجاست؟', lang: 'fa',
    sources: [wikiFa('مریخ', 'مریخ چهارمین سیاره منظومه شمسی است و سطح آن سرخ‌رنگ دیده می‌شود. مریخ دو قمر کوچک به نام‌های فوبوس و دیموس دارد.')],
    expectType: 'place', expectFound: false,
  },
  {
    category: 'nonsense', question: 'Who is the president of Mars?', lang: 'en',
    sources: [wikiEn('Mars', 'Mars is the fourth planet from the Sun. Its surface is covered in iron oxide dust.')],
    expectType: 'person', expectFound: false,
  },
  {
    category: 'nonsense', question: 'قیمت بلیت سفر به کهکشان آندرومدا چقدر است؟', lang: 'fa',
    sources: [wikiFa('کهکشان آندرومدا', 'کهکشان آندرومدا نزدیک‌ترین کهکشان بزرگ به کهکشان راه شیری است و در آسمان شب با چشم غیرمسلح دیده می‌شود.')],
    expectType: 'quantity', expectFound: false,
  },
]

describe('A-02 benchmark — student questions across categories', () => {
  for (const c of CASES) {
    it(`${c.category}: ${c.question}`, () => {
      expect(analyzeQuestion(c.question).type).toBe(c.expectType)
      const ans = buildAnswer(c.sources, c.question, c.lang)
      if (c.expectFound === false) {
        expect(ans.found).toBe(false)
        expect(ans.lines).toEqual([])
        return
      }
      expect(ans.found).toBe(true)
      expect(ans.lines.join(' ')).toContain(c.expectContains)
      // Sources are ALWAYS credited, in the engine itself.
      const credit = ans.lines[ans.lines.length - 1]
      expect(credit).toMatch(c.lang === 'fa' ? /^منبع:/ : /^Source:/)
      expect(credit).toContain('http')
    })
  }
})

describe('A-02 benchmark — multi-part question', () => {
  it('splits a two-part question and answers each part from its own source', () => {
    const q = 'پایتخت فرانسه چیست و جمعیتش چقدر است؟'
    const parts = decomposeQuestion(q)
    expect(parts).toHaveLength(2)
    const subs = subQuestionQueries(q)
    expect(subs).toHaveLength(2)
    // The follow-up part inherits the first part's subject noun.
    expect(subs[1].query).toContain('فرانسه')
    const france = [wikiFa('فرانسه', 'فرانسه کشوری در اروپای غربی است و پایتخت آن شهر پاریس می باشد.')]
    const francePop = [wikiFa('فرانسه', 'جمعیت فرانسه حدود 68 میلیون نفر است.')]
    expect(buildAnswer(france, parts[0], 'fa').lines.join(' ')).toContain('پاریس')
    expect(buildAnswer(francePop, subs[1].query, 'fa').lines.join(' ')).toContain('میلیون')
  })
})

describe('A-02 tightening — known honest leftovers, expressed generally', () => {
  it('(a) a [mm:ss] transcript timestamp fragment must not surface in the answer', () => {
    const src = [wikiFa('فوتوسنتز', '[12:34] فوتوسنتز فرایندی است که گیاهان با آن نور خورشید را به انرژی شیمیایی تبدیل می‌کنند. گیاهان سبز رنگدانه کلروفیل دارند و در برگ‌های خود فوتوسنتز انجام می‌دهند.')]
    const ans = buildAnswer(src, 'فوتوسنتز چیست؟', 'fa')
    expect(ans.found).toBe(true)
    // The answer sentence is found, but its timestamp fragment must
    // be stripped before it reaches the user.
    expect(ans.lines.join(' ')).not.toContain('12:34')
    expect(ans.lines.join(' ')).not.toMatch(/\[\d+:\d+\]/)
  })
  it('(b) a loosely-related secondary-source sentence must not displace the top-source answer', () => {
    const top = wikiFa('ماه', 'ماه نور خورشید را منعکس می‌کند. ماه قمری طبیعی زمین است و سطح آن پوشیده از دهانه‌های برخوردی است.')
    const secondary = wikiFa('آسمان شب', 'ماه در شب می‌درخشد و ستاره‌ها هم در شب دیده می‌شوند چون آسمان شب تاریک است. ستاره‌ها اجرام داغ و درخشانی هستند که نور خود را منتشر می‌کنند.')
    const ans = buildAnswer([top, secondary], 'چرا ماه در شب می‌درخشد؟', 'fa')
    expect(ans.found).toBe(true)
    // The top source's own answer (reflection of sunlight) must win;
    // the secondary sentence only shares words with the question and
    // is about the night sky, not the reason the moon shines.
    expect(ans.lines.join(' ')).toContain('منعکس')
    expect(ans.lines.join(' ')).not.toContain('ستاره‌ها')
  })
})
