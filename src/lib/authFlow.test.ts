// R1 — authFlow tests: validation, password policy (min 10), error mapping,
// request shapes against a fake client, and the no-Premium invariant.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MIN_PASSWORD_LENGTH,
  buildSignUpRequest,
  mapAuthError,
  passwordIssues,
  passwordStrength,
  requestPasswordReset,
  signInWithEmail,
  signUpWithEmail,
  validateEmail,
  validateSignIn,
  validateSignUp,
  type AuthClientLike,
} from './authFlow'
import { computeEntitlement } from './entitlement'

function fakeAuth(overrides: Partial<AuthClientLike> = {}): AuthClientLike & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { signUp: [], signIn: [], reset: [] }
  return {
    calls,
    signUp: async (input) => { calls.signUp.push(input); return { data: { user: { id: 'u1', app_metadata: {} }, session: { access_token: 's' } }, error: null } },
    signInWithPassword: async (input) => { calls.signIn.push(input); return { data: { user: { id: 'u1', app_metadata: {} }, session: { access_token: 's' } }, error: null } },
    resetPasswordForEmail: async (email, options) => { calls.reset.push([email, options]); return { error: null } },
    ...overrides,
  }
}

describe('validation', () => {
  it('email: accepts normal, rejects malformed', () => {
    expect(validateEmail('user@example.com')).toBeNull()
    expect(validateEmail('  user@example.com  ')).toBeNull()
    expect(validateEmail('not-an-email')).toBe('authErrorInvalidEmail')
    expect(validateEmail('a@b')).toBe('authErrorInvalidEmail')
    expect(validateEmail('')).toBe('authErrorInvalidEmail')
    expect(validateEmail('a b@example.com')).toBe('authErrorInvalidEmail')
  })
  it('sign-in does NOT enforce the new-password policy (shared Android pool)', () => {
    expect(validateSignIn('user@example.com', 'short')).toBeNull()
    expect(validateSignIn('user@example.com', '')).toBe('authErrorPasswordRequired')
    expect(validateSignIn('bad', 'whatever1')).toBe('authErrorInvalidEmail')
  })
})

describe('password policy — minimum 10, letter + digit', () => {
  it('exports the policy constant as 10', () => { expect(MIN_PASSWORD_LENGTH).toBe(10) })
  it('9 characters fails, 10 passes', () => {
    expect(passwordIssues('abcd12345')).toContain('authErrorPasswordTooShort')
    expect(passwordIssues('abcd123456')).toEqual([])
  })
  it('letter and digit are each required; Persian digits count', () => {
    expect(passwordIssues('1234567890')).toContain('authErrorPasswordNeedsLetter')
    expect(passwordIssues('abcdefghij')).toContain('authErrorPasswordNeedsDigit')
    expect(passwordIssues('password۱۲۳')).toEqual([])
  })
  it('sign-up validation aggregates email + password + mismatch', () => {
    expect(validateSignUp('bad', 'short', 'shorter')).toContain('authErrorInvalidEmail')
    expect(validateSignUp('bad', 'short', 'shorter')).toContain('authErrorPasswordTooShort')
    expect(validateSignUp('user@example.com', 'abcd123456', 'abcd123457')).toEqual(['authErrorPasswordMismatch'])
    expect(validateSignUp('user@example.com', 'abcd123456', 'abcd123456')).toEqual([])
  })
  it('strength meter: below policy = 0, long mixed = 3', () => {
    expect(passwordStrength('short')).toBe(0)
    expect(passwordStrength('abcd123456')).toBe(1)
    expect(passwordStrength('Abcd12345678!x')).toBe(3)
  })
})

describe('error mapping — user-safe keys, never raw messages', () => {
  it('maps the known Supabase codes', () => {
    expect(mapAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('authErrorInvalidCredentials')
    expect(mapAuthError({ code: 'email_not_confirmed' })).toBe('authErrorEmailNotConfirmed')
    expect(mapAuthError({ code: 'user_already_exists' })).toBe('authErrorEmailInUse')
    expect(mapAuthError({ message: 'User already registered' })).toBe('authErrorEmailInUse')
    expect(mapAuthError({ code: 'weak_password' })).toBe('authErrorWeakPassword')
    expect(mapAuthError({ status: 429 })).toBe('authErrorRateLimited')
    expect(mapAuthError({ code: 'over_email_send_rate_limit' })).toBe('authErrorRateLimited')
    expect(mapAuthError({ message: 'Failed to fetch' })).toBe('authErrorNetwork')
    expect(mapAuthError({ code: 'signup_disabled' })).toBe('authErrorSignupDisabled')
    expect(mapAuthError({ code: 'validation_failed', message: 'Unable to validate email address: invalid format' })).toBe('authErrorInvalidEmail')
  })
  it('unknown errors collapse to the generic key', () => {
    expect(mapAuthError({ message: 'some internal detail xyz' })).toBe('authErrorGeneric')
    expect(mapAuthError(null)).toBe('authErrorGeneric')
    expect(mapAuthError(undefined)).toBe('authErrorGeneric')
  })
})

describe('flows against a fake client', () => {
  it('sign-up sends EXACTLY {email, password} — nothing premium-shaped anywhere', async () => {
    const auth = fakeAuth()
    const res = await signUpWithEmail(auth, '  New@Example.com ', 'abcd123456', 'abcd123456')
    expect(res).toEqual({ ok: true, kind: 'signed-in', user: { id: 'u1', app_metadata: {} } })
    expect(auth.calls.signUp).toHaveLength(1)
    const sent = auth.calls.signUp[0] as Record<string, unknown>
    expect(Object.keys(sent).sort()).toEqual(['email', 'password'])
    expect(JSON.stringify(sent).toLowerCase()).not.toContain('premium')
    expect(JSON.stringify(sent).toLowerCase()).not.toContain('metadata')
  })
  it('a freshly registered user is NOT premium under the real entitlement rule', async () => {
    const auth = fakeAuth()
    const res = await signUpWithEmail(auth, 'new@example.com', 'abcd123456', 'abcd123456')
    if (!res.ok || res.kind !== 'signed-in') throw new Error('expected signed-in')
    const ent = computeEntitlement(res.user as { app_metadata?: Record<string, unknown> }, new Date())
    expect(ent.isPremium).toBe(false)
  })
  it('sign-up without a session means confirmation-required', async () => {
    const auth = fakeAuth({ signUp: async () => ({ data: { user: { id: 'u2', app_metadata: {} }, session: null }, error: null }) })
    const res = await signUpWithEmail(auth, 'new@example.com', 'abcd123456', 'abcd123456')
    expect(res).toEqual({ ok: true, kind: 'confirmation-required' })
  })
  it('sign-up validation failure never reaches the network', async () => {
    const auth = fakeAuth()
    const res = await signUpWithEmail(auth, 'bad', 'short', 'short')
    expect(res.ok).toBe(false)
    expect(auth.calls.signUp).toHaveLength(0)
  })
  it('server sign-up errors surface as keys, not raw text', async () => {
    const auth = fakeAuth({ signUp: async () => ({ data: { user: null, session: null }, error: { code: 'user_already_exists', message: 'User already registered' } }) })
    const res = await signUpWithEmail(auth, 'old@example.com', 'abcd123456', 'abcd123456')
    expect(res).toEqual({ ok: false, errorKey: 'authErrorEmailInUse' })
  })
  it('sign-in maps invalid credentials and succeeds cleanly', async () => {
    const bad = fakeAuth({ signInWithPassword: async () => ({ data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }) })
    expect(await signInWithEmail(bad, 'u@example.com', 'abcd123456')).toEqual({ ok: false, errorKey: 'authErrorInvalidCredentials' })
    const good = fakeAuth()
    const res = await signInWithEmail(good, 'u@example.com', 'abcd123456')
    expect(res.ok).toBe(true)
    expect(good.calls.signIn[0]).toEqual({ email: 'u@example.com', password: 'abcd123456' })
  })
  it('reset sends to the trimmed email with the redirect and reports reset-sent', async () => {
    const auth = fakeAuth()
    const res = await requestPasswordReset(auth, '  u@example.com ', 'https://example.com/')
    expect(res).toEqual({ ok: true, kind: 'reset-sent' })
    expect(auth.calls.reset[0]).toEqual(['u@example.com', { redirectTo: 'https://example.com/' }])
  })
  it('reset validates email before any call', async () => {
    const auth = fakeAuth()
    expect(await requestPasswordReset(auth, 'nope')).toEqual({ ok: false, errorKey: 'authErrorInvalidEmail' })
    expect(auth.calls.reset).toHaveLength(0)
  })
  it('thrown network exceptions collapse to the network key', async () => {
    const auth = fakeAuth({ signInWithPassword: async () => { throw new Error('Failed to fetch') } })
    expect(await signInWithEmail(auth, 'u@example.com', 'abcd123456')).toEqual({ ok: false, errorKey: 'authErrorNetwork' })
  })
  it('buildSignUpRequest trims email and keeps the password verbatim', () => {
    expect(buildSignUpRequest('  a@b.co ', ' ab cd12345 ')).toEqual({ email: 'a@b.co', password: ' ab cd12345 ' })
  })
  it('buildSignUpRequest with a name adds ONLY user_metadata.display_name — never app_metadata or premium', () => {
    const req = buildSignUpRequest('a@b.co', 'abcd123456', '  Najmuddin Safari  ')
    expect(req).toEqual({ email: 'a@b.co', password: 'abcd123456', options: { data: { display_name: 'Najmuddin Safari' } } })
    const json = JSON.stringify(req).toLowerCase()
    expect(json).not.toContain('app_metadata')
    expect(json).not.toContain('premium')
    expect(buildSignUpRequest('a@b.co', 'abcd123456', '   ')).toEqual({ email: 'a@b.co', password: 'abcd123456' })
    expect(buildSignUpRequest('a@b.co', 'abcd123456')).toEqual({ email: 'a@b.co', password: 'abcd123456' })
  })
})

describe('source guards — wiring and invariants', () => {
  const screen = readFileSync(resolve(process.cwd(), 'src/components/AuthScreen.tsx'), 'utf8')
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
  const flow = readFileSync(resolve(process.cwd(), 'src/lib/authFlow.ts'), 'utf8')
  it('AuthScreen delegates to authFlow and shows no raw errors', () => {
    expect(screen).toContain('signUpWithEmail')
    expect(screen).toContain('signInWithEmail')
    expect(screen).toContain('requestPasswordReset')
    expect(screen).not.toMatch(/\.message/)
    expect(screen).not.toMatch(/window\.(alert|prompt|confirm)/)
  })
  it('App renders AuthScreen for the signed-out state', () => {
    expect(app).toContain('<AuthScreen')
    expect(app).toContain('onSignedIn={refreshUser}')
  })
  it('resetPasswordForEmail is only invoked inside authFlow', () => {
    expect(flow).toContain('resetPasswordForEmail')
    expect(screen).not.toContain('resetPasswordForEmail')
    expect(app).not.toContain('resetPasswordForEmail')
  })
  it('no client code in the R1 surface writes app_metadata or premium', () => {
    for (const src of [screen, flow]) {
      expect(src).not.toMatch(/app_metadata\s*:/)
      expect(src.toLowerCase()).not.toContain('premium: true')
      expect(src).not.toContain('updateUser')
    }
  })
  it('the old inline sign-up path is gone from App', () => {
    expect(app).not.toContain("authAction('in')")
    expect(app).not.toContain("authAction('up')")
  })
})
