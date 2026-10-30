import { describe, it, expect } from 'vitest'
import {
  SAVE_BACKUP_KEY, initialSaveDiag, recordAttempt, recordSuccess, recordFailure,
  withBackup, classifyError, saveBackup, loadBackup, clearBackup, storageLocation,
  type SaveBackup,
} from './saveDiagnostics'

function fakeStorage(initial?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
  }
}

const throwingStorage = {
  getItem: () => null,
  setItem: () => { throw new Error('storage blocked') },
  removeItem: () => { throw new Error('storage blocked') },
}

const docContent = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const backup = (docId: string, text: string, at: string): SaveBackup => ({
  docId, title: 'Doc', content: docContent(text), savedAt: at,
})

describe('saveDiagnostics transitions', () => {
  it('initial record claims no success yet and no failures', () => {
    const d = initialSaveDiag()
    expect(d.lastSuccessAt).toBeNull()
    expect(d.lastAttemptAt).toBeNull()
    expect(d.failureCount).toBe(0)
    expect(d.lastErrorKind).toBeNull()
    expect(d.backupAt).toBeNull()
    expect(d.backupDocId).toBeNull()
  })
  it('recordAttempt marks saving with the attempt time and preserves the last success', () => {
    const d = recordAttempt(recordSuccess(initialSaveDiag(), '2026-10-30T10:00:00.000Z'), '2026-10-30T10:05:00.000Z')
    expect(d.status).toBe('saving')
    expect(d.lastAttemptAt).toBe('2026-10-30T10:05:00.000Z')
    expect(d.lastSuccessAt).toBe('2026-10-30T10:00:00.000Z')
  })
  it('recordSuccess sets saved + lastSuccessAt and clears the last error kind', () => {
    const failed = recordFailure(initialSaveDiag(), 'quota', '2026-10-30T10:01:00.000Z')
    const d = recordSuccess(failed, '2026-10-30T10:02:00.000Z')
    expect(d.status).toBe('saved')
    expect(d.lastSuccessAt).toBe('2026-10-30T10:02:00.000Z')
    expect(d.lastErrorKind).toBeNull()
  })
  it('recordFailure NEVER overwrites lastSuccessAt', () => {
    const ok = recordSuccess(initialSaveDiag(), '2026-10-30T10:00:00.000Z')
    const d = recordFailure(ok, 'storage', '2026-10-30T10:05:00.000Z')
    expect(d.status).toBe('failed')
    expect(d.lastSuccessAt).toBe('2026-10-30T10:00:00.000Z')
    expect(d.lastErrorKind).toBe('storage')
    expect(d.lastAttemptAt).toBe('2026-10-30T10:05:00.000Z')
  })
  it('recordFailure increments the count on every failure', () => {
    let d = initialSaveDiag()
    d = recordFailure(d, 'unknown', '2026-10-30T10:01:00.000Z')
    d = recordFailure(d, 'quota', '2026-10-30T10:02:00.000Z')
    expect(d.failureCount).toBe(2)
  })
  it('withBackup mirrors the backup snapshot, and null clears it', () => {
    const d = withBackup(initialSaveDiag(), { savedAt: '2026-10-30T10:03:00.000Z', docId: 'd1' })
    expect(d.backupAt).toBe('2026-10-30T10:03:00.000Z')
    expect(d.backupDocId).toBe('d1')
    expect(withBackup(d, null).backupAt).toBeNull()
    expect(withBackup(d, null).backupDocId).toBeNull()
  })
  it('a failure record contains NO document text', () => {
    const secret = 'my secret diary sentence about the vault'
    const d = recordFailure(
      recordSuccess(initialSaveDiag(), '2026-10-30T10:00:00.000Z'),
      classifyError(new Error(`QuotaExceededError while saving ${secret}`)),
      '2026-10-30T10:05:00.000Z',
    )
    const json = JSON.stringify(d)
    expect(json).not.toContain(secret)
    expect(json).not.toContain('content')
    expect(d.lastErrorKind).toBe('quota')
  })
})

describe('classifyError', () => {
  it('QuotaExceededError name → quota', () => {
    const e = new Error('out of space'); e.name = 'QuotaExceededError'
    expect(classifyError(e)).toBe('quota')
  })
  it('quota wording in the message → quota', () => {
    expect(classifyError(new Error('Quota exceeded for this origin'))).toBe('quota')
  })
  it('SecurityError name → storage', () => {
    const e = new Error('denied'); e.name = 'SecurityError'
    expect(classifyError(e)).toBe('storage')
  })
  it('storage wording in the message → storage', () => {
    expect(classifyError(new Error('Access to storage is blocked'))).toBe('storage')
  })
  it('generic Error → unknown', () => {
    expect(classifyError(new Error('something broke'))).toBe('unknown')
  })
  it('empty values → unknown', () => {
    expect(classifyError(null)).toBe('unknown')
    expect(classifyError(undefined)).toBe('unknown')
    expect(classifyError('')).toBe('unknown')
  })
})

describe('local backup', () => {
  it('round-trips a snapshot and deep-copies it', () => {
    const s = fakeStorage()
    const b = backup('d1', 'hello backup', '2026-10-30T10:00:00.000Z')
    expect(saveBackup(s, b)).toBe(true)
    const loaded = loadBackup(s)
    expect(loaded).toEqual(b)
    b.content.content[0].content[0].text = 'MUTATED'
    expect(loadBackup(s)!.content.content[0].content[0].text).toBe('hello backup')
  })
  it('saving a second backup overwrites the first (single-doc snapshot)', () => {
    const s = fakeStorage()
    saveBackup(s, backup('d1', 'first', '2026-10-30T10:00:00.000Z'))
    saveBackup(s, backup('d2', 'second', '2026-10-30T10:01:00.000Z'))
    const loaded = loadBackup(s)
    expect(loaded!.docId).toBe('d2')
    expect(s.map.get(SAVE_BACKUP_KEY)).not.toContain('first')
  })
  it('clearBackup removes the snapshot', () => {
    const s = fakeStorage()
    saveBackup(s, backup('d1', 'x', '2026-10-30T10:00:00.000Z'))
    expect(clearBackup(s)).toBe(true)
    expect(loadBackup(s)).toBeNull()
  })
  it('corrupt backup data loads as null, never throws', () => {
    const s = fakeStorage({ [SAVE_BACKUP_KEY]: '{not json' })
    expect(loadBackup(s)).toBeNull()
    const s2 = fakeStorage({ [SAVE_BACKUP_KEY]: JSON.stringify({ docId: '', title: 'T', content: {}, savedAt: 'bad' }) })
    expect(loadBackup(s2)).toBeNull()
  })
  it('saveBackup returns false (never throws) on throwing storage', () => {
    expect(saveBackup(throwingStorage, backup('d1', 'x', '2026-10-30T10:00:00.000Z'))).toBe(false)
    expect(clearBackup(throwingStorage)).toBe(false)
    expect(loadBackup(throwingStorage)).toBeNull()
  })
  it('saveBackup rejects an invalid snapshot', () => {
    const s = fakeStorage()
    expect(saveBackup(s, { docId: '', title: 'T', content: docContent('x'), savedAt: '2026-10-30T10:00:00.000Z' })).toBe(false)
    expect(loadBackup(s)).toBeNull()
  })
})

describe('storageLocation', () => {
  it('local when no cloud is configured; cloud only when configured', () => {
    expect(storageLocation(false)).toBe('local')
    expect(storageLocation(true)).toBe('cloud')
  })
})
