// AdminApp — the owner-only Vyro Web admin panel (Release 2, M-plan;
// simplified 2026-11-03 on the owner's model: the whole site is FREE
// and there is NO Premium version, so the panel manages no Premium —
// it is the owner's window on his users: stats, the searchable user
// list and per-user cloud-document counts).
// A SEPARATE entry (/admin.html) from the public app. This page holds
// NO privileges and NO service-role key: it signs the owner in with
// normal Supabase Auth and calls the admin Edge Function with the
// session token; the FUNCTION verifies app_metadata.role === 'admin'
// server-side on every request. A 403 here simply means "you are not
// the admin" and the panel stays shut.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Lang = 'fa' | 'en'

const STR = {
  en: {
    title: 'Vyro Admin Panel', signIn: 'Sign in', email: 'Email', password: 'Password',
    signOut: 'Sign out', notAdmin: 'This account is not an admin. Access is closed.',
    signInFailed: 'Sign-in failed. Check the email and password.',
    loading: 'Loading…', search: 'Search email, username or name…', refresh: 'Refresh',
    totalUsers: 'Total users', newLast7d: 'New (7 days)', cloudDocs: 'Cloud documents',
    user: 'User', username: 'Username', registered: 'Registered', lastSignIn: 'Last sign-in', docs: 'Docs',
    never: '—', loadFailed: 'Could not load the panel data.',
    notConfigured: 'Accounts are not configured on this build.',
    allFree: 'Everything on Vyro is free for all users — there is no Premium version.',
  },
  fa: {
    title: 'پنل مدیریت وایرو', signIn: 'ورود', email: 'ایمیل', password: 'رمز عبور',
    signOut: 'خروج', notAdmin: 'این حساب مدیر نیست. دسترسی بسته است.',
    signInFailed: 'ورود ناموفق بود. ایمیل و رمز عبور را بررسی کنید.',
    loading: 'در حال بارگذاری…', search: 'جستجو: ایمیل، نام کاربری یا نام…', refresh: 'تازه‌سازی',
    totalUsers: 'کل کاربران', newLast7d: 'ثبت‌نام ۷ روز اخیر', cloudDocs: 'اسناد ابری',
    user: 'کاربر', username: 'نام کاربری', registered: 'ثبت‌نام', lastSignIn: 'آخرین ورود', docs: 'اسناد',
    never: '—', loadFailed: 'داده‌های پنل بارگذاری نشد.',
    notConfigured: 'حساب‌ها در این نسخه پیکربندی نشده‌اند.',
    allFree: 'همه‌چیز در وایرو برای همه کاربران رایگان است — نسخهٔ پرمیوم وجود ندارد.',
  },
} as const

interface AdminUser {
  id: string; email: string; username: string | null; displayName: string | null
  createdAt: string; lastSignInAt: string | null; docs: number
}
interface PanelData {
  me: { id: string; email: string }
  stats: { totalUsers: number; newLast7d: number; premiumActive: number; totalCloudDocs: number }
  users: AdminUser[]
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

  const load = useCallback(async (query: string) => {
    if (!supabase) return
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) { setSignedIn(false); return }
    setSignedIn(true)
    const res = await fetch(`${FN_BASE}/admin-users${query ? `?q=${encodeURIComponent(query)}` : ''}`, {
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

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === 'fa' ? 'fa-AF' : 'en-GB') : t.never)

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
          <p className="adm-free-note">{t.allFree}</p>
          <section className="adm-stats">
            <div className="adm-stat"><span>{data.stats.totalUsers}</span><label>{t.totalUsers}</label></div>
            <div className="adm-stat"><span>{data.stats.newLast7d}</span><label>{t.newLast7d}</label></div>
            <div className="adm-stat"><span>{data.stats.totalCloudDocs}</span><label>{t.cloudDocs}</label></div>
          </section>

          <div className="adm-toolbar">
            <input className="adm-search" type="search" value={q} placeholder={t.search}
              onChange={(e) => { setQ(e.target.value); void load(e.target.value) }} />
            <button className="adm-btn ghost" onClick={() => void load(q)}>{t.refresh}</button>
          </div>

          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr>
                <th>{t.user}</th><th>{t.username}</th><th>{t.registered}</th><th>{t.lastSignIn}</th><th>{t.docs}</th>
              </tr></thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.displayName ?? u.email}</strong><br /><span className="adm-muted">{u.email}</span></td>
                    <td>{u.username ? `@${u.username}` : t.never}</td>
                    <td>{fmt(u.createdAt)}</td>
                    <td>{fmt(u.lastSignInAt)}</td>
                    <td>{u.docs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
