import { describe,it,expect } from 'vitest'
import { createDoc, duplicateDoc, deleteDoc, renameDoc, searchDocs, filterDocs, toggleFavorite, loadDocs, saveDocs, STORAGE_KEY } from './store'
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
