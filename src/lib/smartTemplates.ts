// M2-12 Smart Templates & document forms — built ON TOP of the existing
// static templates in templates.ts (never duplicating them). A smart template
// adds fillable fields + a required-sections checklist to a base template:
// the user fills a form, values are substituted into a FRESH deep copy of
// the body, and a real editable TipTap document is created. Template bodies
// are never mutated and never shared between documents.
import type { DocDir } from './dir'

export const SMART_COPIES_KEY = 'vyro-web-smart-templates-v1'

export type SmartFieldType = 'text' | 'date' | 'number'
export interface SmartField {
  key: string
  labelEn: string
  labelFa: string
  type: SmartFieldType
  required: boolean
}
export interface SmartSection {
  id: string
  titleEn: string
  titleFa: string
  /** Form field keys that fill this section. Empty = completed in the editor, not the form. */
  fieldKeys: string[]
  required: boolean
}
export interface SmartTemplate {
  id: string
  baseTemplateId: string
  nameEn: string
  nameFa: string
  descEn: string
  descFa: string
  dir: DocDir
  fields: SmartField[]
  sections: SmartSection[]
  body: any
  personal?: boolean
}

export function smartName(t: SmartTemplate, lang: 'en' | 'fa'): string { return lang === 'fa' ? t.nameFa : t.nameEn }
export function smartDesc(t: SmartTemplate, lang: 'en' | 'fa'): string { return lang === 'fa' ? t.descFa : t.descEn }
export function smartFieldLabel(f: SmartField, lang: 'en' | 'fa'): string { return lang === 'fa' ? f.labelFa : f.labelEn }
export function smartSectionTitle(s: SmartSection, lang: 'en' | 'fa'): string { return lang === 'fa' ? s.titleFa : s.titleEn }

function deepCopy<T>(v: T): T { return v === undefined ? v : JSON.parse(JSON.stringify(v)) }
function p(text: string) { return { type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined } }
function h(level: number, text: string) { return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] } }
function bp(items: string[]) { return { type: 'bulletList', content: items.map(t => ({ type: 'listItem', content: [p(t)] })) } }
function doc(nodes: any[]) { return { type: 'doc', content: nodes } }

export const SMART_TEMPLATES: SmartTemplate[] = [
  {
    id: 'smart-formal-letter', baseTemplateId: 'formal-letter',
    nameEn: 'Formal letter (form)', nameFa: 'نامهٔ رسمی (فرم)',
    descEn: 'Fill a form — name, date, subject — and get an editable letter',
    descFa: 'فرم را پر کنید — نام، تاریخ، موضوع — و نامهٔ قابل‌ویرایش بگیرید',
    dir: 'ltr',
    fields: [
      { key: 'senderName', labelEn: 'Your name', labelFa: 'نام شما', type: 'text', required: true },
      { key: 'senderAddress', labelEn: 'Your address', labelFa: 'نشانی شما', type: 'text', required: false },
      { key: 'date', labelEn: 'Date', labelFa: 'تاریخ', type: 'date', required: true },
      { key: 'recipientName', labelEn: 'Recipient name', labelFa: 'نام گیرنده', type: 'text', required: true },
      { key: 'subject', labelEn: 'Subject', labelFa: 'موضوع', type: 'text', required: true },
      { key: 'referenceNumber', labelEn: 'Reference number', labelFa: 'شمارهٔ مرجع', type: 'number', required: false },
    ],
    sections: [
      { id: 'sender', titleEn: 'Sender', titleFa: 'فرستنده', fieldKeys: ['senderName', 'senderAddress'], required: true },
      { id: 'recipient-date', titleEn: 'Recipient & date', titleFa: 'گیرنده و تاریخ', fieldKeys: ['recipientName', 'date'], required: true },
      { id: 'subject', titleEn: 'Subject', titleFa: 'موضوع', fieldKeys: ['subject'], required: true },
      { id: 'reference', titleEn: 'Reference', titleFa: 'مرجع', fieldKeys: ['referenceNumber'], required: false },
      { id: 'body', titleEn: 'Letter body', titleFa: 'متن نامه', fieldKeys: [], required: true },
    ],
    body: doc([p('{{senderName}}'), p('{{senderAddress}}'), p('Date: {{date}}'), h(1, 'Formal Letter'), p('Subject: {{subject}}'), p('Reference: {{referenceNumber}}'), p('Dear {{recipientName}},'), p('I am writing regarding {{subject}}.'), p('Thank you for your consideration.'), p('Sincerely,'), p('{{senderName}}')]),
  },
  {
    id: 'smart-dari-letter', baseTemplateId: 'dari-letter',
    nameEn: 'نامه رسمی (form)', nameFa: 'نامهٔ رسمی دری (فرم)',
    descEn: 'Dari formal letter form — RTL, fill in Dari and create the letter',
    descFa: 'فرم نامهٔ رسمی دری — راست‌به‌چپ، به دری پر کنید و نامه را بسازید',
    dir: 'rtl',
    fields: [
      { key: 'fullName', labelEn: 'Full name', labelFa: 'نام و نام خانوادگی', type: 'text', required: true },
      { key: 'date', labelEn: 'Date', labelFa: 'تاریخ', type: 'date', required: true },
      { key: 'recipient', labelEn: 'Recipient', labelFa: 'گیرنده', type: 'text', required: true },
      { key: 'subject', labelEn: 'Subject', labelFa: 'موضوع', type: 'text', required: true },
      { key: 'referenceNumber', labelEn: 'Reference number', labelFa: 'شمارهٔ مرجع', type: 'number', required: false },
    ],
    sections: [
      { id: 'sender', titleEn: 'Sender', titleFa: 'فرستنده', fieldKeys: ['fullName', 'date'], required: true },
      { id: 'recipient-subject', titleEn: 'Recipient & subject', titleFa: 'گیرنده و موضوع', fieldKeys: ['recipient', 'subject'], required: true },
      { id: 'reference', titleEn: 'Reference', titleFa: 'مرجع', fieldKeys: ['referenceNumber'], required: false },
      { id: 'body', titleEn: 'Letter body', titleFa: 'متن نامه', fieldKeys: [], required: true },
    ],
    body: doc([h(1, 'نامه رسمی'), p('به نام خدا'), p('{{fullName}}'), p('تاریخ: {{date}}'), p('به: {{recipient}}'), p('موضوع: {{subject}}'), p('احتراماً، این‌جانب {{fullName}} به استحضار می‌رسانم که در مورد {{subject}} می‌خواهم اقدام شود.'), p('با احترام'), p('{{fullName}}'), p('شمارهٔ مرجع: {{referenceNumber}}')]),
  },
  {
    id: 'smart-meeting-minutes', baseTemplateId: 'meeting-minutes',
    nameEn: 'Meeting minutes (form)', nameFa: 'صورت‌جلسه (فرم)',
    descEn: 'Dari meeting minutes form — title, date, chairperson, then complete the rest in the editor',
    descFa: 'فرم صورت‌جلسهٔ دری — عنوان، تاریخ، رئیس جلسه؛ بقیه در ویرایشگر تکمیل می‌شود',
    dir: 'rtl',
    fields: [
      { key: 'meetingTitle', labelEn: 'Meeting subject', labelFa: 'موضوع جلسه', type: 'text', required: true },
      { key: 'date', labelEn: 'Date', labelFa: 'تاریخ', type: 'date', required: true },
      { key: 'location', labelEn: 'Location', labelFa: 'مکان', type: 'text', required: false },
      { key: 'chairperson', labelEn: 'Chairperson', labelFa: 'رئیس جلسه', type: 'text', required: true },
      { key: 'recorder', labelEn: 'Minute taker', labelFa: 'ثبت‌کننده', type: 'text', required: false },
    ],
    sections: [
      { id: 'details', titleEn: 'Meeting details', titleFa: 'مشخصات جلسه', fieldKeys: ['meetingTitle', 'date', 'location'], required: true },
      { id: 'chair', titleEn: 'Chair & recorder', titleFa: 'رئیس و ثبت‌کننده', fieldKeys: ['chairperson', 'recorder'], required: true },
      { id: 'participants', titleEn: 'Participants', titleFa: 'اشتراک‌کنندگان', fieldKeys: [], required: true },
      { id: 'agenda', titleEn: 'Agenda', titleFa: 'آجندا', fieldKeys: [], required: true },
      { id: 'decisions', titleEn: 'Decisions', titleFa: 'تصمیم‌ها', fieldKeys: [], required: true },
      { id: 'tasks', titleEn: 'Tasks & responsibilities', titleFa: 'وظایف و مسئولیت‌ها', fieldKeys: [], required: true },
    ],
    body: doc([h(1, 'صورت‌جلسه'), p('به نام خدا'), p('موضوع جلسه: {{meetingTitle}}'), p('تاریخ: {{date}}'), p('مکان: {{location}}'), p('رئیس جلسه: {{chairperson}}'), p('ثبت‌کننده: {{recorder}}'), h(2, 'اشتراک‌کنندگان'), bp(['نام و سمت اشتراک‌کنندهٔ اول', 'نام و سمت اشتراک‌کنندهٔ دوم']), h(2, 'آجندای جلسه'), bp(['موضوع اول', 'موضوع دوم']), h(2, 'تصمیم‌ها'), bp(['تصمیم اول: ...']), h(2, 'وظایف و مسئولیت‌ها'), bp(['وظیفه: ... — مسئول: ... — مهلت: ...']), p('جلسه در ساعت ... خاتمه یافت.'), p('امضا: ...')]),
  },
  {
    id: 'smart-official-request', baseTemplateId: 'official-request',
    nameEn: 'Official request (form)', nameFa: 'درخواست رسمی (فرم)',
    descEn: 'Dari official request form — applicant, subject, date, phone',
    descFa: 'فرم درخواست رسمی دری — متقاضی، موضوع، تاریخ، شمارهٔ تماس',
    dir: 'rtl',
    fields: [
      { key: 'fullName', labelEn: 'Full name', labelFa: 'نام و نام خانوادگی', type: 'text', required: true },
      { key: 'fatherName', labelEn: "Father's name", labelFa: 'نام پدر', type: 'text', required: false },
      { key: 'subject', labelEn: 'Subject', labelFa: 'موضوع', type: 'text', required: true },
      { key: 'date', labelEn: 'Date', labelFa: 'تاریخ', type: 'date', required: true },
      { key: 'phone', labelEn: 'Phone number', labelFa: 'شمارهٔ تماس', type: 'number', required: false },
    ],
    sections: [
      { id: 'applicant', titleEn: 'Applicant', titleFa: 'متقاضی', fieldKeys: ['fullName', 'fatherName'], required: true },
      { id: 'request', titleEn: 'Request', titleFa: 'درخواست', fieldKeys: ['subject', 'date'], required: true },
      { id: 'contact', titleEn: 'Contact', titleFa: 'تماس', fieldKeys: ['phone'], required: false },
      { id: 'body', titleEn: 'Request body', titleFa: 'متن درخواست', fieldKeys: [], required: true },
    ],
    body: doc([h(1, 'درخواست رسمی'), p('به نام خدا'), p('به: ریاست / ادارهٔ محترم'), p('موضوع: {{subject}}'), p('احتراماً، این‌جانب {{fullName}} فرزند {{fatherName}}، به استحضار می‌رسانم که در مورد {{subject}} درخواست می‌کنم.'), p('بنا بر این، خواهشمندم دستور فرمایید تا اقدام لازم انجام شود. از همکاری و توجه شما پیشاپیش سپاسگزارم.'), p('با احترام'), p('نام و تخلص: {{fullName}}'), p('تاریخ: {{date}}'), p('شمارهٔ تماس: {{phone}}')]),
  },
]

export function getSmartTemplate(id: string, copies: SmartTemplate[] = []): SmartTemplate | undefined {
  return [...SMART_TEMPLATES, ...copies].find(t => t.id === id)
}

/** All values blank — the form-reset state. Always a fresh object. */
export function blankSmartValues(tpl: SmartTemplate): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of tpl.fields) out[f.key] = ''
  return out
}

const HAS_DIGIT = /[0-9\u06F0-\u06F9\u0660-\u0669]/
export interface SmartValidation { ok: boolean; missing: string[]; invalid: string[] }
export function validateSmartForm(tpl: SmartTemplate, values: Record<string, string>): SmartValidation {
  const missing: string[] = []
  const invalid: string[] = []
  for (const f of tpl.fields) {
    const v = (values[f.key] ?? '').trim()
    if (f.required && !v) { missing.push(f.key); continue }
    if (v && f.type === 'number' && !HAS_DIGIT.test(v)) invalid.push(f.key)
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid }
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g
/**
 * Substitute {{key}} placeholders in a FRESH deep copy of the body. Known
 * field keys with a blank value become empty text; unknown placeholders are
 * left intact so nothing is silently swallowed. The template body is never
 * mutated, and no text is normalised — Dari ZWNJ characters pass through
 * byte-for-byte.
 */
export function substitutePlaceholders(body: any, tpl: SmartTemplate, values: Record<string, string>): any {
  const known = new Set(tpl.fields.map(f => f.key))
  const out = deepCopy(body)
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text' && typeof node.text === 'string') {
      node.text = node.text.replace(PLACEHOLDER, (m: string, key: string) => known.has(key) ? (values[key] ?? '') : m)
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(out)
  return out
}

export type SectionStatus = 'complete' | 'incomplete' | 'editor'
export interface SectionCheck { section: SmartSection; status: SectionStatus; missingFields: string[] }
/** Live checklist: a section is complete when every required field in it is filled and valid. */
export function sectionChecklist(tpl: SmartTemplate, values: Record<string, string>): SectionCheck[] {
  const validation = validateSmartForm(tpl, values)
  const bad = new Set([...validation.missing, ...validation.invalid])
  return tpl.sections.map(section => {
    if (section.fieldKeys.length === 0) return { section, status: 'editor' as SectionStatus, missingFields: [] }
    const missingFields = section.fieldKeys.filter(k => {
      const f = tpl.fields.find(x => x.key === k)
      return f?.required && bad.has(k)
    })
    return { section, status: missingFields.length === 0 ? 'complete' as SectionStatus : 'incomplete' as SectionStatus, missingFields }
  })
}
/** Required sections still incomplete in the form (editor sections excluded — they are completed after creation). */
export function incompleteSections(tpl: SmartTemplate, values: Record<string, string>): SmartSection[] {
  return sectionChecklist(tpl, values).filter(c => c.section.required && c.status === 'incomplete').map(c => c.section)
}

export type SmartDocumentResult =
  | { ok: true; content: any; title: string }
  | { ok: false; missing: string[]; invalid: string[] }
/**
 * Validate, then build the real editable document. On validation failure no
 * document is produced. The returned content is a fresh object owned by the
 * caller — creating a second document from the same template can never leak
 * values from the first.
 */
export function createSmartDocument(tpl: SmartTemplate, values: Record<string, string>): SmartDocumentResult {
  const v = validateSmartForm(tpl, values)
  if (!v.ok) return { ok: false, missing: v.missing, invalid: v.invalid }
  const content = substitutePlaceholders(tpl.body, tpl, values)
  const subject = (values.subject ?? '').trim() || (values.meetingTitle ?? '').trim()
    || (values.senderName ?? '').trim() || (values.fullName ?? '').trim() || 'Untitled'
  const baseName = tpl.dir === 'rtl' ? tpl.nameFa : tpl.nameEn
  return { ok: true, content, title: `${baseName} — ${subject}` }
}

/**
 * Duplicate a template WITHOUT altering the original: full deep copy under
 * a new id, marked personal. Mutating the copy (fields, sections, body)
 * can never affect the source.
 */
export function duplicateSmartTemplate(tpl: SmartTemplate, newId: string, nameEn?: string, nameFa?: string): SmartTemplate {
  const copy = deepCopy(tpl) as SmartTemplate
  copy.id = newId
  copy.personal = true
  if (nameEn) copy.nameEn = nameEn
  if (nameFa) copy.nameFa = nameFa
  return copy
}

/** Personal template copies persisted in localStorage (never in the docs store). */
export function loadSmartCopies(storage: Pick<Storage, 'getItem'>): SmartTemplate[] {
  try {
    const raw = storage.getItem(SMART_COPIES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t: any) =>
      t && typeof t.id === 'string' && t.id && t.body && typeof t.body === 'object'
      && Array.isArray(t.fields) && Array.isArray(t.sections))
  } catch { return [] }
}
/** Returns true on success, false when storage rejects the write. Never throws. */
export function saveSmartCopies(storage: Pick<Storage, 'setItem'>, copies: SmartTemplate[]): boolean {
  try { storage.setItem(SMART_COPIES_KEY, JSON.stringify(copies)); return true } catch { return false }
}
