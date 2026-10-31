// PC2 Mailings — real local CSV mail merge. Everything here is pure and
// synchronous: the CSV never leaves the browser (no upload, no network).
// The panel owns the UI; this lib owns parsing + substitution so both are
// unit-testable without an editor.

export const MAIL_MERGE_MAX_RECORDS = 200

export type MailMergeErrorCode =
  | 'empty'
  | 'duplicateHeader'
  | 'blankHeader'
  | 'tooManyRecords'
  | 'unterminatedQuote'

export type ParseCsvResult =
  | { ok: true; fields: string[]; records: Record<string, string>[] }
  | { ok: false; error: MailMergeErrorCode; detail?: string }

type RawField = { value: string; quoted: boolean }
type RawRow = RawField[]

/** Parse CSV text: quoted fields, embedded commas/quotes/newlines, CRLF,
 *  a header row, empty lines skipped. Header names are trimmed; a blank or
 *  duplicated header is an error. Unquoted values are trimmed (hand-typed
 *  "Name, Kabul" must not substitute " Kabul"); quoted values are kept
 *  verbatim. Rows shorter than the header are padded with ''; extra values
 *  beyond the header are ignored. */
export function parseCsv(text: string): ParseCsvResult {
  const rows: RawRow[] = []
  let row: RawField[] = []
  let field = ''
  let inQuotes = false
  let fieldQuoted = false
  let i = 0
  const pushField = () => {
    row.push({ value: fieldQuoted ? field : field.trim(), quoted: fieldQuoted })
    field = ''
    fieldQuoted = false
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      if (field === '') {
        inQuotes = true
        fieldQuoted = true
        i += 1
        continue
      }
      // A quote mid-field (unquoted field) is kept literally.
      field += ch
      i += 1
      continue
    }
    if (ch === ',') {
      pushField()
      i += 1
      continue
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1
      pushRow()
      i += 1
      continue
    }
    if (ch === '\n') {
      pushRow()
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (inQuotes) return { ok: false, error: 'unterminatedQuote' }
  // Trailing content without a final newline is still a row.
  if (field !== '' || fieldQuoted || row.length > 0) pushRow()

  // Empty lines skipped: a row whose every field is blank.
  const nonEmpty = rows.filter((r) => r.some((f) => f.value !== ''))
  if (nonEmpty.length === 0) return { ok: false, error: 'empty' }
  const headerRow = nonEmpty[0]
  const fields = headerRow.map((f) => f.value.trim())
  const seen = new Set<string>()
  for (const f of fields) {
    if (f === '') return { ok: false, error: 'blankHeader' }
    if (seen.has(f)) return { ok: false, error: 'duplicateHeader', detail: f }
    seen.add(f)
  }
  const records: Record<string, string>[] = []
  for (const r of nonEmpty.slice(1)) {
    const rec: Record<string, string> = {}
    fields.forEach((f, idx) => {
      rec[f] = idx < r.length ? r[idx].value : ''
    })
    records.push(rec)
  }
  if (records.length > MAIL_MERGE_MAX_RECORDS) {
    return { ok: false, error: 'tooManyRecords', detail: String(records.length) }
  }
  return { ok: true, fields, records }
}

const PLACEHOLDER_RE = /\{\{\s*([^{}]*?)\s*\}\}/g

function walkTextNodes(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return
  if (node.type === 'text' && typeof node.text === 'string') visit(node)
  if (Array.isArray(node.content)) node.content.forEach((c: any) => walkTextNodes(c, visit))
}

/** Field names used in the document, in first-appearance order. Text nodes
 *  only — marks, attrs and non-text nodes are never scanned. */
export function extractPlaceholders(doc: any): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  walkTextNodes(doc, (n) => {
    PLACEHOLDER_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PLACEHOLDER_RE.exec(n.text)) !== null) {
      const name = m[1].trim()
      if (name !== '' && !seen.has(name)) {
        seen.add(name)
        out.push(name)
      }
    }
  })
  return out
}

/** Fields the document uses but the CSV does not provide. */
export function missingFields(doc: any, fields: string[]): string[] {
  const have = new Set(fields)
  return extractPlaceholders(doc).filter((f) => !have.has(f))
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

/** Substitute {{Field}} placeholders in a deep copy of the TipTap JSON.
 *  Text nodes only; every other node (images, tables, attrs) passes through
 *  untouched, and the input JSON is never mutated. Placeholders for fields
 *  absent from the record are left as-is and reported in `unsubstituted`. */
export function substituteDoc(
  doc: any,
  record: Record<string, string>,
): { doc: any; unsubstituted: string[] } {
  const copy = deepCopy(doc)
  const unsubstituted: string[] = []
  const seen = new Set<string>()
  walkTextNodes(copy, (n) => {
    PLACEHOLDER_RE.lastIndex = 0
    n.text = n.text.replace(PLACEHOLDER_RE, (_full: string, raw: string) => {
      const name = raw.trim()
      if (name === '') return _full
      if (Object.prototype.hasOwnProperty.call(record, name)) return record[name]
      if (!seen.has(name)) {
        seen.add(name)
        unsubstituted.push(name)
      }
      return _full
    })
  })
  return { doc: copy, unsubstituted }
}
