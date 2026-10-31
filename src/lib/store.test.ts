import { describe,it,expect } from 'vitest'
import { createDoc, duplicateDoc, deleteDoc, renameDoc, searchDocs, filterDocs, toggleFavorite, loadDocs, saveDocs, STORAGE_KEY, sortDocs, trashDoc, restoreDoc, purgeDoc, listTrashed, listFolders } from './store'
import type { VyroDoc } from './types'
const mk=(p:Partial<VyroDoc>&{id:string;title:string}):VyroDoc=>({ content:{type:'doc',content:[{type:'paragraph'}]}, folder:'', favorite:false, dir:'ltr', createdAt:'2026-01-01T00:00:00.000Z', updatedAt:'2026-01-01T00:00:00.000Z', ...p })
describe('store CRUD',()=>{
 it('create/search/rename/duplicate/delete/favorite',()=>{
   let {docs,doc}=createDoc([],{title:'Alpha'}); expect(docs).toHaveLength(1)
   docs=renameDoc(docs,doc.id,'Beta'); expect(docs[0].title).toBe('Beta')
   expect(searchDocs(docs,'bet')).toHaveLength(1); expect(searchDocs(docs,'zzz')).toHaveLength(0)
   docs=toggleFavorite(docs,doc.id); expect(docs[0].favorite).toBe(true); expect(filterDocs(docs,{favoritesOnly:true})).toHaveLength(1)
   const dup=duplicateDoc(docs,doc.id); expect(dup).toHaveLength(2)
   expect(deleteDoc(dup,doc.id)).toHaveLength(1)
 })
 it('localStorage roundtrip',()=>{ const m=new Map<string,string>(); const fake={getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)}}; let {docs}=createDoc([],{title:'Persist'}); saveDocs(fake as any,docs); expect(loadDocs(fake as any)[0].title).toBe('Persist'); expect(m.has(STORAGE_KEY)).toBe(true) })
 it('folder filter',()=>{ let a=createDoc([],{title:'A',folder:'Work'}); let b=createDoc(a.docs,{title:'B',folder:'Personal'}); expect(filterDocs(b.docs,{folder:'Work'})).toHaveLength(1) })
})
describe('store sorting (R2)',()=>{
 it('updated: newest edit first, input not mutated',()=>{
   const docs=[mk({id:'a',title:'A',updatedAt:'2026-01-01T00:00:00.000Z'}),mk({id:'b',title:'B',updatedAt:'2026-01-03T00:00:00.000Z'}),mk({id:'c',title:'C',updatedAt:'2026-01-02T00:00:00.000Z'})]
   expect(sortDocs(docs,'updated').map(d=>d.id)).toEqual(['b','c','a'])
   expect(docs.map(d=>d.id)).toEqual(['a','b','c'])
 })
 it('name: locale-aware, Latin case-insensitive, Persian titles sort after Latin without throwing',()=>{
   const docs=[mk({id:'1',title:'banana'}),mk({id:'2',title:'Apple'}),mk({id:'3',title:'نامه'}),mk({id:'4',title:'گزارش'})]
   const out=sortDocs(docs,'name')
   expect(out.slice(0,2).map(d=>d.title)).toEqual(['Apple','banana'])
   expect(out.slice(2).map(d=>d.title).sort()).toEqual(['نامه','گزارش'].sort())
   expect(docs.map(d=>d.id)).toEqual(['1','2','3','4'])
 })
 it('created: newest creation first (independent of updatedAt)',()=>{
   const docs=[mk({id:'old',title:'Old',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-09T00:00:00.000Z'}),mk({id:'new',title:'New',createdAt:'2026-01-05T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z'})]
   expect(sortDocs(docs,'created').map(d=>d.id)).toEqual(['new','old'])
 })
 it('created: legacy doc without createdAt falls back to updatedAt',()=>{
   const legacy={...mk({id:'legacy',title:'Legacy',updatedAt:'2026-01-08T00:00:00.000Z'}), createdAt: undefined as any}
   const dated=mk({id:'dated',title:'Dated',createdAt:'2026-01-03T00:00:00.000Z',updatedAt:'2026-01-03T00:00:00.000Z'})
   expect(sortDocs([dated,legacy],'created').map(d=>d.id)).toEqual(['legacy','dated'])
 })
})
describe('store trash (R3)',()=>{
 it('trash hides a doc from lists, search and folder list; restore brings it back',()=>{
   let {docs,doc}=createDoc([],{title:'TrashMe',folder:'OnlyTrashFolder'})
   const before=docs[0].updatedAt
   docs=trashDoc(docs,doc.id)
   expect(typeof docs[0].deletedAt).toBe('string'); expect(docs[0].updatedAt).toBe(before)
   expect(filterDocs(docs,{})).toHaveLength(0); expect(filterDocs(docs,{query:'TrashMe'})).toHaveLength(0)
   expect(listFolders(docs)).toEqual([])
   expect(listTrashed(docs)).toHaveLength(1)
   docs=restoreDoc(docs,doc.id)
   expect(docs[0].deletedAt).toBeUndefined(); expect(filterDocs(docs,{})).toHaveLength(1); expect(listTrashed(docs)).toHaveLength(0)
 })
 it('listTrashed: trashed only, most recently trashed first',()=>{
   const docs=[mk({id:'a',title:'A',deletedAt:'2026-02-01T00:00:00.000Z'}),mk({id:'b',title:'B'}),mk({id:'c',title:'C',deletedAt:'2026-02-03T00:00:00.000Z'})]
   expect(listTrashed(docs).map(d=>d.id)).toEqual(['c','a'])
 })
 it('purge removes permanently',()=>{
   let {docs,doc}=createDoc([],{title:'Gone'}); docs=trashDoc(docs,doc.id); docs=purgeDoc(docs,doc.id)
   expect(docs).toHaveLength(0); expect(listTrashed(docs)).toHaveLength(0)
 })
 it('save/load round-trip preserves deletedAt',()=>{
   const m=new Map<string,string>(); const fake={getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)}}
   let {docs,doc}=createDoc([],{title:'Keep'}); docs=trashDoc(docs,doc.id); const stamp=docs[0].deletedAt
   saveDocs(fake as any,docs); const back=loadDocs(fake as any)
   expect(back[0].deletedAt).toBe(stamp); expect(listTrashed(back)).toHaveLength(1)
 })
 it('backward compat: stored docs without deletedAt load and behave as live docs',()=>{
   const m=new Map<string,string>(); const fake={getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)}}
   m.set(STORAGE_KEY, JSON.stringify([{id:'legacy1',title:'Old',content:{type:'doc',content:[]},folder:'',favorite:false,dir:'ltr',createdAt:'2025-01-01T00:00:00.000Z',updatedAt:'2025-01-02T00:00:00.000Z'}]))
   const back=loadDocs(fake as any)
   expect(back).toHaveLength(1); expect(back[0].deletedAt).toBeUndefined(); expect(filterDocs(back,{})).toHaveLength(1); expect(listTrashed(back)).toHaveLength(0)
 })
})

describe('sanitizeDoc pagination fields (regression: reload dropped them)', () => {
  it('keeps pageSize, custom dims, moderate and custom margins through a save/load round-trip', () => {
    const m = new Map<string, string>()
    const fake = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    const doc = { id: 'pg1', title: 'Sized', content: { type: 'doc', content: [] }, folder: '', favorite: false, dir: 'ltr', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', pageSize: 'Custom', pageW: 100, pageH: 150, margins: 'custom', customMargins: { top: 10, right: 15, bottom: 10, left: 15 }, orientation: 'landscape' }
    saveDocs(fake as any, [doc as any])
    const back = loadDocs(fake as any)
    expect(back).toHaveLength(1)
    expect(back[0].pageSize).toBe('Custom')
    expect(back[0].pageW).toBe(100)
    expect(back[0].pageH).toBe(150)
    expect(back[0].margins).toBe('custom')
    expect(back[0].customMargins).toEqual({ top: 10, right: 15, bottom: 10, left: 15 })
    const mod = { ...doc, id: 'pg2', pageSize: 'A5', margins: 'moderate' as const, customMargins: undefined }
    saveDocs(fake as any, [mod as any])
    expect(loadDocs(fake as any)[0].margins).toBe('moderate')
    expect(loadDocs(fake as any)[0].pageSize).toBe('A5')
  })
  it('drops malformed pagination fields instead of crashing', () => {
    const m = new Map<string, string>()
    const fake = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    m.set(STORAGE_KEY, JSON.stringify([{ id: 'bad1', title: 'Bad', content: { type: 'doc', content: [] }, pageSize: 42, pageW: 'wide', customMargins: { top: 'x' } }]))
    const back = loadDocs(fake as any)
    expect(back).toHaveLength(1)
    expect(back[0].pageSize).toBeUndefined()
    expect(back[0].pageW).toBeUndefined()
    expect(back[0].customMargins).toBeUndefined()
  })
})
