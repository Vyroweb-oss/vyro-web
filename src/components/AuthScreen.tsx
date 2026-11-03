// Auth page — full-screen sign-up / sign-in experience (owner design
// reference, 2026-11-03): two cards side by side on a soft lavender page,
// the Vyro mark on each card, icon fields, a working "remember me", a
// terms gate on sign-up, and three feature highlights under the cards.
//
// All decisions (validation, password policy, error mapping) stay in the
// pure authFlow library; this component only renders state and calls it.
// It never shows a raw server error and never uses prompt/confirm/alert.
// The Supabase auth client arrives from App (loaded lazily there); with no
// client (Local Mode) it renders an honest note — free local editing is
// unaffected.
//
// Deliberate deviations from the reference image, both on the owner's own
// standing rules: (1) no chosen-username field — usernames are generated
// automatically by the database (R2-I decision) and shown in the profile,
// so the sign-up card carries a short note saying so; (2) no Google /
// GitHub / Apple buttons — no social provider is connected, and a button
// that cannot work is never shipped.
//
// Scope note: password reset SENDS the reset email via authFlow. The page
// that sets a new password after the email link is a later stage together
// with the SMTP/site_url setup.

import { useState, type ReactNode } from 'react'
import { tr, type I18nKey, type UiLang } from '../lib/i18n'
import { setRememberSession } from '../lib/supabaseEnv'
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

interface Props {
  lang: UiLang
  /** Supabase auth client (App passes supabase.auth), or null in Local Mode. */
  auth: AuthClientLike | null
  onSignedIn: () => void
  /** When rendered as the full auth page, a close button returns to the dashboard. */
  onClose?: () => void
}

function LogoMark() {
  return (
    <span className="auth-logo">
      <svg width="38" height="38" viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <linearGradient id="vyroMarkGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8B7CFF" />
            <stop offset="1" stopColor="#4F46E5" />
          </linearGradient>
        </defs>
        <path d="M7 5 L24 41 L41 5 L32 5 L24 25 L16 5 Z" fill="url(#vyroMarkGrad)" />
        <path d="M24 41 L41 5 L32 5 L24 25 Z" fill="#38BDF8" opacity="0.5" />
      </svg>
      <span className="auth-logo-name">Vyro</span>
    </span>
  )
}

const ic = (paths: ReactNode) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
)
const IconUser = ic(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></>)
const IconMail = ic(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>)
const IconEye = ic(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>)
const IconEyeOff = ic(<><path d="M4 4l16 16" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 3.5M6.1 6.9A16.9 16.9 0 0 0 2 12s3.5 7 10 7c1.5 0 2.9-.3 4.1-.8" /></>)
const IconGift = ic(<><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13M5 12v9h14v-9" /><path d="M12 8s-4.2.2-4.2-2.2C7.8 3.6 10 3 11 4.4 11.7 5.4 12 8 12 8Zm0 0s4.2.2 4.2-2.2C16.2 3.6 14 3 13 4.4 12.3 5.4 12 8 12 8Z" /></>)
const IconShield = ic(<><path d="M12 3l7 3v5c0 5-3.5 8.2-7 10-3.5-1.8-7-5-7-10V6l7-3Z" /><path d="M9 12l2 2 4-4" /></>)
const IconDevices = ic(<><rect x="2" y="5" width="13" height="10" rx="2" /><path d="M6 19h6" /><rect x="17" y="9" width="5" height="10" rx="1.5" /></>)

function TextField(props: { label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string; icon?: ReactNode; disabled?: boolean }) {
  return (
    <label className="auth-field">
      <span>{props.label}</span>
      <span className="auth-control">
        <input type={props.type ?? 'text'} value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} autoComplete={props.autoComplete} disabled={props.disabled} />
        {props.icon && <span className="auth-ic">{props.icon}</span>}
      </span>
    </label>
  )
}

function PasswordField(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string; disabled?: boolean; showLabel: string; hideLabel: string }) {
  const [show, setShow] = useState(false)
  return (
    <label className="auth-field">
      <span>{props.label}</span>
      <span className="auth-control">
        <input type={show ? 'text' : 'password'} value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} autoComplete={props.autoComplete} disabled={props.disabled} />
        <button type="button" className="auth-eye" aria-label={show ? props.hideLabel : props.showLabel} onClick={() => setShow((v) => !v)}>{show ? IconEyeOff : IconEye}</button>
      </span>
    </label>
  )
}

export default function AuthScreen({ lang, auth, onSignedIn, onClose }: Props) {
  const t = (k: I18nKey) => tr(lang, k)
  const [view, setView] = useState<'signup' | 'signin'>('signup')
  const [legal, setLegal] = useState<'terms' | 'privacy' | null>(null)
  const [busy, setBusy] = useState<null | 'su' | 'si' | 'reset'>(null)
  // Sign-up card state
  const [suName, setSuName] = useState('')
  const [suEmail, setSuEmail] = useState('')
  const [suPassword, setSuPassword] = useState('')
  const [suConfirm, setSuConfirm] = useState('')
  const [suTerms, setSuTerms] = useState(false)
  const [suErrors, setSuErrors] = useState<AuthErrorKey[]>([])
  const [suNotice, setSuNotice] = useState<I18nKey | null>(null)
  // Sign-in card state (reset mode reuses this card)
  const [siEmail, setSiEmail] = useState('')
  const [siPassword, setSiPassword] = useState('')
  const [siRemember, setSiRemember] = useState(true)
  const [siErrors, setSiErrors] = useState<AuthErrorKey[]>([])
  const [siNotice, setSiNotice] = useState<I18nKey | null>(null)
  const [resetMode, setResetMode] = useState(false)

  const features = (
    <div className="auth-features">
      <div className="auth-feature"><span className="auth-feature-ic">{IconGift}</span><b>{t('authFeatureFreeTitle')}</b><span>{t('authFeatureFreeDesc')}</span></div>
      <div className="auth-feature"><span className="auth-feature-ic">{IconShield}</span><b>{t('authFeatureSecureTitle')}</b><span>{t('authFeatureSecureDesc')}</span></div>
      <div className="auth-feature"><span className="auth-feature-ic">{IconDevices}</span><b>{t('authFeatureDevicesTitle')}</b><span>{t('authFeatureDevicesDesc')}</span></div>
    </div>
  )
  const legalModal = legal && (
    <div className="auth-legal-backdrop" onClick={() => setLegal(null)}>
      <div className="auth-legal" role="dialog" aria-modal="true" aria-label={t(legal === 'terms' ? 'termsOfUse' : 'privacyPolicy')} onClick={(e) => e.stopPropagation()}>
        <h3>{t(legal === 'terms' ? 'termsOfUse' : 'privacyPolicy')}</h3>
        <p>{t(legal === 'terms' ? 'termsBody' : 'privacyBody')}</p>
        <button type="button" className="auth-btn" onClick={() => setLegal(null)}>{t('close')}</button>
      </div>
    </div>
  )

  if (!auth) {
    return (
      <div className="auth-page">
        {onClose && <button type="button" className="auth-close" aria-label={t('close')} onClick={onClose}>✕</button>}
        <div className="auth-cards" data-view="signin">
          <section className="auth-card">
            <LogoMark />
            <p className="auth-sub">{t('authLocalModeNote')}</p>
          </section>
        </div>
        {features}
      </div>
    )
  }

  const submitSignUp = async () => {
    if (busy) return
    setSuErrors([]); setSuNotice(null)
    const issues = passwordIssues(suPassword)
    setBusy('su')
    const res = await signUpWithEmail(auth, suEmail, suPassword, suConfirm, suName)
    setBusy(null)
    if (!res.ok) { setSuErrors([res.errorKey, ...issues.filter((i) => i !== res.errorKey)]); return }
    if (res.kind === 'confirmation-required') { setView('signin'); setSiNotice('authCheckEmail'); return }
    onSignedIn()
  }

  const submitSignIn = async () => {
    if (busy) return
    setSiErrors([]); setSiNotice(null)
    // Set the remember-me routing BEFORE the session is written, so the
    // session lands in localStorage (remembered) or sessionStorage (not).
    setRememberSession(siRemember)
    setBusy('si')
    const res = await signInWithEmail(auth, siEmail, siPassword)
    setBusy(null)
    if (!res.ok) { setSiErrors([res.errorKey]); return }
    onSignedIn()
  }

  const submitReset = async () => {
    if (busy) return
    setSiErrors([]); setSiNotice(null)
    setBusy('reset')
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined
    const res = await requestPasswordReset(auth, siEmail, redirectTo)
    setBusy(null)
    if (!res.ok) { setSiErrors([res.errorKey]); return }
    setSiNotice('authResetSent')
  }

  const strength = passwordStrength(suPassword)
  const strengthKey: I18nKey = strength >= 3 ? 'strengthStrong' : strength === 2 ? 'strengthFair' : 'strengthWeak'
  const errorBox = (errs: AuthErrorKey[]) => errs.length > 0 && (
    <div className="auth-errors" role="alert">{errs.map((k) => <p key={k} className="auth-error">{t(k)}</p>)}</div>
  )

  return (
    <div className="auth-page">
      {onClose && <button type="button" className="auth-close" aria-label={t('close')} onClick={onClose}>✕</button>}
      <div className="auth-cards" data-view={view}>
        <section className="auth-card auth-card-signup" aria-label={t('authSignUpTitle')}>
          <LogoMark />
          <h2>{t('authSignUpTitle')}</h2>
          <p className="auth-sub">{t('signUpSubtitle')}</p>
          <form onSubmit={(e) => { e.preventDefault(); void submitSignUp() }}>
            <TextField label={t('fullName')} value={suName} onChange={setSuName} placeholder={t('fullNamePlaceholder')} autoComplete="name" icon={IconUser} disabled={busy !== null} />
            <TextField label={t('email')} type="email" value={suEmail} onChange={setSuEmail} placeholder="example@vyro.com" autoComplete="email" icon={IconMail} disabled={busy !== null} />
            <PasswordField label={t('password')} value={suPassword} onChange={setSuPassword} placeholder={t('passwordHintSignup')} autoComplete="new-password" disabled={busy !== null} showLabel={t('showPassword')} hideLabel={t('hidePassword')} />
            {suPassword.length > 0 && (
              <div className="auth-strength-wrap">
                <div className="auth-strengthbar"><span style={{ width: `${Math.max(12, strength * 33)}%` }} /></div>
                <p className="auth-strength-text">{t('passwordStrength')}: {t(strengthKey)} ({MIN_PASSWORD_LENGTH}+)</p>
              </div>
            )}
            <PasswordField label={t('confirmPassword')} value={suConfirm} onChange={setSuConfirm} placeholder={t('confirmPasswordPlaceholder')} autoComplete="new-password" disabled={busy !== null} showLabel={t('showPassword')} hideLabel={t('hidePassword')} />
            <p className="auth-note">{t('usernameAutoNote')}</p>
            <label className="auth-check">
              <input type="checkbox" checked={suTerms} onChange={(e) => setSuTerms(e.target.checked)} disabled={busy !== null} />
              <span>{t('acceptTermsStart')} <button type="button" className="auth-link" onClick={(e) => { e.preventDefault(); setLegal('terms') }}>{t('termsOfUse')}</button> {t('acceptTermsMid')} <button type="button" className="auth-link" onClick={(e) => { e.preventDefault(); setLegal('privacy') }}>{t('privacyPolicy')}</button> {t('acceptTermsEnd')}</span>
            </label>
            {errorBox(suErrors)}
            {suNotice && <p className="auth-notice">{t(suNotice)}</p>}
            <button type="submit" className="auth-btn" disabled={busy !== null || !suTerms}>{t('signUp')}</button>
          </form>
          <p className="auth-foot">{t('haveAccountQ')} <button type="button" className="auth-link" onClick={() => setView('signin')}>{t('signIn')}</button></p>
        </section>

        <section className="auth-card auth-card-signin" aria-label={t('authSignInTitle')}>
          <LogoMark />
          <h2>{resetMode ? t('resetPasswordTitle') : t('authSignInTitle')}</h2>
          <p className="auth-sub">{resetMode ? t('resetPasswordHint') : t('signInSubtitle')}</p>
          {resetMode ? (
            <form onSubmit={(e) => { e.preventDefault(); void submitReset() }}>
              <TextField label={t('email')} type="email" value={siEmail} onChange={setSiEmail} placeholder="example@vyro.com" autoComplete="email" icon={IconMail} disabled={busy !== null} />
              {errorBox(siErrors)}
              {siNotice && <p className="auth-notice">{t(siNotice)}</p>}
              <button type="submit" className="auth-btn" disabled={busy !== null}>{t('sendResetLink')}</button>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void submitSignIn() }}>
              <TextField label={t('email')} type="email" value={siEmail} onChange={setSiEmail} placeholder="example@vyro.com" autoComplete="email" icon={IconMail} disabled={busy !== null} />
              <PasswordField label={t('password')} value={siPassword} onChange={setSiPassword} placeholder={t('passwordPlaceholder')} autoComplete="current-password" disabled={busy !== null} showLabel={t('showPassword')} hideLabel={t('hidePassword')} />
              <div className="auth-between">
                <label className="auth-check">
                  <input type="checkbox" checked={siRemember} onChange={(e) => setSiRemember(e.target.checked)} disabled={busy !== null} />
                  <span>{t('rememberMe')}</span>
                </label>
                <button type="button" className="auth-link" onClick={() => { setResetMode(true); setSiErrors([]); setSiNotice(null) }} disabled={busy !== null}>{t('forgotPassword')}</button>
              </div>
              {errorBox(siErrors)}
              {siNotice && <p className="auth-notice">{t(siNotice)}</p>}
              <button type="submit" className="auth-btn" disabled={busy !== null}>{t('signIn')}</button>
            </form>
          )}
          <p className="auth-foot">
            {resetMode
              ? <button type="button" className="auth-link" onClick={() => { setResetMode(false); setSiErrors([]); setSiNotice(null) }}>{t('backToSignIn')}</button>
              : <>{t('noAccountQ')} <button type="button" className="auth-link" onClick={() => setView('signup')}>{t('signUp')}</button></>}
          </p>
        </section>
      </div>
      {features}
      {legalModal}
    </div>
  )
}
