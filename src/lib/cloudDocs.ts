// Stage 2B — cloudDocs: the ONLY module that talks to the cloud tables.
//
// Every call goes through the existing env-gated Supabase client with the
// signed-in user's session, so RLS (owner + server-verified Premium) does
// the enforcing; this module merely cooperates with the protocol:
// - It NEVER sends owner_id (the DB default auth.uid() fills it) and never
//   sends any premium flag (no such column exists).
// - Updates are predicated on the base revision (.eq('revision', base))
//   and themselves carry revision = base + 1, matching the DB trigger.
// - Results are values, not exceptions: PostgREST outcomes the protocol
//   must distinguish (0-row update, unique violation, RLS refusal) are
//   data here, classified by syncProtocol / the engine.
//
// Scope note: 2B covers the `documents` table. `document_versions` access
// (cloud version history) is Stage 2C, per the owner's sub-stage split.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CloudDocMeta, CloudDocPayload, CloudDocRow } from './syncProtocol'

export interface CloudError {
  message: string
  /** Postgres/PostgREST error code when available (e.g. '42501', '23505'). */
  code?: string
}

export type CloudResult<T> = { ok: true; value: T } | { ok: false; error: CloudError }

/** RLS refused the write (Postgres 42501): for inserts/updates this is the
 * server-side Premium gate answering — the client is never trusted, and a
 * tampered client meets exactly this. */
export function isPremiumBlockError(e: CloudError): boolean {
  return e.code === '42501'
}

/** Primary-key conflict on insert: a row with this id already exists. */
export function isUniqueViolation(e: CloudError): boolean {
  return e.code === '23505'
}

function toCloudError(error: any): CloudError {
  if (!error) return { message: 'Unknown cloud error' }
  return {
    message: typeof error.message === 'string' && error.message ? error.message : String(error),
    code: typeof error.code === 'string' && error.code ? error.code : undefined,
  }
}

const LIST_COLUMNS = 'id,title,html,folder,favorite,dir,template_id,margins,orientation,page_size,page_w,page_h,custom_margins,header_text,footer_text,created_at,updated_at,deleted_at,revision,content_hash,server_updated_at'

/** All of the caller's document rows WITHOUT content (pull/list projection). */
export async function fetchDocumentList(client: SupabaseClient): Promise<CloudResult<CloudDocMeta[]>> {
  try {
    const { data, error } = await client.from('documents').select(LIST_COLUMNS)
    if (error) return { ok: false, error: toCloudError(error) }
    return { ok: true, value: (data ?? []) as unknown as CloudDocMeta[] }
  } catch (e) {
    return { ok: false, error: toCloudError(e) }
  }
}

/** One full row (with content), or null when the caller has no such row. */
export async function fetchDocument(client: SupabaseClient, id: string): Promise<CloudResult<CloudDocRow | null>> {
  try {
    const { data, error } = await client.from('documents').select('*').eq('id', id).maybeSingle()
    if (error) return { ok: false, error: toCloudError(error) }
    return { ok: true, value: (data ?? null) as CloudDocRow | null }
  } catch (e) {
    return { ok: false, error: toCloudError(e) }
  }
}

/**
 * Insert a new cloud document. The payload must come from
 * syncProtocol.docToPayload (no owner_id, no revision — the DB defaults
 * revision to 1 and returns the created row as the acknowledgement).
 */
export async function insertDocument(client: SupabaseClient, payload: CloudDocPayload): Promise<CloudResult<CloudDocRow>> {
  try {
    const { data, error } = await client.from('documents').insert(payload).select().single()
    if (error) return { ok: false, error: toCloudError(error) }
    return { ok: true, value: data as unknown as CloudDocRow }
  } catch (e) {
    return { ok: false, error: toCloudError(e) }
  }
}

/**
 * Revision-predicated update: matches ONLY the row at baseRevision and
 * writes revision = baseRevision + 1 (the DB trigger enforces exactly
 * +1). Returns the matched rows: exactly one row at base+1 is the ack;
 * ZERO rows is a protocol signal (stale base / RLS refusal / gone row),
 * NOT an error — the caller classifies it via syncProtocol.
 */
export async function updateDocument(
  client: SupabaseClient,
  id: string,
  baseRevision: number,
  payload: CloudDocPayload,
): Promise<CloudResult<CloudDocRow[]>> {
  try {
    const { data, error } = await client
      .from('documents')
      .update({ ...payload, revision: baseRevision + 1 })
      .eq('id', id)
      .eq('revision', baseRevision)
      .select()
    if (error) return { ok: false, error: toCloudError(error) }
    return { ok: true, value: (data ?? []) as unknown as CloudDocRow[] }
  } catch (e) {
    return { ok: false, error: toCloudError(e) }
  }
}

/**
 * Hard delete (Trash purge only — normal trashing is an update that sets
 * deleted_at). Deleting an already-gone row is a successful no-op at the
 * PostgREST level, which is exactly the idempotence the outbox needs.
 */
export async function deleteDocument(client: SupabaseClient, id: string): Promise<CloudResult<true>> {
  try {
    const { error } = await client.from('documents').delete().eq('id', id)
    if (error) return { ok: false, error: toCloudError(error) }
    return { ok: true, value: true }
  } catch (e) {
    return { ok: false, error: toCloudError(e) }
  }
}
