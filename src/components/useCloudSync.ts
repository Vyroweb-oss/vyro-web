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
// - A doc CREATED after the engine activated in this session is linked
//   automatically (new work under an active cloud autosaves to it).
// - A pre-existing local doc is NEVER bulk-uploaded from here: linking a
//   library that predates activation is the opt-in migration of Stage 2D
//   (consent + backup + hash-verified read-back).
// - A conflicted doc is left entirely alone until Stage 2C resolves it.

import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { VyroDoc } from '../lib/types'
import { isSupabaseConfigured, isCloudDocsEnabled } from '../lib/supabaseEnv'
import { payloadHashOf, type DocSyncStatus, type SyncOp } from '../lib/syncProtocol'
import { SyncEngine, type SyncAck } from '../lib/syncEngine'
import { loadVersions, saveVersions, createSnapshot, addVersion } from '../lib/versions'

export interface CloudSyncHandle {
  /** True while the engine is live (flag on + configured + premium session). */
  active: boolean
  /** Per-document status; null when cloud is inactive (render nothing). */
  statusFor: (doc: VyroDoc) => DocSyncStatus | null
  /** Ops still owed to the server for the current account. */
  pendingCount: number
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
  const activatedAtRef = useRef<string | null>(null)

  // -- engine lifecycle ------------------------------------------------------
  useEffect(() => {
    if (!active || !accountId) { setEngine(null); activatedAtRef.current = null; return }
    activatedAtRef.current = new Date().toISOString()
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
        setEngine(created)
        void created.pull()
        created.resume()
      } catch { /* chunk load failure: stay in Local Mode */ }
    })()
    return () => { cancelled = true; created?.dispose(); setEngine(null) }
    // docs/setDocs are refs/stable by construction; account + activity gate the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, accountId])

  // -- enqueue ops from local document changes --------------------------------
  useEffect(() => {
    const prev = prevDocsRef.current
    prevDocsRef.current = docs
    if (!engine || !accountId) return
    const nowIso = new Date().toISOString()
    const activatedAt = activatedAtRef.current
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
      } else if (activatedAt && doc.createdAt >= activatedAt) {
        engine.enqueue({
          accountId, docId: doc.id, op: 'insert',
          baseRevision: 0, payloadHash: payloadHashOf(doc), queuedAt: nowIso,
        })
      }
    }
  }, [docs, engine, accountId])

  // -- freshness triggers: focus / online / visibility / slow interval --------
  useEffect(() => {
    if (!engine) return
    const wake = () => { engine.resume(); void engine.pull() }
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

  return {
    active: !!engine,
    statusFor: (doc) => (engine ? engine.statusFor(doc) : null),
    pendingCount: engine ? engine.getPendingCount() : 0,
  }
}
