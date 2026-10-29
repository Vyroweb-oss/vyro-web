export type DocDir = 'ltr'|'rtl'
export function resolveDir(input?: string|null): DocDir { return input==='rtl' ? 'rtl' : 'ltr' }
export function dirFromLanguage(lang?: string|null): DocDir { if(!lang) return 'ltr'; const l=lang.toLowerCase(); return (l.startsWith('fa')||l.startsWith('ar')||l.startsWith('ps')||l.startsWith('ur')) ? 'rtl':'ltr' }
export function toggleDir(d: DocDir): DocDir { return d==='rtl'?'ltr':'rtl' }
export function textAlignForDir(d: DocDir): 'right'|'left' { return d==='rtl'?'right':'left' }
export function containsRtlScript(text: string): boolean { return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text) }
export function detectDirFromText(text: string): DocDir { return containsRtlScript(text.slice(0,500)) ? 'rtl':'ltr' }
