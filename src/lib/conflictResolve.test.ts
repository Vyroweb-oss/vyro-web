import { describe, it, expect } from 'vitest'
import { planConflictResolution } from './conflictResolve'
import type { CloudDocRow } from './syncProtocol'

const row = { id: 'd1', revision: 3 } as CloudDocRow

describe('planConflictResolution', () => {
  it('mine + server row exists: snapshot the server copy, relink local onto it', () => {
    expect(planConflictResolution('mine', row)).toEqual({
      snapshotServerFirst: true, adoptServer: false, keepLocalAsNewDoc: false,
      relinkLocal: true, reinsertLocal: false, dropLocal: false,
    })
  })

  it('mine + server copy gone: local re-inserts as a new cloud doc', () => {
    expect(planConflictResolution('mine', null)).toEqual({
      snapshotServerFirst: false, adoptServer: false, keepLocalAsNewDoc: false,
      relinkLocal: false, reinsertLocal: true, dropLocal: false,
    })
  })

  it('server + server row exists: adopt the server row, nothing else', () => {
    expect(planConflictResolution('server', row)).toEqual({
      snapshotServerFirst: false, adoptServer: true, keepLocalAsNewDoc: false,
      relinkLocal: false, reinsertLocal: false, dropLocal: false,
    })
  })

  it('server + server copy gone: accept the deletion (snapshot already preserved it)', () => {
    expect(planConflictResolution('server', null)).toEqual({
      snapshotServerFirst: false, adoptServer: false, keepLocalAsNewDoc: false,
      relinkLocal: false, reinsertLocal: false, dropLocal: true,
    })
  })

  it('both + server row exists: snapshot server, adopt it, local becomes its own new doc', () => {
    expect(planConflictResolution('both', row)).toEqual({
      snapshotServerFirst: true, adoptServer: true, keepLocalAsNewDoc: true,
      relinkLocal: false, reinsertLocal: false, dropLocal: false,
    })
  })

  it('both + server copy gone: degenerates to mine (nothing to split)', () => {
    expect(planConflictResolution('both', null)).toEqual(planConflictResolution('mine', null))
  })
})
