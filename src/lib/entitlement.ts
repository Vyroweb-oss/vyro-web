export type Entitlement = { isPremium: boolean; status: 'free'|'active'|'active-no-date'|'expired'|'local'; premiumUntil: Date|null; reason: string }
export type MinimalUser = { app_metadata?: Record<string, unknown> | null; user_metadata?: Record<string, unknown> | null; email?: string|null } | null | undefined
export function computeEntitlement(user: MinimalUser, now: Date = new Date()): Entitlement {
  if (!user) return { isPremium:false, status:'free', premiumUntil:null, reason:'No authenticated user' }
  const meta = user.app_metadata ?? {}
  const premium = (meta as any).premium
  // strict: only JSON boolean true counts
  if (premium !== true) return { isPremium:false, status:'free', premiumUntil:null, reason:'premium flag is not boolean true' }
  const raw = (meta as any).premium_until
  if (raw == null || raw === '') return { isPremium:true, status:'active-no-date', premiumUntil:null, reason:'premium true with no expiry date' }
  const d = new Date(String(raw))
  if (isNaN(d.getTime())) return { isPremium:true, status:'active-no-date', premiumUntil:null, reason:'premium_until unparseable — treated as active-no-date (Android rule)' }
  if (d.getTime() > now.getTime()) return { isPremium:true, status:'active', premiumUntil:d, reason:'premium_until in future' }
  return { isPremium:false, status:'expired', premiumUntil:d, reason:'premium_until in past — expired, free editing remains available' }
}
