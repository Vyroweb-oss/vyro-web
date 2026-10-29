import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from './components/Editor'
import type { VyroDoc } from './lib/types'
import { loadDocs, saveDocs, createDoc, deleteDoc, duplicateDoc, renameDoc, toggleFavorite, updateDoc, filterDocs, listFolders } from './lib/store'
import { TEMPLATES, getTemplate } from './lib/templates'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { computeEntitlement } from './lib/entitlement'
import { loadUiLang, saveUiLang, tr, uiDir, type UiLang, type I18nKey } from './lib/i18n'

export default function App(){
  const [docs,setDocs]=useState<VyroDoc[]>(()=> typeof window!=='undefined'? loadDocs(localStorage):[])
  const [openId,setOpenId]=useState<string|null>(null)
  const [query,setQuery]=useState(''); const [folder,setFolder]=useState(''); const [favOnly,setFavOnly]=useState(false)
  const [theme,setTheme]=useState(()=>localStorage.getItem('vyro-web-theme')||'light')
  const [lang,setLang]=useState<UiLang>(()=> typeof window!=='undefined'? loadUiLang(localStorage):'en')
  const [user,setUser]=useState<any>(null); const [authMsg,setAuthMsg]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState('')
  const [showPremium,setShowPremium]=useState(false); const [showTemplates,setShowTemplates]=useState(false)
  const [saveError,setSaveError]=useState(false)
  const saveErrorShown=useRef(false)
  const t=(k:I18nKey)=>tr(lang,k)
  const entitlement=useMemo(()=> computeEntitlement(user, new Date()),[user])
  const isPremium = isSupabaseConfigured && !!user && entitlement.isPremium
  useEffect(()=>{ const ok=saveDocs(localStorage, docs); if(!ok && !saveErrorShown.current){ saveErrorShown.current=true; setSaveError(true) } if(ok){ saveErrorShown.current=false; setSaveError(false) } },[docs])
  useEffect(()=>{ document.documentElement.dataset.theme=theme; localStorage.setItem('vyro-web-theme',theme) },[theme])
  useEffect(()=>{ saveUiLang(localStorage, lang); document.documentElement.lang = lang==='fa' ? 'fa' : 'en' },[lang])
  useEffect(()=>{ if(!supabase) return; (async()=>{ const {data}=await supabase.auth.getUser(); setUser(data.user??null) })(); const {data:sub}=supabase.auth.onAuthStateChange(async()=>{ if(!supabase) return; const {data}=await supabase.auth.getUser(); setUser(data.user??null) }); return ()=>sub.subscription.unsubscribe() },[])
  const filtered=useMemo(()=>filterDocs(docs,{query,folder: folder||undefined, favoritesOnly:favOnly}),[docs,query,folder,favOnly])
  const folders=listFolders(docs)
  const openDoc=docs.find(d=>d.id===openId)
  const createFromTemplate=(tid:string)=>{ const tpl=getTemplate(tid); const {docs:nd, doc}=createDoc(docs,{title: tpl&&tpl.id!=='blank'? tpl.name+' — Untitled':'Untitled document', content: JSON.parse(JSON.stringify(tpl?.content||{type:'doc',content:[{type:'paragraph'}]})), dir: tpl?.dir||'ltr', templateId:tid}); setDocs(nd); setOpenId(doc.id); setShowTemplates(false) }
  const createCustomTemplate=()=>{ if(!isPremium){ setShowPremium(true); return } const name=prompt(t('customTemplatePrompt')); if(!name) return; const {docs:nd,doc}=createDoc(docs,{title:name, content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Custom template — edit and reuse.'}]}]}}); setDocs(nd); setOpenId(doc.id) }
  const patchDoc=(id:string, patch:Partial<VyroDoc>, content?:any)=>{ setDocs(prev=>prev.map(d=> d.id===id? {...d, ...patch, ...(content?{content}:{}), updatedAt:new Date().toISOString()}:d)) }
  const authAction=async(kind:'in'|'up'|'out')=>{ if(!supabase) return; setAuthMsg(''); try{ if(kind==='out'){ await supabase.auth.signOut(); setUser(null) } else if(kind==='in'){ const {error}=await supabase.auth.signInWithPassword({email,password}); if(error) throw error; const {data}=await supabase.auth.getUser(); setUser(data.user) } else { const {error}=await supabase.auth.signUp({email,password}); if(error) throw error; const {data}=await supabase.auth.getUser(); setUser(data.user); setAuthMsg(t('accountCreated')) } }catch(e:any){ setAuthMsg(e.message||t('authFailed')) } }
  const dir=uiDir(lang)
  if(openDoc) return <div className={`app${lang==='fa'?' fa':''}`} dir={dir}><Editor doc={openDoc} lang={lang} onBack={()=>setOpenId(null)} isPremium={isPremium} onRequirePremium={()=>setShowPremium(true)} theme={theme} onToggleTheme={()=>setTheme(th=>th==='dark'?'light':'dark')} onChange={(patch,content)=>patchDoc(openDoc.id,patch,content)}/>{showPremium && <PremiumModal lang={lang} onClose={()=>setShowPremium(false)} isPremium={isPremium}/>}{saveError && <div className="toast" role="alert">{t('saveFailed')}</div>}</div>
  return <div className={`app${lang==='fa'?' fa':''}`} dir={dir}>
    <header className="dash-header"><div className="logo big"><span className="vmark">V</span> Vyro Web</div><span className="tagline">{t('appTagline')}</span>
      <div className="lang-toggle" role="group" aria-label={t('language')}><button className={`rbtn${lang==='en'?' active':''}`} onClick={()=>setLang('en')}>EN</button><button className={`rbtn${lang==='fa'?' active':''}`} onClick={()=>setLang('fa')}>فارسی</button></div>
      <button className="rbtn" onClick={()=>setTheme(th=>th==='dark'?'light':'dark')}>{theme==='dark'?'Light':'Dark'}</button></header>
    {!isSupabaseConfigured && <div className="banner" role="status">{t('localBanner')}</div>}
    {saveError && <div className="toast" role="alert">{t('saveFailed')}</div>}
    <div className="dash-grid">
      <aside className="sidebar">
        <button className="primary" onClick={()=>createFromTemplate('blank')}>{t('newDocument')}</button>
        <button className="rbtn block" onClick={()=>setShowTemplates(s=>!s)}>{t('templates')}</button>
        {showTemplates && <div className="template-list">{TEMPLATES.map(tpl=><button key={tpl.id} className="tpl" onClick={()=>createFromTemplate(tpl.id)}><b>{tpl.name}</b><small>{tpl.description}{tpl.dir==='rtl'?' · RTL':''}</small></button>)}<button className="tpl" onClick={createCustomTemplate}><b>{t('customTemplate')} {!isPremium&&t('premiumLock')}</b><small>{t('customTemplateDesc')}</small></button></div>}
        <label>{t('search')}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('searchPlaceholder')}/></label>
        <label>{t('folder')}<select value={folder} onChange={e=>setFolder(e.target.value)}><option value="">{t('allFolders')}</option>{folders.map(f=><option key={f} value={f}>{f}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={favOnly} onChange={e=>setFavOnly(e.target.checked)}/> {t('favoritesOnly')}</label>
        <div className="card"><h3>{t('profileSubscription')}</h3>
          {!isSupabaseConfigured ? <><p><b>{t('localFree')}</b></p><p className="muted">{t('noAccount')}</p></> : user ? <><p>{user.email}</p><p>{(user.user_metadata?.display_name)||t('noDisplayName')}</p><p><b>{entitlement.isPremium?`${t('premiumActive')} — ${entitlement.status}`: entitlement.status==='expired'? t('premiumExpired'): t('free')}</b></p>{entitlement.premiumUntil && <p className="muted">{t('until')} {entitlement.premiumUntil.toLocaleString()}</p>}<button className="rbtn" onClick={()=>authAction('out')}>{t('signOut')}</button>{!entitlement.isPremium && <button className="primary small" onClick={()=>setShowPremium(true)}>{t('goPremium')}</button>}</> : <>
            <input placeholder={t('email')} aria-label={t('email')} value={email} onChange={e=>setEmail(e.target.value)}/><input placeholder={t('password')} aria-label={t('password')} type="password" value={password} onChange={e=>setPassword(e.target.value)}/>
            <div className="row"><button className="primary small" onClick={()=>authAction('in')}>{t('signIn')}</button><button className="rbtn" onClick={()=>authAction('up')}>{t('signUp')}</button></div></>}
          {authMsg && <p className="muted">{authMsg}</p>}
        </div>
      </aside>
      <main className="main"><h2>{t('recentDocuments')}</h2>
        {filtered.length===0 && (docs.length===0
          ? <div className="empty"><p>{t('noDocuments')}</p><p className="muted">{t('noDocumentsText')}</p><button className="primary" onClick={()=>createFromTemplate('blank')}>{t('createFirst')}</button></div>
          : <div className="empty"><p>{t('noMatches')}</p><button className="primary" onClick={()=>{ setQuery(''); setFolder(''); setFavOnly(false) }}>{t('clearFilters')}</button></div>)}
        <div className="doc-grid">{filtered.map(d=><article key={d.id} className="doc-card">
          <button className="doc-open" onClick={()=>setOpenId(d.id)}><h3>{d.title}</h3><p className="muted">{new Date(d.updatedAt).toLocaleString()} · {d.dir.toUpperCase()}{d.folder?` · ${d.folder}`:''}</p></button>
          <div className="card-actions"><button title={t('favorite')} aria-label={t('favorite')} onClick={()=>setDocs(prev=>toggleFavorite(prev,d.id))}>{d.favorite?'★':'☆'}</button><button onClick={()=>{ const nt=prompt(t('renamePrompt'),d.title); if(nt) setDocs(prev=>renameDoc(prev,d.id,nt)) }}>{t('rename')}</button><button onClick={()=>setDocs(prev=>duplicateDoc(prev,d.id))}>{t('duplicate')}</button><button onClick={()=>{ const f=prompt(t('folderPrompt'),d.folder); if(f!==null) setDocs(prev=>updateDoc(prev,d.id,{folder:f.trim()})) }}>{t('folder')}</button><button className="danger" onClick={()=>{ if(confirm(`${t('deleteConfirmPrefix')} "${d.title}"?`)) setDocs(prev=>deleteDoc(prev,d.id)) }}>{t('delete')}</button></div></article>)}
        </div>
        <section className="templates-strip"><h3>{t('templatesHeading')}</h3><div className="row wrap">{TEMPLATES.map(tpl=><button key={tpl.id} className="tpl-chip" onClick={()=>createFromTemplate(tpl.id)}>{tpl.name}</button>)}</div></section>
      </main>
    </div>
    {showPremium && <PremiumModal lang={lang} onClose={()=>setShowPremium(false)} isPremium={isPremium}/>}
  </div>
}
function PremiumModal({onClose,isPremium,lang}:{onClose:()=>void;isPremium:boolean;lang:UiLang}){ const t=(k:I18nKey)=>tr(lang,k); return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><h2>{t('premiumTitle')}</h2>{isPremium?<p>{t('premiumThanks')}</p>:<><p>{t('premiumDesc')}</p><ul><li>{t('planMonthly')}</li><li>{t('planQuarterly')}</li></ul><ol><li>{t('payStep1')} <b>+93 779 528 228</b></li><li>{t('payStep2')}</li><li>{t('payStep3')}</li></ol></>}<button className="primary" onClick={onClose}>{t('close')}</button></div></div> }
