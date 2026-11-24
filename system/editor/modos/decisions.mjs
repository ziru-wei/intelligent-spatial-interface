// ModOS · the decision record (design doc 12.31): one per run of the pipeline (a revision, or the question asked), the raw data that
// every view of the pipeline is drawn from (src/pipeline-view.mjs, the words row's marks and themes: src/recompute-marks.mjs). A view
// is a shell around it: changing how the process is shown never changes what is recorded.
// It is a graph of the decisions this run made, each with what triggered it (`because`, ids of other nodes), so a view can show why
// something was computed again:
//   run        {rev, final, pause, routed: sentences asked about now, of: all sentences, grounding_calls: 1 | 2}
//   grounding  {referent: the thing the question is about, reference: the item a pronoun resolves to (from its themes)}
//   sentences  s<i>: {text, span: [from, to] in the question's words, routed (asked about this run, else kept from before),
//              request_type: [information | action | stop_prev] or [none], into: themes it continues or began, continuation: more |
//              detail | correct (going on with an earlier theme), also_uses: themes it also uses, ends: a theme it stops, adds, know,
//              yesNo; judged: what the model weighed, by decision {request_type: {information, action, stop_prev, none: p},
//              earlier_or_new: {t<id> | s<i> | new: p}, continuation: {more, detail, correct: p}, context_anchor: {option: p},
//              also_uses: {t<id>: p}, answer_form: p (yes/no)}}
//   themes     t<id>: {words, about, referent, items, mods: {id: score >= .3}, focus, ended, judged (its MODs judged this run), moved
//              (a sentence going on with it anchored it to another thing or place),
//              change: new | joined | mentioned | stopped | null, because: [s<i>]}
//   mods       m<id> (every MOD that could apply): {name, score, state: came | stays | went | instead (another way to show the same need) | no, instead?, serves: [t<id>]}
//   fills      f<id>: {answers: [t<id>] (focus or said last), context: [t<id>], reused (nothing it reads changed), kept: selectors not
//              asked again, selectors: [{name, options: [[label, p]], chosen}], because: [t<id>]}
//   parts      p<key>: {mod, change: new | updated | kept | withdrawn, because: [f<id>]}
//   text       {answers: s<i> | null, state: writing | kept | dimmed | withdrawn | none, because: [s<i>]}
// Pure helpers; the pipeline fills a record as it goes (createRecord) and logs it at the end of the run (trace 'decisions').

/** Where each sentence stands in the words (they are cut from them in order). */
const r2=x=>Math.round((x??0)*100)/100;
export function spans(text,sentences){
  let pos=0;return sentences.map(s=>{const k=String(text).indexOf(s,pos);if(k<0)return null;pos=k+s.length;return [k,k+s.length];});
}

export function createRecord(){
  const r={run:null,sentences:[],themes:[],mods:[],fills:[],parts:[],text:{answers:null,state:'none',because:[]}};
  return {
    r,
    /** What the question refers to in the world, from its themes (modos/grounding.mjs). */
    grounding({referent,reference}){r.grounding={referent:referent?.name||null,reference:reference?.status==='resolved'?reference.referent?.item_id||'resolved':null};},
    /** Stage 1: the sentences and where they went; the themes of the question (and those it stopped). */
    request({rev,final,pause,text,sentences,idx,routes,book,touched,focus,rejudged,moved=[],groundingCalls=1}){
      const at=spans(text,sentences);
      r.run={rev:rev??null,final:!!final,pause:!!pause,routed:idx.length,of:sentences.length,grounding_calls:groundingCalls};
      const out=[];
      r.sentences=sentences.map((s,i)=>{const c=routes[i]||{},x=c.route||{};const began=!x.into?.length&&x.adds?[c.newId]:[];
        // what the model weighed, as it weighed it: call 1 (request_type), call 2 (earlier_or_new, continuation, context_anchor, also_uses, answer_form)
        const p=x.p,o=m=>m?Object.fromEntries(Object.entries(m).map(([k,v])=>[k,r2(v)])):null,t=x.type;
        const judged=p?{request_type:p.type?{information:r2(p.type.info),action:r2(p.type.action),stop_prev:r2(p.type.stop),none:r2(p.type.none)}:null,
          earlier_or_new:o(p.prev),continuation:o(p.how),context_anchor:o(p.about),also_uses:Object.fromEntries(Object.entries(p.refs||{}).map(([k,v])=>[`t${k}`,r2(v)])),answer_form:p.yesno==null?null:r2(p.yesno)}:null;
        const request_type=t?(t.none?['none']:[t.info&&'information',t.action&&'action',t.stop&&'stop_prev'].filter(Boolean)):null;
        const into=x.follows!=null?(out[x.follows]?.into||[]):[...(x.into||[]),...(x.begins?[c.newId]:[])].map(t=>`t${t}`);
        return out[i]={id:`s${i}`,text:s,span:at[i],routed:idx.includes(i),...(request_type?{request_type}:{}),into,...(x.follows!=null?{follows:`s${x.follows}`}:{}),continuation:x.how||null,also_uses:(x.refs||[]).map(t=>`t${t}`),
          ends:x.ends!=null?`t${x.ends}`:null,adds:x.adds!==false,know:!!x.know,yesNo:!!x.yesNo,...(judged?{judged}:{})};});
      const stopped=book.themes.filter(t=>t.ended?.why==='said'&&t.ended.q!=null&&r.sentences.some(s=>s.ends===`t${t.id}`)).map(t=>t.id);
      r.themes=[...touched,...stopped.filter(id=>!touched.includes(id))].map(id=>{const t=book.themes.find(x=>x.id===id),tid=`t${id}`;
        const into=r.sentences.filter(s=>s.routed&&s.into.includes(tid)),ref=r.sentences.filter(s=>s.routed&&s.also_uses.includes(tid)),end=r.sentences.filter(s=>s.ends===tid);
        const isNew=t.sentences.length&&into.length&&t.sentences.every(x=>r.sentences[x.i]?.into.includes(tid));
        const change=t.ended?'stopped':isNew&&into.length===t.sentences.length?'new':into.length?'joined':ref.length?'mentioned':null;
        return {id:tid,words:t.sentences.map(x=>x.text).join(' ').slice(-160),about:t.about,referent:t.referent?.name||null,items:(t.items||[]).map(x=>x.item_id),mods:Object.fromEntries(Object.entries(t.mods||{}).filter(([,v])=>v>=.3).map(([k,v])=>[k,Math.round(v*100)/100])),
          focus:focus.includes(id),ended:t.ended?.why||null,judged:rejudged.includes(id),moved:moved.includes(id),
          change,because:[...into,...ref,...end].map(s=>s.id)};});
    },
    /** Stage 2: each MOD that scored, was shown, or was chosen; and what it serves. */
    mods({mods,scores,before,chosen,alternatives,serves}){
      const on=new Set(chosen.map(c=>c.mod.id)),alt=new Map(alternatives.map(a=>[a.mod.id,a.instead.id]));
      r.mods=mods.map(m=>{
        const state=alt.has(m.id)?'instead':on.has(m.id)?(before.has(m.id)?'stays':'came'):before.has(m.id)?'went':'no';
        return {id:`m${m.id}`,name:m.name,score:Math.round((scores[m.id]??1)*100)/100,state,...(alt.has(m.id)?{instead:`m${alt.get(m.id)}`}:{}),serves:(serves(m)||[]).map(t=>`t${t}`)};});
    },
    fill(mod,{asked,reused,kept=[],selectors=[]}){
      const ids=x=>(x||[]).map(t=>`t${t}`);r.fills=r.fills.filter(f=>f.id!==`f${mod}`);
      // selectors: each choice the fill made, with its options and how likely each was ({name, options: [[label, p]], chosen})
      r.fills.push({id:`f${mod}`,mod:`m${mod}`,answers:ids(asked?.now),context:ids(asked?.before),reused:!!reused,kept,selectors,because:[...ids(asked?.now),...ids(asked?.before)]});
    },
    part(key,mod,change){r.parts.push({id:`p${key}`,mod:`m${mod}`,change,because:[`f${mod}`]});},
    text(state,answers=null){r.text={answers:answers!=null?`s${answers}`:null,state,because:answers!=null?[`s${answers}`]:[]};},
    /** What the language model wrote: its heading (Yes, No or Not sure when the sentence is a yes/no question). */
    written(title,yesNo){r.text={...r.text,title:title??null,title_form:yesNo?'Yes / No / Not sure':'a short title'};},
  };
}
