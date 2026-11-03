import { useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type EditorPaletteActions } from './components/Editor'
import CommandPalette from './components/CommandPalette'
import { buildCommands, isPaletteShortcut } from './lib/commands'
import { isPlainFieldTarget } from './lib/keyboard'
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog'
import OnboardingGuide from './components/OnboardingGuide'
import { isOnboardingDismissed, dismissOnboarding, restoreOnboarding, classifyDashboardEmptyState } from './lib/onboarding'
import type { VyroDoc } from './lib/types'
import { loadDocs, saveDocs, createDoc, duplicateDoc, renameDoc, toggleFavorite, updateDoc, filterDocs, listFolders, sortDocs, trashDoc, restoreDoc, purgeDoc, listTrashed, SORT_KEY, type SortMode } from './lib/store'
import { TEMPLATES, getTemplate, templateName, templateDesc } from './lib/templates'
import { SMART_TEMPLATES, smartName, smartDesc, createSmartDocument, duplicateSmartTemplate, loadSmartCopies, saveSmartCopies, type SmartTemplate } from './lib/smartTemplates'
import SmartTemplateForm from './components/SmartTemplateForm'
import { useDialogFocus } from './components/useDialogFocus'
import { uid } from './lib/types'
import { isSupabaseConfigured } from './lib/supabaseEnv'
import { computeEntitlement } from './lib/entitlement'
import { saveUiLang, tr, uiDir, type UiLang, type I18nKey } from './lib/i18n'
import SettingsPanel from './components/SettingsPanel'
import { useCloudSync } from './components/useCloudSync'
import AuthScreen from './components/AuthScreen'
import ProfilePage from './components/ProfilePage'
import LandingPage from './components/LandingPage'
import AgentPage from './components/AgentPage'
import Avatar from './components/Avatar'
import type { AuthClientLike } from './lib/authFlow'
import ConflictResolveModal from './components/ConflictResolveModal'
import CloudLibraryModal from './components/CloudLibraryModal'
import { saveVersions } from './lib/versions'
import { loadDrafts, saveDraft, clearDraft } from './lib/recovery'
import type { RestoredLibrary } from './lib/libraryBackup'
import type { ConflictChoice } from './lib/conflictResolve'
import type { DocSyncStatus } from './lib/syncProtocol'
import { loadSettings, saveSettings, resolveTheme, defaultSettings, uiSizeClass, newDocDir, applyNewDocDefaults, type VyroSettings } from './lib/settings'

type CardEdit = { id: string; kind: 'rename' | 'folder' }

// Stage 2B: per-document cloud sync status → i18n key + badge. Rendered
// ONLY while cloud sync is active (flag on + configured + premium); with
// the flag off nothing in the dashboard or editor changes at all.
const SYNC_KEY: Record<DocSyncStatus, I18nKey> = { 'local-only': 'syncLocalOnly', queued: 'syncQueued', syncing: 'syncSyncing', synced: 'syncSynced', conflict: 'syncConflict', failed: 'syncFailed' }
function syncStatusText(status: DocSyncStatus, syncedAt: string | undefined, lang: UiLang): string {
  if (status === 'synced' && syncedAt) return `${tr(lang, 'syncSynced')} · ${new Date(syncedAt).toLocaleTimeString()}`
  return tr(lang, SYNC_KEY[status])
}
function SyncBadge({ status, syncedAt, lang, onResolve }: { status: DocSyncStatus | null; syncedAt?: string; lang: UiLang; onResolve?: () => void }) {
  if (!status) return null
  const text = syncStatusText(status, syncedAt, lang)
  // Stage 2C: a conflict badge is the doorway to resolution.
  if (status === 'conflict' && onResolve) {
    return <button type="button" className="bdg sync bdg-btn" aria-label={`${text} — ${tr(lang, 'resolveConflict')}`} onClick={(e) => { e.stopPropagation(); onResolve() }}>{text}</button>
  }
  return <span className="bdg sync">{text}</span>
}

// Inline rename/folder editor for a document card. Local state is initialised
// ONCE per edit session (mount), so parent re-renders can't churn the input;
// focus + select-all also happen once on mount. (The previous version kept the
// value in App state and re-ran focus()+select() from a ref callback on every
// render, so each keystroke replaced the whole selection — only the last
// typed character survived.)
function InlineEditForm({ label, initial, placeholder, saveLabel, cancelLabel, onCommit, onCancel }:{ label:string; initial:string; placeholder?:string; saveLabel:string; cancelLabel:string; onCommit:(value:string)=>void; onCancel:()=>void }){
  const [value,setValue]=useState(initial)
  const inputRef=useRef<HTMLInputElement>(null)
  useEffect(()=>{ const el=inputRef.current; if(el){ el.focus(); el.select() } },[])
  return <form className="inline-edit" onSubmit={e=>{ e.preventDefault(); onCommit(value) }}>
    <label className="field">{label}
      <input ref={inputRef} value={value} dir="auto" placeholder={placeholder}
        onChange={e=>setValue(e.target.value)}
        onKeyDown={e=>{ if(e.key==='Escape') onCancel() }}/>
    </label>
    <div className="row"><button type="submit" className="primary small">{saveLabel}</button><button type="button" className="rbtn" onClick={onCancel}>{cancelLabel}</button></div>
  </form>
}

export default function App(){
  const [docs,setDocs]=useState<VyroDoc[]>(()=> typeof window!=='undefined'? loadDocs(localStorage):[])
  const [openId,setOpenId]=useState<string|null>(null)
  const [query,setQuery]=useState(''); const [folder,setFolder]=useState(''); const [favOnly,setFavOnly]=useState(false)
  // M2-08: ONE settings store is the source of truth for theme + language.
  // The legacy keys are still written (theme/language compat) but the
  // settings record wins on load (see lib/settings.ts migration).
  const [settings,setSettings]=useState<VyroSettings>(()=> typeof window!=='undefined'? loadSettings(localStorage): defaultSettings())
  const lang=settings.uiLang
  const [systemDark,setSystemDark]=useState(()=> typeof window!=='undefined' && typeof window.matchMedia==='function' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false)
  const theme=resolveTheme(settings.theme, systemDark)
  const setLang=(l:UiLang)=>setSettings(s=>({...s, uiLang:l}))
  const toggleTheme=()=>setSettings(s=>({...s, theme: resolveTheme(s.theme, systemDark)==='dark'?'light':'dark'}))
  const [settingsOpen,setSettingsOpen]=useState(false)
  const [freshDefaults,setFreshDefaults]=useState<{id:string;font:string;size:number}|null>(null)
  const [user,setUser]=useState<any>(null); const [authClient,setAuthClient]=useState<AuthClientLike|null>(null); const [username,setUsername]=useState<string|null>(null)
  const [showPremium,setShowPremium]=useState(false)
  const [authPageOpen,setAuthPageOpen]=useState(false)
  const [profileOpen,setProfileOpen]=useState(false)
  const [agentOpen,setAgentOpen]=useState(false)
  const [authInitialView,setAuthInitialView]=useState<'signup'|'signin'>('signup')
  const [landingSeen,setLandingSeen]=useState<boolean>(()=>{ try{ return localStorage.getItem('vyro-web-landing-seen-v1')==='1' }catch{ return false } })
  const dismissLanding=()=>{ setLandingSeen(true); try{ localStorage.setItem('vyro-web-landing-seen-v1','1') }catch{ /* best-effort */ } }
  const [showCloudLib,setShowCloudLib]=useState(false)
  const [conflictId,setConflictId]=useState<string|null>(null)
  const [saveError,setSaveError]=useState(false)
  const [menuId,setMenuId]=useState<string|null>(null)
  const [cardEdit,setCardEdit]=useState<CardEdit|null>(null)
  const [deleteId,setDeleteId]=useState<string|null>(null)
  const [purgeId,setPurgeId]=useState<string|null>(null)
  const [view,setView]=useState<'docs'|'trash'>('docs')
  const [sort,setSort]=useState<SortMode>(()=>{ try{ const s=localStorage.getItem(SORT_KEY); return s==='name'||s==='created'||s==='updated'? s : 'updated' }catch{ return 'updated' } })
  const [tplModal,setTplModal]=useState(false); const [tplName,setTplName]=useState('')
  const tplFormRef=useRef<HTMLFormElement>(null)
  useDialogFocus(tplModal, { containerRef: tplFormRef, onClose: ()=>setTplModal(false), autofocus: false, trap: true })
  // M2-12: smart templates — built-ins plus the user's personal copies (localStorage only).
  const [smartForm,setSmartForm]=useState<SmartTemplate|null>(null)
  const [smartCopies,setSmartCopies]=useState<SmartTemplate[]>(()=> typeof window!=='undefined'? loadSmartCopies(localStorage):[])
  const [deleteCopyId,setDeleteCopyId]=useState<string|null>(null)
  const allSmartTemplates=[...SMART_TEMPLATES, ...smartCopies]
  const saveSmartCopy=(tpl:SmartTemplate)=>{ const next=[...smartCopies, duplicateSmartTemplate(tpl, uid())]; setSmartCopies(next); saveSmartCopies(localStorage, next) }
  const doDeleteCopy=(id:string)=>{ const next=smartCopies.filter(c=>c.id!==id); setSmartCopies(next); saveSmartCopies(localStorage, next); setDeleteCopyId(null) }
  const createFromSmartForm=(values:Record<string,string>)=>{ const tpl=smartForm; if(!tpl) return; const res=createSmartDocument(tpl, values); if(!res.ok) return; const content=applyNewDocDefaults(JSON.parse(JSON.stringify(res.content)), settings); const {docs:nd, doc}=createDoc(docs,{title: res.title, content, dir: tpl.dir, templateId: tpl.baseTemplateId}); setDocs(nd); setSmartForm(null); setOpenId(doc.id); setFreshDefaults({id:doc.id, font:settings.defaultFont, size:settings.defaultFontSize}) }
  // Command palette (M2-1): app-level so it works on dashboard and in editor.
  const [paletteOpen,setPaletteOpen]=useState(false)
  // M2-15: keyboard-shortcuts help, dashboard entry (the editor has its
  // own View-tab entry rendering the same dialog).
  const [shortcutsOpen,setShortcutsOpen]=useState(false)
  // M2-16: first-use guide — shown until dismissed (persisted per browser);
  // the re-show button below clears the stored dismissal, so a re-shown
  // guide stays until dismissed again. Dashboard only, never the editor.
  const [guideVisible,setGuideVisible]=useState(()=> typeof window!=='undefined'? !isOnboardingDismissed(localStorage) : true)
  const dismissGuide=()=>{ dismissOnboarding(localStorage); setGuideVisible(false) }
  const reshowGuide=()=>{ restoreOnboarding(localStorage); setGuideVisible(true) }
  const [editorActions,setEditorActions]=useState<EditorPaletteActions|null>(null)
  const paletteReturnFocus=useRef<Element|null>(null)
  const openPalette=()=>{ paletteReturnFocus.current=document.activeElement; setPaletteOpen(true) }
  const closePalette=()=>{ setPaletteOpen(false); const el=paletteReturnFocus.current; if(el instanceof HTMLElement) el.focus() }
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      if(!isPaletteShortcut(e)) return
      // M2-15 audit fix: the chord never fires while typing in a plain
      // field (title input, search, form inputs) — it must not interrupt
      // typing or steal a field's own Ctrl+K. Closing an already-open
      // palette still works everywhere, and the contenteditable editor
      // surface keeps the chord (that is where it is used most).
      if(!paletteOpen && isPlainFieldTarget(e.target as { tagName?: string; isContentEditable?: boolean } | null)) return
      e.preventDefault(); if(paletteOpen) closePalette(); else openPalette()
    }
    window.addEventListener('keydown', handler)
    return ()=>window.removeEventListener('keydown', handler)
  },[paletteOpen])
  const saveErrorShown=useRef(false)
  const t=(k:I18nKey)=>tr(lang,k)
  const entitlement=useMemo(()=> computeEntitlement(user, new Date()),[user])
  const isPremium = isSupabaseConfigured && !!user && entitlement.isPremium
  // Stage 2B: cloud sync engine lifecycle (inert unless the kill-switch
  // flag is on AND a premium user is signed in — see useCloudSync).
  const cloud=useCloudSync({ user, docs, setDocs })
  useEffect(()=>{ const ok=saveDocs(localStorage, docs); if(!ok && !saveErrorShown.current){ saveErrorShown.current=true; setSaveError(true) } if(ok){ saveErrorShown.current=false; setSaveError(false) } },[docs])
  useEffect(()=>{ document.documentElement.dataset.theme=theme; try{ localStorage.setItem('vyro-web-theme',theme) }catch{ /* best-effort */ } },[theme])
  useEffect(()=>{ saveUiLang(localStorage, lang); document.documentElement.lang = lang==='fa' ? 'fa' : 'en' },[lang])
  useEffect(()=>{ if(user) setAuthPageOpen(false) },[user])
  useEffect(()=>{ if(!user) setProfileOpen(false) },[user])
  useEffect(()=>{ saveSettings(localStorage, settings) },[settings])
  // Follow-system theme: live-update when the OS preference changes.
  useEffect(()=>{ if(typeof window.matchMedia!=='function') return; const mq=window.matchMedia('(prefers-color-scheme: dark)'); const h=(e:MediaQueryListEvent)=>setSystemDark(e.matches); setSystemDark(mq.matches); mq.addEventListener('change', h); return ()=>mq.removeEventListener('change', h) },[])
  useEffect(()=>{ try{ localStorage.setItem(SORT_KEY, sort) }catch{ /* best-effort */ } },[sort])
  // P2-4: the Supabase client loads only when auth is configured (Local
  // Mode never fetches it). A failed chunk load leaves the app in Local
  // Mode instead of breaking the dashboard.
  useEffect(()=>{ if(!isSupabaseConfigured) return; let cancelled=false; let sub:{unsubscribe:()=>void}|null=null; (async()=>{ try{ const { supabase }=await import('./lib/supabase'); if(cancelled || !supabase) return; setAuthClient(supabase.auth as unknown as AuthClientLike); const {data}=await supabase.auth.getUser(); if(!cancelled) setUser(data.user??null); const res=supabase.auth.onAuthStateChange(async()=>{ const {data}=await supabase.auth.getUser(); if(!cancelled) setUser(data.user??null) }); sub=res.data.subscription }catch{ /* Local Mode fallback */ } })(); return ()=>{ cancelled=true; sub?.unsubscribe() } },[])
  // R2-I: load the signed-in user's auto-generated username (own profiles
  // row only). Local Mode and signed-out state never fetch it; a missing
  // row (pre-trigger account) simply leaves the line hidden.
  useEffect(()=>{ if(!isSupabaseConfigured || !user?.id){ setUsername(null); return } let cancelled=false; (async()=>{ try{ const { supabase }=await import('./lib/supabase'); if(cancelled || !supabase) return; const { fetchOwnUsername }=await import('./lib/profile'); const name=await fetchOwnUsername(supabase as unknown as import('./lib/profile').ProfilesClientLike, user.id); if(!cancelled) setUsername(name) }catch{ if(!cancelled) setUsername(null) } })(); return ()=>{ cancelled=true } },[user?.id])
  const liveDocs=useMemo(()=>docs.filter(d=>!d.deletedAt),[docs])
  const filtered=useMemo(()=>sortDocs(filterDocs(docs,{query,folder: folder||undefined, favoritesOnly:favOnly}), sort),[docs,query,folder,favOnly,sort])
  // M2-16: which empty message the Recent list needs (trash has its own).
  const dashboardEmpty=classifyDashboardEmptyState({liveCount: liveDocs.length, filteredCount: filtered.length, folder, query})
  const trashed=useMemo(()=>listTrashed(docs),[docs])
  const folders=listFolders(docs)
  const openDoc=docs.find(d=>d.id===openId && !d.deletedAt)
  // M2-08: new-document defaults are wired in at creation only — existing
  // docs are never mutated. Blank docs take the default direction; a
  // template keeps its own direction (see newDocDir); font/size defaults
  // are stamped onto template text nodes, and onto the first keystroke of
  // blank docs via the Editor's freshDefaults prop.
  const createFromTemplate=(tid:string)=>{ const tpl=getTemplate(tid); const isBlank=tid==='blank'||!tpl; const content=applyNewDocDefaults(JSON.parse(JSON.stringify(tpl?.content||{type:'doc',content:[{type:'paragraph'}]})), settings); const {docs:nd, doc}=createDoc(docs,{title: tpl&&tpl.id!=='blank'? tpl.name+' — Untitled':'Untitled document', content, dir: newDocDir(tpl?.dir||'ltr', isBlank, settings.defaultDir), templateId:tid}); setDocs(nd); setOpenId(doc.id); setFreshDefaults({id:doc.id, font:settings.defaultFont, size:settings.defaultFontSize}) }
  const paletteCommands=useMemo(()=>buildCommands({
    createBlank: ()=>createFromTemplate('blank'),
    createFromTemplate,
    goDashboard: ()=>setOpenId(null),
    toggleTheme,
    toggleLanguage: ()=>setLang(lang==='en'?'fa':'en'),
    theme, lang, templates: TEMPLATES,
    ...(editorActions||{}),
  // `docs` is a dep on purpose: createFromTemplate closes over it, and a
  // stale copy would overwrite documents created after the palette's last build.
  // P2-12: `paletteOpen` is a dep on purpose too — rebuilding when the
  // palette opens re-reads the live heading list, so headings added or
  // renamed since the last build are listed. While the palette is open the
  // document cannot change (modal backdrop), so jump positions stay valid.
  }),[theme, lang, editorActions, docs, settings, paletteOpen])
  const openCustomTemplate=()=>{ setTplName(''); setTplModal(true) }
  // Dedicated Agent section (owner order 2026-11-03): a result prepared
  // on the Agent page becomes a brand-new document and opens in the
  // editor — this is how the agent works even with no document open.
  const createDocFromAgent=(title:string, nodes:object[])=>{ const content=applyNewDocDefaults({type:'doc', content: nodes.length>0? nodes : [{type:'paragraph'}]}, settings); const {docs:nd, doc}=createDoc(docs,{title: title.trim()||'Untitled document', content, dir: settings.defaultDir}); setDocs(nd); setAgentOpen(false); setOpenId(doc.id); setFreshDefaults({id:doc.id, font:settings.defaultFont, size:settings.defaultFontSize}) }
  const createCustomTemplate=()=>{ const name=tplName.trim(); if(!name) return; const content=applyNewDocDefaults({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Custom template — edit and reuse.'}]}]}, settings); const {docs:nd,doc}=createDoc(docs,{title:name, content, dir: settings.defaultDir}); setDocs(nd); setTplModal(false); setOpenId(doc.id); setFreshDefaults({id:doc.id, font:settings.defaultFont, size:settings.defaultFontSize}) }
  const patchDoc=(id:string, patch:Partial<VyroDoc>, content?:any)=>{ setDocs(prev=>prev.map(d=> d.id===id? {...d, ...patch, ...(content?{content}:{}), updatedAt:new Date().toISOString()}:d)) }
  // PC2 Mailings: one new local doc per merged record, via the existing
  // createDoc path (same folder + direction as the source doc). The source
  // document stays open and untouched; the merged docs appear on the dashboard.
  const createMergedDocs=(items:{title:string;content:any}[])=>{ if(!openDoc) return; const src=openDoc; setDocs(prev=>{ let nd=prev; for(const item of [...items].reverse()){ const res=createDoc(nd,{title:item.title, content:item.content, dir:src.dir, folder:src.folder, margins:src.margins, orientation:src.orientation, pageSize:src.pageSize, pageW:src.pageW, pageH:src.pageH, customMargins:src.customMargins, headerText:src.headerText, footerText:src.footerText}); nd=res.docs } return nd }) }
  // R1: sign-in / sign-up / reset live in AuthScreen + authFlow (validated,
  // mapped errors, no raw server messages). App keeps only sign-out and the
  // signed-in refresh used as AuthScreen's onSignedIn callback.
  const refreshUser=async()=>{ try{ const { supabase }=await import('./lib/supabase'); if(!supabase) return; const {data}=await supabase.auth.getUser(); setUser(data.user??null) }catch{ /* Local Mode fallback */ } }
  const authAction=async(kind:'out')=>{ if(!isSupabaseConfigured) return; try{ const { supabase }=await import('./lib/supabase'); if(!supabase) return; if(kind==='out'){ await supabase.auth.signOut(); setUser(null) } }catch{ /* sign-out is best-effort; the local session state is already cleared by the auth listener */ } }
  const startCardEdit=(d:VyroDoc, kind:'rename'|'folder')=>{ setMenuId(null); setDeleteId(null); setCardEdit({id:d.id, kind}) }
  const commitCardEdit=(id:string, kind:'rename'|'folder', value:string)=>{ if(kind==='rename'){ if(value.trim()) setDocs(prev=>renameDoc(prev,id,value)) } else { setDocs(prev=>updateDoc(prev,id,{folder:value.trim()})) } setCardEdit(null) }
  const askDelete=(id:string)=>{ setMenuId(null); setCardEdit(null); setDeleteId(id) }
  const doTrash=(id:string)=>{ setDocs(prev=>trashDoc(prev,id)); setDeleteId(null) }
  const doRestore=(id:string)=>{ setDocs(prev=>restoreDoc(prev,id)); setPurgeId(null) }
  const doPurge=(id:string)=>{ setDocs(prev=>purgeDoc(prev,id)); setPurgeId(null) }
  // Stage 2D: apply a restored library backup. Documents flow through the
  // normal docs state (persisted by the saveDocs effect); versions and
  // drafts are replaced in their own stores. Restored documents carry no
  // cloud fields — nothing is re-linked automatically.
  const applyLibraryRestore=(restored:RestoredLibrary)=>{ saveVersions(localStorage, restored.versions); const current=loadDrafts(localStorage); for(const id of Object.keys(current)) clearDraft(localStorage, id); for(const d of Object.values(restored.drafts)) saveDraft(localStorage, d); setDocs(restored.documents) }
  const dir=uiDir(lang)
  const openSyncStatus=openDoc? cloud.statusFor(openDoc) : null
  const openSyncText=openSyncStatus? syncStatusText(openSyncStatus, openDoc?.cloudSyncedAt, lang) : undefined
  const conflictDoc=conflictId? docs.find(d=>d.id===conflictId && d.cloudConflict) ?? null : null
  const conflictModal=conflictDoc? <ConflictResolveModal doc={conflictDoc} lang={lang} onClose={()=>setConflictId(null)} onResolve={(choice: ConflictChoice)=>cloud.resolveConflict(conflictDoc.id, choice)}/> : null
  if(openDoc) return <div className={`app${lang==='fa'?' fa':''}${uiSizeClass(settings.uiSize)?` ${uiSizeClass(settings.uiSize)}`:''}`} dir={dir}><Editor doc={openDoc} lang={lang} onLangChange={setLang} saveFailed={saveError} syncStatusText={openSyncText} onSyncStatusClick={openDoc.cloudConflict? ()=>setConflictId(openDoc.id):undefined} onBack={()=>setOpenId(null)} theme={theme} onToggleTheme={toggleTheme} onChange={(patch,content)=>patchDoc(openDoc.id,patch,content)} onPaletteOpen={openPalette} onEditorActions={setEditorActions} writingWidth={settings.writingWidth} toolbarMode={settings.toolbar} autosaveEnabled={settings.autosaveEnabled} autosaveIntervalMs={settings.autosaveIntervalMs} freshDefaults={freshDefaults?.id===openDoc.id? freshDefaults : undefined} settings={settings} onSettingsChange={(patch)=>setSettings(s=>({...s, ...patch}))} onSettingsReset={()=>setSettings(defaultSettings())} isLocal={!isSupabaseConfigured} onCreateMergedDocs={createMergedDocs} onCreateDocFromAgent={createDocFromAgent} docsList={docs.filter(d=>!d.deletedAt).map(d=>({id:d.id,title:d.title,updatedAt:d.updatedAt}))} onOpenDoc={(id)=>setOpenId(id)} onNewDoc={()=>createFromTemplate('blank')} onMakeCopy={(id)=>{ const next=duplicateDoc(docs,id); if(next!==docs){ setDocs(next); setOpenId(next[0].id) } }} accountLabel={user?.email||undefined}/><CommandPalette open={paletteOpen} onClose={closePalette} commands={paletteCommands} lang={lang}/>{showPremium && <PremiumModal lang={lang} onClose={()=>setShowPremium(false)} isPremium={isPremium}/>}{conflictModal}{saveError && <div className="toast" role="alert">{t('saveFailed')}</div>}</div>
  if(authPageOpen && isSupabaseConfigured && !user) return <div className={`app${lang==='fa'?' fa':''}${uiSizeClass(settings.uiSize)?` ${uiSizeClass(settings.uiSize)}`:''}`} dir={dir}><AuthScreen lang={settings.uiLang} auth={authClient} onSignedIn={refreshUser} onClose={()=>setAuthPageOpen(false)} initialView={authInitialView}/></div>
  if(!user && isSupabaseConfigured && !landingSeen) return <div className={`app${lang==='fa'?' fa':''}${uiSizeClass(settings.uiSize)?` ${uiSizeClass(settings.uiSize)}`:''}`} dir={dir}><LandingPage lang={settings.uiLang} onStart={()=>{ setAuthInitialView('signup'); setAuthPageOpen(true) }} onSignIn={()=>{ setAuthInitialView('signin'); setAuthPageOpen(true) }} onContinueLocal={dismissLanding} onLangChange={setLang}/></div>
  if(agentOpen) return <div className={`app${lang==='fa'?' fa':''}${uiSizeClass(settings.uiSize)?` ${uiSizeClass(settings.uiSize)}`:''}`} dir={dir}><AgentPage lang={lang} editor={null} onClose={()=>setAgentOpen(false)} onCreateDoc={createDocFromAgent}/></div>
  if(profileOpen && user) return <div className={`app${lang==='fa'?' fa':''}${uiSizeClass(settings.uiSize)?` ${uiSizeClass(settings.uiSize)}`:''}`} dir={dir}><ProfilePage lang={settings.uiLang} name={(user.user_metadata?.display_name)||''} email={user.email||''} username={username} memberSince={user.created_at||null} photoUrl={user.user_metadata?.avatar_url} docs={liveDocs} onClose={()=>setProfileOpen(false)} onOpenDoc={(id)=>{ setProfileOpen(false); setOpenId(id) }} onNewDoc={()=>{ setProfileOpen(false); createFromTemplate('blank') }} onSignOut={()=>{ setProfileOpen(false); void authAction('out') }}/></div>
  return <div className={`app${lang==='fa'?' fa':''}${uiSizeClass(settings.uiSize)?` ${uiSizeClass(settings.uiSize)}`:''}`} dir={dir}>
    <header className="appbar"><div className="appbar-inner">
      <div className="logo big"><span className="vmark">V</span><span>Vyro Web</span></div>
      <div className="appbar-search">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('search')}/>
        {query && <button className="search-clear" onClick={()=>setQuery('')} aria-label={t('cancel')}>×</button>}
      </div>
      <div className="appbar-actions">
        {!isSupabaseConfigured && <span className="local-chip">{t('localSaving')}</span>}
        <button className="rbtn" onClick={openPalette} title="Ctrl+K" aria-label={t('commandPalette')}>⌘K</button>
        <button className="rbtn" onClick={()=>setShortcutsOpen(true)} aria-label={t('keyboardShortcuts')} title={t('keyboardShortcuts')}>⌨</button>
        <button className="rbtn" onClick={()=>setShowCloudLib(true)} aria-label={t('cloudLibrary')} title={t('cloudLibrary')}>☁</button>
        <div className="lang-toggle" role="group" aria-label={t('language')}><button className={`rbtn${lang==='en'?' active':''}`} onClick={()=>setLang('en')}>EN</button><button className={`rbtn${lang==='fa'?' active':''}`} onClick={()=>setLang('fa')}>فارسی</button></div>
        <button className="rbtn" onClick={()=>setSettingsOpen(true)} aria-label={t('settings')} title={t('settings')}>⚙</button>
        <button className="rbtn" onClick={toggleTheme} aria-label={theme==='dark'? t('lightUi'):t('darkUi')}>{theme==='dark'?'☀':'☾'}</button>
        <button className="primary small" onClick={()=>setAgentOpen(true)}>🤖 {t('intelligence')}</button>
        {!user && isSupabaseConfigured && <button className="primary small" onClick={()=>{ setAuthInitialView('signin'); setAuthPageOpen(true) }}>{t('signIn')} / {t('signUp')}</button>}
        <button className="chip-btn" onClick={()=>setShowPremium(true)}>{isPremium? `★ ${t('premiumActive')}` : user? t('free') : t('localFree')}</button>
        {user && isSupabaseConfigured && <button className="avatar-btn" onClick={()=>setProfileOpen(true)} aria-label={t('openProfile')} title={t('profile')}><Avatar size={34} photoUrl={user.user_metadata?.avatar_url}/></button>}
      </div>
    </div></header>
    {saveError && <div className="toast" role="alert">{t('saveFailed')}</div>}
    <div className="dash-layout">
      <main className="main">
        <div className="filter-bar" role="navigation" aria-label={t('foldersHeading')}>
          <button className={`filter-chip${view==='docs'&&folder===''&&!favOnly?' active':''}`} onClick={()=>{ setView('docs'); setFolder(''); setFavOnly(false) }}>{t('allDocuments')}<span className="filter-count">{liveDocs.length}</span></button>
          {folders.map(f=><button key={f} className={`filter-chip${view==='docs'&&folder===f?' active':''}`} onClick={()=>{ setView('docs'); setFolder(folder===f?'':f) }}><span dir="auto">{f}</span><span className="filter-count">{liveDocs.filter(d=>d.folder===f).length}</span></button>)}
          <button className={`filter-chip${view==='docs'&&favOnly?' active':''}`} aria-pressed={favOnly} onClick={()=>{ setView('docs'); setFavOnly(v=>!v) }}>★ {t('favoritesOnly')}<span className="filter-count">{liveDocs.filter(d=>d.favorite).length}</span></button>
          <button className={`filter-chip${view==='trash'?' active':''}`} aria-pressed={view==='trash'} onClick={()=>setView('trash')}>🗑 {t('trash')}<span className="filter-count">{trashed.length}</span></button>
        </div>
        {view==='trash' ? <section aria-label={t('trash')}>
          <div className="list-toolbar"><h2 className="section-title">{t('trash')}</h2><button className="rbtn" onClick={()=>setView('docs')}>← {t('allDocuments')}</button></div>
          {trashed.length===0
            ? <div className="empty"><p><b>{t('trashEmpty')}</b></p><p className="muted">{t('trashEmptyText')}</p></div>
            : <div className="doc-grid">{trashed.map(d=><article key={d.id} className="doc-card">
                <div className="doc-head"><div className="doc-open-static"><span className="doc-title" dir="auto">{d.title}</span><span className="doc-meta">{t('deletedOn')} {new Date(d.deletedAt!).toLocaleString()}</span></div></div>
                <div className="doc-badges"><span className="bdg dir">{d.dir==='rtl' ? 'RTL · دری/فارسی' : 'LTR · English'}</span>{d.folder && <span className="bdg" dir="auto">{d.folder}</span>}</div>
                {purgeId===d.id
                  ? <div className="inline-confirm" role="alertdialog" aria-label={t('deleteForever')}><p>{t('deleteForeverConfirm')} <b dir="auto">“{d.title}”</b></p><div className="row"><button className="danger-btn" onClick={()=>doPurge(d.id)}>{t('deleteForever')}</button><button className="rbtn" onClick={()=>setPurgeId(null)}>{t('cancel')}</button></div></div>
                  : <div className="row"><button className="primary small" onClick={()=>doRestore(d.id)}>{t('restore')}</button><button className="danger-btn" onClick={()=>setPurgeId(d.id)}>{t('deleteForever')}</button></div>}
              </article>)}
            </div>}
        </section> : <>
        <section aria-label={t('templatesHeading')}>
          <h2 className="section-title">{t('templatesHeading')}</h2>
          <div className="create-row">
            <button className="tpl-card create-card" onClick={()=>createFromTemplate('blank')}>
              <span className="tpl-thumb" aria-hidden="true"><span className="plus">+</span></span>
              <span className="tpl-name">{t('newDocument')}</span><span className="tpl-desc">{t('newBlankDoc')}</span>
            </button>
            {TEMPLATES.filter(tpl=>tpl.id!=='blank').map(tpl=><button key={tpl.id} className="tpl-card" onClick={()=>createFromTemplate(tpl.id)}>
              <span className="tpl-thumb" aria-hidden="true"/>
              <span className="tpl-name">{templateName(tpl, lang)}</span><span className="tpl-desc">{templateDesc(tpl, lang)}{tpl.dir==='rtl'?' · RTL':''}</span>
            </button>)}
            <button className="tpl-card" onClick={openCustomTemplate}>
              <span className="tpl-thumb" aria-hidden="true"/>
              <span className="tpl-name">{t('customTemplate')}</span><span className="tpl-desc">{t('customTemplateDesc')}</span>
            </button>
          </div>
        </section>
        <section aria-label={t('smartTemplates')}>
          <h2 className="section-title">{t('smartTemplates')}</h2>
          <p className="muted">{t('smartTemplatesDesc')}</p>
          <div className="create-row">
            {allSmartTemplates.map(tpl=><article key={tpl.id} className="tpl-card">
              <span className="tpl-thumb" aria-hidden="true"/>
              <span className="tpl-name">{smartName(tpl, lang)}{tpl.personal && ` · ${t('smartMyCopy')}`}</span>
              <span className="tpl-desc">{smartDesc(tpl, lang)}{tpl.dir==='rtl'?' · RTL':''}</span>
              <div className="row wrap">
                <button className="primary small" onClick={()=>setSmartForm(tpl)}>{t('smartFillForm')}</button>
                <button className="rbtn" onClick={()=>saveSmartCopy(tpl)}>{t('smartSaveCopy')}</button>
                {tpl.personal && (deleteCopyId===tpl.id
                  ? <><span className="muted">{t('smartDeleteCopyConfirm')}</span><button className="danger-btn" onClick={()=>doDeleteCopy(tpl.id)}>{t('smartDeleteCopy')}</button><button className="rbtn" onClick={()=>setDeleteCopyId(null)}>{t('cancel')}</button></>
                  : <button className="rbtn" onClick={()=>setDeleteCopyId(tpl.id)}>{t('smartDeleteCopy')}</button>)}
              </div>
            </article>)}
          </div>
        </section>
        {view==='docs' && guideVisible && <OnboardingGuide lang={lang} onCreateFirst={()=>createFromTemplate('blank')} onOpenShortcuts={()=>setShortcutsOpen(true)} onDismiss={dismissGuide}/>}
        <section aria-label={t('recentDocuments')}>
          <div className="list-toolbar"><h2 className="section-title">{t('recentDocuments')}</h2>{!guideVisible && <button className="rbtn" onClick={reshowGuide}>{t('onboardingShowAgain')}</button>}<label className="sort-select">{t('sortBy')}<select value={sort} onChange={e=>setSort(e.target.value as SortMode)} aria-label={t('sortBy')}><option value="updated">{t('sortUpdated')}</option><option value="name">{t('sortName')}</option><option value="created">{t('sortCreated')}</option></select></label></div>
          {filtered.length===0 && (dashboardEmpty==='no-documents'
            ? <div className="empty"><p><b>{t('noDocuments')}</b></p><p className="muted">{t('noDocumentsText')}</p><button className="primary" onClick={()=>createFromTemplate('blank')}>{t('createFirst')}</button><p className="muted">{t('onboardingNoDocumentsHint')}</p></div>
            : dashboardEmpty==='folder-empty'
            ? <div className="empty"><p><b>{t('onboardingFolderEmpty')}</b></p><p className="muted" dir="auto">{folder}</p><button className="primary" onClick={()=>setFolder('')}>{t('onboardingClearFolder')}</button></div>
            : <div className="empty"><p><b>{t('noMatches')}</b></p><p className="muted">{t('onboardingNoMatchesHint')}</p><button className="primary" onClick={()=>{ setQuery(''); setFolder(''); setFavOnly(false) }}>{t('clearFilters')}</button></div>)}
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
                    <button role="menuitem" className="danger" onClick={()=>askDelete(d.id)}>{t('moveToTrash')}</button>
                  </div>
                </>}
              </div>
            </div>
            <div className="doc-badges">
              <span className="bdg dir">{d.dir==='rtl' ? 'RTL · دری/فارسی' : 'LTR · English'}</span>
              {d.folder && <span className="bdg" dir="auto">{d.folder}</span>}
              {cloud.active && <SyncBadge status={cloud.statusFor(d)} syncedAt={d.cloudSyncedAt} lang={lang} onResolve={()=>setConflictId(d.id)}/>}
            </div>
            {cardEdit && cardEdit.id===d.id && <InlineEditForm key={cardEdit.kind}
              label={cardEdit.kind==='rename'? t('rename') : t('folder')}
              initial={cardEdit.kind==='rename'? d.title : d.folder}
              placeholder={cardEdit.kind==='folder'? t('folderNamePlaceholder') : undefined}
              saveLabel={t('save')} cancelLabel={t('cancel')}
              onCommit={v=>commitCardEdit(d.id, cardEdit.kind, v)}
              onCancel={()=>setCardEdit(null)}/>}
            {deleteId===d.id && <div className="inline-confirm" role="alertdialog" aria-label={t('moveToTrash')}>
              <p>{t('moveToTrashConfirm')} <b dir="auto">“{d.title}”</b></p>
              <div className="row"><button className="danger-btn" onClick={()=>doTrash(d.id)}>{t('moveToTrash')}</button><button className="rbtn" onClick={()=>setDeleteId(null)}>{t('cancel')}</button></div>
            </div>}
          </article>)}
          </div>
        </section>
        </>}
      </main>
    </div>
    <CommandPalette open={paletteOpen} onClose={closePalette} commands={paletteCommands} lang={lang}/>
    {shortcutsOpen && <KeyboardShortcutsDialog open={shortcutsOpen} onClose={()=>setShortcutsOpen(false)} lang={lang}/>}
    {settingsOpen && <SettingsPanel settings={settings} lang={lang} onChange={(patch)=>setSettings(s=>({...s, ...patch}))} onReset={()=>setSettings(defaultSettings())} onClose={()=>setSettingsOpen(false)}/>}
    {tplModal && <div className="modal-backdrop" onClick={()=>setTplModal(false)}><form ref={tplFormRef} className="modal" onClick={e=>e.stopPropagation()} onSubmit={e=>{ e.preventDefault(); createCustomTemplate() }}><h2>{t('customTemplate')}</h2><label className="field">{t('customTemplatePrompt')}<input autoFocus value={tplName} dir="auto" onChange={e=>setTplName(e.target.value)}/></label><div className="row end"><button type="button" className="rbtn" onClick={()=>setTplModal(false)}>{t('cancel')}</button><button type="submit" className="primary small" disabled={!tplName.trim()}>{t('create')}</button></div></form></div>}
    {showPremium && <PremiumModal lang={lang} onClose={()=>setShowPremium(false)} isPremium={isPremium}/>}
    {showCloudLib && <CloudLibraryModal lang={lang} docs={docs} cloud={cloud} onRestore={applyLibraryRestore} onClose={()=>setShowCloudLib(false)}/>}
    {conflictModal}
    {smartForm && <SmartTemplateForm tpl={smartForm} lang={lang} onClose={()=>setSmartForm(null)} onCreate={createFromSmartForm}/>}
  </div>
}
function PremiumModal({onClose,isPremium,lang}:{onClose:()=>void;isPremium:boolean;lang:UiLang}){ const t=(k:I18nKey)=>tr(lang,k); const modalRef=useRef<HTMLDivElement>(null); useDialogFocus(true, { containerRef: modalRef, onClose, autofocus: true, trap: true }); return <div className="modal-backdrop" onClick={onClose}><div ref={modalRef} className="modal" onClick={e=>e.stopPropagation()}><h2>{t('premiumTitle')}</h2>{isPremium?<p>{t('premiumThanks')}</p>:<p>{t('premiumDesc')}</p>}<button className="primary" onClick={onClose}>{t('close')}</button></div></div> }
