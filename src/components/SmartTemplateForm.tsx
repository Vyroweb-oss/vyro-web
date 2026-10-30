import { useState } from 'react'
import {
  blankSmartValues, validateSmartForm, sectionChecklist,
  smartFieldLabel, smartName, smartSectionTitle,
  type SmartTemplate,
} from '../lib/smartTemplates'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'

// M2-12 form-to-document modal. No prompt/confirm/alert anywhere: errors
// render inline, reset is a plain button, and creation is blocked (not
// warned) while required fields are missing or invalid.
export default function SmartTemplateForm({ tpl, lang, onClose, onCreate }:{
  tpl: SmartTemplate
  lang: UiLang
  onClose: () => void
  onCreate: (values: Record<string, string>) => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  const [values, setValues] = useState<Record<string, string>>(() => blankSmartValues(tpl))
  const [attempted, setAttempted] = useState(false)
  const validation = validateSmartForm(tpl, values)
  const checks = sectionChecklist(tpl, values)
  const bad = new Set([...validation.missing, ...validation.invalid])
  const incompleteRequired = checks.filter(c => c.section.required && c.status === 'incomplete')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    if (!validateSmartForm(tpl, values).ok) return
    onCreate(values)
  }
  const reset = () => { setValues(blankSmartValues(tpl)); setAttempted(false) }

  return <div className="modal-backdrop" onClick={onClose}>
    <form className="modal smart-modal" dir={tpl.dir} onClick={e => e.stopPropagation()} onSubmit={submit}>
      <h2>{smartName(tpl, lang)}</h2>
      <div className="smart-checklist" aria-label={t('smartSectionChecklist')}>
        <div className="smart-checklist-title">{t('smartSectionChecklist')}</div>
        {checks.map(c => <div key={c.section.id} className={`smart-check ${c.status}`}>
          <span aria-hidden="true">{c.status === 'complete' ? '✓' : c.status === 'editor' ? '✎' : '○'}</span>
          <span>{smartSectionTitle(c.section, lang)}</span>
          {c.section.required && <span className="smart-req">{t('smartSectionRequired')}</span>}
          {c.status === 'editor' && <span className="muted">{t('smartCompleteInEditor')}</span>}
        </div>)}
      </div>
      {attempted && !validation.ok && <div className="smart-errors" role="alert">
        <div>{t('smartIncompleteSections')}</div>
        <ul>{incompleteRequired.map(c => <li key={c.section.id}>{smartSectionTitle(c.section, lang)}</li>)}</ul>
      </div>}
      {tpl.fields.map(f => <label key={f.key} className="field">
        {smartFieldLabel(f, lang)}{f.required ? ' *' : ''}
        <input
          value={values[f.key] ?? ''}
          dir="auto"
          inputMode={f.type === 'number' ? 'numeric' : undefined}
          onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
          aria-invalid={attempted && bad.has(f.key)}
        />
        {attempted && validation.missing.includes(f.key) && <span className="field-error">{t('smartFieldRequired')}</span>}
        {attempted && validation.invalid.includes(f.key) && <span className="field-error">{t('smartFieldInvalidNumber')}</span>}
      </label>)}
      <div className="row end">
        <button type="button" className="rbtn" onClick={reset}>{t('smartReset')}</button>
        <button type="button" className="rbtn" onClick={onClose}>{t('cancel')}</button>
        <button type="submit" className="primary small">{t('smartCreateDocument')}</button>
      </div>
    </form>
  </div>
}
