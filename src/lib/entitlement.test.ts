import { describe,it,expect } from 'vitest'
import { computeEntitlement } from './entitlement'
const now=new Date('2026-10-29T12:00:00Z')
describe('computeEntitlement',()=>{
 it('no user => free',()=>{ expect(computeEntitlement(null,now).isPremium).toBe(false) })
 it('no flag => free',()=>{ expect(computeEntitlement({app_metadata:{}},now).isPremium).toBe(false) })
 it('string "true" rejected',()=>{ expect(computeEntitlement({app_metadata:{premium:"true"}},now).isPremium).toBe(false) })
 it('bool true future => active',()=>{ const e=computeEntitlement({app_metadata:{premium:true,premium_until:'2027-01-01T00:00:00Z'}},now); expect(e.isPremium).toBe(true); expect(e.status).toBe('active') })
 it('bool true past => expired, not premium',()=>{ const e=computeEntitlement({app_metadata:{premium:true,premium_until:'2025-01-01T00:00:00Z'}},now); expect(e.isPremium).toBe(false); expect(e.status).toBe('expired') })
 it('bool true missing date => active-no-date',()=>{ expect(computeEntitlement({app_metadata:{premium:true}},now).status).toBe('active-no-date') })
 it('bool true unparseable => active-no-date',()=>{ expect(computeEntitlement({app_metadata:{premium:true,premium_until:'not-a-date'}},now).isPremium).toBe(true) })
 it('premium false => free',()=>{ expect(computeEntitlement({app_metadata:{premium:false,premium_until:'2027-01-01T00:00:00Z'}},now).isPremium).toBe(false) })
})
