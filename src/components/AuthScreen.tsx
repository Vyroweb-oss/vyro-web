// R1 — Modern Registration screen: sign in / sign up / password reset.
//
// All decisions (validation, password policy, error mapping) live in the
// pure authFlow library; this component only renders state and calls it.
// It never shows a raw server error, never uses prompt/confirm/alert, and
// receives the Supabase auth client from App (loaded lazily there). When
// no client exists (Local Mode) it renders an honest note and no form —
// free local editing is unaffected.
//
// Scope note: the reset mode SENDS the reset email via authFlow. The page
// that sets a new password after the email link is a later stage together
// with the SMTP/site_url setup.

import { useState } from 'react'
import { tr, type I18nKey, type UiLang } from '../lib/i18n'
import {
  MIN_PASSWORD_LENGTH,
  passwordIssues,
  passwordStrength,
  requestPasswordReset,
  signInWithEmail,
  signUpWithEmail,
  type AuthClientLike,
  type AuthErrorKey,
} from '../lib/authFlow'

type Mode = 'signin' | 'signup' | 'reset'

interface Props {
  lang: UiLang
  /** Supabase auth client (App passes supabase.auth), or null in Local Mode. */
  auth: AuthClientLike | null
  onSignedIn: () => void
}

export default function AuthScreen({ lang, auth, onSignedIn }: Props) {
  const t = (k: I18nKey) => tr(lang, k)
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<AuthErrorKey[]>([])
  const [notice, setNotice] = useState<I18nKey | null>(null)

  if (!auth) {
    return (
      <div className="auth-screen">
        <p className="muted">{t('authLocalModeNote')}</p>
      </div>
    )
  }

  const switchMode = (m: Mode) => { setMode(m); setErrors([]); setNotice(null) }

  const submit = async () => {
    if (busy) return
    setErrors([]); setNotice(null)
    if (mode === 'signup') {
      const issues = passwordIssues(password)
      // Run the full validation through authFlow before any network call;
      // signUpWithEmail re-validates internally as the authoritative gate.
      setBusy(true)
      const res = await signUpWithEmail(auth, email, password, confirm)
      setBusy(false)
      if (!res.ok) { setErrors([res.errorKey, ...issues.filter((i) => i !== res.errorKey)]); return }
      if (res.kind === 'confirmation-required') { setMode('signin'); setNotice('authCheckEmail'); return }
      onSignedIn(); return
    }
    if (mode === 'reset') {
      setBusy(true)
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined
      const res = await requestPasswordReset(auth, email, redirectTo)
      setBusy(false)
      if (!res.ok) { setErrors([res.errorKey]); return }
      setNotice('authResetSent'); return
    }
    setBusy(true)
    const res = await signInWithEmail(auth, email, password)
    setBusy(false)
    if (!res.ok) { setErrors([res.errorKey]); return }
    onSignedIn()
  }

  const strength = mode === 'signup' ? passwordStrength(password) : 0
  const strengthKey: I18nKey = strength >= 3 ? 'strengthStrong' : strength === 2 ? 'strengthFair' : 'strengthWeak'

  return (
    <div className="auth-screen">
      <h3 className="auth-title">{mode === 'signup' ? t('createAccount') : mode === 'reset' ? t('resetPasswordTitle') : t('welcomeBack')}</h3>
      {mode === 'reset' && <p className="muted">{t('resetPasswordHint')}</p>}
      <label className="auth-field">
        <span>{t('email')}</span>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
      </label>
      {mode !== 'reset' && (
        <label className="auth-field">
          <span>{t('password')}</span>
          <span className="auth-password-row">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            <button type="button" className="rbtn small" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? t('hidePassword') : t('showPassword')}
            </button>
          </span>
        </label>
      )}
      {mode === 'signup' && password.length > 0 && (
        <p className="auth-strength" data-strength={strength}>
          {t('passwordStrength')}: {t(strengthKey)} ({MIN_PASSWORD_LENGTH}+)
        </p>
      )}
      {mode === 'signup' && (
        <label className="auth-field">
          <span>{t('confirmPassword')}</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />
        </label>
      )}
      {errors.length > 0 && (
        <div className="auth-errors" role="alert">
          {errors.map((k) => <p key={k} className="auth-error">{t(k)}</p>)}
        </div>
      )}
      {notice && <p className="auth-notice">{t(notice)}</p>}
      <div className="row auth-actions">
        {mode === 'signin' && <>
          <button className="primary small" onClick={submit} disabled={busy}>{t('signIn')}</button>
          <button className="rbtn" onClick={() => switchMode('signup')} disabled={busy}>{t('signUp')}</button>
          <button className="rbtn" onClick={() => switchMode('reset')} disabled={busy}>{t('forgotPassword')}</button>
        </>}
        {mode === 'signup' && <>
          <button className="primary small" onClick={submit} disabled={busy}>{t('createAccount')}</button>
          <button className="rbtn" onClick={() => switchMode('signin')} disabled={busy}>{t('backToSignIn')}</button>
        </>}
        {mode === 'reset' && <>
          <button className="primary small" onClick={submit} disabled={busy}>{t('sendResetLink')}</button>
          <button className="rbtn" onClick={() => switchMode('signin')} disabled={busy}>{t('backToSignIn')}</button>
        </>}
      </div>
    </div>
  )
}
