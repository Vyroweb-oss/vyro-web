// Stage 2D — per-account consent for the FIRST cloud upload (Stage 0 §5.2).
//
// Consent is a local, per-account record: { accountId → ISO timestamp }.
// It is asked once, before any byte leaves the device, is never pre-granted,
// and changing accounts re-asks (a different account simply has no record).
// Storage failures are tolerated: a failed read means "not consented"
// (the safe direction — uploads stay blocked), a failed write returns
// false so the UI can refuse to proceed rather than assume consent.

export const CLOUD_CONSENT_KEY = 'vyro-web-cloud-consent-v1'

type StorageLike = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>

function loadAll(storage: StorageLike): Record<string, string> {
  try {
    const raw = storage.getItem(CLOUD_CONSENT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v && !Number.isNaN(new Date(v).getTime())) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** The consent timestamp for this account, or null when never given. */
export function loadConsent(storage: StorageLike, accountId: string): string | null {
  if (!accountId) return null
  return loadAll(storage)[accountId] ?? null
}

/** Record consent for this account. Returns false when it cannot persist. */
export function recordConsent(storage: StorageLike, accountId: string, at: Date = new Date()): boolean {
  if (!accountId || !storage.setItem) return false
  try {
    const all = loadAll(storage)
    all[accountId] = at.toISOString()
    storage.setItem(CLOUD_CONSENT_KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}
