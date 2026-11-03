// Landing page — the front door (owner orders 2026-11-03): a first-time
// visitor who just found Vyro's link first sees THIS page, which says
// what Vyro is and why it is worth using, with a big "Get started"
// button into sign-up (then straight into the app). Returning users get
// a Sign in button; anyone may also continue without an account into
// free local editing (the local-first promise). Shown only when
// accounts are configured and the visitor is signed out; once dismissed
// via "continue without an account" it does not nag again on this
// browser (localStorage flag, owned by App). The document visual is a
// pure-CSS 3D scene — no images, no libraries.

import type { ReactNode } from 'react'
import { tr, type I18nKey, type UiLang } from '../lib/i18n'

interface Props {
  lang: UiLang
  onStart: () => void
  onSignIn: () => void
  onContinueLocal: () => void
  onLangChange: (lang: UiLang) => void
}

const ic = (paths: ReactNode) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
)
const IconGift = ic(<><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13M5 12v9h14v-9" /><path d="M12 8s-4.2.2-4.2-2.2C7.8 3.6 10 3 11 4.4 11.7 5.4 12 8 12 8Zm0 0s4.2.2 4.2-2.2C16.2 3.6 14 3 13 4.4 12.3 5.4 12 8 12 8Z" /></>)
const IconShield = ic(<><path d="M12 3l7 3v5c0 5-3.5 8.2-7 10-3.5-1.8-7-5-7-10V6l7-3Z" /><path d="M9 12l2 2 4-4" /></>)
const IconDevices = ic(<><rect x="2" y="5" width="13" height="10" rx="2" /><path d="M6 19h6" /><rect x="17" y="9" width="5" height="10" rx="1.5" /></>)
const IconCloud = ic(<><path d="M7 18h9.5a4.5 4.5 0 0 0 .9-8.84A6 6 0 0 0 5.7 10.6 4 4 0 0 0 7 18Z" /></>)
const IconRtl = ic(<><path d="M4 6h10M4 10h7" /><path d="M20 5v9" /><path d="M16.5 11.5 20 15l3.5-3.5" /></>)
const IconDoc = ic(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></>)

function Brand() {
  return (
    <span className="lp-brand">
      <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <linearGradient id="vyroLpGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8B7CFF" />
            <stop offset="1" stopColor="#4F46E5" />
          </linearGradient>
        </defs>
        <path d="M7 5 L24 41 L41 5 L32 5 L24 25 L16 5 Z" fill="url(#vyroLpGrad)" />
        <path d="M24 41 L41 5 L32 5 L24 25 Z" fill="#38BDF8" opacity="0.5" />
      </svg>
      <span>Vyro</span>
    </span>
  )
}

export default function LandingPage({ lang, onStart, onSignIn, onContinueLocal, onLangChange }: Props) {
  const t = (k: I18nKey) => tr(lang, k)
  const benefits: { icon: ReactNode; title: I18nKey; desc: I18nKey }[] = [
    { icon: IconGift, title: 'authFeatureFreeTitle', desc: 'authFeatureFreeDesc' },
    { icon: IconCloud, title: 'landingCloudTitle', desc: 'landingCloudDesc' },
    { icon: IconRtl, title: 'landingRtlTitle', desc: 'landingRtlDesc' },
    { icon: IconDoc, title: 'landingWordTitle', desc: 'landingWordDesc' },
    { icon: IconShield, title: 'authFeatureSecureTitle', desc: 'authFeatureSecureDesc' },
    { icon: IconDevices, title: 'authFeatureDevicesTitle', desc: 'authFeatureDevicesDesc' },
  ]
  const steps: { title: I18nKey; desc: I18nKey }[] = [
    { title: 'landingStep1Title', desc: 'landingStep1Desc' },
    { title: 'landingStep2Title', desc: 'landingStep2Desc' },
    { title: 'landingStep3Title', desc: 'landingStep3Desc' },
  ]
  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden="true"><span className="lp-orb o1" /><span className="lp-orb o2" /><span className="lp-orb o3" /></div>
      <header className="lp-nav">
        <Brand />
        <span className="lp-nav-actions">
          <span className="lang-toggle" role="group" aria-label={t('language')}><button type="button" className={`rbtn${lang === 'en' ? ' active' : ''}`} onClick={() => onLangChange('en')}>EN</button><button type="button" className={`rbtn${lang === 'fa' ? ' active' : ''}`} onClick={() => onLangChange('fa')}>فارسی</button></span>
          <button type="button" className="lp-btn ghost" onClick={onSignIn}>{t('signIn')}</button>
          <button type="button" className="lp-btn primary" onClick={onStart}>{t('landingStart')}</button>
        </span>
      </header>
      <main className="lp-main">
        <section className="lp-hero">
          <div className="lp-hero-text">
            <span className="lp-badge">{t('landingBadge')}</span>
            <h1>{t('landingHeadline')}</h1>
            <p className="lp-def">{t('landingDef')}</p>
            <div className="lp-cta-row">
              <button type="button" className="lp-btn primary big" onClick={onStart}>{t('landingStart')}</button>
              <button type="button" className="lp-btn ghost big" onClick={onSignIn}>{t('signIn')}</button>
            </div>
            <button type="button" className="lp-local" onClick={onContinueLocal}>{t('landingContinueLocal')}</button>
          </div>
          <div className="lp-scene" aria-hidden="true">
            <div className="lp-doc back" />
            <div className="lp-doc front">
              <div className="lp-doc-bar"><span /><span /><span /></div>
              <div className="lp-line title" />
              <div className="lp-line w90" /><div className="lp-line w75" /><div className="lp-line w85" />
              <div className="lp-imgblock" />
              <div className="lp-line w80" /><div className="lp-line w65" />
            </div>
            <span className="lp-chip c1">☁ {t('cloudBadge')}</span>
            <span className="lp-chip c2">DOCX · PDF</span>
            <span className="lp-chip c3">{t('landingChipRtl')}</span>
            <div className="lp-shadow" />
          </div>
        </section>

        <section className="lp-benefits">
          {benefits.map((b) => (
            <article key={b.title} className="lp-benefit">
              <span className="lp-benefit-ic">{b.icon}</span>
              <h3>{t(b.title)}</h3>
              <p>{t(b.desc)}</p>
            </article>
          ))}
        </section>

        <section className="lp-steps">
          <h2>{t('landingStepsTitle')}</h2>
          <div className="lp-steps-row">
            {steps.map((s, i) => (
              <article key={s.title} className="lp-step">
                <span className="lp-step-num">{i + 1}</span>
                <h3>{t(s.title)}</h3>
                <p>{t(s.desc)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-final">
          <h2>{t('landingCtaTitle')}</h2>
          <button type="button" className="lp-btn white big" onClick={onStart}>{t('landingStart')}</button>
        </section>
        <footer className="lp-footer">{t('landingFooter')}</footer>
      </main>
    </div>
  )
}
