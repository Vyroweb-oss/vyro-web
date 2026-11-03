// AdminApp — the owner-only Vyro Web admin panel (Release 2, M-plan).
// A SEPARATE entry (/admin.html) from the public app. This page holds NO
// privileges and NO service-role key: it signs the owner in with normal
// Supabase Auth and calls the admin Edge Functions with the session
// token; the FUNCTIONS verify app_metadata.role === 'admin' server-side
// on every request and are the only place Premium can change. A 403
// here simply means "you are not the admin" and the panel stays shut.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Lang = 'fa' | 'en'

const STR = {
  en: {
    title: 'Vyro Admin Panel', signIn: 'Sign in', email: 'Email', password: 'Password',
    signOut: 'Sign out', notAdmin: 'This account is not an admin. Access is closed.',
    signInFailed: 'Sign-in failed. Check the email and password.',
    loading: 'Loading…', search: 'Search email, username or name…', refresh: 'Refresh',
    totalUsers: 'Total users', newLast7d: 'New (7 days)', premiumActive: 'Premium active', cloudDocs: 'Cloud documents',
    user: 'User', username: 'Username', registered: 'Registered', lastSignIn: 'Last sign-in', docs: 'Docs',
    premium: 'Premium', free: 'Free', until: 'until', never: '—',
    activate: 'Activate 1 month', extend: 'Extend +1 month', deactivate: 'Deactivate',
    confirmQ: 'Are you sure?', yes: 'Yes, do it', cancel: 'Cancel',
    auditTitle: 'Admin actions (audit log)', auditEmpty: 'No admin actions yet.',
    actionActivate: 'Premium activated', actionExtend: 'Premium extended', actionDeactivate: 'Premium deactivated',
    loadFailed: 'Could not load the panel data.', actionFailed: 'The action failed. Nothing was changed by this click — check and retry.',
    notConfigured: 'Accounts are not configured on this build.',
  },
  fa: {
    title: 'پنل مدیریت وایرو', signIn: 'ورود', email: 'ایمیل', password: 'رمز عبور',
    signOut: 'خروج', notAdmin: 'این حساب مدیر نیست. دسترسی بسته است.',
    signInFailed: 'ورود ناموفق بود. ایمیل و رمز عبور را بررسی کنید.',
    loading: 'در حال بارگذاری…', search: 'جستجو: ایمیل، نام کاربری یا نام…', refresh: 'تازه‌سازی',
    totalUsers: 'کل کاربران', newLast7d: 'ثبت‌نام ۷ روز اخیر', premiumActive: 'پرمیوم فعال', cloudDocs: 'اسناد ابری',
    user: 'کاربر', username: 'نام کاربری', registered: 'ثبت‌نام', lastSignIn: 'آخرین ورود', docs: 'اسناد',
    premium: 'پرمیوم', free: 'رایگان', until: 'تا', never: '—',
    activate: 'فعال‌سازی یک ماه', extend: 'تمدید ‎+۱ ماه', deactivate: 'غیرفعال‌کردن',
    confirmQ: 'مطمئن هستید؟', yes: 'بله، انجام بده', cancel: 'لغو',
    auditTitle: 'اقدامات مدیر (گزارش حسابرسی)', auditEmpty: 'هنوز هیچ اقدام مدیریتی ثبت نشده است.',
    actionActivate: 'پرمیوم فعال شد', actionExtend: 'پرمیوم تمدید شد', actionDeactivate: 'پرمیوم غیرفعال شد',
    loadFailed: 'داده‌های پنل بارگذاری نشد.', actionFailed: 'اقدام انجام نشد. با این کلیک چیزی تغییر نکرده — بررسی کنید و دوباره تلاش کنید.',
    notConfigured: 'حساب‌ها در این نسخه پیکربندی نشده‌اند.',
  },
} as const

interface AdminUser {
  id: string; email: string; username: string | null; displayName: string | null
  createdAt: string; lastSignInAt: string | null; premium: boolean; premiumUntil: string | null; docs: number
}
interface PanelData {
  me: { id: string; email: string }
  stats: { totalUsers: number; newLast7d: number; premiumActive: number; totalCloudDocs: number }
  users: AdminUser[]
  audit?: { id: number; actor_id: string; target_user_id: string; action: string; created_at: string }[]
}

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1`
const PUB_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

export default function AdminApp() {
  const [lang, setLang] = useState<Lang>('fa')
  const t = STR[lang]
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [data, setData] = useState<PanelData | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState<{ userId: string; action: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async (query: string) => {
    if (!supabase) return
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) { setSignedIn(false); return }
    setSignedIn(true)
    const res = await fetch(`${FN_BASE}/admin-users?audit=1${query ? `&q=${encodeURIComponent(query)}` : ''}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: PUB_KEY },
    })
    if (res.status === 403) { setForbidden(true); setData(null); return }
    if (!res.ok) { setLoadError('load'); return }
    setForbidden(false); setLoadError('')
    setData(await res.json())
  }, [])

  useEffect(() => {
    if (!supabase) { setReady(true); return }
    supabase.auth.getUser().then(({ data }) => {
      setReady(true)
      if (data.user) void load('')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) void load('')
      else { setSignedIn(false); setData(null); setForbidden(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const doSignIn = async () => {
    if (!supabase) return
    setFormError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setFormError('signin')
  }

  const doAction = async () => {
    if (!supabase || !confirm) return
    setBusy(true); setActionError('')
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    const res = await fetch(`${FN_BASE}/admin-set-premium`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: PUB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: confirm.userId, action: confirm.action }),
    })
    setBusy(false); setConfirm(null)
    if (!res.ok) { setActionError('action'); return }
    await load(q)
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === 'fa' ? 'fa-AF' : 'en-GB') : t.never)
  const emailOf = (id: string) => data?.users.find((u) => u.id === id)?.email ?? `${id.slice(0, 8)}…`
  const auditLabel = (a: string) => (a === 'premium_activate' ? t.actionActivate : a === 'premium_extend' ? t.actionExtend : t.actionDeactivate)

  if (!supabase) return <div className="adm-wrap"><p className="adm-card">{t.notConfigured}</p></div>
  if (!ready) return <div className="adm-wrap"><p className="adm-muted">{t.loading}</p></div>

  return (
    <div className="adm-wrap" dir={lang === 'fa' ? 'rtl' : 'ltr'}>
      <header className="adm-head">
        <strong className="adm-logo">Vyro · {t.title}</strong>
        <span className="adm-head-actions">
          <span className="adm-lang" role="group">
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
            <button className={lang === 'fa' ? 'on' : ''} onClick={() => setLang('fa')}>فارسی</button>
          </span>
          {signedIn && <button className="adm-btn ghost" onClick={() => supabase?.auth.signOut()}>{t.signOut}</button>}
        </span>
      </header>

      {!signedIn ? (
        <form className="adm-card adm-login" onSubmit={(e) => { e.preventDefault(); void doSignIn() }}>
          <h1>{t.title}</h1>
          <label>{t.email}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
          <label>{t.password}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          {formError && <p className="adm-error">{t.signInFailed}</p>}
          <button className="adm-btn primary" type="submit">{t.signIn}</button>
        </form>
      ) : forbidden ? (
        <div className="adm-card"><h1>{t.title}</h1><p className="adm-error">{t.notAdmin}</p></div>
      ) : !data ? (
        <p className="adm-muted">{loadError ? t.loadFailed : t.loading}</p>
      ) : (
        <>
          <section className="adm-stats">
            <div className="adm-stat"><span>{data.stats.totalUsers}</span><label>{t.totalUsers}</label></div>
            <div className="adm-stat"><span>{data.stats.newLast7d}</span><label>{t.newLast7d}</label></div>
            <div className="adm-stat"><span>{data.stats.premiumActive}</span><label>{t.premiumActive}</label></div>
            <div className="adm-stat"><span>{data.stats.totalCloudDocs}</span><label>{t.cloudDocs}</label></div>
          </section>

          <div className="adm-toolbar">
            <input className="adm-search" type="search" value={q} placeholder={t.search}
              onChange={(e) => { setQ(e.target.value); void load(e.target.value) }} />
            <button className="adm-btn ghost" onClick={() => void load(q)}>{t.refresh}</button>
          </div>
          {actionError && <p className="adm-error">{t.actionFailed}</p>}

          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr>
                <th>{t.user}</th><th>{t.username}</th><th>{t.registered}</th><th>{t.lastSignIn}</th><th>{t.docs}</th><th>{t.premium}</th><th></th>
              </tr></thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.displayName ?? u.email}</strong><br /><span className="adm-muted">{u.email}</span></td>
                    <td>{u.username ? `@${u.username}` : t.never}</td>
                    <td>{fmt(u.createdAt)}</td>
                    <td>{fmt(u.lastSignInAt)}</td>
                    <td>{u.docs}</td>
                    <td>{u.premium
                      ? <span className="adm-badge on">{t.premium}{u.premiumUntil ? ` · ${t.until} ${fmt(u.premiumUntil)}` : ''}</span>
                      : <span className="adm-badge">{t.free}</span>}</td>
                    <td className="adm-actions">
                      {confirm?.userId === u.id ? (
                        <span className="adm-confirm">{t.confirmQ}
                          <button className="adm-btn danger" disabled={busy} onClick={() => void doAction()}>{t.yes}</button>
                          <button className="adm-btn ghost" onClick={() => setConfirm(null)}>{t.cancel}</button>
                        </span>
                      ) : (
                        <>
                          {!u.premium && <button className="adm-btn small" onClick={() => setConfirm({ userId: u.id, action: 'activate' })}>{t.activate}</button>}
                          {u.premium && <button className="adm-btn small" onClick={() => setConfirm({ userId: u.id, action: 'extend' })}>{t.extend}</button>}
                          {u.premium && <button className="adm-btn small ghost" onClick={() => setConfirm({ userId: u.id, action: 'deactivate' })}>{t.deactivate}</button>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="adm-card adm-audit">
            <h2>{t.auditTitle}</h2>
            {!data.audit || data.audit.length === 0 ? <p className="adm-muted">{t.auditEmpty}</p> : (
              <ul>
                {data.audit.map((a) => (
                  <li key={a.id}><span>{new Date(a.created_at).toLocaleString(lang === 'fa' ? 'fa-AF' : 'en-GB')}</span>
                    <strong>{auditLabel(a.action)}</strong><span className="adm-muted">{emailOf(a.target_user_id)}</span></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
