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

export interface EditorPaletteActions {
  insertTable: () => void
  insertDate: () => void
  exportTxt: () => void
  exportHtml: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
}

const PageBreak = Node.create({
  name:'pageBreak', group:'block', atom:true,
  parseHTML(){ return [{tag:'hr[data-page-break]'}] },
  renderHTML({HTMLAttributes}){ return ['hr', mergeAttributes(HTMLAttributes, {'data-page-break':'', class:'page-break'})] },
  addCommands(){ return { insertPageBreak: () => ({commands}:any) => commands.insertContent({type:'pageBreak'}) } as any },
})

declare module '@tiptap/core' { interface Commands<ReturnType> { pageBreak: { insertPageBreak: () => ReturnType } } }

const MARGINS = { narrow:'12.7mm', normal:'25.4mm', wide:'38.1mm' } as const
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MM_PX = 96 / 25.4
const FONT_FAMILIES = ['Vazirmatn', 'Tahoma', 'Arial', 'Georgia', "'Times New Roman'", "'Courier New'"]
const FONT_SIZES = [11,12,14,16,18,20,24,28,36]
const LINE_HEIGHTS = ['1','1.15','1.5','2']
const TABS: { id:string; key:I18nKey }[] = [
  { id:'File', key:'tabFile' }, { id:'Home', key:'tabHome' }, { id:'Insert', key:'tabInsert' },
  { id:'Layout', key:'tabLayout' }, { id:'References', key:'tabReferences' }, { id:'Review', key:'tabReview' }, { id:'View', key:'tabView' },
]

export default function Editor({ doc, onChange, onBack, isPremium, onRequirePremium, theme, onToggleTheme, lang, onLangChange, saveFailed, onPaletteOpen, onEditorActions }:{ doc:VyroDoc; onChange:(patch:Partial<VyroDoc>, content?:any)=>void; onBack:()=>void; isPremium:boolean; onRequirePremium:()=>void; theme:string; onToggleTheme:()=>void; lang:UiLang; onLangChange?:(l:UiLang)=>void; saveFailed?:boolean; onPaletteOpen?:()=>void; onEditorActions?:(a:EditorPaletteActions|null)=>void }){
  const t=(k:I18nKey)=>tr(lang,k)
  const [tab,setTab]=useState('Home')
  const [zoom,setZoom]=useState(100)
  const [savedAt,setSavedAt]=useState<string>('')
  const [saveState,setSaveState]=useState<'saved'|'saving'>('saved')
  const [spell,setSpell]=useState(true)
  const [toast,setToast]=useState('')
  const [linkOpen,setLinkOpen]=useState(false)
  const [linkUrl,setLinkUrl]=useState('')
  const [toolsOpen,setToolsOpen]=useState(false)
  const saveTimer=useRef<any>(null)
  const pendingJson=useRef<any>(null)
  const onChangeRef=useRef(onChange); onChangeRef.current=onChange
  const fileImgRef=useRef<HTMLInputElement>(null)
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

  const editor=useEditor({
    extensions:[
      StarterKit.configure({ link:false, underline:false } as any),
      Underline, Link.configure({ openOnClick:false }),
      TextAlign.configure({ types:['heading','paragraph'] }),
      TextStyleKit, Highlight.configure({multicolor:true}),
      TableKit.configure({ table:{ resizable:true } }),
      Image, Placeholder.configure({ placeholder: t('startTyping') }),
      CharacterCount, PageBreak,
    ],
    content: doc.content,
    editorProps:{ attributes:{ dir: doc.dir, spellcheck: String(spell) } as any },
    onUpdate({editor}){
      setSaveState('saving')
      pendingJson.current=editor.getJSON()
      if(saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current=setTimeout(()=>{ saveTimer.current=null; if(pendingJson.current){ const j=pendingJson.current; pendingJson.current=null; onChangeRef.current({}, j); setSavedAt(new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})); setSaveState('saved') } }, 500)
    },
  },[doc.id])

  useEffect(()=>{ if(editor){ editor.view.dom.setAttribute('spellcheck', String(spell)); editor.view.dom.setAttribute('dir', doc.dir) } },[spell, doc.dir, editor])

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
    })
    return ()=>onEditorActions(null)
    // doc.title/dir are deps on purpose: export filenames and the inserted
    // date follow the document's current title/direction, not its mount-time ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[editor, doc.title, doc.dir])

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

  const onImage=(e:React.ChangeEvent<HTMLInputElement>)=>{ const f=e.target.files?.[0]; e.target.value=''; if(!f) return; if(!f.type.startsWith('image/')){ setToast(t('imageInvalid')); return } if(f.size>MAX_IMAGE_BYTES){ setToast(t('imageTooLarge')); return } const r=new FileReader(); r.onerror=()=>setToast(t('importFailed')); r.onload=()=> editor.chain().focus().setImage({src:String(r.result)}).run(); r.readAsDataURL(f) }
  const openLink=()=>{ setLinkUrl(editor.getAttributes('link').href||''); setLinkOpen(true) }
  const applyLink=()=>{ const url=linkUrl.trim(); if(url===''){ editor.chain().focus().unsetLink().run(); setLinkOpen(false); return } if(!isSafeLinkUrl(url)){ setToast(t('linkInvalid')); return } editor.chain().focus().setLink({href:url}).run(); setLinkOpen(false) }
  const removeLink=()=>{ editor.chain().focus().unsetLink().run(); setLinkOpen(false) }

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

  return <div className="editor-shell">
    <header className="editor-top">
      <div className="top-start"><button className="back-btn" onClick={goBack}>← {t('dashboard')}</button><div className="logo"><span className="vmark">V</span> Vyro Web</div></div>
      <input className="title-input" value={doc.title} dir="auto" onChange={e=>onChange({title:e.target.value})} aria-label={t('docTitleLabel')}/>
      <div className="top-end">
        <span className="saved" role="status">{saveText}</span>
        <span className="badge">{isPremium? t('premiumActive') : t('free')}</span>
        {onPaletteOpen && <button className="rbtn" onClick={onPaletteOpen} title="Ctrl+K" aria-label={t('commandPalette')}>⌘K</button>}
        {onLangChange && <div className="lang-toggle mini" role="group" aria-label={t('language')}><button className={`rbtn${lang==='en'?' active':''}`} onClick={()=>onLangChange('en')}>EN</button><button className={`rbtn${lang==='fa'?' active':''}`} onClick={()=>onLangChange('fa')}>فا</button></div>}
        <button className="rbtn" onClick={onToggleTheme} title={theme==='dark'? t('lightUi'):t('darkUi')} aria-label={theme==='dark'? t('lightUi'):t('darkUi')}>{theme==='dark'?'☀':'☾'}</button>
      </div>
    </header>
    <div className={`ribbon-wrap${toolsOpen?' expanded':''}`}>
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
        <Btn onClick={()=>editor.chain().focus().unsetAllMarks().clearNodes().run()}>{t('clearFormatting')}</Btn></Group>
        <Group label={t('groupParagraph')}><Btn active={editor.isActive({textAlign:'left'})} onClick={()=>editor.chain().focus().setTextAlign('left').run()}>{t('alignLeft')}</Btn><Btn active={editor.isActive({textAlign:'center'})} onClick={()=>editor.chain().focus().setTextAlign('center').run()}>{t('alignCenter')}</Btn><Btn active={editor.isActive({textAlign:'right'})} onClick={()=>editor.chain().focus().setTextAlign('right').run()}>{t('alignRight')}</Btn><Btn active={editor.isActive({textAlign:'justify'})} onClick={()=>editor.chain().focus().setTextAlign('justify').run()}>{t('alignJustify')}</Btn></Group>
        <Group label={t('groupLists')}><Btn active={editor.isActive('bulletList')} onClick={()=>editor.chain().focus().toggleBulletList().run()}>{t('bulletList')}</Btn><Btn active={editor.isActive('orderedList')} onClick={()=>editor.chain().focus().toggleOrderedList().run()}>{t('orderedList')}</Btn><Btn active={editor.isActive('blockquote')} onClick={()=>editor.chain().focus().toggleBlockquote().run()}>{t('quote')}</Btn></Group>
      </>}
      {tab==='Insert' && <>
        <Group label={t('groupTable')}><Btn onClick={()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run()}>{t('insertTable')}</Btn><Btn onClick={()=>editor.chain().focus().addRowAfter().run()}>{t('addRow')}</Btn><Btn onClick={()=>editor.chain().focus().addColumnAfter().run()}>{t('addColumn')}</Btn><Btn onClick={()=>editor.chain().focus().deleteTable().run()}>{t('deleteTable')}</Btn></Group>
        <Group label={t('groupMedia')}><Btn onClick={()=>fileImgRef.current?.click()}>{t('imageLocal')}</Btn></Group>
        <Group label={t('groupLinksBreaks')}><Btn active={editor.isActive('link')} onClick={openLink}>{t('link')}</Btn><Btn onClick={()=>editor.chain().focus().setHorizontalRule().run()}>{t('horizontalLine')}</Btn><Btn onClick={()=>editor.chain().focus().insertPageBreak().run()}>{t('pageBreak')}</Btn></Group>
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
        <Group label={t('groupZoom')}><Btn onClick={()=>setZoom(z=>Math.max(50,z-10))}>−</Btn><span className="static-stat">{zoom}%</span><Btn onClick={()=>setZoom(z=>Math.min(200,z+10))}>+</Btn><Btn onClick={()=>setZoom(100)}>100%</Btn><Btn onClick={()=>setZoom(50)}>50%</Btn><Btn onClick={()=>setZoom(200)}>200%</Btn></Group>
        <Group label={t('groupTheme')}><Btn onClick={onToggleTheme}>{theme==='dark'? t('lightUi'):t('darkUi')}</Btn></Group>
        <Group label={t('groupDirection')}><span className="static-stat">{t('documentLabel')}: {doc.dir.toUpperCase()}</span></Group>
      </>}
      </div>
      {linkOpen && <div className="link-pop" role="dialog" aria-label={t('link')}>
        <label>{t('linkPrompt')}<input autoFocus value={linkUrl} dir="ltr" placeholder="https://…" onChange={e=>setLinkUrl(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); applyLink() } if(e.key==='Escape') setLinkOpen(false) }}/></label>
        <div className="row"><button className="primary small" onClick={applyLink}>{t('save')}</button>{editor.isActive('link') && <button className="rbtn" onClick={removeLink}>{t('removeLink')}</button>}<button className="rbtn" onClick={()=>setLinkOpen(false)}>{t('cancel')}</button></div>
      </div>}
    </div>
    <div className="workspace" ref={workspaceRef}>
      <div className="page-scaler" style={{ width:`${Math.round(pageMmW*MM_PX*effScale)}px`, height:`${Math.round(pagePxH*effScale)}px` }}>
        <div className="page-scale-inner" style={{ transform:`scale(${effScale})`, width:`${Math.round(pageMmW*MM_PX)}px` }}>
          <div ref={pageRef} className={`a4-page ${doc.orientation==='landscape'?'landscape':'portrait'}`} style={{ width:pageW, minHeight:pageMinH, padding:MARGINS[doc.margins||'normal'] }}>
            <EditorContent editor={editor}/>
          </div>
        </div>
      </div>
    </div>
    <footer className="status-bar">
      <span className="status-save">{saveText}</span>
      <span>{words} {t('words')} · {chars} {t('chars')}</span>
      <span className="status-dir">{doc.dir==='rtl' ? 'RTL · دری/فارسی' : 'LTR · English'}</span>
      <div className="status-zoom"><span>{t('zoom')}</span><button type="button" className="status-btn" aria-label="Zoom out" onClick={()=>setZoom(z=>Math.max(50,z-10))}>−</button><input type="range" min={50} max={200} step={5} value={zoom} onChange={e=>setZoom(Number(e.target.value))} aria-label={t('zoom')}/><span>{zoom}%</span><button type="button" className="status-btn" aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(200,z+10))}>+</button></div>
    </footer>
    {toast && <div className="toast" role="alert">{toast}</div>}
    <input ref={fileImgRef} type="file" accept="image/*" hidden onChange={onImage}/>
    <input ref={importRef} type="file" accept=".txt,.docx" hidden onChange={onImport}/>
  </div>
}
