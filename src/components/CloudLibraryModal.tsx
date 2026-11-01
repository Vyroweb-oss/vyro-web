// Stage 2D — library backup / restore + per-document cloud transfer.
//
// One dialog, two independent sections:
//
// 1) Backup & restore (purely local): download a full-library backup file,
//    or restore one. Restoring replaces the local library with the file's
//    contents — after an explicit confirmation that first downloads a
//    backup of the CURRENT library. Restored documents always come back
//    local-only: nothing is re-linked to the cloud automatically (a link
//    is only ever re-established by the sync engine's hash-checked pull,
//    or by an explicit send below).
//
// 2) Send to cloud (only when the cloud engine is active: signed-in
//    Premium on the cloud-enabled build): the owner's per-document rule is
//    enforced structurally — a document moves only when the user ticks it
//    here and presses Send, the account has given first-upload consent,
//    and a fresh library backup has been built AND verified in this
//    session. Each send is one guarded insert (planSendToCloud via
//    useCloudSync); after the server acknowledges it, the server's stored
//    hash is read back and compared before the row may call itself
//    "verified". A failed or interrupted send leaves the local document
//    exactly as it was — sending never edits or removes the local copy.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { VyroDoc } from '../lib/types'
import { tr, type I18nKey, type UiLang } from '../lib/i18n'
import type { CloudSyncHandle } from './useCloudSync'
import { useDialogFocus } from './useDialogFocus'
import {
  buildLibraryBackup,
  serializeLibraryBackup,
  parseLibraryBackup,
  restoreLibrary,
  verifyRestoredLibrary,
  type LibraryState,
  type ParsedLibraryBackup,
  type RestoredLibrary,
} from '../lib/libraryBackup'
import { loadVersions } from '../lib/versions'
import { loadDrafts } from '../lib/recovery'

type RowState = 'queued' | 'sending' | 'verifying' | 'verified' | 'failed' | 'mismatch' | 'missing'

const ROW_KEY: Record<RowState, I18nKey> = {
  queued: 'sendStatusQueued',
  sending: 'sendStatusSending',
  verifying: 'sendStatusVerifying',
  verified: 'sendStatusVerified',
  failed: 'sendStatusFailed',
  mismatch: 'sendStatusMismatch',
  missing: 'sendStatusMissing',
}

const RESTORE_ERROR_KEY = {
  'not-json': 'restoreErrorNotJson',
  'wrong-kind': 'restoreErrorWrongKind',
  'unsupported-version': 'restoreErrorVersion',
  'bad-shape': 'restoreErrorShape',
} as const

function fill(template: string, vars: Record<string, number>): string {
  let out = template
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v))
  return out
}

function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function backupFileName(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `vyro-library-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
}

interface Props {
  lang: UiLang
  docs: VyroDoc[]
  cloud: CloudSyncHandle
  onRestore: (restored: RestoredLibrary) => void
  onClose: () => void
}

export default function CloudLibraryModal({ lang, docs, cloud, onRestore, onClose }: Props) {
  const t = (k: I18nKey) => tr(lang, k)
  const modalRef = useRef<HTMLDivElement>(null)
  useDialogFocus(true, { containerRef: modalRef, onClose, autofocus: true, trap: true })
  const fileRef = useRef<HTMLInputElement>(null)

  const currentState = (): LibraryState => ({
    docs,
    versions: loadVersions(localStorage),
    drafts: loadDrafts(localStorage),
  })

  // -- backup gate (transfer section) ---------------------------------------
  const [gate, setGate] = useState<'idle' | 'verified' | 'failed'>('idle')
  const [gateCounts, setGateCounts] = useState<{ documents: number; versions: number; drafts: number } | null>(null)
  const docIdSet = useMemo(() => docs.map((d) => d.id).join(','), [docs])
  const firstIdSet = useRef(docIdSet)
  useEffect(() => {
    // A changed set of documents (restore, create, delete) invalidates a
    // previously verified backup; mere cloud linking does not.
    if (firstIdSet.current !== docIdSet) {
      firstIdSet.current = docIdSet
      setGate('idle')
      setGateCounts(null)
    }
  }, [docIdSet])

  const prepareBackup = () => {
    const state = currentState()
    const backup = buildLibraryBackup(state)
    const parsed = parseLibraryBackup(serializeLibraryBackup(backup))
    if (!parsed.ok) { setGate('failed'); return }
    const v = verifyRestoredLibrary(state, restoreLibrary(parsed.value))
    const exact =
      v.documentsIdentical === v.documentsChecked &&
      v.versionsIdentical === v.versionsChecked &&
      v.draftsIdentical === v.draftsChecked &&
      v.mismatchedDocIds.length === 0 && v.mismatchedVersionIds.length === 0 && v.mismatchedDraftIds.length === 0
    setGateCounts(backup.counts)
    setGate(exact ? 'verified' : 'failed')
  }

  const downloadCurrentBackup = () => {
    downloadText(backupFileName(), serializeLibraryBackup(buildLibraryBackup(currentState())))
  }

  // -- restore ----------------------------------------------------------------
  const [restoreParsed, setRestoreParsed] = useState<ParsedLibraryBackup | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoreDone, setRestoreDone] = useState(false)

  const onPickFile = async (file: File) => {
    setRestoreError(null)
    setRestoreParsed(null)
    setRestoreDone(false)
    const text = await file.text()
    const parsed = parseLibraryBackup(text)
    if (!parsed.ok) {
      setRestoreError(t(RESTORE_ERROR_KEY[parsed.error]))
      return
    }
    setRestoreParsed(parsed.value)
  }

  const linkedRemovedCount = restoreParsed
    ? docs.filter((d) => d.cloudRevision != null && !restoreParsed.backup.documents.some((b) => b.id === d.id)).length
    : 0
  const droppedTotal = restoreParsed
    ? restoreParsed.droppedDocuments + restoreParsed.droppedVersions + restoreParsed.droppedDrafts + restoreParsed.droppedCloudLinks
    : 0

  const applyRestore = () => {
    if (!restoreParsed) return
    // Safety first: the current library leaves as a file before anything
    // is replaced, so this restore can itself be undone.
    downloadCurrentBackup()
    onRestore(restoreLibrary(restoreParsed))
    setRestoreParsed(null)
    setRestoreDone(true)
  }

  // -- send to cloud ------------------------------------------------------------
  const sendable = useMemo(
    () => docs.filter((d) => !d.deletedAt && d.cloudRevision == null && !d.cloudConflict),
    [docs],
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const verifyingRef = useRef<Set<string>>(new Set())

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sendOne = (id: string) => {
    const plan = cloud.sendToCloud(id)
    if (plan.action === 'enqueue') setRows((r) => ({ ...r, [id]: 'queued' }))
    else if (plan.reason === 'already-queued') setRows((r) => ({ ...r, [id]: 'queued' }))
    else setRows((r) => ({ ...r, [id]: 'failed' }))
  }

  const sendSelected = () => {
    for (const id of selected) sendOne(id)
  }

  // Watch for acknowledgements: once a queued document carries a cloud
  // revision, read the server hash back and classify the link.
  useEffect(() => {
    for (const [id, state] of Object.entries(rows)) {
      if (state !== 'queued' && state !== 'sending') continue
      const doc = docs.find((d) => d.id === id)
      if (!doc) continue
      if (doc.cloudRevision != null) {
        if (verifyingRef.current.has(id)) continue
        verifyingRef.current.add(id)
        setRows((r) => ({ ...r, [id]: 'verifying' }))
        void cloud.verifyCloudLink(id).then((result) => {
          verifyingRef.current.delete(id)
          setRows((r) => ({
            ...r,
            [id]: result === 'verified' ? 'verified' : result === 'mismatch' ? 'mismatch' : result === 'missing' ? 'missing' : 'failed',
          }))
        })
      } else if (cloud.statusFor(doc) === 'failed') {
        setRows((r) => ({ ...r, [id]: 'failed' }))
      }
    }
  }, [docs, rows, cloud])

  const counts = useMemo(() => {
    const st = currentState()
    return {
      documents: st.docs.length,
      versions: st.versions.length,
      drafts: Object.keys(st.drafts).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs])

  // Documents sent during THIS session, with their outcome. They leave the
  // checkbox list the moment they link — but their verification result
  // must stay visible here until the dialog closes: a mismatch that
  // quietly vanished would look exactly like a success.
  const sentRows = Object.entries(rows)
    .map(([id, state]) => ({ doc: docs.find((d) => d.id === id), state }))
    .filter((x): x is { doc: VyroDoc; state: RowState } => {
      if (!x.doc) return false
      const docId = x.doc.id
      return !sendable.some((s) => s.id === docId)
    })

  const canSend = cloud.active && !!cloud.consentAt && gate === 'verified'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="modal cloud-lib" role="dialog" aria-modal="true" aria-label={t('cloudLibTitle')} onClick={(e) => e.stopPropagation()}>
        <div className="cloud-lib-head">
          <h2>{t('cloudLibTitle')}</h2>
          <button className="rbtn" onClick={onClose} aria-label="×">×</button>
        </div>

        <h3>{t('backupSection')}</h3>
        <p className="muted">{t('backupExplain')}</p>
        <p>{fill(t('backupCounts'), { docs: counts.documents, versions: counts.versions, drafts: counts.drafts })}</p>
        <div className="row">
          <button className="primary small" onClick={downloadCurrentBackup}>{t('downloadBackup')}</button>
          <button className="rbtn" onClick={() => fileRef.current?.click()}>{t('restoreFromFile')}</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onPickFile(f)
              e.target.value = ''
            }}
          />
        </div>
        {restoreError && <p role="alert">{restoreError}</p>}
        {restoreDone && <p>{t('restoreDone')}</p>}
        {restoreParsed && (
          <div className="cloud-lib-confirm">
            <h4>{t('restoreConfirmTitle')}</h4>
            <p>{t('restoreConfirmBody')}</p>
            <p>{fill(t('backupCounts'), {
              docs: restoreParsed.backup.counts.documents,
              versions: restoreParsed.backup.counts.versions,
              drafts: restoreParsed.backup.counts.drafts,
            })}</p>
            {droppedTotal > 0 && <p>{fill(t('restoreDropped'), { count: droppedTotal })}</p>}
            {linkedRemovedCount > 0 && <p role="alert">{fill(t('restoreLinkedWarning'), { count: linkedRemovedCount })}</p>}
            <div className="row">
              <button className="primary small" onClick={applyRestore}>{t('restoreApply')}</button>
              <button className="rbtn" onClick={() => setRestoreParsed(null)}>{t('consentDecline')}</button>
            </div>
          </div>
        )}

        <h3>{t('cloudSection')}</h3>
        {!cloud.active ? (
          <p className="muted">{t('cloudInactiveNote')}</p>
        ) : !cloud.consentAt ? (
          <div className="cloud-lib-consent">
            <h4>{t('consentTitle')}</h4>
            <p>{t('consentBody')}</p>
            <p className="muted">{t('consentMoves')}</p>
            <div className="row">
              <button className="rbtn" onClick={onClose}>{t('consentDecline')}</button>
              <button className="primary small" onClick={() => cloud.recordConsent()}>{t('consentAgree')}</button>
            </div>
          </div>
        ) : (
          <>
            <h4>{t('backupGateTitle')}</h4>
            <p className="muted">{t('backupGateBody')}</p>
            {gate !== 'verified' && (
              <button className="primary small" onClick={prepareBackup}>{t('prepareBackup')}</button>
            )}
            {gate === 'verified' && gateCounts && (
              <p>{fill(t('backupVerified'), { docs: gateCounts.documents, versions: gateCounts.versions, drafts: gateCounts.drafts })}</p>
            )}
            {gate === 'failed' && <p role="alert">{t('backupVerifyFailed')}</p>}

            <h4>{t('sendListTitle')}</h4>
            {cloud.pausedPremium && <p role="alert">{t('sendPausedPremium')}</p>}
            {sendable.length === 0 ? (
              <p className="muted">{t('sendListEmpty')}</p>
            ) : (
              <>
                <ul className="cloud-lib-list">
                  {sendable.map((d) => {
                    const state = rows[d.id]
                    return (
                      <li key={d.id} className="cloud-lib-row">
                        <label>
                          <input
                            type="checkbox"
                            checked={selected.has(d.id)}
                            disabled={!canSend}
                            onChange={() => toggle(d.id)}
                          />
                          <span>{d.title}</span>
                        </label>
                        {state && (
                          <span className={`cloud-lib-status st-${state}`}>
                            {t(ROW_KEY[state])}
                            {(state === 'failed' || state === 'missing') && (
                              <button className="rbtn" onClick={() => sendOne(d.id)}>{t('retrySend')}</button>
                            )}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <button className="primary small" disabled={!canSend || selected.size === 0} onClick={sendSelected}>
                  {t('sendSelected')}
                </button>
              </>
            )}
            {sentRows.length > 0 && (
              <ul className="cloud-lib-list">
                {sentRows.map(({ doc: d, state }) => (
                  <li key={d.id} className="cloud-lib-row">
                    <span>{d.title}</span>
                    <span className={`cloud-lib-status st-${state}`}>
                      {t(ROW_KEY[state])}
                      {(state === 'failed' || state === 'missing') && (
                        <button className="rbtn" onClick={() => sendOne(d.id)}>{t('retrySend')}</button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
