// Stage 2B — useCloudSync: wires the sync engine into the app lifecycle.
//
// The engine exists ONLY while ALL of these hold (Stage 0/2 plan):
// the VITE_CLOUD_DOCS_ENABLED kill switch is on, Supabase is configured,
// a user is signed in, and that user is Premium (server-verified
// entitlement drives this; the server enforces it again on every write).
// In every other state this hook is inert and the app behaves exactly as
// Local Mode always has — documents are never locked, and a lapsed
// Premium simply stops the engine (queued ops stay persisted for renewal).
//
// Linking rules (no silent uploads — Stage 2 plan §5):
// - A doc that already carries a cloudRevision is linked: its changes
//   enqueue revision-predicated updates; its disappearance enqueues a
//   hard delete.
// - An unlinked doc is NEVER uploaded from here — not even one created
//   while signed in (owner's per-document rule, 2026-11-01: the cloud
//   holds ONLY the documents the user explicitly chooses to put there).
//   Sending a doc to the cloud is an explicit per-document action
//   (Stage 2D: consent + backup + hash-verified read-back).
// - A conflicted doc is left entirely alone until Stage 2C resolves it.

import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uid, type VyroDoc } from '../lib/types'
import { isSupabaseConfigured, isCloudDocsEnabled } from '../lib/supabaseEnv'
import { payloadHashOf, rowToDoc, type DocSyncStatus, type SyncOp } from '../lib/syncProtocol'
import { SyncEngine, type SyncAck } from '../lib/syncEngine'
import { fetchDocument, fetchDocumentList } from '../lib/cloudDocs'
import { planConflictResolution, type ConflictChoice } from '../lib/conflictResolve'
import { loadConsent, recordConsent as persistConsent } from '../lib/cloudConsent'
import { planSendToCloud, verifyLinkHash, type SendPlan, type LinkVerification } from '../lib/cloudSend'
import { syncVersionsForDoc } from '../lib/versionSync'
import { loadVersions, saveVersions, createSnapshot, addVersion } from '../lib/versions'

export interface CloudSyncHandle {
  /** True while the engine is live (flag on + configured + premium session). */
  active: boolean
  /** Per-document status; null when cloud is inactive (render nothing). */
  statusFor: (doc: VyroDoc) => DocSyncStatus | null
  /** Ops still owed to the server for the current account. */
  pendingCount: number
  /** Stage 2C: execute the user's conflict-resolution choice for a
   * conflicted document. Resolves false when the server could not be
   * read (the document stays conflicted and the choice can be retried);
   * true once the resolution has been applied locally (any resulting
   * push then flows through the normal outbox). */
  resolveConflict: (docId: string, choice: ConflictChoice) => Promise<boolean>
  /** Stage 2D: first-upload consent timestamp for the current account
   * (null = never given; uploads stay blocked until it exists). */
  consentAt: string | null
  /** Stage 2D: record the account's first-upload consent. */
  recordConsent: () => boolean
  /** Stage 2D: the ONLY way a document is sent to the cloud — one
   * explicit call for one document, guarded by planSendToCloud. Returns
   * the plan so the UI can show exactly why a send was blocked. */
  sendToCloud: (docId: string) => SendPlan
  /** Stage 2D: read the server's meta row back and compare its stored
   * content_hash with the local payload hash. 'unavailable' = the read
   * itself failed (nothing is claimed either way). */
  verifyCloudLink: (docId: string) => Promise<LinkVerification | 'unavailable'>
  /** True while the queue is paused because the server refused a write
   * for a lapsed Premium (documents stay local and editable). */
  pausedPremium: boolean
}

interface UseCloudSyncOpts {
  user: { id: string } | null | undefined
  isPremium: boolean
  docs: VyroDoc[]
  setDocs: Dispatch<SetStateAction<VyroDoc[]>>
}

export function useCloudSync({ user, isPremium, docs, setDocs }: UseCloudSyncOpts): CloudSyncHandle {
  const accountId = user?.id ?? null
  const active = isCloudDocsEnabled && isSupabaseConfigured && !!accountId && isPremium
  const [engine, setEngine] = useState<SyncEngine | null>(null)
  const [, setTick] = useState(0)
  const docsRef = useRef(docs)
  docsRef.current = docs
  const prevDocsRef = useRef<VyroDoc[]>(docs)
  // Stage 2C: the live engine + client pair, for imperative work the
  // passive effects don't cover (conflict resolution, version mirroring).
  const liveRef = useRef<{ engine: SyncEngine; client: SupabaseClient } | null>(null)
  const versionSyncAtRef = useRef(new Map<string, number>())

  // Mirror version histories of linked, non-conflicted documents
  // (throttled per document; versions are secondary data — a failure is
  // silent here and simply retried on a later wake).
  const syncAllVersions = (force = false) => {
    const live = liveRef.current
    if (!live) return
    const now = Date.now()
    for (const d of docsRef.current) {
      if (d.cloudRevision == null || d.cloudConflict) continue
      const last = versionSyncAtRef.current.get(d.id) ?? 0
      if (!force && now - last < 5 * 60_000) continue
      versionSyncAtRef.current.set(d.id, now)
      void syncVersionsForDoc(live.client, localStorage, d.id).catch(() => {})
    }
  }

  // -- engine lifecycle ------------------------------------------------------
  useEffect(() => {
    if (!active || !accountId) { setEngine(null); liveRef.current = null; return }
    prevDocsRef.current = docsRef.current
    let cancelled = false
    let created: SyncEngine | null = null
    ;(async () => {
      try {
        const { supabase } = await import('../lib/supabase')
        if (cancelled || !supabase) return
        created = new SyncEngine({
          client: supabase,
          accountId,
          storage: localStorage,
          getDoc: (id) => docsRef.current.find((d) => d.id === id),
          getDocs: () => docsRef.current,
          onSynced: (docId: string, ack: SyncAck) => {
            setDocs((prev) => prev.map((d) => d.id === docId
              ? { ...d, cloudRevision: ack.revision, cloudHash: ack.hash, cloudSyncedAt: ack.syncedAt }
              : d))
          },
          onAdoptRemote: (remote: VyroDoc) => {
            setDocs((prev) => prev.some((d) => d.id === remote.id)
              ? prev.map((d) => (d.id === remote.id ? remote : d))
              : [remote, ...prev])
          },
          onConflict: (doc: VyroDoc) => {
            // Preserve the local content FIRST (version snapshot), then
            // mark the doc. The local document itself is never modified.
            try {
              const versions = loadVersions(localStorage)
              const snap = createSnapshot(doc, 'before-risky', 'Conflict copy')
              if (snap) saveVersions(localStorage, addVersion(versions, snap))
            } catch { /* best-effort: the local doc itself is untouched either way */ }
            setDocs((prev) => prev.map((d) => d.id === doc.id && !d.cloudConflict
              ? { ...d, cloudConflict: new Date().toISOString() }
              : d))
          },
          onChange: () => setTick((t) => t + 1),
        })
        if (cancelled) { created.dispose(); return }
        liveRef.current = { engine: created, client: supabase }
        setEngine(created)
        void created.pull().then(() => syncAllVersions(true))
        created.resume()
      } catch { /* chunk load failure: stay in Local Mode */ }
    })()
    return () => { cancelled = true; created?.dispose(); liveRef.current = null; setEngine(null) }
    // docs/setDocs are refs/stable by construction; account + activity gate the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, accountId])

  // -- enqueue ops from local document changes --------------------------------
  useEffect(() => {
    const prev = prevDocsRef.current
    prevDocsRef.current = docs
    if (!engine || !accountId) return
    const nowIso = new Date().toISOString()
    const currentIds = new Set(docs.map((d) => d.id))
    // Disappeared docs that were cloud-linked owe the server a hard delete.
    for (const old of prev) {
      if (!currentIds.has(old.id) && old.cloudRevision != null) {
        const op: SyncOp = {
          accountId, docId: old.id, op: 'delete',
          baseRevision: old.cloudRevision, payloadHash: old.cloudHash ?? '', queuedAt: nowIso,
        }
        engine.enqueue(op)
      }
    }
    for (const doc of docs) {
      if (doc.cloudConflict) continue
      if (doc.cloudRevision != null) {
        const hash = payloadHashOf(doc)
        if (hash !== doc.cloudHash) {
          engine.enqueue({
            accountId, docId: doc.id, op: 'update',
            baseRevision: doc.cloudRevision, payloadHash: hash, queuedAt: nowIso,
          })
        }
      }
      // Unlinked docs fall through with NO op: per-document opt-in only
      // (owner's rule, 2026-11-01) — this effect never uploads a document
      // the user did not explicitly choose to send to the cloud.
    }
  }, [docs, engine, accountId])

  // -- freshness triggers: focus / online / visibility / slow interval --------
  useEffect(() => {
    if (!engine) return
    const wake = () => { engine.resume(); void engine.pull(); syncAllVersions() }
    const onVisible = () => { if (document.visibilityState === 'visible') wake() }
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(wake, 60_000)
    return () => {
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [engine])

  // -- Stage 2C: conflict resolution -----------------------------------------
  // Executes planConflictResolution for the user's chosen outcome. The
  // local content was already snapshot-preserved when the conflict was
  // recorded; when the server copy is about to be replaced, its content
  // is snapshot-preserved first too. Nothing here writes to the server
  // directly except through the normal outbox (relink/reinsert), so the
  // revision protocol keeps governing every byte.
  const resolveConflict = async (docId: string, choice: ConflictChoice): Promise<boolean> => {
    const live = liveRef.current
    const acct = accountId
    const doc = docsRef.current.find((d) => d.id === docId)
    if (!live || !acct || !doc || !doc.cloudConflict) return false
    const server = await fetchDocument(live.client, docId)
    if (!server.ok) return false
    const row = server.value
    const plan = planConflictResolution(choice, row)
    if (plan.snapshotServerFirst && row) {
      try {
        const versions = loadVersions(localStorage)
        const snap = createSnapshot(rowToDoc(row), 'before-risky', 'Server copy')
        if (snap) saveVersions(localStorage, addVersion(versions, snap))
      } catch { /* best-effort: resolution still proceeds */ }
    }
    const nowIso = new Date().toISOString()
    if (plan.dropLocal) {
      setDocs((prev) => prev.filter((d) => d.id !== docId))
      return true
    }
    if (plan.adoptServer && row) {
      const remote = rowToDoc(row)
      const copy: VyroDoc | null = plan.keepLocalAsNewDoc
        ? {
            ...doc,
            content: JSON.parse(JSON.stringify(doc.content)),
            id: uid(),
            title: `${doc.title} (conflict copy)`,
            createdAt: nowIso, updatedAt: nowIso, deletedAt: undefined,
            cloudRevision: undefined, cloudHash: undefined, cloudSyncedAt: undefined, cloudConflict: undefined,
          }
        : null
      setDocs((prev) => {
        const mapped = prev.map((d) => (d.id === docId ? remote : d))
        return copy ? [copy, ...mapped] : mapped
      })
      void syncVersionsForDoc(live.client, localStorage, docId).catch(() => {})
      return true
    }
    if (plan.relinkLocal && row) {
      const serverHash = payloadHashOf(rowToDoc(row))
      setDocs((prev) => prev.map((d) => (d.id === docId
        ? { ...d, cloudConflict: undefined, cloudRevision: row.revision, cloudHash: serverHash, cloudSyncedAt: row.server_updated_at }
        : d)))
      // Mirror the 'Server copy' snapshot taken above right away (the
      // adopt branch already does this; without it the snapshot waited
      // for the next throttled wake — observed live in the 2C 'mine'
      // rehearsal, 2026-11-01).
      void syncVersionsForDoc(live.client, localStorage, docId).catch(() => {})
      return true
    }
    if (plan.reinsertLocal) {
      setDocs((prev) => prev.map((d) => (d.id === docId
        ? { ...d, cloudConflict: undefined, cloudRevision: undefined, cloudHash: undefined, cloudSyncedAt: undefined }
        : d)))
      live.engine.enqueue({
        accountId: acct, docId, op: 'insert',
        baseRevision: 0, payloadHash: payloadHashOf(doc), queuedAt: nowIso,
      })
      return true
    }
    return false
  }

  // -- Stage 2D: consent + per-document send + link verification -------------
  const [consentAt, setConsentAt] = useState<string | null>(null)
  useEffect(() => {
    setConsentAt(accountId ? loadConsent(localStorage, accountId) : null)
  }, [accountId])

  const recordConsent = (): boolean => {
    if (!accountId) return false
    if (!persistConsent(localStorage, accountId)) return false
    setConsentAt(loadConsent(localStorage, accountId))
    return true
  }

  const sendToCloud = (docId: string): SendPlan => {
    const live = liveRef.current
    const doc = docsRef.current.find((d) => d.id === docId)
    if (!live || !doc || !accountId) return { action: 'blocked', reason: 'inactive' }
    const plan = planSendToCloud(doc, {
      engineActive: true,
      // Storage is the source of truth (state may lag a just-taken consent).
      consentAt: loadConsent(localStorage, accountId),
      accountId,
      queue: live.engine.getQueue(),
      nowIso: new Date().toISOString(),
    })
    if (plan.action === 'enqueue') {
      live.engine.enqueue(plan.op)
      live.engine.resume()
    }
    return plan
  }

  const verifyCloudLink = async (docId: string): Promise<LinkVerification | 'unavailable'> => {
    const live = liveRef.current
    const doc = docsRef.current.find((d) => d.id === docId)
    if (!live || !doc) return 'unavailable'
    const res = await fetchDocumentList(live.client)
    if (!res.ok) return 'unavailable'
    const meta = res.value.find((m) => m.id === docId)
    return verifyLinkHash(meta?.content_hash, doc)
  }

  return {
    active: !!engine,
    statusFor: (doc) => (engine ? engine.statusFor(doc) : null),
    pendingCount: engine ? engine.getPendingCount() : 0,
    resolveConflict,
    consentAt,
    recordConsent,
    sendToCloud,
    verifyCloudLink,
    pausedPremium: engine ? engine.isPausedPremium() : false,
  }
}
