import { useState } from 'react'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import {
  EDITOR_FONTS, EDITOR_FONT_SIZES, AUTOSAVE_INTERVALS,
  type VyroSettings,
} from '../lib/settings'

// M2-08 Personalization (§20). A modal over the dashboard (the app's
// existing .modal pattern), backed by the single 'vyro-web-settings-v1'
// store owned by App. Every control writes straight into that store, so
// each setting takes effect immediately — nothing here is decorative.
// Reset uses a two-step inline confirm (the Move-to-trash pattern), never
// a browser dialog.
export default function SettingsPanel({ settings, lang, onChange, onReset, onClose }: {
  settings: VyroSettings
  lang: UiLang
  onChange: (patch: Partial<VyroSettings>) => void
  onReset: () => void
  onClose: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  const [confirmReset, setConfirmReset] = useState(false)
  const sel = (label: string, value: string | number, onChangeVal: (v: string) => void, options: { value: string | number; label: string }[]) => (
    <label className="field">{label}
      <select value={value} onChange={(e) => onChangeVal(e.target.value)}>
        {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" role="dialog" aria-label={t('settings')} onClick={(e) => e.stopPropagation()}>
        <h2>{t('settings')}</h2>
        {sel(t('language'), settings.uiLang, (v) => onChange({ uiLang: v as 'en' | 'fa' }), [
          { value: 'en', label: 'English' }, { value: 'fa', label: 'فارسی' },
        ])}
        {sel(t('uiSize'), settings.uiSize, (v) => onChange({ uiSize: v as VyroSettings['uiSize'] }), [
          { value: 'compact', label: t('uiSizeCompact') },
          { value: 'comfortable', label: t('uiSizeComfortable') },
          { value: 'large', label: t('uiSizeLarge') },
        ])}
        {sel(t('textWidth'), settings.writingWidth, (v) => onChange({ writingWidth: v as VyroSettings['writingWidth'] }), [
          { value: 'narrow', label: t('narrow') },
          { value: 'normal', label: t('normal') },
          { value: 'wide', label: t('wide') },
        ])}
        {sel(t('toolbarDisplay'), settings.toolbar, (v) => onChange({ toolbar: v as VyroSettings['toolbar'] }), [
          { value: 'full', label: t('toolbarFull') },
          { value: 'compact', label: t('toolbarCompact') },
        ])}
        {sel(t('groupTheme'), settings.theme, (v) => onChange({ theme: v as VyroSettings['theme'] }), [
          { value: 'light', label: t('lightUi') },
          { value: 'dark', label: t('darkUi') },
          { value: 'system', label: t('themeSystem') },
        ])}
        <hr className="settings-divider" />
        {sel(t('defaultDirection'), settings.defaultDir, (v) => onChange({ defaultDir: v as 'ltr' | 'rtl' }), [
          { value: 'ltr', label: 'LTR · English' },
          { value: 'rtl', label: 'RTL · دری/فارسی' },
        ])}
        {sel(t('defaultFont'), settings.defaultFont, (v) => onChange({ defaultFont: v }), EDITOR_FONTS.map((f) => ({ value: f, label: f.replace(/'/g, '') })))}
        {sel(t('defaultFontSize'), settings.defaultFontSize, (v) => onChange({ defaultFontSize: Number(v) }), EDITOR_FONT_SIZES.map((s) => ({ value: s, label: `${s}px` })))}
        <hr className="settings-divider" />
        <label className="field">{t('autosaveSettings')}
          <select value={settings.autosaveEnabled ? 'on' : 'off'} onChange={(e) => onChange({ autosaveEnabled: e.target.value === 'on' })}>
            <option value="on">{t('on')}</option>
            <option value="off">{t('off')}</option>
          </select>
        </label>
        {settings.autosaveEnabled && sel(t('autosaveInterval'), settings.autosaveIntervalMs, (v) => onChange({ autosaveIntervalMs: Number(v) }),
          AUTOSAVE_INTERVALS.map((ms) => ({ value: ms, label: ms < 1000 ? `${ms} ms` : `${ms / 1000} s` })))}
        {!settings.autosaveEnabled && <p className="muted">{t('autosaveOffNote')}</p>}
        <hr className="settings-divider" />
        {confirmReset
          ? <div className="inline-confirm" role="alertdialog" aria-label={t('resetSettings')}>
              <p>{t('resetSettingsConfirm')}</p>
              <div className="row">
                <button type="button" className="danger-btn" onClick={() => { onReset(); setConfirmReset(false) }}>{t('resetSettings')}</button>
                <button type="button" className="rbtn" onClick={() => setConfirmReset(false)}>{t('cancel')}</button>
              </div>
            </div>
          : <div className="row"><button type="button" className="rbtn" onClick={() => setConfirmReset(true)}>{t('resetSettings')}</button></div>}
        <div className="row end"><button type="button" className="primary small" onClick={onClose}>{t('close')}</button></div>
      </div>
    </div>
  )
}
