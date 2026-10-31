export type DocDir = 'ltr'|'rtl'
export function resolveDir(input?: string|null): DocDir { return input==='rtl' ? 'rtl' : 'ltr' }
export function dirFromLanguage(lang?: string|null): DocDir { if(!lang) return 'ltr'; const l=lang.toLowerCase(); return (l.startsWith('fa')||l.startsWith('ar')||l.startsWith('ps')||l.startsWith('ur')) ? 'rtl':'ltr' }
export function toggleDir(d: DocDir): DocDir { return d==='rtl'?'ltr':'rtl' }
export function textAlignForDir(d: DocDir): 'right'|'left' { return d==='rtl'?'right':'left' }
export function containsRtlScript(text: string): boolean { return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text) }
export function detectDirFromText(text: string): DocDir { return containsRtlScript(text.slice(0,500)) ? 'rtl':'ltr' }

/**
 * Tier-1 S3: the BCP-47 language tag advertised to the browser for a
 * document (drives which dictionary the BROWSER's spellchecker uses).
 *
 * The document model stores direction only — there is no per-document
 * language field, and direction alone cannot uniquely identify a language
 * (Arabic, Urdu and Pashto are also RTL; many languages are LTR). This is
 * the conservative documented fallback, NOT a language detector:
 *   rtl -> 'fa'  (Vyro's RTL pipeline is Persian/Dari end to end: the
 *                 stats tokenizer, date formatting and search
 *                 normalisation all assume fa, so an RTL Vyro document is
 *                 Persian/Dari by product design)
 *   ltr -> 'en'  (the product's LTR language)
 * Known limitation: an Arabic RTL document would be tagged 'fa'. Adding a
 * real per-document language field is a data-model change, deliberately
 * out of scope here.
 */
export function languageTagForDir(dir: DocDir): string {
  return dir === 'rtl' ? 'fa' : 'en'
}
