import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from './components/Editor'
import type { VyroDoc } from './lib/types'
import { loadDocs, saveDocs, createDoc, deleteDoc, duplicateDoc, renameDoc, toggleFavorite, updateDoc, filterDocs, listFolders } from './lib/store'
import { TEMPLATES, getTemplate } from './lib/templates'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { computeEntitlement } from './lib/entitlement'
import { loadUiLang, saveUiLang, tr, uiDir, type UiLang, type I18nKey } from './lib/i18n'

type CardEdit = { id: string; kind: 'rename' | 'folder'; value: string }

export default function App(){
  const [docs,setDocs]=useState<VyroDoc[]>(()=> typeof window!=='undefined'? loadDocs(localStorage):[])
  const [openId,setOpenId]=useState<string|null>(null)
  const [query,setQuery]=useState(''); const [folder,setFolder]=useState(''); const [favOnly,setFavOnly]=useState(false)
  const [theme,setTheme]=useState(()=>localStorage.getItem('vyro-web-theme')||'light')
  const [lang,setLang]=useState<UiLang>(()=> typeof window!=='undefined'? loadUiLang(localStorage):'en')
  const [user,setUser]=useState<any>(null); const [authMsg,setAuthMsg]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState('')
  const [showPremium,setShowPremium]=useState(false)
  const [saveError,setSaveError]=useState(false)
  const [menuId,setMenuId]=useState<string|null>(null)
  const [cardEdit,setCardEdit]=useState<CardEdit|null>(null)
  const [deleteId,setDeleteId]=useState<string|null>(null)
  const [tplModal,setTplModal]=useState(false); const [tplName,setTplName]=useState('')
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
  const createFromTemplate=(tid:string)=>{ const tpl=getTemplate(tid); const {docs:nd, doc}=createDoc(docs,{title: tpl&&tpl.id!=='blank'? tpl.name+' — Untitled':'Untitled document', content: JSON.parse(JSON.stringify(tpl?.content||{type:'doc',content:[{type:'paragraph'}]})), dir: tpl?.dir||'ltr', templateId:tid}); setDocs(nd); setOpenId(doc.id) }
  const openCustomTemplate=()=>{ if(!isPremium){ setShowPremium(true); return } setTplName(''); setTplModal(true) }
  const createCustomTemplate=()=>{ const name=tplName.trim(); if(!name) return; const {docs:nd,doc}=createDoc(docs,{title:name, content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Custom template — edit and reuse.'}]}]}}); setDocs(nd); setTplModal(false); setOpenId(doc.id) }
  const patchDoc=(id:string, patch:Partial<VyroDoc>, content?:any)=>{ setDocs(prev=>prev.map(d=> d.id===id? {...d, ...patch, ...(content?{content}:{}), updatedAt:new Date().toISOString()}:d)) }
  const authAction=async(kind:'in'|'up'|'out')=>{ if(!supabase) return; setAuthMsg(''); try{ if(kind==='out'){ await supabase.auth.signOut(); setUser(null) } else if(kind==='in'){ const {error}=await supabase.auth.signInWithPassword({email,password}); if(error) throw error; const {data}=await supabase.auth.getUser(); setUser(data.user) } else { const {error}=await supabase.auth.signUp({email,password}); if(error) throw error; const {data}=await supabase.auth.getUser(); setUser(data.user); setAuthMsg(t('accountCreated')) } }catch(e:any){ setAuthMsg(e.message||t('authFailed')) } }
  const startCardEdit=(d:VyroDoc, kind:'rename'|'folder')=>{ setMenuId(null); setDeleteId(null); setCardEdit({id:d.id, kind, value: kind==='rename'? d.title : d.folder}) }
  const commitCardEdit=()=>{ if(!cardEdit) return; if(cardEdit.kind==='rename'){ if(cardEdit.value.trim()) setDocs(prev=>renameDoc(prev,cardEdit.id,cardEdit.value)) } else { setDocs(prev=>updateDoc(prev,cardEdit.id,{folder:cardEdit.value.trim()})) } setCardEdit(null) }
  const askDelete=(id:string)=>{ setMenuId(null); setCardEdit(null); setDeleteId(id) }
  const doDelete=(id:string)=>{ setDocs(prev=>deleteDoc(prev,id)); setDeleteId(null) }
  const dir=uiDir(lang)
  if(openDoc) return <div className={`app${lang==='fa'?' fa':''}`} dir={dir}><Editor doc={openDoc} lang={lang} onLangChange={setLang} onBack={()=>setOpenId(null)} isPremium={isPremium} onRequirePremium={()=>setShowPremium(true)} theme={theme} onToggleTheme={()=>setTheme(th=>th==='dark'?'light':'dark')} onChange={(patch,content)=>patchDoc(openDoc.id,patch,content)}/>{showPremium && <PremiumModal lang={lang} onClose={()=>setShowPremium(false)} isPremium={isPremium}/>}{saveError && <div className="toast" role="alert">{t('saveFailed')}</div>}</div>
  return <div className={`app${lang==='fa'?' fa':''}`} dir={dir}>
    <header className="appbar"><div className="appbar-inner">
      <div className="logo big"><span className="vmark">V</span><span>Vyro Web</span></div>
      <div className="appbar-search">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('search')}/>
        {query && <button className="search-clear" onClick={()=>setQuery('')} aria-label={t('cancel')}>×</button>}
      </div>
      <div className="appbar-actions">
        <div className="lang-toggle" role="group" aria-label={t('language')}><button className={`rbtn${lang==='en'?' active':''}`} onClick={()=>setLang('en')}>EN</button><button className={`rbtn${lang==='fa'?' active':''}`} onClick={()=>setLang('fa')}>فارسی</button></div>
        <button className="rbtn" onClick={()=>setTheme(th=>th==='dark'?'light':'dark')} aria-label={theme==='dark'? t('lightUi'):t('darkUi')}>{theme==='dark'?'☀':'☾'}</button>
        <button className="chip-btn" onClick={()=>setShowPremium(true)}>{isPremium? `★ ${t('premiumActive')}` : user? t('free') : t('localFree')}</button>
      </div>
    </div></header>
    {!isSupabaseConfigured && <div className="banner" role="status">{t('localBanner')}</div>}
    {saveError && <div className="toast" role="alert">{t('saveFailed')}</div>}
    <div className="dash-layout">
      <aside className="sidebar">
        <nav className="side-nav" aria-label={t('foldersHeading')}>
          <div className="side-nav-heading">{t('foldersHeading')}</div>
          <button className={`side-nav-item${folder===''&&!favOnly?' active':''}`} onClick={()=>{ setFolder(''); setFavOnly(false) }}>{t('allDocuments')}<span className="side-nav-count">{docs.length}</span></button>
          {folders.map(f=><button key={f} className={`side-nav-item${folder===f?' active':''}`} onClick={()=>setFolder(folder===f?'':f)}><span dir="auto">{f}</span><span className="side-nav-count">{docs.filter(d=>d.folder===f).length}</span></button>)}
          <button className={`side-nav-item${favOnly?' active':''}`} aria-pressed={favOnly} onClick={()=>setFavOnly(v=>!v)}><span>★ {t('favoritesOnly')}</span><span className="side-nav-count">{docs.filter(d=>d.favorite).length}</span></button>
        </nav>
        <div className="card sub-card"><h3>{t('profileSubscription')}</h3>
          {!isSupabaseConfigured ? <><p><b>{t('localFree')}</b></p><p className="muted">{t('noAccount')}</p></> : user ? <><p>{user.email}</p><p>{(user.user_metadata?.display_name)||t('noDisplayName')}</p><p><b>{entitlement.isPremium?`${t('premiumActive')} — ${entitlement.status}`: entitlement.status==='expired'? t('premiumExpired'): t('free')}</b></p>{entitlement.premiumUntil && <p className="muted">{t('until')} {entitlement.premiumUntil.toLocaleString()}</p>}<button className="rbtn" onClick={()=>authAction('out')}>{t('signOut')}</button>{!entitlement.isPremium && <button className="primary small" onClick={()=>setShowPremium(true)}>{t('goPremium')}</button>}</> : <>
            <input placeholder={t('email')} aria-label={t('email')} value={email} onChange={e=>setEmail(e.target.value)}/><input placeholder={t('password')} aria-label={t('password')} type="password" value={password} onChange={e=>setPassword(e.target.value)}/>
            <div className="row"><button className="primary small" onClick={()=>authAction('in')}>{t('signIn')}</button><button className="rbtn" onClick={()=>authAction('up')}>{t('signUp')}</button></div></>}
          {authMsg && <p className="muted">{authMsg}</p>}
        </div>
      </aside>
      <main className="main">
        <section aria-label={t('templatesHeading')}>
          <h2 className="section-title">{t('templatesHeading')}</h2>
          <div className="create-row">
            <button className="tpl-card create-card" onClick={()=>createFromTemplate('blank')}>
              <span className="tpl-thumb" aria-hidden="true"><span className="plus">+</span></span>
              <span className="tpl-name">{t('newDocument')}</span><span className="tpl-desc">{t('newBlankDoc')}</span>
            </button>
            {TEMPLATES.filter(tpl=>tpl.id!=='blank').map(tpl=><button key={tpl.id} className="tpl-card" onClick={()=>createFromTemplate(tpl.id)}>
              <span className="tpl-thumb" aria-hidden="true"/>
              <span className="tpl-name">{tpl.name}</span><span className="tpl-desc">{tpl.description}{tpl.dir==='rtl'?' · RTL':''}</span>
            </button>)}
            <button className="tpl-card" onClick={openCustomTemplate}>
              <span className="tpl-thumb" aria-hidden="true"/>
              <span className="tpl-name">{t('customTemplate')} {!isPremium&&t('premiumLock')}</span><span className="tpl-desc">{t('customTemplateDesc')}</span>
            </button>
          </div>
        </section>
        <section aria-label={t('recentDocuments')}>
          <h2 className="section-title">{t('recentDocuments')}</h2>
          {filtered.length===0 && (docs.length===0
            ? <div className="empty"><p><b>{t('noDocuments')}</b></p><p className="muted">{t('noDocumentsText')}</p><button className="primary" onClick={()=>createFromTemplate('blank')}>{t('createFirst')}</button></div>
            : <div className="empty"><p><b>{t('noMatches')}</b></p><button className="primary" onClick={()=>{ setQuery(''); setFolder(''); setFavOnly(false) }}>{t('clearFilters')}</button></div>)}
          <div className="doc-grid">{filtered.map(d=><article key={d.id} className="doc-card">
            <div className="doc-head">
              <button className="doc-open" onClick={()=>setOpenId(d.id)}>
                <span className="doc-title" dir="auto">{d.title}</span>
                <span className="doc-meta">{new Date(d.updatedAt).toLocaleString()}</span>
              </button>
              <button className={`icon-btn fav${d.favorite?' on':''}`} title={t('favorite')} aria-label={t('favorite')} aria-pressed={d.favorite} onClick={()=>setDocs(prev=>toggleFavorite(prev,d.id))}>{d.favorite?'★':'☆'}</button>
              <div className="menu-wrap">
                <button className="icon-btn" aria-haspopup="menu" aria-expanded={menuId===d.id} aria-label={t('moreActions')} onClick={()=>setMenuId(menuId===d.id? null : d.id)}>⋯</button>
                {menuId===d.id && <>
                  <div className="menu-backdrop" onClick={()=>setMenuId(null)}/>
                  <div className="menu" role="menu">
                    <button role="menuitem" onClick={()=>startCardEdit(d,'rename')}>{t('rename')}</button>
                    <button role="menuitem" onClick={()=>startCardEdit(d,'folder')}>{t('folder')}</button>
                    <button role="menuitem" onClick={()=>{ setMenuId(null); setDocs(prev=>duplicateDoc(prev,d.id)) }}>{t('duplicate')}</button>
                    <button role="menuitem" className="danger" onClick={()=>askDelete(d.id)}>{t('delete')}</button>
                  </div>
                </>}
              </div>
            </div>
            <div className="doc-badges">
              <span className="bdg dir">{d.dir==='rtl' ? 'RTL · دری/فارسی' : 'LTR · English'}</span>
              {d.folder && <span className="bdg" dir="auto">{d.folder}</span>}
            </div>
            {cardEdit && cardEdit.id===d.id && <form className="inline-edit" onSubmit={e=>{ e.preventDefault(); commitCardEdit() }}>
              <label className="field">{cardEdit.kind==='rename'? t('rename') : t('folder')}
                <input autoFocus value={cardEdit.value} dir="auto" placeholder={cardEdit.kind==='folder'? t('folderNamePlaceholder') : undefined}
                  ref={el=>{ el?.focus(); el?.select() }}
                  onChange={e=>setCardEdit({...cardEdit, value:e.target.value})}
                  onKeyDown={e=>{ if(e.key==='Escape') setCardEdit(null) }}/>
              </label>
              <div className="row"><button type="submit" className="primary small">{t('save')}</button><button type="button" className="rbtn" onClick={()=>setCardEdit(null)}>{t('cancel')}</button></div>
            </form>}
            {deleteId===d.id && <div className="inline-confirm" role="alertdialog" aria-label={t('delete')}>
              <p>{t('deleteConfirm')} <b dir="auto">“{d.title}”</b></p>
              <div className="row"><button className="danger-btn" onClick={()=>doDelete(d.id)}>{t('delete')}</button><button className="rbtn" onClick={()=>setDeleteId(null)}>{t('cancel')}</button></div>
            </div>}
          </article>)}
          </div>
        </section>
      </main>
    </div>
    {tplModal && <div className="modal-backdrop" onClick={()=>setTplModal(false)}><form className="modal" onClick={e=>e.stopPropagation()} onSubmit={e=>{ e.preventDefault(); createCustomTemplate() }}><h2>{t('customTemplate')}</h2><label className="field">{t('customTemplatePrompt')}<input autoFocus value={tplName} dir="auto" onChange={e=>setTplName(e.target.value)}/></label><div className="row end"><button type="button" className="rbtn" onClick={()=>setTplModal(false)}>{t('cancel')}</button><button type="submit" className="primary small" disabled={!tplName.trim()}>{t('create')}</button></div></form></div>}
    {showPremium && <PremiumModal lang={lang} onClose={()=>setShowPremium(false)} isPremium={isPremium}/>}
  </div>
}
function PremiumModal({onClose,isPremium,lang}:{onClose:()=>void;isPremium:boolean;lang:UiLang}){ const t=(k:I18nKey)=>tr(lang,k); return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><h2>{t('premiumTitle')}</h2>{isPremium?<p>{t('premiumThanks')}</p>:<><p>{t('premiumDesc')}</p><ul><li>{t('planMonthly')}</li><li>{t('planQuarterly')}</li></ul><ol><li>{t('payStep1')} <b>+93 779 528 228</b></li><li>{t('payStep2')}</li><li>{t('payStep3')}</li></ol></>}<button className="primary" onClick={onClose}>{t('close')}</button></div></div> }
