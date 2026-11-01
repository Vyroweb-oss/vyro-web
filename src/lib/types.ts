import type { DocDir } from './dir'
export interface VyroDoc {
  id: string; title: string; content: any; html?: string; folder: string; favorite: boolean;
  dir: DocDir; createdAt: string; updatedAt: string; templateId?: string;
  margins?: 'narrow'|'normal'|'moderate'|'wide'|'custom'; orientation?: 'portrait'|'landscape';
  /** Pagination mission: paper size id (see lib/pageSetup). Absent = A4. */
  pageSize?: string;
  /** Custom paper dimensions in millimetres (portrait, before orientation). */
  pageW?: number; pageH?: number;
  /** Custom margins in millimetres, used when margins === 'custom'. */
  customMargins?: { top: number; right: number; bottom: number; left: number };
  /** Release mission: per-document header/footer text, repeated on every sheet (screen) and via @page margin boxes (print). */
  headerText?: string;
  footerText?: string;
  /** ISO timestamp when the doc was moved to trash; absent = not trashed. Additive/optional for backward compatibility. */
  deletedAt?: string;
  /** Stage 2B cloud bookkeeping — present only on docs linked to the cloud
   * (behind VITE_CLOUD_DOCS_ENABLED). Absent = never synced. */
  /** Last server-acknowledged revision (documents.revision on the server). */
  cloudRevision?: number;
  /** Payload hash (see lib/syncProtocol) at the last server acknowledgement. */
  cloudHash?: string;
  /** ISO time of the last server acknowledgement. */
  cloudSyncedAt?: string;
  /** ISO time a sync conflict was recorded; the local content is never
   * overwritten while this is set (resolution UI is Stage 2C). */
  cloudConflict?: string;
}
export function uid(): string { const c=(globalThis as any).crypto; if(c?.randomUUID) return c.randomUUID(); return Math.random().toString(36).slice(2,10)+Date.now().toString(36)+Math.random().toString(36).slice(2,8) }
