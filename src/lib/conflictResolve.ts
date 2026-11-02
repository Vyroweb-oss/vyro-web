// Stage 2C — conflict resolution planning (pure logic).
//
// A conflicted document (see syncEngine) holds local edits the server
// never accepted, because the server copy moved first (or vanished).
// The local content is ALWAYS already preserved: the engine's conflict
// path snapshots it into the local version history before marking the
// document. Resolution is the user's explicit choice — this module only
// decides WHAT a choice means, as a plan the hook executes:
//
// - 'mine':   the local version wins. If the server row still exists,
//             its content is snapshotted locally FIRST (nothing is lost
//             on either side), the document is relinked onto the
//             server's current revision, and the normal push then
//             carries the local content over it. If the server copy is
//             gone, the local document simply re-inserts as a new
//             cloud document.
// - 'server': the server version wins. The local document is replaced
//             by the server row (the local edits live on in the
//             conflict snapshot). If the server copy is gone, choosing
//             it means accepting the deletion: the local document is
//             removed, still snapshot-preserved.
// - 'both':   keep both as separate documents. The server row becomes
//             the document; the local content becomes a NEW document
//             (own id, own cloud life) — plus the server content is
//             snapshotted first for symmetry. If the server copy is
//             gone there is nothing to split: the choice degenerates
//             to 'mine' (re-insert).
//
// No plan ever overwrites or deletes content without a snapshot: the
// engine's conflict snapshot covers the local side, and
// snapshotServerFirst covers the server side.

import type { CloudDocRow } from './syncProtocol'

export type ConflictChoice = 'mine' | 'server' | 'both'

export interface ConflictResolutionPlan {
  /** Preserve the server row's content as a local version snapshot
   * before anything replaces it. */
  snapshotServerFirst: boolean
  /** Replace the local document with the server row (clean, linked). */
  adoptServer: boolean
  /** Create a separate new document holding the local content. */
  keepLocalAsNewDoc: boolean
  /** Keep the local document and relink it onto the server's current
   * revision so the next push carries the local content over. */
  relinkLocal: boolean
  /** Keep the local document and let it re-insert as a new cloud
   * document (its server copy is gone). */
  reinsertLocal: boolean
  /** Remove the local document (server copy gone + 'server' chosen;
   * the conflict snapshot preserves the content). */
  dropLocal: boolean
}

const NONE: ConflictResolutionPlan = {
  snapshotServerFirst: false,
  adoptServer: false,
  keepLocalAsNewDoc: false,
  relinkLocal: false,
  reinsertLocal: false,
  dropLocal: false,
}

export function planConflictResolution(
  choice: ConflictChoice,
  serverRow: CloudDocRow | null,
): ConflictResolutionPlan {
  const exists = serverRow !== null
  switch (choice) {
    case 'mine':
      return exists
        ? { ...NONE, snapshotServerFirst: true, relinkLocal: true }
        : { ...NONE, reinsertLocal: true }
    case 'server':
      return exists
        ? { ...NONE, adoptServer: true }
        : { ...NONE, dropLocal: true }
    case 'both':
      return exists
        ? { ...NONE, snapshotServerFirst: true, adoptServer: true, keepLocalAsNewDoc: true }
        : { ...NONE, reinsertLocal: true }
  }
}
