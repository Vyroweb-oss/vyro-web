// Profile page — the signed-in user's personal profile (owner order
// 2026-11-03): their name, email, auto username and membership date,
// how many documents they have created, the total words across all of
// them, and every document listed with its own word count. Counts come
// from the app's own stats engine (computeDocumentStats), the exact same
// numbers the editor status bar shows. Documents are the local library
// (local-first product): trashed documents are excluded by App, which
// passes only live docs. Tapping a document opens it in the editor.

import { tr, type I18nKey, type UiLang } from '../lib/i18n'
import { computeDocumentStats } from '../lib/stats'
import { countNoun } from '../lib/wordChrome'
import type { VyroDoc } from '../lib/types'
import Avatar from './Avatar'

interface Props {
  lang: UiLang
  name: string
  email: string
  username: string | null
  memberSince: string | null
  photoUrl?: string
  docs: VyroDoc[]
  onClose: () => void
  onOpenDoc: (id: string) => void
  onNewDoc: () => void
  onSignOut: () => void
}

const DocIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></svg>
)

export default function ProfilePage({ lang, name, email, username, memberSince, photoUrl, docs, onClose, onOpenDoc, onNewDoc, onSignOut }: Props) {
  const t = (k: I18nKey) => tr(lang, k)
  const locale = lang === 'fa' ? 'fa-IR' : 'en-US'
  const fmtNum = (n: number) => n.toLocaleString(locale)
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  }
  const rows = docs
    .map((doc) => ({ doc, stats: computeDocumentStats(doc.content) }))
    .sort((a, b) => (b.doc.updatedAt || '').localeCompare(a.doc.updatedAt || ''))
  const totalWords = rows.reduce((sum, r) => sum + r.stats.words, 0)
  const totalChars = rows.reduce((sum, r) => sum + r.stats.charsWithSpaces, 0)
  const displayName = name || email

  return (
    <div className="profile-page">
      <div className="profile-wrap">
        <button type="button" className="rbtn profile-back" onClick={onClose}>← {t('profileBack')}</button>

        <section className="profile-head">
          <Avatar size={76} photoUrl={photoUrl} />
          <div className="profile-head-main">
            <h1 dir="auto">{displayName}</h1>
            <p className="profile-email" dir="ltr">{email}</p>
            <div className="profile-chips">
              {username && <span className="profile-chip" dir="ltr">@{username}</span>}
              {memberSince && <span className="profile-chip">{t('memberSince')}: {fmtDate(memberSince)}</span>}
            </div>
          </div>
          <button type="button" className="rbtn profile-signout" onClick={onSignOut}>{t('signOut')}</button>
        </section>

        <div className="profile-stats">
          <div className="profile-stat"><b>{fmtNum(rows.length)}</b><span>{t('documentsLabel')}</span></div>
          <div className="profile-stat"><b>{fmtNum(totalWords)}</b><span>{t('totalWords')}</span></div>
          <div className="profile-stat"><b>{fmtNum(totalChars)}</b><span>{t('totalCharacters')}</span></div>
        </div>

        <section className="profile-docs">
          <div className="profile-docs-head">
            <h2>{t('myDocuments')}</h2>
            <button type="button" className="primary small" onClick={onNewDoc}>{t('newDocument')}</button>
          </div>
          {rows.length === 0 ? (
            <p className="muted profile-empty">{t('noDocuments')}</p>
          ) : rows.map(({ doc, stats }) => (
            <button type="button" key={doc.id} className="profile-doc" onClick={() => onOpenDoc(doc.id)}>
              <span className="profile-doc-ic">{DocIcon}</span>
              <span className="profile-doc-main">
                <b dir="auto">{doc.title || t('untitled')}</b>
                <span className="muted">{t('lastUpdated')}: {fmtDate(doc.updatedAt)}</span>
              </span>
              {doc.favorite && <span className="profile-doc-star" aria-hidden="true">★</span>}
              {(doc.cloudRevision !== undefined || doc.cloudSyncedAt) && <span className="profile-chip">☁ {t('cloudBadge')}</span>}
              <span className="profile-doc-words"><b>{fmtNum(stats.words)}</b> {countNoun(stats.words, t('wordSingular'), t('words'))}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  )
}
