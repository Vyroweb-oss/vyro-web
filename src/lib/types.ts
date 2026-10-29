import type { DocDir } from './dir'
export interface VyroDoc {
  id: string; title: string; content: any; html?: string; folder: string; favorite: boolean;
  dir: DocDir; createdAt: string; updatedAt: string; templateId?: string;
  margins?: 'narrow'|'normal'|'wide'; orientation?: 'portrait'|'landscape';
}
export function uid(): string { const c=(globalThis as any).crypto; if(c?.randomUUID) return c.randomUUID(); return Math.random().toString(36).slice(2,10)+Date.now().toString(36)+Math.random().toString(36).slice(2,8) }
