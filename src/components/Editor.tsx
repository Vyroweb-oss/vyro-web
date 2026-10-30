import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { Node, mergeAttributes } from '@tiptap/core'
import type { VyroDoc } from '../lib/types'
import { exportDocx, jsonToPlainText, escapeHtml, isSafeLinkUrl } from '../lib/docx'
import { formatDocDate } from '../lib/date'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import NavigationPane from './NavigationPane'
import StatsPanel from './StatsPanel'
import LinkManagerPanel from './LinkManagerPanel'
import ComparePanel from './ComparePanel'
import { validateImageFile, imageSizeKb, IMAGE_WIDTH_PRESETS } from '../lib/images'
import FindReplacePanel from './FindReplacePanel'
import ContextMenu from './ContextMenu'
import { sanitizePastedHtml, htmlToPlainText, getContextMenuItems, type MenuItemId } from '../lib/paste'
import { createSnapshot, addVersion, loadVersions, saveVersions, restoreVersion, listVersions, type VersionSnapshot, type VersionTrigger } from '../lib/versions'
import { saveDraft, loadDraft, clearDraft, detectRecovery, acceptDraft, type RecoveryInfo } from '../lib/recovery'
import { FocusDim, createViewSnapshot, focusWidthClass, viewModeClass, type FocusWidth, type ViewMode, type ViewSnapshot } from '../lib/viewModes'
import { EDITOR_FONTS, EDITOR_FONT_SIZES, resolveAutosaveDelay, type VyroSettings } from '../lib/settings'

export interface EditorPaletteActions {
  insertTable: () => void
  insertDate: () => void
  exportTxt: () => void
  exportHtml: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  pastePlainText: () => void
}

const PageBreak = Node.create({
  name:'pageBreak', group:'block', atom:true,
  parseHTML(){ return [{tag:'hr[data-page-break]'}] },
  renderHTML({HTMLAttributes}){ return ['hr', mergeAttributes(HTMLAttributes, {'data-page-break':'', class:'page-break'})] },
  addCommands(){ return { insertPageBreak: () => ({commands}:any) => commands.insertContent({type:'pageBreak'}) } as any },
})

declare module '@tiptap/core' { interface Commands<ReturnType> { pageBreak: { insertPageBreak: () => ReturnType } } }

const MARGINS = { narrow:'12.7mm', normal:'25.4mm', wide:'38.1mm' } as const
const MM_PX = 96 / 25.4
// M2-08: the font/size lists live in lib/settings.ts so the Settings panel
// and the editor can never offer different fonts.
const FONT_FAMILIES = EDITOR_FONTS
const FONT_SIZES = EDITOR_FONT_SIZES
const LINE_HEIGHTS = ['1','1.15','1.5','2']
const TABS: { id:string; key:I18nKey }[] = [
  { id:'File', key:'tabFile' }, { id:'Home', key:'tabHome' }, { id:'Insert', key:'tabInsert' },
  { id:'Layout', key:'tabLayout' }, { id:'References', key:'tabReferences' }, { id:'Review', key:'tabReview' }, { id:'View', key:'tabView' },
]

export default function Editor({ doc, onChange, onBack, isPremium, onRequirePremium, theme, onToggleTheme, lang, onLangChange, saveFailed, onPaletteOpen, onEditorActions, writingWidth, toolbarMode, autosaveEnabled, autosaveIntervalMs, freshDefaults }:{ doc:VyroDoc; onChange:(patch:Partial<VyroDoc>, content?:any)=>void; onBack:()=>void; isPremium:boolean; onRequirePremium:()=>void; theme:string; onToggleTheme:()=>void; lang:UiLang; onLangChange?:(l:UiLang)=>void; saveFailed?:boolean; onPaletteOpen?:()=>void; onEditorActions?:(a:EditorPaletteActions|null)=>void; writingWidth?: VyroSettings['writingWidth']; toolbarMode?: VyroSettings['toolbar']; autosaveEnabled?: boolean; autosaveIntervalMs?: number; freshDefaults?: { id:string; font:string; size:number } }){
  const t=(k:I18nKey)=>tr(lang,k)
  const [tab,setTab]=useState('Home')
  const [zoom,setZoom]=useState(100)
  const [savedAt,setSavedAt]=useState<string>('')
  const [saveState,setSaveState]=useState<'saved'|'saving'>('saved')
  const [spell,setSpell]=useState(true)
  const [toast,setToast]=useState('')
  const [linkOpen,setLinkOpen]=useState(false)
  const [linkUrl,setLinkUrl]=useState('')
  const [linkText,setLinkText]=useState('')
  const [linkTextShown,setLinkTextShown]=useState(false)
  const [linksOpen,setLinksOpen]=useState(false)
  // M2-07 image dialog (width presets + caption via native attrs) and
  // insert-preview (file is only inserted after the user confirms).
  const [imgEditOpen,setImgEditOpen]=useState(false)
  const [imgSrc,setImgSrc]=useState('')
  const [imgAlt,setImgAlt]=useState('')
  const [imgCaption,setImgCaption]=useState('')
  const [imgWidth,setImgWidth]=useState('')
  const [imgPreview,setImgPreview]=useState<{ src:string; size:number }|null>(null)
  const [navOpen,setNavOpen]=useState(false)
  // M2-05 document statistics panel (derived live, no stored state).
  const [statsOpen,setStatsOpen]=useState(false)
  const [findOpen,setFindOpen]=useState(false)
  // M2-03 view modes: session-only editor state, never persisted to the doc.
  const [viewMode,setViewMode]=useState<ViewMode>('edit')
  // M2-08: the settings writing width is the initial focus/reading width,
  // and a later settings change re-applies it (the in-mode width select
  // remains a session override until settings change again).
  const [focusWidth,setFocusWidth]=useState<FocusWidth>((writingWidth ?? 'normal') as FocusWidth)
  useEffect(()=>{ if(writingWidth) setFocusWidth(writingWidth as FocusWidth) },[writingWidth])
  const compactToolbar = toolbarMode==='compact'
  // M2-08 autosave settings, read through a ref so the debounced onUpdate
  // (bound once per document) always sees the current values.
  const autosaveRef=useRef({ autosaveEnabled: autosaveEnabled ?? true, autosaveIntervalMs: autosaveIntervalMs ?? 500 })
  autosaveRef.current = { autosaveEnabled: autosaveEnabled ?? true, autosaveIntervalMs: autosaveIntervalMs ?? 500 }
  const viewSnapshotRef=useRef<ViewSnapshot|null>(null)
  const restoreRef=useRef<ViewSnapshot|null>(null)
  const [toolsOpen,setToolsOpen]=useState(false)
  // M2-06 contextual menu + image alt-text dialog (transient UI only).
  const [ctxMenu,setCtxMenu]=useState<{ items:MenuItemId[]; x:number; y:number; linkHref:string|null }|null>(null)
  const [altOpen,setAltOpen]=useState(false)
  const [altText,setAltText]=useState('')
  const longPressRef=useRef<{ timer:any; x:number; y:number; moved:boolean }|null>(null)
  const longPressMenuRef=useRef(0)
  const saveTimer=useRef<any>(null)
  const pendingJson=useRef<any>(null)
  const onChangeRef=useRef(onChange); onChangeRef.current=onChange
  const docRef=useRef(doc); docRef.current=doc
  // M2-04 version history + crash recovery (own storage keys; docs store untouched).
  const [versionsOpen,setVersionsOpen]=useState(false)
  // M2-09 document compare panel (reads editor JSON + versions only).
  const [compareOpen,setCompareOpen]=useState(false)
  const [versions,setVersions]=useState<VersionSnapshot[]>(()=> typeof window!=='undefined' ? loadVersions(localStorage) : [])
  const [versionLabel,setVersionLabel]=useState('')
  const [selectedVersionId,setSelectedVersionId]=useState<string|null>(null)
  const [versionError,setVersionError]=useState('')
  const [recovery,setRecovery]=useState<RecoveryInfo|null>(null)
  const fileImgRef=useRef<HTMLInputElement>(null)
  const replaceImgRef=useRef<HTMLInputElement>(null)
  const importRef=useRef<HTMLInputElement>(null)
  const workspaceRef=useRef<HTMLDivElement>(null)
  const pageRef=useRef<HTMLDivElement>(null)

  useEffect(()=>{ if(!toast) return; const id=setTimeout(()=>setToast(''),6000); return ()=>clearTimeout(id) },[toast])

  const flushSave=()=>{ if(saveTimer.current){ clearTimeout(saveTimer.current); saveTimer.current=null } if(pendingJson.current){ const j=pendingJson.current; pendingJson.current=null; onChangeRef.current({}, j); setSavedAt(new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})); setSaveState('saved') } }
  const flushRef=useRef(flushSave); flushRef.current=flushSave
  // Flush any debounced edit before the editor unmounts (doc switch / back) so the last keystrokes are never lost.
  useEffect(()=>()=>{ flushRef.current() },[])
  const goBack=()=>{ flushSave(); onBack() }
  // Warn before leaving the page ONLY while work is not safely stored: a debounced
  // save is still pending ('saving' state / pending JSON), or the last write to
  // browser storage failed (saveFailed from the parent). Never warn when all saved.
  const unsavedRef=useRef(false)
  unsavedRef.current = saveState==='saving' || pendingJson.current!=null || !!saveFailed
  useEffect(()=>{
    const handler=(e:BeforeUnloadEvent)=>{ if(unsavedRef.current){ e.preventDefault(); e.returnValue=true } }
    window.addEventListener('beforeunload', handler)
    return ()=>window.removeEventListener('beforeunload', handler)
  },[])

  // M2-04 crash recovery check, once per opened document: a draft that
  // differs from the saved doc raises an explicit notice (never an auto
  // overwrite); a draft identical to the saved doc is stale and cleared.
  useEffect(()=>{
    const d = loadDraft(localStorage, doc.id)
    if (!d) return
    const info = detectRecovery({ id: doc.id, title: doc.title, content: doc.content }, d)
    if (info) setRecovery(info)
    else clearDraft(localStorage, doc.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[doc.id])

  const editor=useEditor({
    extensions:[
      StarterKit.configure({ link:false, underline:false } as any),
      Underline, Link.configure({ openOnClick:false }),
      // M2-06: 'image' added so the context menu can align a selected
      // image (rendered as text-align style + CSS block margins below).
      // Additive node attribute only; existing docs are unchanged.
      TextAlign.configure({ types:['heading','paragraph','image'] }),
      TextStyleKit, Highlight.configure({multicolor:true}),
      TableKit.configure({ table:{ resizable:true } }),
      Image, Placeholder.configure({ placeholder: t('startTyping') }),
      CharacterCount, PageBreak, FocusDim,
    ],
    content: doc.content,
    editorProps:{ attributes:{ dir: doc.dir, spellcheck: String(spell) } as any },
    onUpdate({editor}){
      setSaveState('saving')
      pendingJson.current=editor.getJSON()
      // M2-04: draft snapshot of the pending JSON (separate key, best-effort).
      // Cleared explicitly on accept/discard, and silently on reopen when it
      // turns out identical to the saved doc — never auto-applied.
      try { saveDraft(localStorage, { docId: docRef.current.id, content: editor.getJSON(), title: docRef.current.title, savedAt: new Date().toISOString() }) } catch { /* draft is best-effort */ }
      if(saveTimer.current) clearTimeout(saveTimer.current)
      // M2-08: no timer when autosave is off — pending edits flush only on
      // Save now / leaving the document (see resolveAutosaveDelay).
      const delay = resolveAutosaveDelay(autosaveRef.current as VyroSettings)
      if(delay!=null) saveTimer.current=setTimeout(()=>{ saveTimer.current=null; if(pendingJson.current){ const j=pendingJson.current; pendingJson.current=null; onChangeRef.current({}, j); setSavedAt(new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})); setSaveState('saved') } }, delay)
    },
  },[doc.id])

  useEffect(()=>{ if(editor){ editor.view.dom.setAttribute('spellcheck', String(spell)); editor.view.dom.setAttribute('dir', doc.dir) } },[spell, doc.dir, editor])

  // M2-08: a freshly created document carries the user's default font/size
  // as stored marks, so the first keystroke in a blank document is typed in
  // the default font/size (template text already carries them via
  // applyNewDocDefaults). Stored marks change no document content.
  useEffect(()=>{ if(!editor || !freshDefaults) return; try{ editor.chain().focus().setFontFamily(freshDefaults.font).setFontSize(freshDefaults.size+'px').run() }catch{ /* defaults are best-effort */ } },[editor, freshDefaults])

  // M2-03: enter/exit for Focus + Reading modes. Entering Reading records
  // scroll + selection; exiting restores them. Focus keeps the editor
  // editable and preserves the live cursor on exit (re-focused). Neither
  // mode touches document content — only chrome, editable state and CSS.
  const enterFocus=()=>{ if(viewMode==='reading') restoreRef.current=viewSnapshotRef.current; viewSnapshotRef.current=null; setNavOpen(false); setFindOpen(false); setViewMode('focus') }
  const enterReading=()=>{ if(!editor) return; viewSnapshotRef.current=createViewSnapshot(workspaceRef.current?.scrollTop??0, editor.state.selection.from, editor.state.selection.to); setNavOpen(false); setFindOpen(false); setViewMode('reading') }
  const exitMode=()=>{ if(viewMode==='reading') restoreRef.current=viewSnapshotRef.current; viewSnapshotRef.current=null; setViewMode('edit'); if(viewMode==='focus' && editor) editor.commands.focus() }
  useEffect(()=>{ if(!editor) return; editor.setEditable(viewMode!=='reading'); if(viewMode==='reading') return; const snap=restoreRef.current; if(!snap) return; restoreRef.current=null; const ws=workspaceRef.current; if(ws) ws.scrollTop=snap.scrollTop; try{ editor.commands.setTextSelection({from:snap.from, to:snap.to}); editor.commands.focus() }catch{ /* selection restore is best-effort */ } },[editor, viewMode])
  useEffect(()=>{ if(viewMode==='edit') return; const h=(e:KeyboardEvent)=>{ if(e.key==='Escape'){ e.preventDefault(); exitMode() } }; window.addEventListener('keydown', h); return ()=>window.removeEventListener('keydown', h) },[viewMode])

  // Font read-back: the family/size selects must REFLECT the textStyle at the
  // cursor, not just set it. getAttributes('textStyle') resolves the marks at
  // the selection start (or stored marks at a collapsed cursor), which is the
  // sensible value for mixed selections too.
  const fontState = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return { family: '', size: '', lineHeight: '' }
      const attrs = (ed.getAttributes('textStyle') || {}) as { fontFamily?: string; fontSize?: string; lineHeight?: string }
      return { family: attrs.fontFamily || '', size: attrs.fontSize || '', lineHeight: attrs.lineHeight || '' }
    },
  })

  // Page scaling: the sheet keeps its true A4 layout size; a wrapper with
  // compensated dimensions scales it (fit-to-width on narrow screens × user
  // zoom) so zooming never breaks the surrounding layout or scrolls the app.
  const pageMmW = doc.orientation==='landscape' ? 297 : 210
  const pageMmH = doc.orientation==='landscape' ? 210 : 297
  const [fitScale,setFitScale]=useState(1)
  const [pagePxH,setPagePxH]=useState(()=>Math.round(pageMmH*MM_PX))
  useEffect(()=>{ const ws=workspaceRef.current; if(!ws) return; const upd=()=>{ const avail=Math.max(160, ws.clientWidth-20); setFitScale(Math.min(1, avail/(pageMmW*MM_PX))) }; upd(); const ro=new ResizeObserver(upd); ro.observe(ws); return ()=>ro.disconnect() },[pageMmW])
  useEffect(()=>{ const el=pageRef.current; if(!el) return; const upd=()=>setPagePxH(el.offsetHeight); upd(); const ro=new ResizeObserver(upd); ro.observe(el); return ()=>ro.disconnect() },[editor, doc.orientation, doc.margins])
  const effScale=Math.max(0.1, fitScale*(zoom/100))

  // M2-06: the menu closes on scroll, on selection change, on Esc (the
  // menu component handles Esc/backdrop), and on outside click (backdrop).
  useEffect(()=>{
    if(!ctxMenu || !editor) return
    const close=()=>setCtxMenu(null)
    const ws=workspaceRef.current
    ws?.addEventListener('scroll', close, true)
    editor.on('selectionUpdate', close)
    return ()=>{ ws?.removeEventListener('scroll', close, true); editor.off('selectionUpdate', close) }
  },[ctxMenu, editor])

  // Expose the editor's real actions to the app-level command palette while
  // this editor is mounted; cleared on unmount so the palette never offers
  // editor commands on the dashboard. (Hooks below this line are conditional
  // on `editor` only in the sense that the early return above already fired
  // when it is null — this effect therefore always runs with an editor.)
  useEffect(()=>{
    if(!editor || !onEditorActions) return
    onEditorActions({
      insertTable: ()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run(),
      insertDate: ()=>editor.chain().focus().insertContent({ type:'text', text: formatDocDate(doc.dir) }).run(),
      exportTxt: ()=>download(`${doc.title}.txt`, jsonToPlainText(editor.getJSON()), 'text/plain'),
      exportHtml: ()=>download(`${doc.title}.html`, `<!doctype html><html dir="${doc.dir}"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title></head><body>${editor.getHTML()}</body></html>`, 'text/html'),
      zoomIn: ()=>setZoom(z=>Math.min(200,z+10)),
      zoomOut: ()=>setZoom(z=>Math.max(50,z-10)),
      zoomReset: ()=>setZoom(100),
      pastePlainText: ()=>{ void pastePlainText() },
    })
    return ()=>onEditorActions(null)
    // doc.title/dir are deps on purpose: export filenames and the inserted
    // date follow the document's current title/direction, not its mount-time ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[editor, doc.title, doc.dir])

  // ---- M2-04 version history + crash recovery helpers ----
  const triggerLabel=(trg:VersionTrigger)=> t(({
    manual:'versionTriggerManual', auto:'versionTriggerAuto', 'before-replace':'versionTriggerBeforeReplace',
    'before-risky':'versionTriggerBeforeRisky', 'pre-restore':'versionTriggerPreRestore', recovery:'versionTriggerRecovery',
  } as const)[trg])
  /** Snapshot the editor's current JSON (incl. unsaved edits). Returns false only when the version could not be stored. */
  const snapshotCurrent=(trigger:VersionTrigger, label?:string):boolean=>{
    if(!editor) return false
    const snap=createSnapshot({ id: docRef.current.id, title: docRef.current.title, content: editor.getJSON() }, trigger, label)
    if(!snap) { setVersionError(t('versionSaveFailed')); return false }
    const store=loadVersions(localStorage)
    const next=addVersion(store, snap)
    const ok=saveVersions(localStorage, next)
    if(ok){ setVersions(next); setVersionError('') } else setVersionError(t('versionSaveFailed'))
    return ok
  }
  const saveVersionManual=()=>{ if(snapshotCurrent('manual', versionLabel)){ setVersionLabel(''); setToast(t('versionSaved')) } }
  /** Apply restored content/title: pending edits are folded into the pre-restore backup, never silently discarded. */
  const applyRestored=(restored:{content:any;title:string}, versionsNext:VersionSnapshot[])=>{
    if(!editor) return
    if(saveTimer.current){ clearTimeout(saveTimer.current); saveTimer.current=null }
    pendingJson.current=null
    setVersions(versionsNext)
    editor.commands.setContent(restored.content)
    onChangeRef.current({ title: restored.title }, editor.getJSON())
    setSaveState('saving')
  }
  const restoreSelected=()=>{
    if(!editor || !selectedVersionId) return
    // The backup must capture the user's latest work: pending (unsaved) edits
    // count as current, since the debounce save has not run yet.
    const current={ id: docRef.current.id, title: docRef.current.title, content: pendingJson.current ?? docRef.current.content }
    const res=restoreVersion(loadVersions(localStorage), current, selectedVersionId)
    if(!res){ setVersionError(t('versionSaveFailed')); return }
    if(!saveVersions(localStorage, res.versions)){ setVersionError(t('versionSaveFailed')); return }
    applyRestored(res.restored, res.versions)
    setToast(t('versionRestored'))
  }
  const acceptRecovery=()=>{
    if(!editor || !recovery) return
    const current={ id: docRef.current.id, title: docRef.current.title, content: pendingJson.current ?? docRef.current.content }
    const res=acceptDraft(current, recovery.draft, loadVersions(localStorage))
    if(!res){ setVersionError(t('versionSaveFailed')); return }
    if(!saveVersions(localStorage, res.versions)){ setVersionError(t('versionSaveFailed')); return }
    clearDraft(localStorage, docRef.current.id)
    setRecovery(null)
    applyRestored(res.restored, res.versions)
    setToast(t('recoveryAccepted'))
  }
  const discardRecovery=()=>{ clearDraft(localStorage, docRef.current.id); setRecovery(null) }
  const beforeReplaceAll=()=>{ if(!snapshotCurrent('before-replace')) setToast(t('versionSaveFailed')) }
  const docVersions=listVersions(versions, doc.id)
  const selectedVersion=docVersions.find(v=>v.id===selectedVersionId) ?? null

  if(!editor) return <div className="loading">{t('loadingEditor')}</div>
  const words = editor.getText().trim()? editor.getText().trim().split(/\s+/).length:0
  const chars = (editor.storage as any).characterCount?.characters?.() ?? editor.getText().length

  const gated=(fn:()=>void)=> isPremium? fn() : onRequirePremium()
  const download=(name:string, text:string, type:string)=>{ const b=new Blob([text],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000) }
  const exportTxt=()=> download(`${doc.title}.txt`, jsonToPlainText(editor.getJSON()), 'text/plain')
  const exportHtml=()=> download(`${doc.title}.html`, `<!doctype html><html dir="${doc.dir}"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title></head><body>${editor.getHTML()}</body></html>`, 'text/html')
  const insertDate=()=>{ editor.chain().focus().insertContent({ type:'text', text: formatDocDate(doc.dir) }).run() }
  const insertToc=()=>{ const items:{level:number;text:string}[]=[]; editor.state.doc.descendants((n:any)=>{ if(n.type.name==='heading') items.push({level:n.attrs.level, text:n.textContent}) }); if(!items.length){ setToast(t('noHeadings')); return } const html=`<h2>${escapeHtml(t('tocHeading'))}</h2>`+items.map(i=>`<p style="margin-left:${(i.level-1)*18}px">${escapeHtml(i.text)}</p>`).join(''); editor.chain().focus().insertContent(html).run() }

  const onImport=async(e:React.ChangeEvent<HTMLInputElement>)=>{ const f=e.target.files?.[0]; if(!f) return; try{
    const isDocx=/\.docx$/i.test(f.name); const isTxt=/\.txt$/i.test(f.name)
    if(!isDocx && !isTxt) throw new Error(t('importUnsupported'))
    if(isDocx){ const mammoth=(await import('mammoth')).default ?? (await import('mammoth')); const buf=await f.arrayBuffer(); const res=await (mammoth as any).convertToHtml({arrayBuffer:buf}); editor.commands.setContent(res.value||'<p></p>'); onChange({title:f.name.replace(/\.docx$/i,'')}, editor.getJSON()) }
    else { const txt=await f.text(); editor.commands.setContent(txt.split(/\n{2,}/).map((para:string)=>`<p>${escapeHtml(para).replace(/\n/g,'<br>')}</p>`).join('')); onChange({title:f.name.replace(/\.txt$/i,'')}, editor.getJSON()) }
  }catch(err:any){ setToast(`${t('importFailed')}: ${err?.message||err}`) } finally{ e.target.value='' } }

  // M2-07: picking a file now only OPENS a preview — insertion happens
  // on the preview dialog's Insert button, never on file-pick directly.
  const onImage=(e:React.ChangeEvent<HTMLInputElement>)=>{ const f=e.target.files?.[0]; e.target.value=''; if(!f) return; const err=validateImageFile(f); if(err){ setToast(t(err)); return } const r=new FileReader(); r.onerror=()=>setToast(t('importFailed')); r.onload=()=> setImgPreview({ src:String(r.result), size:f.size }); r.readAsDataURL(f) }
  const insertPreviewImage=()=>{ if(!imgPreview) return; editor.chain().focus().setImage({src:imgPreview.src} as any).run(); setImgPreview(null) }
  const openImageEdit=()=>{ const a=editor.getAttributes('image'); setImgSrc(a.src||''); setImgAlt(a.alt||''); setImgCaption(a.title||''); setImgWidth(typeof a.width==='string'? a.width : ''); setImgEditOpen(true) }
  const applyImageEdit=()=>{ editor.chain().focus().updateAttributes('image', { src: imgSrc, alt: imgAlt.trim()||null, title: imgCaption.trim()||null, width: imgWidth||null } as any).run(); setImgEditOpen(false) }
  const deleteImageEdit=()=>{ editor.chain().focus().deleteSelection().run(); setImgEditOpen(false) }
  const onReplaceImage=(e:React.ChangeEvent<HTMLInputElement>)=>{ const f=e.target.files?.[0]; e.target.value=''; if(!f) return; const err=validateImageFile(f); if(err){ setToast(t(err)); return } const r=new FileReader(); r.onerror=()=>setToast(t('importFailed')); r.onload=()=> setImgSrc(String(r.result)); r.readAsDataURL(f) }
  const openLink=()=>{ const sel=editor.state.selection; setLinkUrl(editor.getAttributes('link').href||''); setLinkText(sel.from===sel.to ? '' : editor.state.doc.textBetween(sel.from, sel.to, '\n')); setLinkTextShown(sel.from!==sel.to); setLinkOpen(true) }
  const openLinkAt=(from:number, to:number)=>{ editor.chain().focus().setTextSelection({from, to}).run(); const sel=editor.state.selection; setLinkUrl(editor.getAttributes('link').href||''); setLinkText(editor.state.doc.textBetween(sel.from, sel.to, '\n')); setLinkTextShown(true); setLinkOpen(true) }
  const applyLink=()=>{
    const url=linkUrl.trim()
    const sel=editor.state.selection; const curText=sel.from===sel.to ? '' : editor.state.doc.textBetween(sel.from, sel.to, '\n')
    if(url===''){ editor.chain().focus().unsetLink().run(); setLinkOpen(false); return }
    if(!isSafeLinkUrl(url)){ setToast(t('linkInvalid')); return }
    // Manager edit with changed text: replace the range with the new text
    // carrying the link mark, keeping the text (never dropping it).
    if(linkText!=='' && linkText!==curText && sel.from!==sel.to){
      editor.chain().focus().deleteSelection().insertContent({ type:'text', text:linkText, marks:[{ type:'link', attrs:{ href:url } }] }).run()
    } else {
      editor.chain().focus().setLink({href:url}).run()
    }
    setLinkOpen(false)
  }
  const removeLink=()=>{ editor.chain().focus().unsetLink().run(); setLinkOpen(false) }

  // ---- M2-06 clipboard + contextual menu ----
  const pastePlainText=async()=>{
    if(!editor) return
    try {
      const text = await navigator.clipboard?.readText()
      if(text) editor.chain().focus().insertContent(text).run()
    } catch { setToast(t('pastePlainUnavailable')) }
    if(!navigator.clipboard?.readText) setToast(t('pastePlainUnavailable'))
  }
  const copySelection=async(cut:boolean)=>{
    if(!editor) return
    const sel=editor.state.selection
    if(sel.from===sel.to) return
    const text=editor.state.doc.textBetween(sel.from, sel.to, '\n')
    try { await navigator.clipboard?.writeText(text) } catch { try { document.execCommand('copy') } catch { /* clipboard blocked */ } }
    if(cut) editor.chain().focus().deleteSelection().run()
  }
  /** Paste interceptor: only steps in when sanitizing changed something
   *  (danger stripped, wrappers/classes dropped). Untouched HTML and plain
   *  text keep TipTap's native paste path, so normal pasting is identical. */
  const handlePaste=(e:React.ClipboardEvent)=>{
    if(!editor) return
    const html=e.clipboardData?.getData('text/html')
    if(!html) return
    const clean=sanitizePastedHtml(html)
    if(clean===html.trim()) return
    e.preventDefault()
    if(!clean) {
      const plain=e.clipboardData.getData('text/plain') || htmlToPlainText(html)
      if(plain) editor.chain().focus().insertContent(plain).run()
      return
    }
    editor.chain().focus().insertContent(clean).run()
  }
  const openContextMenu=(clientX:number, clientY:number)=>{
    if(!editor) return
    try {
      const view=editor.view
      const hit=view.posAtCoords({ left: clientX, top: clientY })
      let inTable=false, inImage=false
      if(hit) {
        const $pos=editor.state.doc.resolve(hit.pos)
        for(let d=$pos.depth; d>=0; d--){ const n=$pos.node(d); if(n.type.name==='tableCell'||n.type.name==='tableHeader') inTable=true }
        if(editor.state.doc.nodeAt(hit.pos)?.type.name==='image') inImage=true
        const sel=editor.state.selection
        if(hit.pos < sel.from || hit.pos > sel.to) {
          if(inImage) editor.commands.setNodeSelection(hit.pos)
          else editor.commands.setTextSelection(hit.pos)
        }
      }
      if((editor.state.selection as any).node?.type.name==='image') inImage=true
      if(editor.isActive('tableCell') || editor.isActive('tableHeader')) inTable=true
      const sel=editor.state.selection
      const hasSelection=sel.from!==sel.to && (sel as any).node==null
      const inLink=editor.isActive('link')
      const linkHref=inLink ? (editor.getAttributes('link').href as string|null) ?? null : null
      const items=getContextMenuItems({ hasSelection, inTable, inImage, inLink, linkHref })
      setCtxMenu({ items, x: clientX, y: clientY, linkHref })
    } catch { /* menu is best-effort; a failed probe must never break editing */ }
  }
  const runMenuAction=(id:MenuItemId)=>{
    if(!editor) return
    const linkHref=ctxMenu?.linkHref ?? null
    setCtxMenu(null)
    const chain=()=>editor.chain().focus()
    switch(id){
      case 'cut': void copySelection(true); break
      case 'copy': void copySelection(false); break
      case 'pastePlain': void pastePlainText(); break
      case 'clearFormatting': chain().unsetAllMarks().clearNodes().run(); break
      case 'bold': chain().toggleBold().run(); break
      case 'italic': chain().toggleItalic().run(); break
      case 'link': openLink(); break
      case 'addRow': chain().addRowAfter().run(); break
      case 'addColumn': chain().addColumnAfter().run(); break
      case 'deleteRow': chain().deleteRow().run(); break
      case 'deleteColumn': chain().deleteColumn().run(); break
      case 'imageAlt': setAltText((editor.getAttributes('image').alt as string)||''); setAltOpen(true); break
      case 'alignLeft': chain().setTextAlign('left').run(); break
      case 'alignCenter': chain().setTextAlign('center').run(); break
      case 'alignRight': chain().setTextAlign('right').run(); break
      case 'deleteImage': chain().deleteSelection().run(); break
      case 'editLink': openLink(); break
      case 'removeLink': chain().unsetLink().run(); break
      case 'openLink': if(linkHref && isSafeLinkUrl(linkHref)) window.open(linkHref, '_blank', 'noopener'); break
    }
  }
  const applyImageAlt=()=>{ if(!editor) return; editor.chain().focus().updateAttributes('image', { alt: altText.trim() || null }).run(); setAltOpen(false) }
  /** Guarded long-press: timer cleared on any move/scroll/end, so normal
   *  taps (caret placement) and scrolling never trigger the menu. If the
   *  timer fires, the native long-press menu is suppressed by the
   *  duplicate-contextmenu guard in onContextMenu. */
  const clearLongPress=()=>{ if(longPressRef.current?.timer) clearTimeout(longPressRef.current.timer); longPressRef.current=null }
  const onTouchStart=(e:React.TouchEvent)=>{
    clearLongPress()
    const touch=e.touches[0]; if(!touch) return
    const x=touch.clientX, y=touch.clientY
    const ref={ timer: setTimeout(()=>{ longPressMenuRef.current=Date.now(); openContextMenu(x, y) }, 550), x, y, moved:false }
    longPressRef.current=ref
  }
  const onTouchMove=(e:React.TouchEvent)=>{
    const ref=longPressRef.current; if(!ref) return
    const touch=e.touches[0]; if(!touch) return
    if(Math.abs(touch.clientX-ref.x) > 10 || Math.abs(touch.clientY-ref.y) > 10) clearLongPress()
  }

  const Btn=(p:{onClick:()=>void; active?:boolean; title?:string; children:any; disabled?:boolean})=>(<button type="button" className={`rbtn${p.active?' active':''}`} onClick={p.onClick} title={p.title||''} disabled={p.disabled}>{p.children}</button>)
  const Group=(p:{label:string; children:any})=>(<div className="rgroup"><div className="rgroup-items">{p.children}</div><div className="rgroup-label">{p.label}</div></div>)

  // Controlled values for the font selects, derived from the read-back state.
  const curFamily = fontState?.family || ''
  const curSizeNum = fontState?.size ? parseInt(fontState.size, 10) : NaN
  const sizeSelectValue = Number.isNaN(curSizeNum) ? '16' : FONT_SIZES.includes(curSizeNum) ? String(curSizeNum) : ''
  // Line spacing read-back: same textStyle mechanism as family/size. The
  // official LineHeight extension ships inside TextStyleKit (already enabled),
  // so setLineHeight/unsetLineHeight are plain mark writes — no custom
  // extension, and stored docs only gain an additive textStyle attr.
  const curLineHeight = fontState?.lineHeight || ''

  const pageW = doc.orientation==='landscape' ? '297mm':'210mm'
  const pageMinH = doc.orientation==='landscape' ? '210mm':'297mm'
  const saveText = saveState==='saving'? t('saving') : savedAt? `${t('saved')} ${savedAt}` : t('savedLocally')

  return <div className={`editor-shell${viewMode!=='edit' ? ` ${viewModeClass(viewMode)}` : ''}`}>
    {viewMode!=='edit' && <div className="view-mode-bar" role="toolbar" aria-label={viewMode==='focus' ? t('focusMode') : t('readingMode')}>
      <span className="view-mode-label">{viewMode==='focus' ? t('focusMode') : t('readingMode')}</span>
      {viewMode==='focus' && <label className="view-mode-width">{t('textWidth')}<select aria-label={t('textWidth')} value={focusWidth} onChange={e=>setFocusWidth(e.target.value as FocusWidth)}><option value="narrow">{t('narrow')}</option><option value="normal">{t('normal')}</option><option value="wide">{t('wide')}</option></select></label>}
      <button type="button" className="rbtn view-mode-exit" onClick={exitMode}>{viewMode==='focus' ? t('exitFocusMode') : t('exitReadingMode')}</button>
    </div>}
    {viewMode==='edit' && <header className="editor-top">
      <div className="top-start"><button className="back-btn" onClick={goBack}>← {t('dashboard')}</button><div className="logo"><span className="vmark">V</span> Vyro Web</div></div>
      <input className="title-input" value={doc.title} dir="auto" onChange={e=>onChange({title:e.target.value})} aria-label={t('docTitleLabel')}/>
      <div className="top-end">
        <span className="saved" role="status">{saveText}</span>
        <span className="badge">{isPremium? t('premiumActive') : t('free')}</span>
        {onPaletteOpen && <button className="rbtn" onClick={onPaletteOpen} title="Ctrl+K" aria-label={t('commandPalette')}>⌘K</button>}
        {onLangChange && <div className="lang-toggle mini" role="group" aria-label={t('language')}><button className={`rbtn${lang==='en'?' active':''}`} onClick={()=>onLangChange('en')}>EN</button><button className={`rbtn${lang==='fa'?' active':''}`} onClick={()=>onLangChange('fa')}>فا</button></div>}
        <button className="rbtn" onClick={onToggleTheme} title={theme==='dark'? t('lightUi'):t('darkUi')} aria-label={theme==='dark'? t('lightUi'):t('darkUi')}>{theme==='dark'?'☀':'☾'}</button>
      </div>
    </header>}
    {viewMode==='edit' && <div className={`ribbon-wrap${toolsOpen?' expanded':''}`}>
      <nav className="ribbon-tabs">{TABS.map(tb=><button key={tb.id} className={tab===tb.id?'tab active':'tab'} onClick={()=>setTab(tb.id)}>{t(tb.key)}</button>)}<button className="tools-toggle" aria-expanded={toolsOpen} onClick={()=>setToolsOpen(o=>!o)}>{t('moreTools')} {toolsOpen?'▴':'▾'}</button></nav>
      <div className="ribbon">
      {tab==='File' && <>
        <Group label={t('groupDocument')}><Btn onClick={goBack}>{t('dashboard')}</Btn><Btn onClick={()=>{ pendingJson.current=editor.getJSON(); flushSave() }}>{t('saveNow')}</Btn></Group>
        <Group label={t('groupImport')}><Btn onClick={()=>importRef.current?.click()}>{t('importBtn')}</Btn></Group>
        <Group label={t('groupExport')}><Btn onClick={exportTxt}>{t('exportTxt')}</Btn><Btn onClick={exportHtml}>{t('exportHtml')}</Btn><Btn onClick={()=>gated(()=>exportDocx(editor.getJSON(), doc.title))}>{t('exportDocx')} {!isPremium&&'🔒'}</Btn><Btn onClick={()=>gated(()=>window.print())}>{t('printPdf')} {!isPremium&&'🔒'}</Btn></Group>
      </>}
      {tab==='Home' && <>
        <Group label={t('groupHistory')}><Btn onClick={()=>editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>{t('undo')}</Btn><Btn onClick={()=>editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>{t('redo')}</Btn></Group>
        <Group label={t('groupStyle')}><select aria-label="Block style" value={editor.isActive('heading',{level:1})?'h1':editor.isActive('heading',{level:2})?'h2':editor.isActive('heading',{level:3})?'h3':'p'} onChange={e=>{ const v=e.target.value; const c=editor.chain().focus(); if(v==='p') c.setParagraph().run(); else c.toggleHeading({level:Number(v.slice(1)) as any}).run() }}><option value="p">{t('paragraph')}</option><option value="h1">{t('heading1')}</option><option value="h2">{t('heading2')}</option><option value="h3">{t('heading3')}</option></select>
        <select aria-label={t('fontFamily')} value={curFamily} onChange={e=>{ const v=e.target.value; const c=editor.chain().focus(); if(!v) c.unsetFontFamily().run(); else c.setFontFamily(v).run() }}><option value="">{t('fontFamily')}</option>{curFamily && !FONT_FAMILIES.includes(curFamily) && <option value={curFamily}>{curFamily.replace(/'/g,'')}</option>}{FONT_FAMILIES.map(f=><option key={f} value={f}>{f.replace(/'/g,'')}</option>)}</select>
        <select aria-label="Font size" value={sizeSelectValue} onChange={e=>{ if(e.target.value) editor.chain().focus().setFontSize(e.target.value+'px').run() }}>{sizeSelectValue==='' && <option value="">{curSizeNum}px</option>}{FONT_SIZES.map(s=><option key={s} value={s}>{s}px</option>)}</select>
        <select aria-label={t('lineSpacing')} value={curLineHeight} onChange={e=>{ const v=e.target.value; const c=editor.chain().focus(); if(!v) c.unsetLineHeight().run(); else c.setLineHeight(v).run() }}><option value="">{t('lineSpacing')}</option>{curLineHeight && !LINE_HEIGHTS.includes(curLineHeight) && <option value={curLineHeight}>{curLineHeight}</option>}{LINE_HEIGHTS.map(v=><option key={v} value={v}>{v}</option>)}</select></Group>
        <Group label={t('groupFont')}><Btn active={editor.isActive('bold')} onClick={()=>editor.chain().focus().toggleBold().run()}><b>B</b></Btn><Btn active={editor.isActive('italic')} onClick={()=>editor.chain().focus().toggleItalic().run()}><i>I</i></Btn><Btn active={editor.isActive('underline')} onClick={()=>editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn><Btn active={editor.isActive('strike')} onClick={()=>editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
        <label className="color-wrap" title={t('textColour')}>A<input type="color" onChange={e=>editor.chain().focus().setColor(e.target.value).run()}/></label>
        <label className="color-wrap" title={t('highlight')}>H<input type="color" defaultValue="#ffff00" onChange={e=>editor.chain().focus().toggleHighlight({color:e.target.value}).run()}/></label>
        <Btn onClick={()=>editor.chain().focus().unsetAllMarks().clearNodes().run()}>{t('clearFormatting')}</Btn><Btn onClick={()=>{ void pastePlainText() }}>{t('menuPastePlain')}</Btn></Group>
        <Group label={t('groupParagraph')}><Btn active={editor.isActive({textAlign:'left'})} onClick={()=>editor.chain().focus().setTextAlign('left').run()}>{t('alignLeft')}</Btn><Btn active={editor.isActive({textAlign:'center'})} onClick={()=>editor.chain().focus().setTextAlign('center').run()}>{t('alignCenter')}</Btn><Btn active={editor.isActive({textAlign:'right'})} onClick={()=>editor.chain().focus().setTextAlign('right').run()}>{t('alignRight')}</Btn><Btn active={editor.isActive({textAlign:'justify'})} onClick={()=>editor.chain().focus().setTextAlign('justify').run()}>{t('alignJustify')}</Btn></Group>
        {!compactToolbar && <Group label={t('groupLists')}><Btn active={editor.isActive('bulletList')} onClick={()=>editor.chain().focus().toggleBulletList().run()}>{t('bulletList')}</Btn><Btn active={editor.isActive('orderedList')} onClick={()=>editor.chain().focus().toggleOrderedList().run()}>{t('orderedList')}</Btn><Btn active={editor.isActive('blockquote')} onClick={()=>editor.chain().focus().toggleBlockquote().run()}>{t('quote')}</Btn></Group>}
      </>}
      {tab==='Insert' && <>
        <Group label={t('groupTable')}><Btn onClick={()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run()}>{t('insertTable')}</Btn><Btn onClick={()=>editor.chain().focus().addRowBefore().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('addRowBefore')}</Btn><Btn onClick={()=>editor.chain().focus().addRowAfter().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('addRow')}</Btn><Btn onClick={()=>editor.chain().focus().addColumnBefore().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('addColumnBefore')}</Btn><Btn onClick={()=>editor.chain().focus().addColumnAfter().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('addColumn')}</Btn><Btn onClick={()=>editor.chain().focus().deleteRow().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('deleteRow')}</Btn><Btn onClick={()=>editor.chain().focus().deleteColumn().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('deleteColumn')}</Btn><Btn active={editor.isActive('tableHeader')} onClick={()=>editor.chain().focus().toggleHeaderRow().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('toggleHeaderRow')}</Btn><Btn onClick={()=>editor.chain().focus().deleteTable().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('deleteTable')}</Btn></Group>
        <Group label={t('cellAlign')}><Btn onClick={()=>editor.chain().focus().setTextAlign('left').run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('alignLeft')}</Btn><Btn onClick={()=>editor.chain().focus().setTextAlign('center').run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('alignCenter')}</Btn><Btn onClick={()=>editor.chain().focus().setTextAlign('right').run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('alignRight')}</Btn></Group>
        <Group label={t('groupMedia')}><Btn onClick={()=>fileImgRef.current?.click()}>{t('imageLocal')}</Btn><Btn onClick={openImageEdit} disabled={!editor.isActive('image')}>{t('imageEdit')}</Btn></Group>
        {!compactToolbar && <Group label={t('groupLinksBreaks')}><Btn active={editor.isActive('link')} onClick={openLink}>{t('link')}</Btn><Btn onClick={()=>editor.chain().focus().setHorizontalRule().run()}>{t('horizontalLine')}</Btn><Btn onClick={()=>editor.chain().focus().insertPageBreak().run()}>{t('pageBreak')}</Btn></Group>}
        <Group label={t('groupText')}><Btn onClick={insertDate}>{t('insertDate')}</Btn></Group>
      </>}
      {tab==='Layout' && <>
        <Group label={t('groupMargins')}><Btn active={(doc.margins||'normal')==='narrow'} onClick={()=>onChange({margins:'narrow'})}>{t('narrow')}</Btn><Btn active={(doc.margins||'normal')==='normal'} onClick={()=>onChange({margins:'normal'})}>{t('normal')}</Btn><Btn active={(doc.margins||'normal')==='wide'} onClick={()=>onChange({margins:'wide'})}>{t('wide')}</Btn></Group>
        <Group label={t('groupOrientation')}><Btn active={(doc.orientation||'portrait')==='portrait'} onClick={()=>onChange({orientation:'portrait'})}>{t('portrait')}</Btn><Btn active={doc.orientation==='landscape'} onClick={()=>onChange({orientation:'landscape'})}>{t('landscape')}</Btn></Group>
        <Group label={t('groupDirection')}><Btn active={doc.dir==='ltr'} onClick={()=>onChange({dir:'ltr'})}>LTR</Btn><Btn active={doc.dir==='rtl'} onClick={()=>onChange({dir:'rtl'})}>RTL (Dari/Persian)</Btn></Group>
      </>}
      {tab==='References' && <Group label={t('groupContents')}><Btn onClick={insertToc}>{t('insertToc')}</Btn></Group>}
      {tab==='Review' && <>
        <Group label={t('groupProofing')}><Btn active={spell} onClick={()=>setSpell(s=>!s)}>{t('spellcheck')} {spell? t('on'):t('off')}</Btn></Group>
        <Group label={t('groupCount')}><span className="static-stat">{words} {t('words')} · {chars} {t('characters')} · {editor.getText().split(/\n/).filter(Boolean).length} {t('paragraphsApprox')}</span></Group>
      </>}
      {tab==='View' && <>
        <Group label={t('navigationPane')}><Btn active={navOpen} onClick={()=>setNavOpen(o=>!o)}>{t('navigationPane')}</Btn><Btn active={findOpen} onClick={()=>setFindOpen(o=>!o)}>{t('findReplace')}</Btn></Group>
        <Group label={t('documentStatistics')}><Btn active={statsOpen} onClick={()=>setStatsOpen(o=>!o)}>{t('documentStatistics')}</Btn></Group>
        <Group label={t('linkManager')}><Btn active={linksOpen} onClick={()=>setLinksOpen(o=>!o)}>{t('linkManager')}</Btn></Group>
        <Group label={t('groupViewModes')}><Btn onClick={enterFocus}>{t('focusMode')}</Btn><Btn onClick={enterReading}>{t('readingMode')}</Btn></Group>
        <Group label={t('versions')}><Btn active={versionsOpen} onClick={()=>setVersionsOpen(o=>!o)}>{t('versions')}</Btn><Btn active={compareOpen} onClick={()=>setCompareOpen(o=>!o)}>{t('compare')}</Btn></Group>
        <Group label={t('groupZoom')}><Btn onClick={()=>setZoom(z=>Math.max(50,z-10))}>−</Btn><span className="static-stat">{zoom}%</span><Btn onClick={()=>setZoom(z=>Math.min(200,z+10))}>+</Btn><Btn onClick={()=>setZoom(100)}>100%</Btn><Btn onClick={()=>setZoom(50)}>50%</Btn><Btn onClick={()=>setZoom(200)}>200%</Btn></Group>
        {!compactToolbar && <Group label={t('groupTheme')}><Btn onClick={onToggleTheme}>{theme==='dark'? t('lightUi'):t('darkUi')}</Btn></Group>}
        {!compactToolbar && <Group label={t('groupDirection')}><span className="static-stat">{t('documentLabel')}: {doc.dir.toUpperCase()}</span></Group>}
      </>}
      </div>
      {linkOpen && <div className="link-pop" role="dialog" aria-label={t('link')}>
        <label>{t('linkPrompt')}<input autoFocus value={linkUrl} dir="ltr" placeholder="https://…" onChange={e=>setLinkUrl(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); applyLink() } if(e.key==='Escape') setLinkOpen(false) }}/></label>
        {linkTextShown && <label>{t('linkTextLabel')}<input value={linkText} dir="auto" onChange={e=>setLinkText(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); applyLink() } if(e.key==='Escape') setLinkOpen(false) }}/></label>}
        <div className="row"><button className="primary small" onClick={applyLink}>{t('save')}</button>{editor.isActive('link') && <button className="rbtn" onClick={removeLink}>{t('removeLink')}</button>}<button className="rbtn" onClick={()=>setLinkOpen(false)}>{t('cancel')}</button></div>
      </div>}
    </div>}
    {viewMode==='edit' && findOpen && <FindReplacePanel editor={editor} lang={lang} onClose={()=>setFindOpen(false)} onBeforeReplaceAll={beforeReplaceAll} />}
    {viewMode==='edit' && recovery && <div className="recovery-banner" role="alert">
      <div><b>{t('recoveryNotice')}</b> — {t('recoveryDiff')}</div>
      <div className="recovery-compare" dir="auto">{t('saved')}: {recovery.savedLength} {t('chars')} · {t('versionTriggerRecovery')}: {recovery.draftLength} {t('chars')}</div>
      <div className="recovery-excerpt" dir="auto"><span>{t('saved')}: “{recovery.savedExcerpt}”</span><span>{t('versionTriggerRecovery')}: “{recovery.draftExcerpt}”</span></div>
      <div className="row"><button type="button" className="primary small" onClick={acceptRecovery}>{t('recoveryAccept')}</button><button type="button" className="rbtn" onClick={discardRecovery}>{t('recoveryDiscard')}</button></div>
    </div>}
    {viewMode==='edit' && statsOpen && <StatsPanel editor={editor} lang={lang} onClose={()=>setStatsOpen(false)} />}
    {viewMode==='edit' && compareOpen && <ComparePanel editor={editor} doc={doc} versions={versions} lang={lang} onClose={()=>setCompareOpen(false)} onVersionsSaved={(next)=>setVersions(next)} />}
    {viewMode==='edit' && linksOpen && <LinkManagerPanel editor={editor} lang={lang} onClose={()=>setLinksOpen(false)} onEditLink={openLinkAt} />}
    {viewMode==='edit' && versionsOpen && <div className="versions-panel" role="region" aria-label={t('versions')}>
      <div className="find-row">
        <input value={versionLabel} dir="auto" onChange={e=>setVersionLabel(e.target.value)} placeholder={t('versionNamePlaceholder')} aria-label={t('versionNamePlaceholder')}/>
        <button type="button" className="primary small" onClick={saveVersionManual}>{t('versionSave')}</button>
        <button type="button" className="rbtn" onClick={()=>setVersionsOpen(false)} aria-label={t('close')}>×</button>
      </div>
      {versionError && <div className="versions-error" role="alert">{versionError}</div>}
      {docVersions.length===0
        ? <p className="muted">{t('versionListEmpty')}</p>
        : <ul className="version-list">
            {docVersions.map(v=><li key={v.id}>
              <button type="button" className={`version-item${selectedVersionId===v.id?' active':''}`} onClick={()=>setSelectedVersionId(v.id)}>
                <span className="version-meta">{new Date(v.createdAt).toLocaleString()} · {triggerLabel(v.trigger)}</span>
                {v.label && <span className="version-label" dir="auto">{v.label}</span>}
              </button>
            </li>)}
          </ul>}
      {selectedVersion && <div className="version-preview">
        <div className="find-row"><span className="find-preview-label">{t('versionPreview')}</span><button type="button" className="primary small" onClick={restoreSelected}>{t('restore')}</button></div>
        <div className="version-preview-text" dir="auto">{jsonToPlainText(selectedVersion.content).slice(0, 5000)}</div>
      </div>}
    </div>}
    <div className="editor-body">
    {viewMode==='edit' && navOpen && <NavigationPane editor={editor} lang={lang} onCollapse={()=>setNavOpen(false)} />}
    <div className="workspace" ref={workspaceRef}>
      <div className="page-scaler" style={{ width:`${Math.round(pageMmW*MM_PX*effScale)}px`, height:`${Math.round(pagePxH*effScale)}px` }}>
        <div className="page-scale-inner" style={{ transform:`scale(${effScale})`, width:`${Math.round(pageMmW*MM_PX)}px` }}>
          <div ref={pageRef} className={`a4-page ${doc.orientation==='landscape'?'landscape':'portrait'}${viewMode==='focus' || viewMode==='reading' ? ` ${focusWidthClass(focusWidth)}` : ''}`} style={{ width:pageW, minHeight:pageMinH, padding:MARGINS[doc.margins||'normal'] }}
            onPaste={handlePaste}
            onContextMenu={(e)=>{ if(Date.now()-longPressMenuRef.current < 1000 && ctxMenu){ e.preventDefault(); return } e.preventDefault(); openContextMenu(e.clientX, e.clientY) }}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={clearLongPress} onTouchCancel={clearLongPress}
          >
            <EditorContent editor={editor}/>
          </div>
        </div>
      </div>
    </div>
    </div>
    {viewMode==='edit' && <footer className="status-bar">
      <span className="status-save">{saveText}</span>
      <span>{words} {t('words')} · {chars} {t('chars')}</span>
      <span className="status-dir">{doc.dir==='rtl' ? 'RTL · دری/فارسی' : 'LTR · English'}</span>
      <div className="status-zoom"><span>{t('zoom')}</span><button type="button" className="status-btn" aria-label="Zoom out" onClick={()=>setZoom(z=>Math.max(50,z-10))}>−</button><input type="range" min={50} max={200} step={5} value={zoom} onChange={e=>setZoom(Number(e.target.value))} aria-label={t('zoom')}/><span>{zoom}%</span><button type="button" className="status-btn" aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(200,z+10))}>+</button></div>
    </footer>}
    {ctxMenu && <ContextMenu items={ctxMenu.items} x={ctxMenu.x} y={ctxMenu.y} lang={lang} onAction={runMenuAction} onClose={()=>setCtxMenu(null)} />}
    {altOpen && <div className="modal-backdrop" onClick={()=>setAltOpen(false)}><form className="modal" onClick={e=>e.stopPropagation()} onSubmit={e=>{ e.preventDefault(); applyImageAlt() }}><h2>{t('menuImageAlt')}</h2><label className="field">{t('imageAltPrompt')}<input autoFocus value={altText} dir="auto" onChange={e=>setAltText(e.target.value)} /></label><div className="row end"><button type="button" className="rbtn" onClick={()=>setAltOpen(false)}>{t('cancel')}</button><button type="submit" className="primary small">{t('save')}</button></div></form></div>}
    {imgPreview && <div className="modal-backdrop" onClick={()=>setImgPreview(null)}><div className="modal" onClick={e=>e.stopPropagation()}><h2>{t('imagePreview')}</h2><img src={imgPreview.src} alt="" style={{ maxWidth:'100%', height:'auto', borderRadius:8 }} /><p className="muted">{t('imageSizeKb')}: {imageSizeKb(imgPreview.size)}</p><div className="row end"><button type="button" className="rbtn" onClick={()=>setImgPreview(null)}>{t('cancel')}</button><button type="button" className="primary small" onClick={insertPreviewImage}>{t('imageInsert')}</button></div></div></div>}
    {imgEditOpen && <div className="modal-backdrop" onClick={()=>setImgEditOpen(false)}><form className="modal" onClick={e=>e.stopPropagation()} onSubmit={e=>{ e.preventDefault(); applyImageEdit() }}><h2>{t('imageEdit')}</h2><img src={imgSrc} alt="" style={{ maxWidth:'100%', height:'auto', borderRadius:8 }} /><label className="field">{t('imageWidth')}<select value={imgWidth} onChange={e=>setImgWidth(e.target.value)}>{IMAGE_WIDTH_PRESETS.map(p=><option key={p.value} value={p.value}>{p.value==='' ? t('imageWidthOriginal') : p.label}</option>)}</select></label><label className="field">{t('imageCaption')}<input value={imgCaption} dir="auto" onChange={e=>setImgCaption(e.target.value)} /></label><label className="field">{t('imageAltPrompt')}<input value={imgAlt} dir="auto" onChange={e=>setImgAlt(e.target.value)} /></label><div className="row wrap"><button type="button" className="rbtn" onClick={()=>replaceImgRef.current?.click()}>{t('imageReplace')}</button><button type="button" className="danger-btn" onClick={deleteImageEdit}>{t('delete')}</button></div><div className="row end"><button type="button" className="rbtn" onClick={()=>setImgEditOpen(false)}>{t('cancel')}</button><button type="submit" className="primary small">{t('save')}</button></div></form></div>}
    {toast && <div className="toast" role="alert">{toast}</div>}
    <input ref={fileImgRef} type="file" accept="image/*" hidden onChange={onImage}/>
    <input ref={replaceImgRef} type="file" accept="image/*" hidden onChange={onReplaceImage}/>
    <input ref={importRef} type="file" accept=".txt,.docx" hidden onChange={onImport}/>
  </div>
}
