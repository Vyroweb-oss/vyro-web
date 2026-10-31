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
import { Node, Extension, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { resolvePageSetup, usableHeightMm, cssPageSize, marginsPaddingCss, pageSizeLabel, toMm, fromMm, validateCustomSizeMm, validateMarginsMm, PAGE_SIZE_IDS, FOOTER_RESERVE_MM, type LengthUnit, type PageSizeId } from '../lib/pageSetup'
import { computePagination, type PageSegment } from '../lib/pagination'
import { PaginationExtension, getPaginationSpacers, setPaginationSpacers, type SpacerSpec } from './paginationPlugin'
import type { VyroDoc } from '../lib/types'
import { jsonToPlainText, escapeHtml, isSafeLinkUrl } from '../lib/docText'
import { formatDocDate } from '../lib/date'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import NavigationPane from './NavigationPane'
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog'
import { useDialogFocus } from './useDialogFocus'
import { restoreFocus } from '../lib/keyboard'
import StatsPanel from './StatsPanel'
import SaveDiagnosticsPanel from './SaveDiagnosticsPanel'
import ExportPresetsPanel from './ExportPresetsPanel'
import { initialSaveDiag, recordAttempt, recordSuccess, recordFailure, withBackup, saveBackup, loadBackup, type SaveDiagnostics, type SaveBackup } from '../lib/saveDiagnostics'
import LinkManagerPanel from './LinkManagerPanel'
import MailMergePanel from './MailMergePanel'
import ComparePanel from './ComparePanel'
import IntelligencePanel from './IntelligencePanel'
import { validateImageFile, imageSizeKb, IMAGE_WIDTH_PRESETS } from '../lib/images'
import FindReplacePanel from './FindReplacePanel'
import ContextMenu from './ContextMenu'
import { sanitizePastedHtml, htmlToPlainText, getContextMenuItems, type MenuItemId } from '../lib/paste'
import { createSnapshot, addVersion, loadVersions, saveVersions, restoreVersion, listVersions, hasSnapshotWorthyContent, type VersionSnapshot, type VersionTrigger } from '../lib/versions'
import { saveDraft, loadDraft, clearDraft, detectRecovery, acceptDraft, type RecoveryInfo } from '../lib/recovery'
import { FocusDim, createViewSnapshot, focusWidthClass, viewModeClass, type FocusWidth, type ViewMode, type ViewSnapshot } from '../lib/viewModes'
import { SectionCollapse } from '../lib/sections'
import { clampZoom, zoomStep, documentLanguageLabel, documentDirectionLabel, activeParagraphStyle } from '../lib/wordChrome'
import { computeDocumentStats } from '../lib/stats'
import { EDITOR_FONTS, EDITOR_FONT_SIZES, resolveAutosaveDelay, type VyroSettings } from '../lib/settings'
import { isTitleBarOverflowWidth } from '../lib/titleBar'
import { resolveTitleCommit } from '../lib/titleEdit'
import SettingsPanel from './SettingsPanel'
import { HorizontalRuler, VerticalRuler, RULER_SIZE } from './Rulers'

export interface EditorPaletteActions {
  insertTable: () => void
  insertDate: () => void
  exportTxt: () => void
  exportHtml: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  pastePlainText: () => void
  openNavigation: () => void
}

const PageBreak = Node.create({
  name:'pageBreak', group:'block', atom:true,
  parseHTML(){ return [{tag:'hr[data-page-break]'}] },
  renderHTML({HTMLAttributes}){ return ['hr', mergeAttributes(HTMLAttributes, {'data-page-break':'', class:'page-break'})] },
  // Pagination mission fix (found by interactive test, 2026-10-31): the
  // old insertContent left the atom NODE-SELECTED, so the very next
  // keystroke replaced (deleted) the break. The command now moves the
  // caret into the text block that follows the break — typing continues
  // on the new page and the break survives.
  addCommands(){ return { insertPageBreak: () => ({ state, dispatch }:any) => {
    const node = state.schema.nodes.pageBreak.create()
    const tr = state.tr.replaceSelectionWith(node)
    const atomStart = tr.selection.from
    const atomEnd = atomStart + node.nodeSize
    const next = tr.doc.resolve(atomEnd).nodeAfter
    if(next && next.isTextblock){
      tr.setSelection(TextSelection.create(tr.doc, atomEnd + 1))
    } else {
      tr.insert(atomEnd, state.schema.nodes.paragraph.create())
      tr.setSelection(TextSelection.create(tr.doc, atomEnd + 1))
    }
    if(dispatch) dispatch(tr.scrollIntoView())
    return true
  } } as any },
})

declare module '@tiptap/core' { interface Commands<ReturnType> { pageBreak: { insertPageBreak: () => ReturnType } } }

// Release mission: a REAL table-of-contents block. Unlike the old static
// HTML snapshot, this node stores its entries (from the document headings)
// and can be refreshed in place with the Update command — Word's TOC is a
// field, and this is the honest local equivalent. Entries are plain data
// in node attrs; rendering is derived, the block itself is not editable.
const TocBlock = Node.create({
  name: 'tocBlock', group: 'block', atom: true, selectable: true,
  addAttributes() {
    return {
      title: { default: 'Contents' },
      items: {
        default: [],
        parseHTML: (el: any) => { try { return JSON.parse(el.getAttribute('data-items') || '[]') } catch { return [] } },
        renderHTML: (attrs: any) => ({ 'data-items': JSON.stringify(attrs.items || []) }),
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-toc-block]' }] },
  renderHTML({ node }: any) {
    const items = (node.attrs.items || []) as { level: number; text: string }[]
    return ['div', { 'data-toc-block': '', class: 'toc-block' },
      ['p', { class: 'toc-block-title' }, String(node.attrs.title || 'Contents')],
      ...items.map((i) => ['p', { class: 'toc-block-item', style: `margin-left:${(Math.max(1, i.level) - 1) * 18}px` }, i.text || ''])]
  },
  addCommands() {
    return {
      insertTocBlock: () => ({ state, dispatch, editor }: any) => {
        const items: { level: number; text: string }[] = []
        state.doc.descendants((n: any) => { if (n.type.name === 'heading') items.push({ level: n.attrs.level, text: n.textContent }) })
        if (!items.length) return false
        const node = state.schema.nodes.tocBlock.create({ title: (editor as any)?.storage?.vyroTocTitle || 'Contents', items })
        if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView())
        return true
      },
      updateTocBlocks: () => ({ state, dispatch }: any) => {
        const items: { level: number; text: string }[] = []
        state.doc.descendants((n: any) => { if (n.type.name === 'heading') items.push({ level: n.attrs.level, text: n.textContent }) })
        const found: { pos: number; node: any }[] = []
        state.doc.descendants((n: any, pos: number) => { if (n.type.name === 'tocBlock') found.push({ pos, node: n }) })
        if (!found.length) return false
        let tr = state.tr
        // Replace from the end backwards so earlier positions stay valid.
        for (let i = found.length - 1; i >= 0; i--) {
          const fresh = state.schema.nodes.tocBlock.create({ title: found[i].node.attrs.title, items })
          tr = tr.replaceWith(found[i].pos, found[i].pos + found[i].node.nodeSize, fresh)
        }
        if (dispatch) dispatch(tr)
        return true
      },
    } as any
  },
})

declare module '@tiptap/core' { interface Commands<ReturnType> { tocBlock: { insertTocBlock: () => ReturnType; updateTocBlocks: () => ReturnType } } }

// Pagination mission: Ctrl/Cmd+Enter inserts a manual page break, as in Word.
const PageBreakShortcut = Extension.create({
  name: 'pageBreakShortcut',
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.chain().focus().insertPageBreak().run() }
  },
})

/** Vertical whitespace between two sheets on screen, in CSS pixels. */
const PAGE_GAP_PX = 24
const MM_PX = 96 / 25.4
// M2-08: the font/size lists live in lib/settings.ts so the Settings panel
// and the editor can never offer different fonts.
const FONT_FAMILIES = EDITOR_FONTS
const FONT_SIZES = EDITOR_FONT_SIZES
const LINE_HEIGHTS = ['1','1.15','1.5','2']
const TABS: { id:string; key:I18nKey }[] = [
  { id:'File', key:'tabFile' }, { id:'Home', key:'tabHome' }, { id:'Insert', key:'tabInsert' },
  { id:'Layout', key:'tabLayout' }, { id:'References', key:'tabReferences' }, { id:'Mailings', key:'tabMailings' }, { id:'Review', key:'tabReview' }, { id:'View', key:'tabView' },
]

export default function Editor({ doc, onChange, onBack, isPremium, onRequirePremium, theme, onToggleTheme, lang, onLangChange, saveFailed, onPaletteOpen, onEditorActions, writingWidth, toolbarMode, autosaveEnabled, autosaveIntervalMs, freshDefaults, settings, onSettingsChange, onSettingsReset, isLocal, onCreateMergedDocs, onNewDoc, onOpenDoc, onMakeCopy, docsList, accountLabel }:{ doc:VyroDoc; onChange:(patch:Partial<VyroDoc>, content?:any)=>void; onBack:()=>void; isPremium:boolean; onRequirePremium:()=>void; theme:string; onToggleTheme:()=>void; lang:UiLang; onLangChange?:(l:UiLang)=>void; saveFailed?:boolean; onPaletteOpen?:()=>void; onEditorActions?:(a:EditorPaletteActions|null)=>void; writingWidth?: VyroSettings['writingWidth']; toolbarMode?: VyroSettings['toolbar']; autosaveEnabled?: boolean; autosaveIntervalMs?: number; freshDefaults?: { id:string; font:string; size:number }; settings?: VyroSettings; onSettingsChange?: (patch: Partial<VyroSettings>)=>void; onSettingsReset?: ()=>void; isLocal?: boolean; onCreateMergedDocs?: (items:{title:string;content:any}[])=>void; onNewDoc?: ()=>void; onOpenDoc?: (id:string)=>void; onMakeCopy?: (id:string)=>void; docsList?: { id:string; title:string; updatedAt:string }[]; accountLabel?: string }){
  const t=(k:I18nKey)=>tr(lang,k)
  const [tab,setTab]=useState('Home')
  const [zoom,setZoom]=useState(100)
  const [savedAt,setSavedAt]=useState<string>('')
  const [saveState,setSaveState]=useState<'saved'|'saving'|'pending'|'failed'>('saved')
  // M2-13 autosave diagnostics: the record only ever claims 'saved'
  // after the confirmation effect below observes the parent's write.
  const [diag,setDiag]=useState<SaveDiagnostics>(()=>initialSaveDiag())
  const [backup,setBackup]=useState<SaveBackup|null>(()=> typeof window!=='undefined' ? loadBackup(localStorage) : null)
  const [saveDiagOpen,setSaveDiagOpen]=useState(false)
  // M2-14 export presets: panel state only; all export work goes through
  // the callbacks below (download / print), never from the panel. Print is
  // FREE for everyone (owner policy, 2026-10-31); only DOCX export is gated.
  const [exportPresetsOpen,setExportPresetsOpen]=useState(false)
  const [spell,setSpell]=useState(true)
  const [toast,setToast]=useState('')
  const [linkOpen,setLinkOpen]=useState(false)
  const [linkUrl,setLinkUrl]=useState('')
  const [linkText,setLinkText]=useState('')
  const [linkTextShown,setLinkTextShown]=useState(false)
  const [linksOpen,setLinksOpen]=useState(false)
  // PC2 Mailings: local CSV mail-merge panel (session-only; CSV never stored).
  const [mailMergeOpen,setMailMergeOpen]=useState(false)
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
  const viewModeRef=useRef(viewMode); viewModeRef.current=viewMode
  // PC3 page rulers: session-only toggle, default ON; shown only in edit
  // mode (never focus/reading, never print — see the print CSS).
  const [showRuler,setShowRuler]=useState(true)
  // M2-08: the settings writing width is the initial focus/reading width,
  // and a later settings change re-applies it (the in-mode width select
  // remains a session override until settings change again).
  const [focusWidth,setFocusWidth]=useState<FocusWidth>((writingWidth ?? 'normal') as FocusWidth)
  useEffect(()=>{ if(writingWidth) setFocusWidth(writingWidth as FocusWidth) },[writingWidth])
  // PC5: on narrow screens the ribbon tab strip scrolls horizontally —
  // keep the active tab in view when it changes (no-op when all tabs fit).
  useEffect(()=>{ const el=document.querySelector('.ribbon-tabs .tab.active'); if(el && typeof el.scrollIntoView==='function') el.scrollIntoView({block:'nearest',inline:'center'}) },[tab])
  const compactToolbar = toolbarMode==='compact'
  // M2-08 autosave settings, read through a ref so the debounced onUpdate
  // (bound once per document) always sees the current values.
  const autosaveRef=useRef({ autosaveEnabled: autosaveEnabled ?? true, autosaveIntervalMs: autosaveIntervalMs ?? 500 })
  autosaveRef.current = { autosaveEnabled: autosaveEnabled ?? true, autosaveIntervalMs: autosaveIntervalMs ?? 500 }
  const viewSnapshotRef=useRef<ViewSnapshot|null>(null)
  const restoreRef=useRef<ViewSnapshot|null>(null)
  const [toolsOpen,setToolsOpen]=useState(false)
  // PC1 title-bar overflow: session-only; Esc / outside-click closes it.
  const [overflowOpen,setOverflowOpen]=useState(false)
  const [settingsOpen,setSettingsOpen]=useState(false)
  // PC1 title-bar width: the lib (titleBar.ts) decides narrow vs wide
  // (width < 720); the CSS media queries (now aligned at 719/720px) stay
  // as a fallback. Non-browser initial state collapses (narrow-safe).
  const [isNarrow,setIsNarrow]=useState(()=> typeof window!=='undefined' ? isTitleBarOverflowWidth(window.innerWidth) : true)
  useEffect(()=>{
    if(typeof window==='undefined' || typeof window.matchMedia!=='function') return
    const mq=window.matchMedia('(max-width: 719px)')
    const update=()=>{ const narrow=isTitleBarOverflowWidth(window.innerWidth); setIsNarrow(narrow); if(!narrow) setOverflowOpen(false) }
    update()
    if(typeof mq.addEventListener==='function') mq.addEventListener('change', update)
    else (mq as any).addListener(update)
    return ()=>{ if(typeof mq.removeEventListener==='function') mq.removeEventListener('change', update); else (mq as any).removeListener(update) }
  },[])
  const settingsAvailable = !!(settings && onSettingsChange && onSettingsReset)
  const overflowRef=useRef<HTMLDivElement>(null)
  const overflowBtnRef=useRef<HTMLButtonElement>(null)
  useEffect(()=>{ if(!overflowOpen) return
    const onDown=(e:MouseEvent)=>{ if(overflowRef.current && e.target instanceof globalThis.Node && !overflowRef.current.contains(e.target)) setOverflowOpen(false) }
    // M2-15 focus return: Esc closes the menu AND returns focus to the
    // ⋯ button; outside-click close deliberately does NOT steal focus.
    const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape'){ setOverflowOpen(false); restoreFocus(overflowBtnRef.current) } }
    document.addEventListener('mousedown',onDown); document.addEventListener('keydown',onKey)
    return ()=>{ document.removeEventListener('mousedown',onDown); document.removeEventListener('keydown',onKey) }
  },[overflowOpen])
  // TITLE BAR REDESIGN (owner mission, 2026-10-31): the File menu in the
  // title bar — same close discipline as the ⋯ menu (outside mousedown
  // closes silently; Escape closes and returns focus to the opener).
  const [fileOpen,setFileOpen]=useState(false)
  const [openListOpen,setOpenListOpen]=useState(false)
  const fileRef=useRef<HTMLDivElement>(null)
  const fileBtnRef=useRef<HTMLButtonElement>(null)
  useEffect(()=>{ if(!fileOpen) return
    const onDown=(e:MouseEvent)=>{ if(fileRef.current && e.target instanceof globalThis.Node && !fileRef.current.contains(e.target)){ setFileOpen(false); setOpenListOpen(false) } }
    const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape'){ setFileOpen(false); setOpenListOpen(false); restoreFocus(fileBtnRef.current) } }
    document.addEventListener('mousedown',onDown); document.addEventListener('keydown',onKey)
    return ()=>{ document.removeEventListener('mousedown',onDown); document.removeEventListener('keydown',onKey) }
  },[fileOpen])
  // Rename semantics (spec §5): while the title input is being edited it
  // holds a LOCAL draft — nothing is saved per keystroke. Enter/blur
  // commits through resolveTitleCommit (empty/unchanged drafts revert);
  // Escape discards the draft, so the previous title always survives a
  // cancelled or invalid rename.
  const [titleDraft,setTitleDraft]=useState<string|null>(null)
  const titleDraftRef=useRef<string|null>(null)
  const titleInputRef=useRef<HTMLInputElement>(null)
  // The draft is mirrored in a ref: Escape clears the draft and blurs in
  // the same tick, and the blur handler must see the CLEARED draft, not
  // the stale state value — otherwise a cancelled rename would commit.
  const setDraft=(v:string|null)=>{ titleDraftRef.current=v; setTitleDraft(v) }
  useEffect(()=>{ setDraft(null) },[doc.id])
  const commitTitle=()=>{ const d=titleDraftRef.current; if(d==null) return; const r=resolveTitleCommit(doc.title, d); setDraft(null); if(r.changed) onChange({ title: r.title }) }
  // M2-06 contextual menu + image alt-text dialog (transient UI only).
  const [ctxMenu,setCtxMenu]=useState<{ items:MenuItemId[]; x:number; y:number; linkHref:string|null }|null>(null)
  const [altOpen,setAltOpen]=useState(false)
  const [altText,setAltText]=useState('')
  const [shortcutsOpen,setShortcutsOpen]=useState(false)
  // M2-15 dialog focus: the opener is captured synchronously in the open
  // handler (before any autoFocus input can steal it); the dialog refs
  // anchor the Tab trap. Find & Replace gets its own opener ref because
  // it is a panel, not a dialog (see FindReplacePanel's `opener` prop).
  const dialogOpenerRef=useRef<Element|null>(null)
  const findOpenerRef=useRef<Element|null>(null)
  const versionsOpenerRef=useRef<Element|null>(null)
  const versionsWasOpenRef=useRef(false)
  const linkDialogRef=useRef<HTMLDivElement>(null)
  const altDialogRef=useRef<HTMLFormElement>(null)
  const imgPreviewDialogRef=useRef<HTMLDivElement>(null)
  const imgEditDialogRef=useRef<HTMLFormElement>(null)
  const longPressRef=useRef<{ timer:any; x:number; y:number; moved:boolean }|null>(null)
  const longPressMenuRef=useRef(0)
  const saveTimer=useRef<any>(null)
  const pendingJson=useRef<any>(null)
  // M2-13 confirmation bookkeeping: awaitingRef is set when a flush
  // hands JSON to onChange and cleared only by the confirmation effect
  // (success or failure) — never by the flush itself. failureHandledFor
  // keys the auto-backup + failure record to one write (one updatedAt),
  // so a persisting saveFailed flag cannot record the same failure twice.
  const awaitingRef=useRef(false)
  const lastSeenUpdatedAtRef=useRef(doc.updatedAt)
  const failureHandledForRef=useRef<string|null>(null)
  // M2-13 flash guard: latest saveFailed value, read by the deferred
  // confirmation timer (the prop captured in the effect may predate the
  // parent's storage effect for this write).
  const saveFailedRef=useRef(!!saveFailed); saveFailedRef.current=!!saveFailed
  const confirmTimerRef=useRef<any>(null)
  const onChangeRef=useRef(onChange); onChangeRef.current=onChange
  const docRef=useRef(doc); docRef.current=doc
  // M2-04 version history + crash recovery (own storage keys; docs store untouched).
  const [versionsOpen,setVersionsOpen]=useState(false)
  // M2-09 document compare panel (reads editor JSON + versions only).
  const [compareOpen,setCompareOpen]=useState(false)
  // M2-10 Vyro Intelligence panel (architecture + UI only; never mutates the doc).
  const [intelligenceOpen,setIntelligenceOpen]=useState(false)
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

  // M2-15: editor dialogs — Tab trapped inside, Esc closes (inputs with
  // their own Esc handlers close idempotently), focus returns to the
  // opener captured in the open handlers. Link/alt keep their autoFocus
  // inputs, so autofocus stays off there; image-preview focuses Insert
  // (the last button) so Enter confirms instead of cancelling.
  useDialogFocus(linkOpen, { containerRef: linkDialogRef, onClose: ()=>setLinkOpen(false), autofocus: false, trap: true, opener: dialogOpenerRef.current })
  useDialogFocus(altOpen, { containerRef: altDialogRef, onClose: ()=>setAltOpen(false), autofocus: false, trap: true, opener: dialogOpenerRef.current })
  useDialogFocus(imgPreview!==null, { containerRef: imgPreviewDialogRef, onClose: ()=>setImgPreview(null), autofocusLast: true, trap: true, opener: dialogOpenerRef.current })
  useDialogFocus(imgEditOpen, { containerRef: imgEditDialogRef, onClose: ()=>setImgEditOpen(false), autofocus: true, trap: true, opener: dialogOpenerRef.current })
  // M2-15: versions region panel — no autoFocus inside, so the opener is
  // simply the focused toggle button at open time; Esc is on the panel
  // root below, focus return here.
  useEffect(()=>{ if(versionsOpen && !versionsWasOpenRef.current) versionsOpenerRef.current=document.activeElement; if(!versionsOpen && versionsWasOpenRef.current) restoreFocus(versionsOpenerRef.current); versionsWasOpenRef.current=versionsOpen },[versionsOpen])

  // M2-13: a flush HANDS OFF to the parent and marks the status
  // 'saving' with an awaiting confirmation — it must NOT claim 'saved'
  // or set savedAt here, because the parent has not written yet. The
  // confirmation effect (below, after the editor exists) flips the
  // status only once the document's updatedAt moved with no failure
  // reported, or to 'failed' when the parent reports a failed write.
  // pendingJson stays cleared on failure: the M2-04 draft already holds
  // the unsaved JSON, so nothing is lost by not re-queueing it.
  const flushSave=()=>{ if(saveTimer.current){ clearTimeout(saveTimer.current); saveTimer.current=null } if(pendingJson.current){ const j=pendingJson.current; pendingJson.current=null; onChangeRef.current({}, j); awaitingRef.current=true; setSaveState('saving'); setDiag(prev=>recordAttempt(prev, new Date().toISOString())) } }
  const flushRef=useRef(flushSave); flushRef.current=flushSave
  // Flush any debounced edit before the editor unmounts (doc switch / back) so the last keystrokes are never lost.
  useEffect(()=>()=>{ flushRef.current() },[])
  const goBack=()=>{ flushSave(); onBack() }
  // Warn before leaving the page ONLY while work is not safely stored: a debounced
  // save is still pending ('saving' state / pending JSON), or the last write to
  // browser storage failed (saveFailed from the parent). Never warn when all saved.
  const unsavedRef=useRef(false)
  unsavedRef.current = saveState==='saving' || saveState==='pending' || saveState==='failed' || pendingJson.current!=null || !!saveFailed
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
    const info = detectRecovery({ id: doc.id, title: doc.title, content: doc.content, updatedAt: doc.updatedAt }, d)
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
      CharacterCount, PageBreak, PageBreakShortcut, PaginationExtension, FocusDim, SectionCollapse, TocBlock,
    ],
    content: doc.content,
    editorProps:{ attributes:{ dir: doc.dir, spellcheck: String(spell) } as any },
    onUpdate({editor}){
      pendingJson.current=editor.getJSON()
      // M2-04: draft snapshot of the pending JSON (separate key, best-effort).
      // Cleared explicitly on accept/discard, and silently on reopen when it
      // turns out identical to the saved doc — never auto-applied.
      try { saveDraft(localStorage, { docId: docRef.current.id, content: editor.getJSON(), title: docRef.current.title, savedAt: new Date().toISOString() }) } catch { /* draft is best-effort */ }
      if(saveTimer.current) clearTimeout(saveTimer.current)
      // M2-08: no timer when autosave is off — pending edits flush only on
      // Save now / leaving the document (see resolveAutosaveDelay).
      const delay = resolveAutosaveDelay(autosaveRef.current as VyroSettings)
      // M2-13: with autosave off there is no timer coming, so the status
      // is 'pending' (unsaved changes) — never a 'saving' that never
      // resolves, and never 'saved' before any write happens.
      setSaveState(delay!=null ? 'saving' : 'pending')
      if(delay!=null) saveTimer.current=setTimeout(()=>{ saveTimer.current=null; if(pendingJson.current){ const j=pendingJson.current; pendingJson.current=null; onChangeRef.current({}, j); awaitingRef.current=true; setSaveState('saving'); setDiag(prev=>recordAttempt(prev, new Date().toISOString())) } }, delay)
    },
  },[doc.id])

  useEffect(()=>{ if(editor){ editor.view.dom.setAttribute('spellcheck', String(spell)); editor.view.dom.setAttribute('dir', doc.dir) } },[spell, doc.dir, editor])

  // M2-08: a freshly created document carries the user's default font/size
  // as stored marks, so the first keystroke in a blank document is typed in
  // the default font/size (template text already carries them via
  // applyNewDocDefaults). Stored marks change no document content.
  useEffect(()=>{ if(!editor || !freshDefaults) return; try{ editor.chain().focus().setFontFamily(freshDefaults.font).setFontSize(freshDefaults.size+'px').run() }catch{ /* defaults are best-effort */ } },[editor, freshDefaults])

  // M2-13: fresh diagnostics per opened document. The failure guard is
  // pre-seeded with this document's current updatedAt so a saveFailed
  // flag left over from another document is not misattributed to this
  // one; only writes observed while this document is open are recorded.
  useEffect(()=>{
    awaitingRef.current=false
    failureHandledForRef.current=doc.updatedAt
    lastSeenUpdatedAtRef.current=doc.updatedAt
    let b: SaveBackup|null=null
    try { b = typeof window!=='undefined' ? loadBackup(localStorage) : null } catch { b=null }
    setBackup(b)
    setDiag(withBackup(initialSaveDiag(), b && b.docId===doc.id ? b : null))
    setSaveState('saved')
    setSavedAt('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[doc.id])

  // M2-13: the save-confirmation loop. 'Saved' is flipped on ONLY here,
  // and only when an awaited hand-off is followed by a new updatedAt
  // with no failure reported for it. Parent fix (flash guard): child
  // effects run BEFORE the parent's storage effect in the same commit,
  // so confirming synchronously would flash 'Saved' for one render on
  // a failing write before the parent's saveFailed flag lands. The
  // success confirmation is therefore deferred to a macrotask: the
  // parent's effect + state update always run before the timer fires,
  // so by confirmation time saveFailedRef reflects this write's real
  // outcome; a failure cancels the pending confirmation via
  // awaitingRef=false in the failure branch. The failure kind is
  // 'unknown' here because the parent reports only a boolean — the
  // lib's classifyError is ready for an error object if App ever passes
  // one through, but that would require touching App.tsx.
  useEffect(()=>{
    // Shared failure handling (auto-backup + diagnostics + 'failed').
    const applyFailure=(forUpdatedAt:string)=>{
      failureHandledForRef.current=forUpdatedAt
      lastSeenUpdatedAtRef.current=forUpdatedAt
      awaitingRef.current=false
      if(confirmTimerRef.current){ clearTimeout(confirmTimerRef.current); confirmTimerRef.current=null }
      const now=new Date().toISOString()
      let snap: SaveBackup|null=null
      try {
        const candidate={ docId: docRef.current.id, title: docRef.current.title, content: editor.getJSON(), savedAt: now }
        if(saveBackup(localStorage, candidate)) snap=candidate
      } catch { /* auto-backup is best-effort */ }
      if(snap) setBackup(snap)
      setDiag(prev=>{ const next=recordFailure(prev, 'unknown', now); return snap ? withBackup(next, snap) : next })
      setSaveState('failed')
    }
    // Retry race (title-bar redesign, 2026-10-31): while a write is in
    // flight (awaiting), a still-raised saveFailed flag belongs to the
    // PREVIOUS write — the parent clears it only after this write's
    // storage effect runs. Judging the in-flight write here would
    // misclassify a successful retry as a new failure and stick the
    // status on 'failed' forever; the confirm timer below is its judge.
    if(saveFailed && !awaitingRef.current && failureHandledForRef.current!==doc.updatedAt){
      applyFailure(doc.updatedAt)
      return
    }
    if(awaitingRef.current && doc.updatedAt!==lastSeenUpdatedAtRef.current){
      // Deferred: only confirm once the parent's storage effect for this
      // write has had a chance to report failure (see flash-guard note).
      if(confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      const seenUpdatedAt=doc.updatedAt
      confirmTimerRef.current=setTimeout(()=>{
        confirmTimerRef.current=null
        if(!awaitingRef.current) return
        // By now the parent's storage effect has reported this write's
        // real outcome: a raised flag means THIS write failed — run the
        // failure handling here, since the synchronous branch above
        // deliberately does not judge in-flight writes.
        if(saveFailedRef.current){ if(failureHandledForRef.current!==seenUpdatedAt) applyFailure(seenUpdatedAt); return }
        awaitingRef.current=false
        lastSeenUpdatedAtRef.current=seenUpdatedAt
        setSavedAt(new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))
        setSaveState('saved')
        setDiag(prev=>recordSuccess(prev, new Date().toISOString()))
      }, 0)
      return
    }
    lastSeenUpdatedAtRef.current=doc.updatedAt
  },[doc.updatedAt, saveFailed])

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

  // Page scaling: the sheet keeps its true layout size; a wrapper with
  // compensated dimensions scales it (fit-to-width on narrow screens × user
  // zoom) so zooming never breaks the surrounding layout or scrolls the app.
  // Pagination mission: the size comes from the document's page setup
  // (A3/A4/A5/Letter/Legal/Tabloid/Custom) instead of hardcoded A4.
  const setup = resolvePageSetup(doc)
  const pageMmW = setup.widthMm
  const pageMmH = setup.heightMm
  const [fitScale,setFitScale]=useState(1)
  const [pagePxH,setPagePxH]=useState(()=>Math.round(pageMmH*MM_PX))
  useEffect(()=>{ const ws=workspaceRef.current; if(!ws) return; const upd=()=>{ const avail=Math.max(160, ws.clientWidth-20); setFitScale(Math.min(1, avail/(pageMmW*MM_PX))) }; upd(); const ro=new ResizeObserver(upd); ro.observe(ws); return ()=>ro.disconnect() },[pageMmW])
  useEffect(()=>{ const el=pageRef.current; if(!el) return; const upd=()=>setPagePxH(el.offsetHeight); upd(); const ro=new ResizeObserver(upd); ro.observe(el); return ()=>ro.disconnect() },[editor, setup.widthMm, setup.heightMm, setup.margins.top, setup.margins.bottom])
  const effScale=Math.max(0.1, fitScale*(zoom/100))
  const effScaleRef=useRef(1); effScaleRef.current=effScale

  // ---- Pagination (mission 2026-10-31): measured sheets over ONE editor --
  // The document is never split; spacers (decorations) push each page's
  // first block to the top of its sheet. Measurement reads rendered block
  // geometry, subtracts the spacers already in place, runs the pure
  // engine, and writes back only real changes (no render loops).
  const [pageCount,setPageCount]=useState(1)
  const pageHPx = setup.heightMm * MM_PX
  useEffect(()=>{
    if(!editor) return
    let raf=0; let timer: ReturnType<typeof setTimeout> | undefined
    let disposed=false
    const measure=()=>{
      if(disposed) return
      if(viewMode!=='edit'){ setPaginationSpacers(editor, []); setPageCount(p=>p===1?p:1); return }
      const dom=editor.view.dom as HTMLElement
      const scale=effScaleRef.current || 1
      const domRect=dom.getBoundingClientRect()
      const kids=(Array.from(dom.children) as HTMLElement[]).filter(el=>!el.classList.contains('page-gap-spacer'))
      const blocks:{pos:number;type:string}[]=[]
      // The spacer position is the block's OWN doc position (before the
      // node), so the widget renders BETWEEN blocks as a direct child of
      // the editor DOM. offset+1 would land INSIDE the paragraph — the
      // spacer then inflates that paragraph's measured height and the
      // pagination feeds back on itself (found by live verification,
      // 2026-10-31: break text stayed on the old sheet, counts drifted).
      editor.state.doc.forEach((node, offset)=>{ blocks.push({ pos: offset, type: node.type.name }) })
      if(kids.length!==blocks.length || blocks.length===0) return
      const old=getPaginationSpacers(editor)
      const oldBefore=(pos:number)=>old.filter(s=>s.pos<=pos).reduce((a,s)=>a+s.height,0)
      const tops:number[]=[]; const heights:number[]=[]
      kids.forEach((el,i)=>{ const r=el.getBoundingClientRect(); tops.push((r.top-domRect.top)/scale - oldBefore(blocks[i].pos)); heights.push(r.height/scale) })
      const segs: PageSegment[]=blocks.map((_b,i)=>({
        height: i<blocks.length-1 ? Math.max(0, tops[i+1]-tops[i]) : heights[i],
        breakBefore: i>0 && blocks[i-1].type==='pageBreak',
      }))
      if(blocks[blocks.length-1].type==='pageBreak') segs.push({ height:0, breakBefore:true })
      const res=computePagination(segs, usableHeightMm(setup)*MM_PX)
      const spacers: SpacerSpec[]=[]
      let acc=0
      for(const st of res.starts){
        if(st.index>=blocks.length) break
        const target=st.page*(pageHPx+PAGE_GAP_PX)
        const h=target-(tops[st.index]+acc)
        if(h>0.5){ spacers.push({ pos: blocks[st.index].pos, height: h }); acc+=h }
      }
      setPaginationSpacers(editor, spacers)
      setPageCount(p=>p===res.pageCount?p:res.pageCount)
    }
    const schedule=()=>{ cancelAnimationFrame(raf); raf=requestAnimationFrame(()=>{ if(timer) clearTimeout(timer); timer=setTimeout(measure, 60) }) }
    editor.on('update', schedule)
    schedule()
    if(typeof document!=='undefined' && document.fonts?.ready) document.fonts.ready.then(()=>schedule()).catch(()=>{})
    return ()=>{ disposed=true; editor.off('update', schedule); cancelAnimationFrame(raf); if(timer) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[editor, viewMode, doc.id, setup.sizeId, setup.widthMm, setup.heightMm, setup.margins.top, setup.margins.bottom, setup.margins.left, setup.margins.right])

  // Print fidelity: the printer gets the document's real paper size and
  // margins via a dynamic @page rule (the static A4 rules were removed).
  // The bottom margin carries the same 12mm page-number reserve the
  // on-screen pagination subtracts, so screen and print page counts agree.
  useEffect(()=>{
    const el=document.createElement('style')
    el.setAttribute('data-vyro-print','')
    const cssStr=(v:string)=>'"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\n\r]+/g,' ')+'"'
    const hf='font-size:10pt;font-family:Arial,sans-serif;color:#666'
    const boxes=[ doc.footerText ? `@bottom-center{content:${cssStr(doc.footerText)};${hf}}@bottom-right{content:counter(page);${hf}}` : `@bottom-center{content:counter(page);${hf}}`, ...(doc.headerText ? [`@top-center{content:${cssStr(doc.headerText)};${hf}}`] : []) ].join('')
    el.textContent=`@page{size:${cssPageSize(setup)};margin:${setup.margins.top}mm ${setup.margins.right}mm ${setup.margins.bottom + FOOTER_RESERVE_MM}mm ${setup.margins.left}mm;${boxes}}`
    document.head.appendChild(el)
    return ()=>{ el.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[setup.widthMm, setup.heightMm, setup.margins.top, setup.margins.right, setup.margins.bottom, setup.margins.left, doc.headerText, doc.footerText])

  // Page-setup dialog (custom size / custom margins).
  const [setupDialog,setSetupDialog]=useState<null|'size'|'margins'>(null)
  const setupDialogRef=useRef<HTMLFormElement>(null)
  useDialogFocus(setupDialog!==null, { containerRef: setupDialogRef, onClose: ()=>setSetupDialog(null), autofocus: false, trap: true, opener: dialogOpenerRef.current })
  const [psUnit,setPsUnit]=useState<LengthUnit>('mm')
  const [psW,setPsW]=useState(''); const [psH,setPsH]=useState('')
  const [pmT,setPmT]=useState(''); const [pmR,setPmR]=useState(''); const [pmB,setPmB]=useState(''); const [pmL,setPmL]=useState('')
  const [psError,setPsError]=useState('')
  // Release mission: header & footer dialog (per-document repeated text).
  const [hfOpen,setHfOpen]=useState(false)
  const [hfDraft,setHfDraft]=useState({header:'',footer:''})
  const hfDialogRef=useRef<HTMLFormElement>(null)
  useDialogFocus(hfOpen, { containerRef: hfDialogRef, onClose: ()=>setHfOpen(false), autofocus: true, trap: true, opener: dialogOpenerRef.current })
  const openHfDialog=()=>{ dialogOpenerRef.current=document.activeElement; setHfDraft({ header: docRef.current.headerText||'', footer: docRef.current.footerText||'' }); setHfOpen(true) }
  const applyHfDialog=()=>{ onChange({ headerText: hfDraft.header.trim() || undefined, footerText: hfDraft.footer.trim() || undefined } as any); setHfOpen(false) }
  const openSetupDialog=(mode:'size'|'margins')=>{
    setPsError('')
    if(mode==='size'){
      const base = doc.orientation==='landscape' ? { w: setup.heightMm, h: setup.widthMm } : { w: setup.widthMm, h: setup.heightMm }
      setPsW(String(fromMm(base.w, psUnit))); setPsH(String(fromMm(base.h, psUnit)))
    } else {
      setPmT(String(fromMm(setup.margins.top, psUnit))); setPmR(String(fromMm(setup.margins.right, psUnit)))
      setPmB(String(fromMm(setup.margins.bottom, psUnit))); setPmL(String(fromMm(setup.margins.left, psUnit)))
    }
    setSetupDialog(mode)
  }
  const changePsUnit=(u:LengthUnit)=>{
    if(u===psUnit) return
    const conv=(v:string)=>{ const n=parseFloat(v); return Number.isFinite(n) ? String(fromMm(toMm(n, psUnit), u)) : v }
    setPsW(conv(psW)); setPsH(conv(psH)); setPmT(conv(pmT)); setPmR(conv(pmR)); setPmB(conv(pmB)); setPmL(conv(pmL))
    setPsUnit(u)
  }
  const applySetupDialog=()=>{
    if(setupDialog==='size'){
      const wMm=toMm(parseFloat(psW), psUnit); const hMm=toMm(parseFloat(psH), psUnit)
      if(validateCustomSizeMm(wMm, hMm)){ setPsError(t('pageSetupRangeError')); return }
      onChange({ pageSize:'Custom', pageW: Math.round(wMm*10)/10, pageH: Math.round(hMm*10)/10 })
    } else if(setupDialog==='margins'){
      const m={ top: toMm(parseFloat(pmT), psUnit), right: toMm(parseFloat(pmR), psUnit), bottom: toMm(parseFloat(pmB), psUnit), left: toMm(parseFloat(pmL), psUnit) }
      const err=validateMarginsMm(m, setup.widthMm, setup.heightMm)
      if(err){ setPsError(t(err==='range' ? 'pageSetupRangeError' : 'pageSetupUsableError')); return }
      const rounded={ top: Math.round(m.top*10)/10, right: Math.round(m.right*10)/10, bottom: Math.round(m.bottom*10)/10, left: Math.round(m.left*10)/10 }
      onChange({ margins:'custom', customMargins: rounded })
    }
    setSetupDialog(null)
  }

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
      zoomIn: ()=>setZoom(z=>zoomStep(z,10)),
      zoomOut: ()=>setZoom(z=>zoomStep(z,-10)),
      zoomReset: ()=>setZoom(100),
      pastePlainText: ()=>{ void pastePlainText() },
      openNavigation: ()=>{ if(viewModeRef.current!=='edit') exitMode(); setNavOpen(true) },
    })
    return ()=>onEditorActions(null)
    // doc.title/dir are deps on purpose: export filenames and the inserted
    // date follow the document's current title/direction, not its mount-time ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[editor, doc.title, doc.dir])

  // ---- M2-04 version history + crash recovery helpers ----
  const triggerLabel=(trg:VersionTrigger)=> t(({
    manual:'versionTriggerManual', auto:'versionTriggerAuto', 'before-replace':'versionTriggerBeforeReplace',
    'before-risky':'versionTriggerBeforeRisky', 'pre-restore':'versionTriggerPreRestore', recovery:'versionTriggerRecovery', 'before-import':'versionTriggerBeforeImport',
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
  const statusStats = computeDocumentStats(editor.getJSON())
  const chars = (editor.storage as any).characterCount?.characters?.() ?? editor.getText().length

  const gated=(fn:()=>void)=> isPremium? fn() : onRequirePremium()
  const download=(name:string, text:string, type:string)=>{ const b=new Blob([text],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000) }
  // M2-13 diagnostics actions: retry re-flushes the editor's current
  // JSON through the same confirmation loop; backup creation is local
  // only; backup download is a local file download, never an upload.
  const retrySave=()=>{ if(!editor) return; pendingJson.current=editor.getJSON(); flushSave() }
  // Ctrl/Cmd+S (spec §4): save now, never the browser's Save dialog.
  // TipTap does not bind this chord, so there is no editor conflict; the
  // handler only captures the pending JSON and flushes the normal save.
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{ if((e.ctrlKey||e.metaKey) && !e.altKey && (e.key==='s' || e.key==='S')){ e.preventDefault(); if(editor){ pendingJson.current=editor.getJSON() } flushRef.current() } }
    window.addEventListener('keydown', h)
    return ()=>window.removeEventListener('keydown', h)
  },[editor])
  const createBackupNow=()=>{ if(!editor) return; const now=new Date().toISOString(); const snap={ docId: docRef.current.id, title: docRef.current.title, content: editor.getJSON(), savedAt: now }; if(saveBackup(localStorage, snap)){ setBackup(snap); setDiag(prev=>withBackup(prev, snap)); setToast(t('saveBackupSaved')) } else setToast(t('saveFailedStatus')) }
  const downloadBackup=()=>{ if(!backup || backup.docId!==docRef.current.id) return; download(`${docRef.current.title}-backup.json`, JSON.stringify(backup, null, 2), 'application/json') }
  const exportTxt=()=> download(`${doc.title}.txt`, jsonToPlainText(editor.getJSON()), 'text/plain')
  const exportHtml=()=> download(`${doc.title}.html`, `<!doctype html><html dir="${doc.dir}"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title></head><body>${editor.getHTML()}</body></html>`, 'text/html')
  // P2-4: DOCX export (the `docx` + `file-saver` packages) is loaded on
  // first use only, so it stays out of the initial bundle. Same signature
  // and same call sites as before, so the Premium gate (gated(...)) and
  // its lock mark are unchanged; a failed chunk load shows the existing
  // export-failed toast instead of an unhandled rejection.
  const exportDocx=async(json:any, title:string)=>{ try{ const m=await import('../lib/docx'); await m.exportDocx(json, title) }catch(err:any){ setToast(`${t('exportFailed')}: ${err?.message||err}`) } }
  const insertDate=()=>{ editor.chain().focus().insertContent({ type:'text', text: formatDocDate(doc.dir) }).run() }
  // Release mission: format painter (Word's paintbrush). Click once to
  // capture the formatting at the current selection (inline marks of its
  // first text + the block type/alignment), then select target text and
  // the captured formatting is applied once. Esc cancels. A caret-only
  // click keeps the painter armed until a range is selected.
  const painterRef = useRef<null | { marks: { type: string; attrs: any }[]; block: { name: string; level?: number; textAlign?: string } }>(null)
  const [painterArmed, setPainterArmed] = useState(false)
  const PAINTER_MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'textStyle', 'highlight', 'link']
  const captureFormat = () => {
    if (painterRef.current) { painterRef.current = null; setPainterArmed(false); return }
    const sel = editor.state.selection as any
    const marks: { type: string; attrs: any }[] = []
    for (const type of PAINTER_MARKS) {
      const attrs = (editor as any).getAttributes?.(type)
      const active = type === 'textStyle' ? (attrs && Object.keys(attrs).length > 0) : editor.isActive(type)
      if (active) marks.push({ type, attrs: attrs || {} })
    }
    const parent = sel.$from.parent
    painterRef.current = { marks, block: { name: parent.type.name, level: parent.attrs?.level, textAlign: parent.attrs?.textAlign }, from: sel.from, to: sel.to } as any
    setPainterArmed(true)
  }
  useEffect(() => {
    if (!editor) return
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const applyNow = () => {
      const p = painterRef.current
      if (!p) return
      const sel = editor.state.selection as any
      if (sel.empty) return
      // Never paint onto the very range the format was captured from.
      if ((p as any).from === sel.from && (p as any).to === sel.to) return
      const chain = editor.chain().focus()
      for (const type of PAINTER_MARKS) {
        const got = p.marks.find((m) => m.type === type)
        if (got) chain.setMark(type as any, got.attrs)
        else chain.unsetMark(type as any)
      }
      if (p.block.name === 'heading' && p.block.level) chain.setHeading({ level: p.block.level as any })
      else if (p.block.name === 'paragraph') chain.setParagraph()
      if (p.block.textAlign) chain.setTextAlign(p.block.textAlign)
      chain.run()
      painterRef.current = null
      setPainterArmed(false)
    }
    // Paint only once the selection SETTLES: selectionUpdate fires for
    // every intermediate step of a shift-selection or mouse drag, and
    // painting then would format a partial range (found by the release
    // suite, 2026-10-31). 250ms of stillness = the user finished selecting.
    const onSel = () => {
      if (!painterRef.current) return
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(applyNow, 250)
    }
    editor.on('selectionUpdate', onSel)
    return () => { editor.off('selectionUpdate', onSel); if (settleTimer) clearTimeout(settleTimer) }
  }, [editor])
  useEffect(() => {
    if (!painterArmed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); painterRef.current = null; setPainterArmed(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [painterArmed])

  const insertToc=()=>{ const has=(()=>{ let f=false; editor.state.doc.descendants((n:any)=>{ if(n.type.name==='heading') f=true }); return f })(); if(!has){ setToast(t('noHeadings')); return } (editor.storage as any).vyroTocTitle=t('tocHeading'); editor.chain().focus().insertTocBlock().run() }
  const updateToc=()=>{ const ok=editor.chain().focus().updateTocBlocks().run(); if(!ok) setToast(t('tocNothingToUpdate')); else setToast(t('tocUpdated')) }

  const onImport=async(e:React.ChangeEvent<HTMLInputElement>)=>{ const f=e.target.files?.[0]; if(!f) return; try{
    const isDocx=/\.docx$/i.test(f.name); const isTxt=/\.txt$/i.test(f.name)
    if(!isDocx && !isTxt) throw new Error(t('importUnsupported'))
    // Tier-1 S1: convert/read FIRST; then, before the destructive
    // setContent, snapshot the current content (trigger 'before-import').
    // If the snapshot cannot be stored, the import ABORTS — user content
    // is never overwritten without a restorable backup. Empty documents
    // are not snapshotted (nothing to protect, no version noise).
    let html=''; let txt=''
    if(isDocx){ const mammoth=(await import('mammoth')).default ?? (await import('mammoth')); const buf=await f.arrayBuffer(); const res=await (mammoth as any).convertToHtml({arrayBuffer:buf}); html=res.value||'<p></p>' }
    else { txt=await f.text() }
    if(hasSnapshotWorthyContent(editor.getJSON()) && !snapshotCurrent('before-import', f.name)){ setToast(t('versionSaveFailed')); return }
    if(isDocx){ editor.commands.setContent(html); onChange({title:f.name.replace(/\.docx$/i,'')}, editor.getJSON()) }
    else { editor.commands.setContent(txt.split(/\n{2,}/).map((para:string)=>`<p>${escapeHtml(para).replace(/\n/g,'<br>')}</p>`).join('')); onChange({title:f.name.replace(/\.txt$/i,'')}, editor.getJSON()) }
  }catch(err:any){ setToast(`${t('importFailed')}: ${err?.message||err}`) } finally{ e.target.value='' } }

  // M2-07: picking a file now only OPENS a preview — insertion happens
  // on the preview dialog's Insert button, never on file-pick directly.
  const onImage=(e:React.ChangeEvent<HTMLInputElement>)=>{ const f=e.target.files?.[0]; e.target.value=''; if(!f) return; const err=validateImageFile(f); if(err){ setToast(t(err)); return } const r=new FileReader(); r.onerror=()=>setToast(t('importFailed')); r.onload=()=>{ dialogOpenerRef.current=document.activeElement; setImgPreview({ src:String(r.result), size:f.size }) }; r.readAsDataURL(f) }
  const insertPreviewImage=()=>{ if(!imgPreview) return; editor.chain().focus().setImage({src:imgPreview.src} as any).run(); setImgPreview(null) }
  const openImageEdit=()=>{ dialogOpenerRef.current=document.activeElement; const a=editor.getAttributes('image'); setImgSrc(a.src||''); setImgAlt(a.alt||''); setImgCaption(a.title||''); setImgWidth(typeof a.width==='string'? a.width : ''); setImgEditOpen(true) }
  const applyImageEdit=()=>{ editor.chain().focus().updateAttributes('image', { src: imgSrc, alt: imgAlt.trim()||null, title: imgCaption.trim()||null, width: imgWidth||null } as any).run(); setImgEditOpen(false) }
  const deleteImageEdit=()=>{ editor.chain().focus().deleteSelection().run(); setImgEditOpen(false) }
  const onReplaceImage=(e:React.ChangeEvent<HTMLInputElement>)=>{ const f=e.target.files?.[0]; e.target.value=''; if(!f) return; const err=validateImageFile(f); if(err){ setToast(t(err)); return } const r=new FileReader(); r.onerror=()=>setToast(t('importFailed')); r.onload=()=> setImgSrc(String(r.result)); r.readAsDataURL(f) }
  const openLink=()=>{ dialogOpenerRef.current=document.activeElement; const sel=editor.state.selection; setLinkUrl(editor.getAttributes('link').href||''); setLinkText(sel.from===sel.to ? '' : editor.state.doc.textBetween(sel.from, sel.to, '\n')); setLinkTextShown(sel.from!==sel.to); setLinkOpen(true) }
  const openLinkAt=(from:number, to:number)=>{ dialogOpenerRef.current=document.activeElement; editor.chain().focus().setTextSelection({from, to}).run(); const sel=editor.state.selection; setLinkUrl(editor.getAttributes('link').href||''); setLinkText(editor.state.doc.textBetween(sel.from, sel.to, '\n')); setLinkTextShown(true); setLinkOpen(true) }
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
    // M2-15: menu actions that open a dialog (link, image alt) return
    // focus here on close; openLink re-records the same element.
    dialogOpenerRef.current=document.activeElement
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

  // Ribbon buttons must never steal the editor's focus/selection on
  // mousedown: without this, the browser blur collapses the DOM selection
  // and chain().focus() restores a stale caret (position ~0), so the next
  // Enter lands at the start of the block — which is how heading text was
  // destroyed after applying a heading style with the mouse (P2-1b,
  // found live 2026-10-31, reproduced locally). Keyboard activation is
  // unaffected (Tab + Enter/Space still fire click).
  const keepEditorFocus=(e:any)=>{ e.preventDefault() }
  const Btn=(p:{onClick:()=>void; active?:boolean; title?:string; label?:string; children:any; disabled?:boolean})=>(<button type="button" className={`rbtn${p.active?' active':''}`} onMouseDown={keepEditorFocus} onClick={p.onClick} title={p.title||''} aria-label={p.label||undefined} disabled={p.disabled}>{p.children}</button>)
  const Group=(p:{label:string; cls?:string; children:any})=>(<div className={`rgroup${p.cls?' '+p.cls:''}`}><div className="rgroup-items">{p.children}</div><div className="rgroup-label">{p.label}</div></div>)

  // Controlled values for the font selects, derived from the read-back state.
  const curFamily = fontState?.family || ''
  const curSizeNum = fontState?.size ? parseInt(fontState.size, 10) : NaN
  const sizeSelectValue = Number.isNaN(curSizeNum) ? '16' : FONT_SIZES.includes(curSizeNum) ? String(curSizeNum) : ''
  // Line spacing read-back: same textStyle mechanism as family/size. The
  // official LineHeight extension ships inside TextStyleKit (already enabled),
  // so setLineHeight/unsetLineHeight are plain mark writes — no custom
  // extension, and stored docs only gain an additive textStyle attr.
  const curLineHeight = fontState?.lineHeight || ''
  const styleId = activeParagraphStyle({ isHeading1: editor.isActive('heading',{level:1}), isHeading2: editor.isActive('heading',{level:2}), isHeading3: editor.isActive('heading',{level:3}), isParagraph: editor.isActive('paragraph'), isBold: editor.isActive('bold'), fontSizePx: Number.isNaN(curSizeNum) ? null : curSizeNum })
  // PC2 font grow/shrink: ±2px within the existing font-size range. With
  // no explicit size at the cursor, the document default size is the base
  // (settings default, else 16) — the size select's read-back already
  // shows 16 in that case, so the first step lands on a real size.
  const adjustFontSize=(delta:number)=>{ const base = Number.isNaN(curSizeNum) ? (settings?.defaultFontSize ?? 16) : curSizeNum; const next = Math.min(FONT_SIZES[FONT_SIZES.length-1], Math.max(FONT_SIZES[0], base+delta)); editor.chain().focus().setFontSize(next+'px').run() }
  const applyTitleStyle = () => { const to=editor.state.selection.to; editor.chain().focus().setParagraph().setFontSize('28px').setTextSelection(to).run(); if(!editor.isActive('bold')) editor.chain().focus().toggleBold().run() }

  const pageW = `${setup.widthMm}mm`
  const pageMinH = viewMode==='edit'
    ? `${Math.round(pageCount*pageHPx + (pageCount-1)*PAGE_GAP_PX)}px`
    : `${setup.heightMm}mm`
  // M2-13: 'Saved HH:MM' appears only after the confirmation effect set
  // savedAt; 'failed' and 'pending' (autosave off) have their own strings
  // and are never folded into the saved label.
  const saveText = saveState==='failed' ? t('saveFailedStatus')
    : saveState==='saving' ? t('saving')
    : saveState==='pending' ? t('saveUnsavedChanges')
    : savedAt ? `${t('saved')} ${savedAt}` : t('savedLocally')

  return <div className={`editor-shell${viewMode!=='edit' ? ` ${viewModeClass(viewMode)}` : ''}`}>
    {viewMode!=='edit' && <div className="view-mode-bar" role="toolbar" aria-label={viewMode==='focus' ? t('focusMode') : t('readingMode')}>
      <span className="view-mode-label">{viewMode==='focus' ? t('focusMode') : t('readingMode')}</span>
      {viewMode==='focus' && <label className="view-mode-width">{t('textWidth')}<select aria-label={t('textWidth')} value={focusWidth} onChange={e=>setFocusWidth(e.target.value as FocusWidth)}><option value="narrow">{t('narrow')}</option><option value="normal">{t('normal')}</option><option value="wide">{t('wide')}</option></select></label>}
      <button type="button" className="rbtn view-mode-exit" onClick={exitMode}>{viewMode==='focus' ? t('exitFocusMode') : t('exitReadingMode')}</button>
    </div>}
    {viewMode==='edit' && <header className="editor-top">
      <div className="top-start"><div className="logo"><span className="vmark">V</span><span className="logo-name">Vyro Web</span></div><div className="file-menu-wrap" ref={fileRef}><button type="button" ref={fileBtnRef} className="file-btn" aria-haspopup="menu" aria-expanded={fileOpen} onClick={()=>setFileOpen(o=>!o)}>{t('fileMenu')}</button>{fileOpen && <div className="file-menu" role="menu" aria-label={t('fileMenu')}>{onNewDoc && <button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); onNewDoc() }}>{t('newDocPlain')}</button>}{onOpenDoc && docsList && <button type="button" role="menuitem" className="file-item" aria-expanded={openListOpen} onClick={()=>setOpenListOpen(o=>!o)}>{t('openDocument')} {openListOpen?'▴':'▸'}</button>}{openListOpen && onOpenDoc && docsList && <div className="file-open-list">{docsList.filter(d=>d.id!==doc.id).slice(0,8).map(d=><button key={d.id} type="button" role="menuitem" className="file-item file-open-item" onClick={()=>{ setFileOpen(false); setOpenListOpen(false); flushSave(); onOpenDoc(d.id) }}>{d.title}</button>)}{!docsList.some(d=>d.id!==doc.id) && <span className="file-item file-open-item" aria-disabled="true">{t('noOtherDocuments')}</span>}</div>}<button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); titleInputRef.current?.focus() }}>{t('rename')}</button>{onMakeCopy && <button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); onMakeCopy(doc.id) }}>{t('makeCopy')}</button>}<div className="file-sep"/><button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); importRef.current?.click() }}>{t('importBtn')}</button><div className="file-sep"/><button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); exportTxt() }}>{t('exportTxt')}</button><button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); exportHtml() }}>{t('exportHtml')}</button><button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); gated(()=>exportDocx(editor.getJSON(), doc.title)) }}>{t('exportDocx')} {!isPremium&&'🔒'}</button><button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); window.print() }}>{t('printPdf')}</button><div className="file-sep"/><button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); setVersionsOpen(o=>!o) }}>{t('versions')}</button>{settingsAvailable && <button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); setSettingsOpen(true) }}>{t('documentSettings')}</button>}<button type="button" role="menuitem" className="file-item" onClick={()=>{ setFileOpen(false); goBack() }}>{t('dashboard')}</button></div>}</div><div className="qat" role="group" aria-label={t('quickAccessToolbar')}><button type="button" className="qat-btn" title={`${t('saveNow')} (Ctrl+S / ⌘S)`} aria-label={t('saveNow')} onClick={()=>{ pendingJson.current=editor.getJSON(); flushSave() }}>💾</button><button type="button" className="qat-btn" title={`${t('undo')} (Ctrl+Z / ⌘Z)`} aria-label={t('undo')} disabled={!editor.can().undo()} onClick={()=>editor.chain().focus().undo().run()}>↶</button><button type="button" className="qat-btn" title={`${t('redo')} (Ctrl+Shift+Z / Ctrl+Y)`} aria-label={t('redo')} disabled={!editor.can().redo()} onClick={()=>editor.chain().focus().redo().run()}>↷</button></div><button className="back-btn" onClick={goBack} title={t('dashboard')} aria-label={t('dashboard')}>← <span className="back-label">{t('dashboard')}</span></button></div>
      <input ref={titleInputRef} className="title-input" value={titleDraft ?? doc.title} dir="auto" aria-label={t('docTitleLabel')} onFocus={e=>{ setDraft(doc.title); e.currentTarget.select() }} onChange={e=>setDraft(e.target.value)} onBlur={commitTitle} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); commitTitle(); e.currentTarget.blur() } else if(e.key==='Escape'){ e.preventDefault(); setDraft(null); e.currentTarget.blur() } }}/>
      <div className="top-end">
        {saveState==='failed' ? <button type="button" className="saved failed saved-retry" onClick={retrySave} title={t('retrySave')}>{saveText} · {t('retrySave')}</button> : <span className="saved" role="status">{saveText}</span>}
        {accountLabel && <span className="account-label" title={accountLabel}>{accountLabel}</span>}
        {isLocal && !isNarrow && <span className="local-chip title-local-chip">{t('localSaving')}</span>}
        {!isNarrow && onPaletteOpen && <button className="rbtn title-overflow-item" onClick={onPaletteOpen} title="Ctrl+K" aria-label={t('commandPalette')}>⌘K</button>}
        {!isNarrow && onLangChange && <div className="lang-toggle mini title-overflow-item" role="group" aria-label={t('language')}><button className={`rbtn${lang==='en'?' active':''}`} onClick={()=>onLangChange('en')}>EN</button><button className={`rbtn${lang==='fa'?' active':''}`} onClick={()=>onLangChange('fa')}>فا</button></div>}
        {!isNarrow && <button className="rbtn title-overflow-item" onClick={onToggleTheme} title={theme==='dark'? t('lightUi'):t('darkUi')} aria-label={theme==='dark'? t('lightUi'):t('darkUi')}>{theme==='dark'?'☀':'☾'}</button>}
        {!isNarrow && settingsAvailable && <button className="rbtn title-overflow-item" onClick={()=>setSettingsOpen(true)} title={t('settings')} aria-label={t('settings')}>⚙</button>}
        {isNarrow && <div className="title-overflow-wrap" ref={overflowRef}>
          <button type="button" ref={overflowBtnRef} className="rbtn overflow-btn" aria-label={t('titleBarOverflow')} aria-haspopup="menu" aria-expanded={overflowOpen} onClick={()=>setOverflowOpen(o=>!o)}>⋯</button>
          {overflowOpen && <div className="overflow-menu" role="menu" aria-label={t('titleBarOverflow')}>
            {onPaletteOpen && <button type="button" role="menuitem" className="overflow-item" onClick={()=>{ setOverflowOpen(false); onPaletteOpen() }}>⌘K {t('commandPalette')}</button>}
            {onLangChange && <><button type="button" role="menuitem" className={`overflow-item${lang==='en'?' active':''}`} onClick={()=>{ setOverflowOpen(false); onLangChange('en') }}>EN</button><button type="button" role="menuitem" className={`overflow-item${lang==='fa'?' active':''}`} onClick={()=>{ setOverflowOpen(false); onLangChange('fa') }}>فا</button></>}
            <button type="button" role="menuitem" className="overflow-item" onClick={()=>{ setOverflowOpen(false); onToggleTheme() }}>{theme==='dark'? t('lightUi'):t('darkUi')}</button>
            {settingsAvailable && <button type="button" role="menuitem" className="overflow-item" onClick={()=>{ setOverflowOpen(false); setSettingsOpen(true) }}>⚙ {t('settings')}</button>}
            {isLocal && <div className="overflow-item overflow-info" role="note">{t('localSaving')}</div>}
          </div>}
        </div>}
      </div>
    </header>}
    {viewMode==='edit' && <div className={`ribbon-wrap${toolsOpen?' expanded':''}`}>
      <nav className="ribbon-tabs">{TABS.map(tb=><button key={tb.id} className={tab===tb.id?'tab active':'tab'} onMouseDown={keepEditorFocus} onClick={()=>setTab(tb.id)}>{t(tb.key)}</button>)}<button className="tools-toggle" aria-expanded={toolsOpen} onMouseDown={keepEditorFocus} onClick={()=>setToolsOpen(o=>!o)}>{t('moreTools')} {toolsOpen?'▴':'▾'}</button></nav>
      <div className="ribbon" data-tab={tab}>
      {tab==='File' && <>
        <Group label={t('groupDocument')}><Btn onClick={goBack}>{t('dashboard')}</Btn><Btn onClick={()=>{ pendingJson.current=editor.getJSON(); flushSave() }}>{t('saveNow')}</Btn></Group>
        <Group label={t('versions')}><Btn active={versionsOpen} onClick={()=>setVersionsOpen(o=>!o)}>{t('versions')}</Btn></Group>
        <Group label={t('groupImport')}><Btn onClick={()=>importRef.current?.click()}>{t('importBtn')}</Btn></Group>
        <Group label={t('groupExport')}><Btn onClick={exportTxt}>{t('exportTxt')}</Btn><Btn onClick={exportHtml}>{t('exportHtml')}</Btn><Btn onClick={()=>gated(()=>exportDocx(editor.getJSON(), doc.title))}>{t('exportDocx')} {!isPremium&&'🔒'}</Btn><Btn onClick={()=>window.print()}>{t('printPdf')}</Btn><Btn active={exportPresetsOpen} onClick={()=>setExportPresetsOpen(o=>!o)}>{t('exportPresets')}</Btn></Group>
      </>}
      {tab==='Home' && <>
        <Group label={t('groupClipboard')} cls="g-fixed"><Btn label={t('menuPastePlain')} title={t('menuPastePlain')} onClick={()=>{ void pastePlainText() }}><span aria-hidden="true">📋</span></Btn><Btn label={t('menuCut')} title={t('menuCut')} onClick={()=>copySelection(true)}><span aria-hidden="true">✂</span></Btn><Btn label={t('menuCopy')} title={t('menuCopy')} onClick={()=>copySelection(false)}><span aria-hidden="true">⧉</span></Btn><Btn label={t('formatPainter')} title={t('formatPainter')} active={painterArmed} onClick={captureFormat}><span aria-hidden="true">🖌</span></Btn></Group>
        <Group label={t('groupFont')} cls="g-font"><select className="font-select" aria-label={t('fontFamily')} value={curFamily} onChange={e=>{ const v=e.target.value; const c=editor.chain().focus(); if(!v) c.unsetFontFamily().run(); else c.setFontFamily(v).run() }}><option value="">{t('fontFamily')}</option>{curFamily && !FONT_FAMILIES.includes(curFamily) && <option value={curFamily}>{curFamily.replace(/'/g,'')}</option>}{FONT_FAMILIES.map(f=><option key={f} value={f}>{f.replace(/'/g,'')}</option>)}</select><select className="size-select" aria-label="Font size" value={sizeSelectValue} onChange={e=>{ if(e.target.value) editor.chain().focus().setFontSize(e.target.value+'px').run() }}>{sizeSelectValue==='' && <option value="">{curSizeNum}px</option>}{FONT_SIZES.map(s=><option key={s} value={s}>{s}px</option>)}</select><Btn title={t('fontGrow')} onClick={()=>adjustFontSize(2)}>A▲</Btn><Btn title={t('fontShrink')} onClick={()=>adjustFontSize(-2)}>A▼</Btn><Btn title="Ctrl+B / ⌘B" active={editor.isActive('bold')} onClick={()=>editor.chain().focus().toggleBold().run()}><b>B</b></Btn><Btn title="Ctrl+I / ⌘I" active={editor.isActive('italic')} onClick={()=>editor.chain().focus().toggleItalic().run()}><i>I</i></Btn><Btn title="Ctrl+U / ⌘U" active={editor.isActive('underline')} onClick={()=>editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn><Btn title="Ctrl+Shift+S / ⌘⇧S" active={editor.isActive('strike')} onClick={()=>editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
        <label className="color-wrap" title={t('textColour')}>A<input type="color" onChange={e=>editor.chain().focus().setColor(e.target.value).run()}/></label>
        <label className="color-wrap" title={t('highlight')}>H<input type="color" defaultValue="#ffff00" onChange={e=>editor.chain().focus().toggleHighlight({color:e.target.value}).run()}/></label>
        <Btn label={t('clearFormatting')} title={t('clearFormatting')} onClick={()=>editor.chain().focus().unsetAllMarks().clearNodes().run()}><span className="cf-ico" aria-hidden="true">A<span className="cf-mark">✕</span></span></Btn></Group>
        <Group label={t('groupParagraph')} cls="g-para"><Btn active={editor.isActive({textAlign:'left'})} label={t('alignLeft')} title={t('alignLeft')} onClick={()=>editor.chain().focus().setTextAlign('left').run()}><span className="al-ico al-left" aria-hidden="true"><i/><i/><i/><i/></span></Btn><Btn active={editor.isActive({textAlign:'center'})} label={t('alignCenter')} title={t('alignCenter')} onClick={()=>editor.chain().focus().setTextAlign('center').run()}><span className="al-ico al-center" aria-hidden="true"><i/><i/><i/><i/></span></Btn><Btn active={editor.isActive({textAlign:'right'})} label={t('alignRight')} title={t('alignRight')} onClick={()=>editor.chain().focus().setTextAlign('right').run()}><span className="al-ico al-right" aria-hidden="true"><i/><i/><i/><i/></span></Btn><Btn active={editor.isActive({textAlign:'justify'})} label={t('alignJustify')} title={t('alignJustify')} onClick={()=>editor.chain().focus().setTextAlign('justify').run()}><span className="al-ico al-justify" aria-hidden="true"><i/><i/><i/><i/></span></Btn><select className="ls-select" aria-label={t('lineSpacing')} value={curLineHeight} onChange={e=>{ const v=e.target.value; const c=editor.chain().focus(); if(!v) c.unsetLineHeight().run(); else c.setLineHeight(v).run() }}><option value="">{t('lineSpacing')}</option>{curLineHeight && !LINE_HEIGHTS.includes(curLineHeight) && <option value={curLineHeight}>{curLineHeight}</option>}{LINE_HEIGHTS.map(v=><option key={v} value={v}>{v}</option>)}</select>{!compactToolbar && <><Btn active={editor.isActive('bulletList')} label={t('bulletList')} title={`${t('bulletList')} (Ctrl+Shift+8 / ⌘⇧8)`} onClick={()=>editor.chain().focus().toggleBulletList().run()}><span className="lst-ico" aria-hidden="true"><span className="lst-row"><b>•</b><i/></span><span className="lst-row"><b>•</b><i/></span><span className="lst-row"><b>•</b><i/></span></span></Btn><Btn active={editor.isActive('orderedList')} label={t('orderedList')} title={`${t('orderedList')} (Ctrl+Shift+7 / ⌘⇧7)`} onClick={()=>editor.chain().focus().toggleOrderedList().run()}><span className="lst-ico" aria-hidden="true"><span className="lst-row"><b>1</b><i/></span><span className="lst-row"><b>2</b><i/></span><span className="lst-row"><b>3</b><i/></span></span></Btn><Btn active={editor.isActive('blockquote')} label={t('quote')} title={`${t('quote')} (Ctrl+Shift+B / ⌘⇧B)`} onClick={()=>editor.chain().focus().toggleBlockquote().run()}><span aria-hidden="true">❝</span></Btn></>}</Group>
        <Group label={t('groupStyles')}><div className="styles-gallery" role="group" aria-label={t('groupStyles')}><button type="button" onMouseDown={keepEditorFocus} className={`style-gal${styleId==='normal'?' active':''}`} aria-label={t('paragraph')} onClick={()=>{ const to=editor.state.selection.to; editor.chain().focus().setParagraph().setTextSelection(to).run() }}><span className="style-sample" aria-hidden="true">AaBbCc</span><span className="style-name">{t('paragraph')}</span></button><button type="button" onMouseDown={keepEditorFocus} className={`style-gal style-h1${styleId==='heading1'?' active':''}`} aria-label={t('heading1')} title="Ctrl+Alt+1 / ⌘⌥1" onClick={()=>{ const to=editor.state.selection.to; editor.chain().focus().toggleHeading({level:1}).setTextSelection(to).run() }}><span className="style-sample" aria-hidden="true">AaBbCc</span><span className="style-name">{t('heading1')}</span></button><button type="button" onMouseDown={keepEditorFocus} className={`style-gal style-h2${styleId==='heading2'?' active':''}`} aria-label={t('heading2')} title="Ctrl+Alt+2 / ⌘⌥2" onClick={()=>{ const to=editor.state.selection.to; editor.chain().focus().toggleHeading({level:2}).setTextSelection(to).run() }}><span className="style-sample" aria-hidden="true">AaBbCc</span><span className="style-name">{t('heading2')}</span></button><button type="button" onMouseDown={keepEditorFocus} className={`style-gal style-h3${styleId==='heading3'?' active':''}`} aria-label={t('heading3')} title="Ctrl+Alt+3 / ⌘⌥3" onClick={()=>{ const to=editor.state.selection.to; editor.chain().focus().toggleHeading({level:3}).setTextSelection(to).run() }}><span className="style-sample" aria-hidden="true">AaBbCc</span><span className="style-name">{t('heading3')}</span></button><button type="button" onMouseDown={keepEditorFocus} className={`style-gal style-title${styleId==='title'?' active':''}`} aria-label={t('styleTitle')} onClick={applyTitleStyle}><span className="style-sample" aria-hidden="true">AaBbCc</span><span className="style-name">{t('styleTitle')}</span></button></div></Group>
        <Group label={t('groupEditing')}><Btn onClick={()=>{ findOpenerRef.current=document.activeElement; setFindOpen(true) }}>{t('findReplace')}</Btn></Group>
      </>}
      {tab==='Insert' && <>
        <Group label={t('groupTable')}><Btn onClick={()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run()}>{t('insertTable')}</Btn><Btn onClick={()=>editor.chain().focus().addRowBefore().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('addRowBefore')}</Btn><Btn onClick={()=>editor.chain().focus().addRowAfter().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('addRow')}</Btn><Btn onClick={()=>editor.chain().focus().addColumnBefore().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('addColumnBefore')}</Btn><Btn onClick={()=>editor.chain().focus().addColumnAfter().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('addColumn')}</Btn><Btn onClick={()=>editor.chain().focus().deleteRow().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('deleteRow')}</Btn><Btn onClick={()=>editor.chain().focus().deleteColumn().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('deleteColumn')}</Btn><Btn active={editor.isActive('tableHeader')} onClick={()=>editor.chain().focus().toggleHeaderRow().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('toggleHeaderRow')}</Btn><Btn onClick={()=>editor.chain().focus().deleteTable().run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('deleteTable')}</Btn></Group>
        <Group label={t('cellAlign')}><Btn onClick={()=>editor.chain().focus().setTextAlign('left').run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('alignLeft')}</Btn><Btn onClick={()=>editor.chain().focus().setTextAlign('center').run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('alignCenter')}</Btn><Btn onClick={()=>editor.chain().focus().setTextAlign('right').run()} disabled={!editor.isActive('tableCell') && !editor.isActive('tableHeader')}>{t('alignRight')}</Btn></Group>
        <Group label={t('groupMedia')}><Btn onClick={()=>fileImgRef.current?.click()}>{t('imageLocal')}</Btn><Btn onClick={openImageEdit} disabled={!editor.isActive('image')}>{t('imageEdit')}</Btn></Group>
        {!compactToolbar && <Group label={t('groupLinksBreaks')}><Btn active={editor.isActive('link')} onClick={openLink}>{t('link')}</Btn><Btn active={linksOpen} onClick={()=>setLinksOpen(o=>!o)}>{t('linkManager')}</Btn><Btn onClick={()=>editor.chain().focus().setHorizontalRule().run()}>{t('horizontalLine')}</Btn><Btn onClick={()=>editor.chain().focus().insertPageBreak().run()}>{t('pageBreak')}</Btn></Group>}
        <Group label={t('groupText')}><Btn onClick={insertDate}>{t('insertDate')}</Btn></Group>
        <Group label={t('headerFooter')}><Btn onClick={openHfDialog}>{t('headerFooterEdit')}</Btn></Group>
      </>}
      {tab==='Layout' && <>
        <Group label={t('groupPageSize')}><select className="ps-select" aria-label={t('pageSize')} value={setup.sizeId} onChange={e=>{ const v=e.target.value as PageSizeId; if(v==='Custom'){ openSetupDialog('size') } else { onChange({ pageSize: v }) } }}>{PAGE_SIZE_IDS.map(id=><option key={id} value={id}>{id==='Custom' ? t('pageSizeCustom') : id}</option>)}</select><span className="ps-label" title={pageSizeLabel(setup)}>{pageSizeLabel(setup)}</span>{setup.sizeId==='Custom' && <Btn onClick={()=>openSetupDialog('size')}>{t('pageSizeCustom')}</Btn>}</Group>
        <Group label={t('groupMargins')}><Btn active={(doc.margins||'normal')==='narrow'} onClick={()=>onChange({margins:'narrow'})}>{t('narrow')}</Btn><Btn active={(doc.margins||'normal')==='normal'} onClick={()=>onChange({margins:'normal'})}>{t('normal')}</Btn><Btn active={(doc.margins||'normal')==='moderate'} onClick={()=>onChange({margins:'moderate'})}>{t('moderate')}</Btn><Btn active={(doc.margins||'normal')==='wide'} onClick={()=>onChange({margins:'wide'})}>{t('wide')}</Btn><Btn active={doc.margins==='custom'} onClick={()=>openSetupDialog('margins')}>{t('customMargins')}</Btn></Group>
        <Group label={t('groupOrientation')}><Btn active={(doc.orientation||'portrait')==='portrait'} onClick={()=>onChange({orientation:'portrait'})}>{t('portrait')}</Btn><Btn active={doc.orientation==='landscape'} onClick={()=>onChange({orientation:'landscape'})}>{t('landscape')}</Btn></Group>
        <Group label={t('groupDirection')}><Btn active={doc.dir==='ltr'} onClick={()=>onChange({dir:'ltr'})}>LTR</Btn><Btn active={doc.dir==='rtl'} onClick={()=>onChange({dir:'rtl'})}>RTL (Dari/Persian)</Btn></Group>
      </>}
      {tab==='References' && <Group label={t('groupContents')}><Btn onClick={insertToc}>{t('insertToc')}</Btn><Btn onClick={updateToc}>{t('updateToc')}</Btn></Group>}
      {tab==='Mailings' && <Group label={t('mailMerge')}><Btn active={mailMergeOpen} onClick={()=>setMailMergeOpen(o=>!o)}>{t('mailMerge')}</Btn><span className="static-stat mailings-note">{t('mailMergeLocal')}</span></Group>}
      {tab==='Review' && <>
        <Group label={t('groupProofing')}><Btn active={spell} onClick={()=>setSpell(s=>!s)}>{t('spellcheck')} {spell? t('on'):t('off')}</Btn></Group>
        <Group label={t('groupCount')}><span className="static-stat">{words} {t('words')} · {chars} {t('characters')} · {editor.getText().split(/\n/).filter(Boolean).length} {t('paragraphsApprox')}</span><Btn active={statsOpen} onClick={()=>setStatsOpen(o=>!o)}>{t('documentStatistics')}</Btn></Group>
        <Group label={t('compare')}><Btn active={compareOpen} onClick={()=>setCompareOpen(o=>!o)}>{t('compare')}</Btn></Group>
        <Group label={t('intelligence')}><Btn active={intelligenceOpen} onClick={()=>setIntelligenceOpen(o=>!o)}>{t('intelligence')}</Btn></Group>
      </>}
      {tab==='View' && <>
        <Group label={t('groupViews')}><Btn onClick={enterFocus}>{t('focusMode')}</Btn><Btn onClick={enterReading}>{t('readingMode')}</Btn></Group>
        <Group label={t('groupThemes')}><Btn onClick={onToggleTheme}>{theme==='dark'? t('lightUi'):t('darkUi')}</Btn></Group>
        <Group label={t('groupShow')}><Btn active={navOpen} onClick={()=>setNavOpen(o=>!o)}>{t('navigationPane')}</Btn><Btn active={showRuler} aria-label={t('ruler')} onClick={()=>setShowRuler(o=>!o)}>{showRuler ? t('hideRuler') : t('showRuler')}</Btn></Group>
        <Group label={t('saveDiagnostics')}><Btn active={saveDiagOpen} onClick={()=>setSaveDiagOpen(o=>!o)}>{t('saveDiagnostics')}</Btn></Group>
        <Group label={t('keyboardShortcuts')}><Btn active={shortcutsOpen} onClick={()=>setShortcutsOpen(o=>!o)}>{t('keyboardShortcuts')}</Btn></Group>
        <Group label={t('groupZoom')}><Btn onClick={()=>setZoom(z=>zoomStep(z,-10))}>−</Btn><span className="static-stat">{zoom}%</span><Btn onClick={()=>setZoom(z=>zoomStep(z,10))}>+</Btn><Btn onClick={()=>setZoom(100)}>100%</Btn><Btn onClick={()=>setZoom(50)}>50%</Btn><Btn onClick={()=>setZoom(200)}>200%</Btn></Group>
      </>}
      </div>
      {linkOpen && <div className="link-pop" role="dialog" aria-label={t('link')} ref={linkDialogRef}>
        <label>{t('linkPrompt')}<input autoFocus value={linkUrl} dir="ltr" placeholder="https://…" onChange={e=>setLinkUrl(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); applyLink() } if(e.key==='Escape') setLinkOpen(false) }}/></label>
        {linkTextShown && <label>{t('linkTextLabel')}<input value={linkText} dir="auto" onChange={e=>setLinkText(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); applyLink() } if(e.key==='Escape') setLinkOpen(false) }}/></label>}
        <div className="row"><button className="primary small" onClick={applyLink}>{t('save')}</button>{editor.isActive('link') && <button className="rbtn" onClick={removeLink}>{t('removeLink')}</button>}<button className="rbtn" onClick={()=>setLinkOpen(false)}>{t('cancel')}</button></div>
      </div>}
    </div>}
    {viewMode==='edit' && findOpen && <FindReplacePanel editor={editor} lang={lang} onClose={()=>setFindOpen(false)} onBeforeReplaceAll={beforeReplaceAll} opener={findOpenerRef.current} />}
    {viewMode==='edit' && recovery && <div className="recovery-banner" role="alert">
      <div><b>{t('recoveryNotice')}</b> — {t('recoveryDiff')}</div>
      <div className="recovery-compare" dir="auto">{t('saved')}: {recovery.savedLength} {t('chars')} · {t('versionTriggerRecovery')}: {recovery.draftLength} {t('chars')}</div>
      <div className="recovery-excerpt" dir="auto"><span>{t('saved')}: “{recovery.savedExcerpt}”</span><span>{t('versionTriggerRecovery')}: “{recovery.draftExcerpt}”</span></div>
      <div className="row"><button type="button" className="primary small" onClick={acceptRecovery}>{t('recoveryAccept')}</button><button type="button" className="rbtn" onClick={discardRecovery}>{t('recoveryDiscard')}</button></div>
    </div>}
    {viewMode==='edit' && statsOpen && <StatsPanel editor={editor} lang={lang} onClose={()=>setStatsOpen(false)} />}
    {viewMode==='edit' && saveDiagOpen && <SaveDiagnosticsPanel editor={editor} doc={doc} lang={lang} diag={diag} backup={backup} autosaveEnabled={autosaveEnabled ?? true} autosaveIntervalMs={autosaveIntervalMs ?? 500} hasPendingEdits={saveState==='pending' || saveState==='failed'} onRetry={retrySave} onCreateBackup={createBackupNow} onDownloadBackup={downloadBackup} onClose={()=>setSaveDiagOpen(false)} />}
    {viewMode==='edit' && exportPresetsOpen && <ExportPresetsPanel editor={editor} doc={doc} lang={lang} onClose={()=>setExportPresetsOpen(false)} onExportText={(name,text,mime)=>download(name,text,mime)} onExportHtml={(name,html)=>download(name, `<!doctype html><html dir="${doc.dir}"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title></head><body>${html}</body></html>`, 'text/html')} onExportArchive={(name,payload)=>download(name,payload,'application/json')} onPrint={()=>window.print()} />}
    {viewMode==='edit' && compareOpen && <ComparePanel editor={editor} doc={doc} versions={versions} lang={lang} onClose={()=>setCompareOpen(false)} onVersionsSaved={(next)=>setVersions(next)} />}
    {viewMode==='edit' && intelligenceOpen && <IntelligencePanel editor={editor} lang={lang} onClose={()=>setIntelligenceOpen(false)} />}
    {viewMode==='edit' && linksOpen && <LinkManagerPanel editor={editor} lang={lang} onClose={()=>setLinksOpen(false)} onEditLink={openLinkAt} />}
    {viewMode==='edit' && mailMergeOpen && <MailMergePanel editor={editor} doc={doc} lang={lang} onCreateMergedDocs={onCreateMergedDocs} onClose={()=>setMailMergeOpen(false)} />}
    {viewMode==='edit' && versionsOpen && <div className="versions-panel" role="region" aria-label={t('versions')}
      onKeyDown={(e) => { if (e.key === 'Escape') setVersionsOpen(false) }}>
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
      {/* PC3: the ruler frame wraps the existing .page-scaler untouched —
         fitScale measurement (workspaceRef clientWidth) and the pagePxH
         ResizeObserver are reused as-is; the rulers only read them. */}
      <div className={`page-frame${viewMode==='edit' && showRuler ? ' with-rulers' : ''}`} style={{ width:`${Math.round(pageMmW*MM_PX*effScale) + (viewMode==='edit' && showRuler ? RULER_SIZE : 0)}px` }}>
      {viewMode==='edit' && showRuler && <div className="ruler-corner" aria-hidden="true" />}
      {viewMode==='edit' && showRuler && <HorizontalRuler pageMm={pageMmW} marginPreset={doc.margins} marginMm={setup.margins.left} scale={effScale} />}
      {viewMode==='edit' && showRuler && <VerticalRuler pageMm={pageMmH} marginPreset={doc.margins} marginMm={setup.margins.top} scale={effScale} pagePxH={pagePxH} />}
      <div className="page-scaler" style={{ width:`${Math.round(pageMmW*MM_PX*effScale)}px`, height:`${Math.round(pagePxH*effScale)}px` }}>
        <div className="page-scale-inner" style={{ transform:`scale(${effScale})`, width:`${Math.round(pageMmW*MM_PX)}px` }}>
          <div ref={pageRef} className={`a4-page ${doc.orientation==='landscape'?'landscape':'portrait'}${viewMode==='edit' ? ' paged' : ''}${viewMode==='focus' || viewMode==='reading' ? ` ${focusWidthClass(focusWidth)}` : ''}`} style={{ width:pageW, minHeight:pageMinH, padding:marginsPaddingCss(setup.margins) }}
            onPaste={handlePaste}
            onContextMenu={(e)=>{ if(Date.now()-longPressMenuRef.current < 1000 && ctxMenu){ e.preventDefault(); return } e.preventDefault(); openContextMenu(e.clientX, e.clientY) }}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={clearLongPress} onTouchCancel={clearLongPress}
          >
            {viewMode==='edit' && <div className="sheet-layer" aria-hidden="true">{Array.from({length: pageCount},(_,i)=>(<div key={i} className="sheet" style={{ top:`${Math.round(i*(pageHPx+PAGE_GAP_PX))}px`, height:`${Math.round(pageHPx)}px` }}>{doc.headerText && <span className="sheet-header">{doc.headerText}</span>}{doc.footerText && <span className="sheet-footer">{doc.footerText}</span>}<span className="sheet-num">{i+1}</span></div>))}</div>}
            <EditorContent editor={editor}/>
          </div>
        </div>
      </div>
      </div>
    </div>
    </div>
    {viewMode==='edit' && <footer className="status-bar">
      {/* Pagination mission (2026-10-31) supersedes the PC4 note: in edit
         mode the document IS paginated into measured sheets, so the count
         shown is the REAL page count from the pagination engine. The word-
         word-based estimate remains only inside the statistics
         dialog's separate figure. */}
      <span className={saveState==='failed' ? 'status-save failed' : 'status-save'}>{saveText}</span>
      <button type="button" className="status-stats-btn" onClick={()=>setStatsOpen(true)} aria-label={t('documentStatistics')} title={t('documentStatistics')}>{statusStats.words} {t('words')} · {statusStats.charsWithSpaces} {t('chars')} · {pageCount} {t('pagesLabel')}</button>
      <span className="status-dir" aria-label={t('language')} title={t('language')}>{documentLanguageLabel(doc.dir)}</span>
      <span className="status-dir" aria-label={t('direction')} title={t('direction')}>{documentDirectionLabel(doc.dir)}</span>
      <div className="status-views"><button type="button" className="status-view-btn" onClick={enterFocus}>{t('focusMode')}</button><button type="button" className="status-view-btn" onClick={enterReading}>{t('readingMode')}</button></div>
      <div className="status-zoom"><span>{t('zoom')}</span><button type="button" className="status-btn" aria-label={t('zoomOut')} onClick={()=>setZoom(z=>zoomStep(z,-10))}>−</button><input type="range" min={50} max={200} step={5} value={zoom} onChange={e=>setZoom(clampZoom(Number(e.target.value)))} aria-label={t('zoom')}/><span>{zoom}%</span><button type="button" className="status-btn" aria-label={t('zoomIn')} onClick={()=>setZoom(z=>zoomStep(z,10))}>+</button></div>
    </footer>}
    {ctxMenu && <ContextMenu items={ctxMenu.items} x={ctxMenu.x} y={ctxMenu.y} lang={lang} onAction={runMenuAction} onClose={()=>setCtxMenu(null)} />}
    {altOpen && <div className="modal-backdrop" onClick={()=>setAltOpen(false)}><form className="modal" ref={altDialogRef} onClick={e=>e.stopPropagation()} onSubmit={e=>{ e.preventDefault(); applyImageAlt() }}><h2>{t('menuImageAlt')}</h2><label className="field">{t('imageAltPrompt')}<input autoFocus value={altText} dir="auto" onChange={e=>setAltText(e.target.value)} /></label><div className="row end"><button type="button" className="rbtn" onClick={()=>setAltOpen(false)}>{t('cancel')}</button><button type="submit" className="primary small">{t('save')}</button></div></form></div>}
    {imgPreview && <div className="modal-backdrop" onClick={()=>setImgPreview(null)}><div className="modal" ref={imgPreviewDialogRef} onClick={e=>e.stopPropagation()}><h2>{t('imagePreview')}</h2><img src={imgPreview.src} alt="" style={{ maxWidth:'100%', height:'auto', borderRadius:8 }} /><p className="muted">{t('imageSizeKb')}: {imageSizeKb(imgPreview.size)}</p><div className="row end"><button type="button" className="rbtn" onClick={()=>setImgPreview(null)}>{t('cancel')}</button><button type="button" className="primary small" onClick={insertPreviewImage}>{t('imageInsert')}</button></div></div></div>}
    {imgEditOpen && <div className="modal-backdrop" onClick={()=>setImgEditOpen(false)}><form className="modal" ref={imgEditDialogRef} onClick={e=>e.stopPropagation()} onSubmit={e=>{ e.preventDefault(); applyImageEdit() }}><h2>{t('imageEdit')}</h2><img src={imgSrc} alt="" style={{ maxWidth:'100%', height:'auto', borderRadius:8 }} /><label className="field">{t('imageWidth')}<select value={imgWidth} onChange={e=>setImgWidth(e.target.value)}>{IMAGE_WIDTH_PRESETS.map(p=><option key={p.value} value={p.value}>{p.value==='' ? t('imageWidthOriginal') : p.label}</option>)}</select></label><label className="field">{t('imageCaption')}<input value={imgCaption} dir="auto" onChange={e=>setImgCaption(e.target.value)} /></label><label className="field">{t('imageAltPrompt')}<input value={imgAlt} dir="auto" onChange={e=>setImgAlt(e.target.value)} /></label><div className="row wrap"><button type="button" className="rbtn" onClick={()=>replaceImgRef.current?.click()}>{t('imageReplace')}</button><button type="button" className="danger-btn" onClick={deleteImageEdit}>{t('delete')}</button></div><div className="row end"><button type="button" className="rbtn" onClick={()=>setImgEditOpen(false)}>{t('cancel')}</button><button type="submit" className="primary small">{t('save')}</button></div></form></div>}
    {shortcutsOpen && <KeyboardShortcutsDialog open={shortcutsOpen} onClose={()=>setShortcutsOpen(false)} lang={lang} />}
    {settingsOpen && settingsAvailable && settings && onSettingsChange && onSettingsReset && <SettingsPanel settings={settings} lang={lang} onChange={onSettingsChange} onReset={onSettingsReset} onClose={()=>setSettingsOpen(false)} />}
    {setupDialog && <div className="modal-backdrop" onClick={()=>setSetupDialog(null)}><form className="modal" ref={setupDialogRef} onClick={e=>e.stopPropagation()} onSubmit={e=>{ e.preventDefault(); applySetupDialog() }}><h2>{t('pageSetup')} — {setupDialog==='size' ? t('pageSize') : t('customMargins')}</h2>
      <label className="field">{t('unit')}<select value={psUnit} onChange={e=>changePsUnit(e.target.value as LengthUnit)}><option value="mm">{t('unitMm')}</option><option value="cm">{t('unitCm')}</option><option value="in">{t('unitIn')}</option></select></label>
      {setupDialog==='size' ? <>
        <label className="field">{t('pageWidth')}<input type="number" step="any" min="0" autoFocus value={psW} onChange={e=>setPsW(e.target.value)} /></label>
        <label className="field">{t('pageHeight')}<input type="number" step="any" min="0" value={psH} onChange={e=>setPsH(e.target.value)} /></label>
      </> : <>
        <label className="field">{t('marginTop')}<input type="number" step="any" min="0" autoFocus value={pmT} onChange={e=>setPmT(e.target.value)} /></label>
        <label className="field">{t('marginBottom')}<input type="number" step="any" min="0" value={pmB} onChange={e=>setPmB(e.target.value)} /></label>
        <label className="field">{t('marginLeft')}<input type="number" step="any" min="0" value={pmL} onChange={e=>setPmL(e.target.value)} /></label>
        <label className="field">{t('marginRight')}<input type="number" step="any" min="0" value={pmR} onChange={e=>setPmR(e.target.value)} /></label>
      </>}
      {psError && <p className="form-error" role="alert">{psError}</p>}
      <div className="row end"><button type="button" className="rbtn" onClick={()=>setSetupDialog(null)}>{t('cancel')}</button><button type="submit" className="primary small">{t('apply')}</button></div>
    </form></div>}
    {hfOpen && <div className="modal-backdrop" onClick={()=>setHfOpen(false)}><form className="modal" ref={hfDialogRef} onClick={e=>e.stopPropagation()} onSubmit={e=>{ e.preventDefault(); applyHfDialog() }}><h2>{t('headerFooter')}</h2><label className="field">{t('headerTextLabel')}<input value={hfDraft.header} dir="auto" maxLength={200} onChange={e=>setHfDraft(d=>({...d, header:e.target.value}))}/></label><label className="field">{t('footerTextLabel')}<input value={hfDraft.footer} dir="auto" maxLength={200} onChange={e=>setHfDraft(d=>({...d, footer:e.target.value}))}/></label><div className="row end"><button type="button" className="rbtn" onClick={()=>setHfOpen(false)}>{t('cancel')}</button><button type="submit" className="primary small">{t('apply')}</button></div></form></div>}
    {toast && <div className="toast" role="alert">{toast}</div>}
    <input ref={fileImgRef} type="file" accept="image/*" hidden onChange={onImage}/>
    <input ref={replaceImgRef} type="file" accept="image/*" hidden onChange={onReplaceImage}/>
    <input ref={importRef} type="file" accept=".txt,.docx" hidden onChange={onImport}/>
  </div>
}
