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
}
export function uid(): string { const c=(globalThis as any).crypto; if(c?.randomUUID) return c.randomUUID(); return Math.random().toString(36).slice(2,10)+Date.now().toString(36)+Math.random().toString(36).slice(2,8) }
