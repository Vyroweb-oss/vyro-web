import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
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
import { tr, type UiLang, type I18nKey } from '../lib/i18n'

const PageBreak = Node.create({
  name:'pageBreak', group:'block', atom:true,
  parseHTML(){ return [{tag:'hr[data-page-break]'}] },
  renderHTML({HTMLAttributes}){ return ['hr', mergeAttributes(HTMLAttributes, {'data-page-break':'', class:'page-break'})] },
  addCommands(){ return { insertPageBreak: () => ({commands}:any) => commands.insertContent({type:'pageBreak'}) } as any },
})

declare module '@tiptap/core' { interface Commands<ReturnType> { pageBreak: { insertPageBreak: () => ReturnType } } }

const MARGINS = { narrow:'12.7mm', normal:'25.4mm', wide:'38.1mm' } as const
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const TABS: { id:string; key:I18nKey }[] = [
  { id:'File', key:'tabFile' }, { id:'Home', key:'tabHome' }, { id:'Insert', key:'tabInsert' },
  { id:'Layout', key:'tabLayout' }, { id:'References', key:'tabReferences' }, { id:'Review', key:'tabReview' }, { id:'View', key:'tabView' },
]

export default function Editor({ doc, onChange, onBack, isPremium, onRequirePremium, theme, onToggleTheme, lang }:{ doc:VyroDoc; onChange:(patch:Partial<VyroDoc>, content?:any)=>void; onBack:()=>void; isPremium:boolean; onRequirePremium:()=>void; theme:string; onToggleTheme:()=>void; lang:UiLang }){
  const t=(k:I18nKey)=>tr(lang,k)
  const [tab,setTab]=useState('Home')
  const [zoom,setZoom]=useState(100)
  const [savedAt,setSavedAt]=useState<string>('')
  const [saveState,setSaveState]=useState<'saved'|'saving'>('saved')
  const [spell,setSpell]=useState(true)
  const [toast,setToast]=useState('')
  const saveTimer=useRef<any>(null)
  const pendingJson=useRef<any>(null)
  const onChangeRef=useRef(onChange); onChangeRef.current=onChange
  const fileImgRef=useRef<HTMLInputElement>(null)
  const importRef=useRef<HTMLInputElement>(null)

  useEffect(()=>{ if(!toast) return; const id=setTimeout(()=>setToast(''),6000); return ()=>clearTimeout(id) },[toast])

  const flushSave=()=>{ if(saveTimer.current){ clearTimeout(saveTimer.current); saveTimer.current=null } if(pendingJson.current){ const j=pendingJson.current; pendingJson.current=null; onChangeRef.current({}, j); setSavedAt(new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})); setSaveState('saved') } }
  const flushRef=useRef(flushSave); flushRef.current=flushSave
  // Flush any debounced edit before the editor unmounts (doc switch / back) so the last keystrokes are never lost.
  useEffect(()=>()=>{ flushRef.current() },[])
  const goBack=()=>{ flushSave(); onBack() }

  const editor=useEditor({
    extensions:[
      StarterKit.configure({ link:false, underline:false } as any),
      Underline, Link.configure({ openOnClick:false }),
      TextAlign.configure({ types:['heading','paragraph'] }),
      TextStyleKit, Highlight.configure({multicolor:true}),
      TableKit.configure({ table:{ resizable:true } }),
      Image, Placeholder.configure({ placeholder:'Start typing…' }),
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

  if(!editor) return <div className="loading">{t('loadingEditor')}</div>
  const words = editor.getText().trim()? editor.getText().trim().split(/\s+/).length:0
  const chars = (editor.storage as any).characterCount?.characters?.() ?? editor.getText().length

  const gated=(fn:()=>void)=> isPremium? fn() : onRequirePremium()
  const download=(name:string, text:string, type:string)=>{ const b=new Blob([text],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000) }
  const exportTxt=()=> download(`${doc.title}.txt`, jsonToPlainText(editor.getJSON()), 'text/plain')
  const exportHtml=()=> download(`${doc.title}.html`, `<!doctype html><html dir="${doc.dir}"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title></head><body>${editor.getHTML()}</body></html>`, 'text/html')
  const insertToc=()=>{ const items:{level:number;text:string}[]=[]; editor.state.doc.descendants((n:any)=>{ if(n.type.name==='heading') items.push({level:n.attrs.level, text:n.textContent}) }); if(!items.length){ setToast(t('noHeadings')); return } const html=`<h2>${escapeHtml(t('tocHeading'))}</h2>`+items.map(i=>`<p style="margin-left:${(i.level-1)*18}px">${escapeHtml(i.text)}</p>`).join(''); editor.chain().focus().insertContent(html).run() }

  const onImport=async(e:React.ChangeEvent<HTMLInputElement>)=>{ const f=e.target.files?.[0]; if(!f) return; try{
    const isDocx=/\.docx$/i.test(f.name); const isTxt=/\.txt$/i.test(f.name)
    if(!isDocx && !isTxt) throw new Error(t('importUnsupported'))
    if(isDocx){ const mammoth=(await import('mammoth')).default ?? (await import('mammoth')); const buf=await f.arrayBuffer(); const res=await (mammoth as any).convertToHtml({arrayBuffer:buf}); editor.commands.setContent(res.value||'<p></p>'); onChange({title:f.name.replace(/\.docx$/i,'')}, editor.getJSON()) }
    else { const txt=await f.text(); editor.commands.setContent(txt.split(/\n{2,}/).map((para:string)=>`<p>${escapeHtml(para).replace(/\n/g,'<br>')}</p>`).join('')); onChange({title:f.name.replace(/\.txt$/i,'')}, editor.getJSON()) }
  }catch(err:any){ setToast(`${t('importFailed')}: ${err?.message||err}`) } finally{ e.target.value='' } }

  const onImage=(e:React.ChangeEvent<HTMLInputElement>)=>{ const f=e.target.files?.[0]; e.target.value=''; if(!f) return; if(!f.type.startsWith('image/')){ setToast(t('imageInvalid')); return } if(f.size>MAX_IMAGE_BYTES){ setToast(t('imageTooLarge')); return } const r=new FileReader(); r.onerror=()=>setToast(t('importFailed')); r.onload=()=> editor.chain().focus().setImage({src:String(r.result)}).run(); r.readAsDataURL(f) }
  const setLink=()=>{ const prev=editor.getAttributes('link').href||''; const url=prompt(t('linkPrompt'), prev); if(url===null) return; if(url===''){ editor.chain().focus().unsetLink().run(); return } if(!isSafeLinkUrl(url)){ setToast(t('linkInvalid')); return } editor.chain().focus().setLink({href:url.trim()}).run() }

  const Btn=(p:{onClick:()=>void; active?:boolean; title?:string; children:any; disabled?:boolean})=>(<button type="button" className={`rbtn${p.active?' active':''}`} onClick={p.onClick} title={p.title||''} disabled={p.disabled}>{p.children}</button>)
  const Group=(p:{label:string; children:any})=>(<div className="rgroup"><div className="rgroup-items">{p.children}</div><div className="rgroup-label">{p.label}</div></div>)

  const pageW = doc.orientation==='landscape' ? '297mm':'210mm'
  const pageMinH = doc.orientation==='landscape' ? '210mm':'297mm'

  return <div className="editor-shell">
    <header className="editor-top">
      <div className="top-start"><button className="back-btn" onClick={goBack}>← {t('dashboard')}</button><div className="logo"><span className="vmark">V</span> Vyro Web</div></div>
      <input className="title-input" value={doc.title} onChange={e=>onChange({title:e.target.value})} aria-label={t('docTitleLabel')}/>
      <div className="top-end"><span className="saved" role="status">{saveState==='saving'? t('saving') : savedAt? `${t('saved')} ${savedAt}`: t('savedLocally')}</span><span className="badge">{isPremium? t('premiumActive') : t('free')}</span></div>
    </header>
    <nav className="ribbon-tabs">{TABS.map(tb=><button key={tb.id} className={tab===tb.id?'tab active':'tab'} onClick={()=>setTab(tb.id)}>{t(tb.key)}</button>)}</nav>
    <div className="ribbon">
      {tab==='File' && <>
        <Group label={t('groupDocument')}><Btn onClick={goBack}>{t('dashboard')}</Btn><Btn onClick={()=>{ pendingJson.current=editor.getJSON(); flushSave() }}>{t('saveNow')}</Btn></Group>
        <Group label={t('groupImport')}><Btn onClick={()=>importRef.current?.click()}>{t('importBtn')}</Btn></Group>
        <Group label={t('groupExport')}><Btn onClick={exportTxt}>{t('exportTxt')}</Btn><Btn onClick={exportHtml}>{t('exportHtml')}</Btn><Btn onClick={()=>gated(()=>exportDocx(editor.getJSON(), doc.title))}>{t('exportDocx')} {!isPremium&&'🔒'}</Btn><Btn onClick={()=>gated(()=>window.print())}>{t('printPdf')} {!isPremium&&'🔒'}</Btn></Group>
      </>}
      {tab==='Home' && <>
        <Group label={t('groupHistory')}><Btn onClick={()=>editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>{t('undo')}</Btn><Btn onClick={()=>editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>{t('redo')}</Btn></Group>
        <Group label={t('groupStyle')}><select aria-label="Block style" value={editor.isActive('heading',{level:1})?'h1':editor.isActive('heading',{level:2})?'h2':editor.isActive('heading',{level:3})?'h3':'p'} onChange={e=>{ const v=e.target.value; const c=editor.chain().focus(); if(v==='p') c.setParagraph().run(); else c.toggleHeading({level:Number(v.slice(1)) as any}).run() }}><option value="p">{t('paragraph')}</option><option value="h1">{t('heading1')}</option><option value="h2">{t('heading2')}</option><option value="h3">{t('heading3')}</option></select>
        <select aria-label="Font size" defaultValue="16" onChange={e=>editor.chain().focus().setFontSize(e.target.value+'px').run()}>{[11,12,14,16,18,20,24,28,36].map(s=><option key={s} value={s}>{s}px</option>)}</select></Group>
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
        <Group label={t('groupLinksBreaks')}><Btn active={editor.isActive('link')} onClick={setLink}>{t('link')}</Btn><Btn onClick={()=>editor.chain().focus().setHorizontalRule().run()}>{t('horizontalLine')}</Btn><Btn onClick={()=>editor.chain().focus().insertPageBreak().run()}>{t('pageBreak')}</Btn></Group>
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
    <div className="workspace">
      <div className="page-wrap" style={{ zoom: zoom/100 } as any}>
        <div className={`a4-page ${doc.orientation==='landscape'?'landscape':'portrait'}`} style={{ width:pageW, minHeight:pageMinH, padding:MARGINS[doc.margins||'normal'] }}>
          <EditorContent editor={editor}/>
        </div>
      </div>
    </div>
    <footer className="status-bar">
      <span>{words} {t('words')} · {chars} {t('chars')}</span>
      <span className="status-dir">{doc.dir==='rtl' ? 'RTL · دری/فارسی' : 'LTR · English'}</span>
      <label className="status-zoom">{t('zoom')}<input type="range" min={50} max={200} step={5} value={zoom} onChange={e=>setZoom(Number(e.target.value))} aria-label={t('zoom')}/><span>{zoom}%</span></label>
    </footer>
    {toast && <div className="toast" role="alert">{toast}</div>}
    <input ref={fileImgRef} type="file" accept="image/*" hidden onChange={onImage}/>
    <input ref={importRef} type="file" accept=".txt,.docx" hidden onChange={onImport}/>
  </div>
}
