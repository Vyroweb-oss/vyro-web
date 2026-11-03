// R1 — Modern Registration: the pure auth-flow library.
//
// Every sign-in / sign-up / password-reset decision lives here so it can be
// unit-tested without a network or a Supabase project:
//   * form validation (email shape, password policy, confirm match),
//   * mapping of raw Supabase Auth errors to i18n KEYS — the UI never shows
//     a raw server message to the user,
//   * the exact request shapes sent to Supabase Auth.
//
// SECURITY INVARIANTS (pinned by authFlow.test.ts):
//   * Sign-up sends { email, password } — plus, ONLY when the user typed a
//     name on the auth page, options.data.display_name (their own
//     user_metadata, which the account panel already displays). No
//     app_metadata, and never anything premium-shaped: entitlement is read
//     exclusively from the server-owned app_metadata (see entitlement.ts),
//     which a client can never write. Registering can therefore NEVER
//     create Premium.
//   * Password policy (minimum 10 characters, a letter and a digit) is
//     enforced for NEW passwords (sign-up). Sign-in deliberately does NOT
//     enforce it: the production Auth pool is shared with Vyro Android,
//     whose existing accounts may predate this policy — locking them out
//     would be a regression, not security.

export const MIN_PASSWORD_LENGTH = 10

export type AuthErrorKey =
  | 'authErrorInvalidEmail'
  | 'authErrorPasswordRequired'
  | 'authErrorPasswordTooShort'
  | 'authErrorPasswordNeedsLetter'
  | 'authErrorPasswordNeedsDigit'
  | 'authErrorPasswordMismatch'
  | 'authErrorInvalidCredentials'
  | 'authErrorEmailNotConfirmed'
  | 'authErrorEmailInUse'
  | 'authErrorWeakPassword'
  | 'authErrorRateLimited'
  | 'authErrorNetwork'
  | 'authErrorSignupDisabled'
  | 'authErrorGeneric'

/** Minimal structural slice of the Supabase Auth client this flow needs. */
export interface AuthClientLike {
  signUp(input: { email: string; password: string; options?: { data?: { display_name?: string } } }): Promise<{ data: { user: unknown; session: unknown }; error: unknown }>
  signInWithPassword(input: { email: string; password: string }): Promise<{ data: { user: unknown; session: unknown }; error: unknown }>
  resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<{ error: unknown }>
}

export type AuthFlowResult =
  | { ok: true; kind: 'signed-in'; user: unknown }
  | { ok: true; kind: 'confirmation-required' }
  | { ok: true; kind: 'reset-sent' }
  | { ok: false; errorKey: AuthErrorKey }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(email: string): AuthErrorKey | null {
  const e = (email ?? '').trim()
  if (!e || e.length > 254 || !EMAIL_RE.test(e)) return 'authErrorInvalidEmail'
  return null
}

/** All policy failures for a NEW password, in display order. */
export function passwordIssues(password: string): AuthErrorKey[] {
  const pw = password ?? ''
  const issues: AuthErrorKey[] = []
  if (pw.length < MIN_PASSWORD_LENGTH) issues.push('authErrorPasswordTooShort')
  if (!/[A-Za-z]/.test(pw) && !/[؀-ۿ]/.test(pw)) issues.push('authErrorPasswordNeedsLetter')
  if (!/[0-9]/.test(pw) && !/[۰-۹]/.test(pw)) issues.push('authErrorPasswordNeedsDigit')
  return issues
}

/** 0 = unusable, 1 = meets policy, 2 = good, 3 = strong. UI meter only. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  const pw = password ?? ''
  if (passwordIssues(pw).length > 0) return 0
  let score = 1
  if (pw.length >= 14) score += 1
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1
  if (/[^A-Za-z0-9]/.test(pw)) score += 1
  return Math.min(3, score) as 0 | 1 | 2 | 3
}

export function validateSignIn(email: string, password: string): AuthErrorKey | null {
  const emailIssue = validateEmail(email)
  if (emailIssue) return emailIssue
  if (!password) return 'authErrorPasswordRequired'
  return null
}

export function validateSignUp(email: string, password: string, confirm: string): AuthErrorKey[] {
  const issues: AuthErrorKey[] = []
  const emailIssue = validateEmail(email)
  if (emailIssue) issues.push(emailIssue)
  issues.push(...passwordIssues(password))
  if (password && confirm !== password) issues.push('authErrorPasswordMismatch')
  return issues
}

export function validateReset(email: string): AuthErrorKey | null {
  return validateEmail(email)
}

interface RawAuthError { code?: string; status?: number; message?: string }

/** Map any Supabase Auth failure to a user-safe i18n key. Raw messages are
 *  NEVER propagated — they leak server detail and are English-only. */
export function mapAuthError(error: unknown): AuthErrorKey {
  const e = (error ?? {}) as RawAuthError
  const code = typeof e.code === 'string' ? e.code : ''
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'authErrorInvalidCredentials'
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'authErrorEmailNotConfirmed'
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered') || msg.includes('already been registered')) return 'authErrorEmailInUse'
  if (code === 'weak_password' || msg.includes('password should be')) return 'authErrorWeakPassword'
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || e.status === 429 || msg.includes('rate limit')) return 'authErrorRateLimited'
  if (code === 'signup_disabled' || msg.includes('signups not allowed') || msg.includes('signup is disabled')) return 'authErrorSignupDisabled'
  if (code === 'validation_failed' && msg.includes('email')) return 'authErrorInvalidEmail'
  if (e.status === 0 || msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch')) return 'authErrorNetwork'
  return 'authErrorGeneric'
}

/** The sign-up request. Without a display name it is EXACTLY
 *  { email, password }; with one it adds ONLY options.data.display_name
 *  (user_metadata). Never app_metadata — registration cannot mint Premium. */
export function buildSignUpRequest(email: string, password: string, displayName?: string): { email: string; password: string; options?: { data: { display_name: string } } } {
  const base: { email: string; password: string; options?: { data: { display_name: string } } } = { email: email.trim(), password }
  const name = (displayName ?? '').trim().slice(0, 80)
  if (name) base.options = { data: { display_name: name } }
  return base
}

export async function signUpWithEmail(auth: AuthClientLike, email: string, password: string, confirm: string, displayName?: string): Promise<AuthFlowResult> {
  const issues = validateSignUp(email, password, confirm)
  if (issues.length > 0) return { ok: false, errorKey: issues[0] }
  try {
    const { data, error } = await auth.signUp(buildSignUpRequest(email, password, displayName))
    if (error) return { ok: false, errorKey: mapAuthError(error) }
    if (data && data.user && !data.session) return { ok: true, kind: 'confirmation-required' }
    return { ok: true, kind: 'signed-in', user: data?.user ?? null }
  } catch (err) {
    return { ok: false, errorKey: mapAuthError(err) }
  }
}

export async function signInWithEmail(auth: AuthClientLike, email: string, password: string): Promise<AuthFlowResult> {
  const issue = validateSignIn(email, password)
  if (issue) return { ok: false, errorKey: issue }
  try {
    const { data, error } = await auth.signInWithPassword({ email: email.trim(), password })
    if (error) return { ok: false, errorKey: mapAuthError(error) }
    return { ok: true, kind: 'signed-in', user: data?.user ?? null }
  } catch (err) {
    return { ok: false, errorKey: mapAuthError(err) }
  }
}

export async function requestPasswordReset(auth: AuthClientLike, email: string, redirectTo?: string): Promise<AuthFlowResult> {
  const issue = validateReset(email)
  if (issue) return { ok: false, errorKey: issue }
  try {
    const { error } = await auth.resetPasswordForEmail(email.trim(), redirectTo ? { redirectTo } : undefined)
    if (error) return { ok: false, errorKey: mapAuthError(error) }
    return { ok: true, kind: 'reset-sent' }
  } catch (err) {
    return { ok: false, errorKey: mapAuthError(err) }
  }
}
