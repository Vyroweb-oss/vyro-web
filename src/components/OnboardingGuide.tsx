// First-use guide card (Mission 2, M2-16 = owner spec §19).
// Deliberately NOT a modal: it sits inline on the dashboard, never blocks
// anything, and never asks for sign-in — local features need no account.
// The shortcuts catalogue itself lives in KeyboardShortcutsDialog (M2-15);
// this card only opens that dialog via prop, it never duplicates the list.
import { tr, type UiLang } from '../lib/i18n'

export default function OnboardingGuide({ lang, onCreateFirst, onOpenShortcuts, onDismiss }: {
  lang: UiLang
  onCreateFirst: () => void
  onOpenShortcuts: () => void
  onDismiss: () => void
}) {
  return (
    <section className="onboarding-guide print-hidden" aria-label={tr(lang, 'onboardingTitle')}>
      <div className="onboarding-guide-head">
        <h2 className="section-title">{tr(lang, 'onboardingTitle')}</h2>
        <button type="button" className="icon-btn" aria-label={tr(lang, 'onboardingDismiss')} onClick={onDismiss}>×</button>
      </div>
      <p className="muted">{tr(lang, 'onboardingWelcome')}</p>
      <ul className="onboarding-list">
        <li>💾 {tr(lang, 'onboardingLocal')}</li>
        <li>📄 {tr(lang, 'onboardingTemplates')}</li>
        <li>⌘ {tr(lang, 'onboardingPalette')}</li>
        <li>⌨ {tr(lang, 'onboardingShortcuts')}</li>
      </ul>
      <div className="row wrap">
        <button type="button" className="primary" onClick={onCreateFirst}>{tr(lang, 'createFirst')}</button>
        <button type="button" className="rbtn" onClick={onOpenShortcuts}>{tr(lang, 'onboardingShowShortcuts')}</button>
      </div>
    </section>
  )
}
