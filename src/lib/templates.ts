import type { DocDir } from './dir'
export interface Template { id:string; name:string; description:string; dir:DocDir; premium?:boolean; content:any }
function p(text:string, style?:string){ return style? {type:'paragraph', attrs:{textAlign: style}, content: text?[{type:'text',text}]:undefined} : {type:'paragraph', content: text?[{type:'text',text}]:undefined} }
function h(level:number, text:string){ return {type:'heading', attrs:{level}, content:[{type:'text',text}]} }
function bp(items:string[]){ return {type:'bulletList', content: items.map(t=>({type:'listItem', content:[p(t)]}))} }
export const TEMPLATES: Template[] = [
 { id:'blank', name:'Blank', description:'Empty document', dir:'ltr', content:{type:'doc', content:[{type:'paragraph'}]} },
 { id:'formal-letter', name:'Formal letter', description:'Business formal letter', dir:'ltr', content:{type:'doc', content:[p('Your Name | Address | Email'),' ',h(1,'Formal Letter'),p('Dear Sir / Madam,'),p('I am writing to ...'),p('Thank you for your consideration.'),p('Sincerely,'),p('Your Name')].filter(Boolean)} },
 { id:'cv', name:'CV / Resume', description:'Professional CV', dir:'ltr', content:{type:'doc', content:[h(1,'Your Name'),p('Email • Phone • City'),h(2,'Summary'),p('Professional summary...'),h(2,'Experience'),bp(['Role — Company — Dates','Achievement']),h(2,'Education'),p('Degree, University, Year'),h(2,'Skills'),bp(['Skill 1','Skill 2'])]} },
 { id:'formal-report', name:'Formal report', description:'Structured report', dir:'ltr', content:{type:'doc', content:[h(1,'Formal Report'),p('Prepared by: —  Date: —'),h(2,'Executive Summary'),p('...'),h(2,'Findings'),p('...'),h(2,'Recommendations'),bp(['Recommendation 1'])]} },
 { id:'academic-report', name:'Academic report', description:'Academic structure', dir:'ltr', content:{type:'doc', content:[h(1,'Academic Report Title'),p('Author • Institution • Date'),h(2,'Abstract'),p('...'),h(2,'Introduction'),p('...'),h(2,'Methodology'),p('...'),h(2,'Results'),p('...'),h(2,'Conclusion'),p('...'),h(2,'References'),p('[1] ...')]} },
 { id:'assignment', name:'Assignment', description:'Student assignment', dir:'ltr', content:{type:'doc', content:[h(1,'Assignment Title'),p('Student: —  Course: —  Lecturer: —'),h(2,'Question / Task'),p('...'),h(2,'Answer'),p('Write your answer here...')]} },
 { id:'dari-letter', name:'نامه رسمی (Dari)', description:'Dari formal letter — RTL sample', dir:'rtl', premium:false, content:{type:'doc', content:[h(1,'نامه رسمی'),p('به نام خدا'),p('محترم ...'),p('احتراماً، این نامه به منظور ... نوشته شده است.'),p('با احترام'),p('نام شما')]} },
]
export function getTemplate(id:string){ return TEMPLATES.find(t=>t.id===id) }
