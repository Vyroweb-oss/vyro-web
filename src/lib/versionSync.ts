// Stage 2C — versionSync: mirror one linked document's version history
// between the local versions store and the cloud document_versions table.
//
// Rules (Stage 2 plan):
// - Mirroring is by snapshot id and idempotent: a second run with no
//   changes transfers nothing. Snapshot ids are stable across devices,
//   so the same snapshot arriving from two devices is one cloud row.
// - Versions are secondary data: a failure here NEVER marks the document
//   failed and never blocks document sync. The result reports what
//   happened and the next wake cycle simply tries again.
// - Nothing is ever deleted in either direction by mirroring. Local
//   pruning stays a local concern (the standard caps still apply after a
//   download merge); the cloud keeps its copies.
// - Only call this for cloud-linked documents (the caller checks
//   cloudRevision): an unlinked document's history stays local until the
//   Stage 2D migration carries it, with consent.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchVersions, insertVersion } from './cloudDocs'
import { planVersionSync } from './syncProtocol'
import { listVersions, loadVersions, pruneVersions, saveVersions } from './versions'

export interface VersionSyncResult {
  uploaded: number
  downloaded: number
  /** True when any step failed; partial progress is kept and the rest is
   * retried on the next cycle (transfers are idempotent). */
  failed: boolean
}

export async function syncVersionsForDoc(
  client: SupabaseClient,
  storage: Storage,
  docId: string,
): Promise<VersionSyncResult> {
  const remote = await fetchVersions(client, docId)
  if (!remote.ok) return { uploaded: 0, downloaded: 0, failed: true }

  const all = loadVersions(storage)
  const local = listVersions(all, docId)
  const plan = planVersionSync(local, remote.value)

  let uploaded = 0
  let failed = false
  // Oldest first, so the cloud history reads in creation order.
  const uploads = [...plan.upload].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const snap of uploads) {
    const res = await insertVersion(client, snap)
    if (!res.ok) { failed = true; break }
    uploaded++
  }

  let downloaded = 0
  if (plan.download.length > 0) {
    const merged = pruneVersions([...all, ...plan.download])
    if (saveVersions(storage, merged)) downloaded = plan.download.length
    else failed = true
  }

  return { uploaded, downloaded, failed }
}
