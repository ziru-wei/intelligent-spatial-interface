// ModOS stage 3b · Fill: each chosen MOD's selectors, one decision call per MOD (questions generated in selectors.mjs). A filler
// remembers what it started, so a place MOD filled early (while grounding runs) is not asked twice.
import {selectorQuestions,selectorSources} from './selectors.mjs';

const r2=x=>Math.round((x??0)*100)/100;
const optionLabel=(k,v)=>{try{const o=JSON.parse(v);if(o?.item)return o.item;}catch{}
  if(/^t\d+$/.test(k))return String(v).replace(/^\(the user is pointing at it\) /,'').replace(/: .*$/,'');
  if(/^d\d+$/.test(k))return String(v).split(', ').slice(0,2).join(', ');   // a day as people say it: "Saturday 2026-11-21, today"
  if(/^(d\d+_|p\d+$|c\d+$|e\d+$)/.test(k))return String(v).replace(/ \(.*$/,'').replace(/: look at it.*$/,': look');return k.replace(/^item_\d+$/,'item');};
/** For the pipeline view: each selector's options and what was chosen. A choice lists its options with probabilities; the per-date and
 *  per-time scores of a timeseries selector are grouped and labelled by the date or time they ask about. */
export function fillView(questions,a,selection=null){
  const out=[],groups=new Map();
  for(const [id,q] of Object.entries(questions)){
    if(q.kind==='choose'){const p=a[id].probabilities||{[a[id].choice]:a[id].probability??1};
      out.push({name:id.replace(/__/,'.'),options:(e=>e.length<=6?e:[...e.filter(o=>o[0]===optionLabel(a[id].choice,q.options[a[id].choice])),...e.filter(o=>o[0]!==optionLabel(a[id].choice,q.options[a[id].choice])).sort((x,y)=>y[1]-x[1]).slice(0,5)])(Object.entries(q.options).map(([k,v])=>[optionLabel(k,v),r2(p[k])])),chosen:optionLabel(a[id].choice,q.options[a[id].choice])});continue;}
    const m=id.match(/^(.*)_(date|slot)_\d+$/),n=id.match(/^(.*)_\d+$/),group=m?`${m[1]} · ${m[2]==='date'?'days':'times'}`:n?n[1]:id;
    const quoted=q.instructions.match(/"([^"]+)"/)?.[1]?.split(':')[0];
    const label=q.label||(m?(q.instructions.match(/\d{4}-\d{2}-\d{2}/)||q.instructions.match(/\b\d{2}:\d{2}\b/)||[id])[0]:quoted||id);
    if(!groups.has(group))groups.set(group,[]);groups.get(group).push([label,r2(a[id].score)]);
  }
  // what was chosen is what the fill took: a rule may take what scored under .5 (a person the request names is a recipient)
  for(const [name,opts] of groups){const sel=selection?.[name],took=sel?.kind==='contacts'?sel.people.map(p=>p.name):null;
    out.push({name,options:opts.slice(0,8),chosen:took||opts.filter(o=>o[1]>=.5).map(o=>o[0])});}
  return out;
}

export function createFiller({view,items,decide,trace=()=>{}}){
  const started=new Map();let reference=null;
  return {
    setReference(r){reference=r;},
    /** context: the MOD's context info (item ids, from context-request.mjs), which some selectors choose among. asked: what is asked
     *  of this MOD, {now, before}: the words of its theme being spoken of now, which its selectors answer (user_question), and those
     *  of its other themes, given as context (a MOD that showed next week's weather shows today's once the user asks about today), and
     *  `last`: the latest sentence of its theme, which decides over its earlier words;
     *  without it, the whole utterance. kept (answer while typing): the answers of earlier revisions by selector and evidence, so a
     *  selector whose evidence is the same is not asked again. */
    fill(mod,context=[],{asked=null,kept=null}={}){
      if(!started.has(mod.id))started.set(mod.id,(async()=>{
        const sources=selectorSources(mod),bodies=sources.length?Object.fromEntries((await items(sources)).map(b=>[b.id,b])):{};
        const question=asked?.now||view.state?.user_question||'',about=asked?JSON.stringify(asked):null;
        const state={...view.state,user_question:question,...(asked?.last?{said_last:{note:'What the user says now about this need, the latest of user_question. Where it differs from its earlier words (a correction, another day), said_last decides.',words:asked.last}}:{}),...(asked?.before?.length?{said_before:{note:'What the user said earlier about this same need: context only. Where it differs from user_question (a correction, another day), user_question decides.',words:asked.before}}:{})};
        const qs=selectorQuestions(mod,bodies,{reference,view,question,about,context:context.map(id=>view.snap.items.find(i=>i.id===id)).filter(Boolean)});
        if(!Object.keys(qs.questions).length)return {};
        const keyOf=s=>`${mod.id}|${s.name}|${s.evidence}`,same=kept?qs.selectors.filter(s=>kept.has(keyOf(s))):[];
        const ask=Object.fromEntries(Object.entries(qs.questions).filter(([k])=>!same.some(s=>s.keys.includes(k))));
        const answered=Object.keys(ask).length?await decide(`modos_fill_${mod.id}`,{...state,capability:{name:mod.name,description:mod.description},data:qs.data,reference_resolution:reference},ask):{};
        const a={...Object.assign({},...same.map(s=>kept.get(keyOf(s)))),...answered};
        if(kept)for(const s of qs.selectors)if(!same.includes(s))kept.set(keyOf(s),Object.fromEntries(s.keys.map(k=>[k,a[k]])));
        const selection=qs.interpret(a);trace('modos_fill',JSON.stringify({mod:mod.id,selection,...(same.length?{kept:same.map(s=>s.name)}:{})}));
        trace('view_fill',JSON.stringify({mod:mod.name,selectors:fillView(qs.questions,a,selection),...(same.length?{kept:same.map(s=>s.name)}:{})}));return selection;
      })());
      return started.get(mod.id);
    }
  };
}
