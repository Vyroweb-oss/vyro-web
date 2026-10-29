import type { DocDir } from './dir'

// Format a date for insertion into a document. The format follows the
// DOCUMENT's direction/language, never the UI language: RTL (Dari/Persian)
// documents get a fa-AF long date (Persian calendar + Persian digits);
// LTR documents get an en-GB long date (e.g. "29 October 2026").
export function formatDocDate(dir: DocDir, date: Date = new Date()): string {
  const locale = dir === 'rtl' ? 'fa-AF' : 'en-GB'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date)
}
