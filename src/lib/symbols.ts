// Curated symbol catalogue for the Insert > Symbols panel (P2-13,
// Microsoft Word parity). Pure data + search helpers — no DOM, no
// document mutation. Every entry is exactly one printable code point
// that renders in a normal font: no emoji, no multi-codepoint
// sequences (no ZWJ, no variation selectors), no whitespace.

export interface SymbolEntry {
  char: string
  name: string
}

export type SymbolCategoryId = 'punctuation' | 'math' | 'currency' | 'arrows' | 'greek'

export const SYMBOL_CATEGORIES: ReadonlyArray<{
  id: SymbolCategoryId
  entries: ReadonlyArray<SymbolEntry>
}> = [
  {
    id: 'punctuation',
    entries: [
      { char: '•', name: 'bullet' },
      { char: '·', name: 'middle dot' },
      { char: '–', name: 'en dash' },
      { char: '—', name: 'em dash' },
      { char: '‘', name: 'left single quote' },
      { char: '’', name: 'right single quote' },
      { char: '“', name: 'left double quote' },
      { char: '”', name: 'right double quote' },
      { char: '…', name: 'ellipsis' },
      { char: '§', name: 'section sign' },
      { char: '¶', name: 'pilcrow' },
      { char: '©', name: 'copyright sign' },
    ],
  },
  {
    id: 'math',
    entries: [
      { char: '+', name: 'plus sign' },
      { char: '−', name: 'minus sign' },
      { char: '×', name: 'multiplication sign' },
      { char: '÷', name: 'division sign' },
      { char: '=', name: 'equals sign' },
      { char: '≠', name: 'not equal to' },
      { char: '≈', name: 'almost equal to' },
      { char: '≤', name: 'less than or equal to' },
      { char: '≥', name: 'greater than or equal to' },
      { char: '±', name: 'plus minus sign' },
      { char: '√', name: 'square root' },
      { char: '∞', name: 'infinity' },
      { char: '∑', name: 'summation' },
      { char: '∫', name: 'integral' },
    ],
  },
  {
    id: 'currency',
    entries: [
      { char: '$', name: 'dollar sign' },
      { char: '€', name: 'euro sign' },
      { char: '£', name: 'pound sign' },
      { char: '¥', name: 'yen sign' },
      { char: '₹', name: 'rupee sign' },
      { char: '₽', name: 'ruble sign' },
      { char: '¢', name: 'cent sign' },
      { char: '₩', name: 'won sign' },
      { char: '₺', name: 'lira sign' },
      { char: '₴', name: 'hryvnia sign' },
      { char: '؋', name: 'afghani sign' },
    ],
  },
  {
    id: 'arrows',
    entries: [
      { char: '←', name: 'leftwards arrow' },
      { char: '↑', name: 'upwards arrow' },
      { char: '→', name: 'rightwards arrow' },
      { char: '↓', name: 'downwards arrow' },
      { char: '↔', name: 'left right arrow' },
      { char: '↕', name: 'up down arrow' },
      { char: '↖', name: 'north west arrow' },
      { char: '↗', name: 'north east arrow' },
      { char: '↘', name: 'south east arrow' },
      { char: '↙', name: 'south west arrow' },
      { char: '⇒', name: 'rightwards double arrow' },
      { char: '⇐', name: 'leftwards double arrow' },
    ],
  },
  {
    id: 'greek',
    entries: [
      { char: 'α', name: 'alpha' },
      { char: 'β', name: 'beta' },
      { char: 'γ', name: 'gamma' },
      { char: 'δ', name: 'delta' },
      { char: 'ε', name: 'epsilon' },
      { char: 'θ', name: 'theta' },
      { char: 'λ', name: 'lambda' },
      { char: 'μ', name: 'mu' },
      { char: 'π', name: 'pi' },
      { char: 'σ', name: 'sigma' },
      { char: 'φ', name: 'phi' },
      { char: 'ω', name: 'omega' },
      { char: 'Δ', name: 'capital delta' },
      { char: 'Ω', name: 'capital omega' },
    ],
  },
]

/** Category ids in display order. */
export function symbolCategoryIds(): SymbolCategoryId[] {
  return SYMBOL_CATEGORIES.map((c) => c.id)
}

/** Entries of one category; an unknown id returns an empty list. */
export function symbolsForCategory(id: string): SymbolEntry[] {
  return SYMBOL_CATEGORIES.find((c) => c.id === id)?.entries.slice() ?? []
}

/**
 * Case-insensitive search across all categories, matching by symbol
 * name (substring) or by the character itself. A blank query matches
 * nothing — the dialog shows the active category grid instead.
 */
export function searchSymbols(query: string): SymbolEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: SymbolEntry[] = []
  for (const category of SYMBOL_CATEGORIES) {
    for (const entry of category.entries) {
      if (entry.name.toLowerCase().includes(q) || entry.char.toLowerCase().includes(q)) out.push(entry)
    }
  }
  return out
}
