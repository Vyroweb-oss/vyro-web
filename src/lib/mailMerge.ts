// PC2 Mailings — real local CSV mail merge. Everything here is pure and
// synchronous: the CSV never leaves the browser (no upload, no network).
// The panel owns the UI; this lib owns parsing + substitution so both are
// unit-testable without an editor.

export const MAIL_MERGE_MAX_RECORDS = 200

/**
 * Tier-1 S4c: hard cap on CSV input size, in UTF-8 BYTES (1 MB).
 * Rationale: the record cap is 200 rows, so a legitimate merge file is
 * tiny — even 200 rows of 1 KB each is 200 KB. 1 MB leaves generous
 * headroom for wide/long fields while keeping paste-and-parse fully
 * responsive and memory-trivial; anything larger is almost certainly the
 * wrong file. The panel enforces this on the File object BEFORE reading
 * it, and parseCsv enforces it again at entry (the paste path), before a
 * single row is tokenized.
 */
export const MAIL_MERGE_MAX_CSV_BYTES = 1_000_000

export type MailMergeErrorCode =
  | 'empty'
  | 'duplicateHeader'
  | 'blankHeader'
  | 'tooManyRecords'
  | 'unterminatedQuote'
  | 'tooLarge'

/**
 * A data row whose field count differs from the header's. `row` uses the
 * documented convention: 1-based LOGICAL records in file order — the
 * header is row 1, the first data row is row 2, blank lines count (they
 * are records too, just skipped), and a quoted field containing newlines
 * is still ONE record.
 */
export interface CsvRowWarning {
  row: number
  expected: number
  actual: number
}

export type ParseCsvResult =
  | { ok: true; fields: string[]; records: Record<string, string>[]; warnings: CsvRowWarning[] }
  | { ok: false; error: MailMergeErrorCode; detail?: string }

type RawField = { value: string; quoted: boolean }
type RawRow = RawField[]

/** Parse CSV text: quoted fields, embedded commas/quotes/newlines, CRLF,
 *  a header row, empty lines skipped. Header names are trimmed; a blank or
 *  duplicated header is an error. Unquoted values are trimmed (hand-typed
 *  "Name, Kabul" must not substitute " Kabul"); quoted values are kept
 *  verbatim. Rows are mapped POSITIONALLY (that mapping is unambiguous):
 *  a short row's missing fields become '' and a long row's extra values
 *  cannot be used — both cases are REPORTED in `warnings` with their row
 *  numbers, never silently absorbed. Inputs over MAIL_MERGE_MAX_CSV_BYTES
 *  are rejected before tokenizing. */
export function parseCsv(text: string): ParseCsvResult {
  const byteLength = new TextEncoder().encode(text).length
  if (byteLength > MAIL_MERGE_MAX_CSV_BYTES) {
    return { ok: false, error: 'tooLarge', detail: `${Math.round(byteLength / 1024)} KB` }
  }
  const rows: RawRow[] = []
  const rowNos: number[] = []
  let recordNo = 0
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
    recordNo += 1
    rowNos.push(recordNo)
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

  // Empty lines skipped: a row whose every field is blank. The record
  // number travels with the row so warnings can name it exactly.
  const nonEmpty = rows
    .map((r, idx) => ({ fields: r, no: rowNos[idx] }))
    .filter((r) => r.fields.some((f) => f.value !== ''))
  if (nonEmpty.length === 0) return { ok: false, error: 'empty' }
  const headerRow = nonEmpty[0].fields
  const fields = headerRow.map((f) => f.value.trim())
  const seen = new Set<string>()
  for (const f of fields) {
    if (f === '') return { ok: false, error: 'blankHeader' }
    if (seen.has(f)) return { ok: false, error: 'duplicateHeader', detail: f }
    seen.add(f)
  }
  const records: Record<string, string>[] = []
  const warnings: CsvRowWarning[] = []
  for (const r of nonEmpty.slice(1)) {
    if (r.fields.length !== fields.length) {
      warnings.push({ row: r.no, expected: fields.length, actual: r.fields.length })
    }
    const rec: Record<string, string> = {}
    fields.forEach((f, idx) => {
      rec[f] = idx < r.fields.length ? r.fields[idx].value : ''
    })
    records.push(rec)
  }
  if (records.length > MAIL_MERGE_MAX_RECORDS) {
    return { ok: false, error: 'tooManyRecords', detail: String(records.length) }
  }
  return { ok: true, fields, records, warnings }
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

/**
 * Tier-1 S4b: record-navigation helpers (pure, so the panel's boundary
 * behaviour is unit-testable). Indices are always clamped into the valid
 * range; an empty record set always yields 0 and navigation is a no-op.
 */
export function clampRecordIndex(index: number, count: number): number {
  if (count <= 0) return 0
  if (!Number.isFinite(index) || index < 0) return 0
  return Math.min(Math.floor(index), count - 1)
}

export type RecordNav = 'first' | 'prev' | 'next' | 'last'

export function navRecordIndex(index: number, count: number, nav: RecordNav): number {
  const cur = clampRecordIndex(index, count)
  if (count <= 0) return 0
  switch (nav) {
    case 'first': return 0
    case 'prev': return Math.max(0, cur - 1)
    case 'next': return Math.min(count - 1, cur + 1)
    case 'last': return count - 1
  }
}
