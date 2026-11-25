// ModOS pipeline (modos-system-design.md section 6): orchestration only. Each stage is its own module:
//   view.mjs             what the stages read about the request (from the context snapshot)
//   grounding.mjs      1 what the request refers to (the headset's candidate, earlier turns)
//   request.mjs        1 the request's questions, what each is about, and how much each needs each MOD   (1: one decision call)
//   mod-selection.mjs  2 which MODs (eligibility is a rule; the scores come from 1)
//   context-request.mjs 3 each chosen MOD asks for the context info it needs, by rules along the twin (no model)
//   fill.mjs           4 each chosen MOD's slots (selectors.mjs generates the questions); its text slot is written by text.mjs
//   compose.mjs        5 selections → the parts the answer shows; which MOD hosts the text
// Only bounded decisions use a model (decision.mjs) before the text: one call for 1, one per chosen MOD for 4. Nothing searches the whole
// space: what a MOD reads is what it asks for.
// Answer while typing (design doc 12): `live` runs the same stages on each revision of a question still being typed and reconciles what
// it shows with what the last revision showed: a MOD comes once its need is clear, stays until it is clearly gone (CLEAR, KEEP), its
// parts are replaced in place when they change and withdrawn when it goes; the text is written when the user pauses and again on Enter.
//   live = {state (kept by the bridge across revisions), final (Enter), pause (the user paused), stale() (a newer revision came),
//           retract(keys)}
import {createView} from './view.mjs';
import {anchorThemes,referentOf,referenceOf} from './grounding.mjs';
import {splitRequest} from './request.mjs';
import {createRecord} from './decisions.mjs';
import {bookBefore,liveThemes,changed,typeCall,resolveTypes,groundCall,continuationCall,continuing,resolveGround,place,modCall,judged,steadyFocus,normalize,themeText,GROUNDING} from './themes.mjs';
import {eligible,placeModFor} from './mod-selection.mjs';
import {requestContext,fallbackContext} from './context-request.mjs';
import {createFiller} from './fill.mjs';
import {partsFor,textHost} from './compose.mjs';
import {runText,writeDraft} from './text.mjs';

export {eligible,partsFor,textHost};
export {splitRequest} from './request.mjs';
export {MODOS_INSTRUCTION} from './text.mjs';

// A MOD's need is clear at CLEAR in two revisions in a row, or at SURE in one; once shown it stays while its score is KEEP or more, so a
// phrase half typed does not make it blink. When the user pauses (or asks), their words are what they mean: the plain rule (CLEAR).
export const LIVE={CLEAR:.5,SURE:.85,KEEP:.35},ALT_GAP=.15;
/** Which MODs a revision shows: scores {id: 0-1} now, the last revision's and the ones shown; on Enter the plain rule (CLEAR). */
export function liveChoice(scores,{previous={},shown=new Set(),final=false}={}){
  return new Set(Object.entries(scores).filter(([id,s])=>final?s>=LIVE.CLEAR:shown.has(id)?s>=LIVE.KEEP:s>=LIVE.SURE||s>=LIVE.CLEAR&&(previous[id]??0)>=LIVE.CLEAR).map(([id])=>id));
}
/** A part's identity on its question's surface (as scripts/agent_store.py part_key): its kind and its MOD. */
export const partKey=p=>`${p.part!=='ui'?p.part:['weather','findmy','highlight','control','action'].find(k=>p[k]!=null)||'ui'}:${p.mod?.id||''}`;

const r2=x=>Math.round((x??0)*100)/100,itemLabel=id=>id.replace(/^(info|user|feed):/,'').replace(/^weather$/,'weather forecast');
const ABOUT={referent:'the thing looked at',here:'this place',user:'the user',world:'outside data',other:'something else'};

// themes: the conversation's theme book before this question (modos/themes.mjs); the result carries it updated (`themes`).
// Each run logs its decision record at its end (modos/decisions.mjs: the raw data every view of the pipeline is drawn from).
export async function runModos(args){
  const rec=createRecord();
  try{return await run(args,rec);}
  finally{if(rec.r.run)(args.trace||(()=>{}))('decisions',JSON.stringify(rec.r));}
}
async function run({question,memory,context,items,decide,answer,publish=async()=>{},recordInfo=async()=>{},trace=()=>{},live=null,themes=null,groundingCalls=GROUNDING.calls},rec){
  if(live)live.state={scores:{},shown:new Set(),published:new Map(),fills:new Map(),text:null,...live.state};
  const view=createView(await (context||memory)(),question);
  const keptOf={},selOf={},mods=view.snap.mods,filler=createFiller({view,items,decide,trace:(t,x)=>{if(t==='modos_fill')try{const v=JSON.parse(x);keptOf[v.mod]=v.kept||[];}catch{}
    if(t==='view_fill')try{const v=JSON.parse(x);selOf[v.mod]=v.selectors||[];}catch{}trace(t,x);}});
  // Stage 0 (rules): which MODs can apply here; place-scoped MODs start filling now (unused fills are dropped).
  const early={places:view.places,candidate:view.candidate,referent:null,itemIds:view.itemIds,aboutIds:view.aboutIds};
  for(const mod of mods)if(Array.isArray(mod.scope)&&eligible(mod,early))filler.fill(mod).catch(e=>trace('modos_error',e.message));
  const askable=mods.filter(m=>m.scope!=='referent'&&eligible(m,early));
  trace('view_context',JSON.stringify({places:view.places.map(view.nameOf),looking:view.candidate?view.nameOf(view.candidate):null,mods:mods.map(m=>m.name)}));

  // Stage 1 (design doc 12.32): the request's sentences, decided in order, each call given what the one before decided. Call 1, what
  // each new or changed sentence wants (its type: information, action, stop_prev, none; none changes nothing). Call 2, grounding: what
  // each is about (an earlier theme or something new; how it goes on with the earlier one, or what in the world the new one is about;
  // which other earlier themes it also uses) and, for information, whether it is answered by yes or no. Rules place it in its theme and
  // set the focus. Call 3: the MODs each theme whose words changed needs, judged once on all its words. While typing, only the sentences
  // new or changed since the last revision are asked about.
  const sentences=splitRequest(question.text),now=Date.now(),st=live?live.state:{},n=question.n??((themes?.asked||0)+1);
  const settle=!live||!!live.final||!!live.pause,typing=!!live&&!live.final;
  st.routes=(st.routes||[]).slice(0,sentences.length);st.needs||={};
  const base=bookBefore(themes,{q:question.id,n,now});st.nextId=Math.max(st.nextId||0,base.next);
  const idx=changed(st.routes,sentences);
  for(const i of idx)st.routes[i]={norm:normalize(sentences[i]),text:sentences[i],route:null,newId:st.routes[i]?.newId??st.nextId++};
  const offered=liveThemes(place(base,st.routes.map((c,i)=>idx.includes(i)?{...c,route:null}:c),{q:question.id,n,now}).book);
  const types=resolveTypes(idx.length?await decide('modos_request_type',view.state,typeCall(sentences,idx,{typing})):{},idx),asked=idx.filter(i=>!types[i].none);
  // grounding in one call, or two (themes.mjs GROUNDING: the tradeoff): the second asks how each sentence goes on with its earlier request
  let ga=asked.length?await decide('modos_grounding',view.state,groundCall(view,sentences,asked,offered,askable,types,{typing,how:groundingCalls===1})):{};
  const goesOn=groundingCalls===2?continuing(ga,asked,types):[];
  if(goesOn.length)ga={...ga,...await decide('modos_continuation',view.state,continuationCall(sentences,goesOn,ga,offered,askable,{typing}))};
  const routes=resolveGround(ga,idx,offered,types);for(const i of idx)st.routes[i].route=routes[i];
  const placed=place(base,st.routes,{q:question.id,n,now}),book=placed.book;
  const moved=anchorThemes(view,book,st.routes,placed.went,question.id);
  const unjudged=placed.rejudge.filter(id=>{const t=book.themes.find(x=>x.id===id),k=normalize(themeText(t)),known=st.needs[k];if(known)Object.assign(t,{mods:known.mods,key:k});return !known;});
  if(unjudged.length){const {questions,requests}=modCall(book,unjudged,askable);judged(book,await decide('modos_mod_need',{...view.state,requests},questions),unjudged,askable);
    for(const id of unjudged){const t=book.themes.find(x=>x.id===id);st.needs[t.key]={mods:t.mods};}}
  // a theme that has only just come has nothing to flicker against: it takes the focus at once (the steadying is between themes in view)
  const fresh=placed.raw.some(id=>!(st.seen||[]).includes(id));st.seen=[...new Set([...(st.seen||[]),...placed.touched])];
  st.focus=steadyFocus(st.focus,placed.raw,{settle:settle||fresh});
  // The themes this question speaks of are its questions from here on (their words, what they are about, the MODs they need).
  const req={questions:placed.touched.map(id=>book.themes.find(t=>t.id===id)).map(t=>({text:themeText(t),about:t.about,abouts:t.abouts||[t.about],mods:t.mods,theme:t.id,focus:st.focus.ids.includes(t.id),said:placed.said.includes(t.id),
    know:t.sentences.some(x=>x.q===question.id&&x.know),last:Math.max(-1,...t.sentences.filter(x=>x.q===question.id).map(x=>x.i)),
    lastHow:t.sentences.filter(x=>x.q===question.id).sort((a,b)=>a.i-b.i).at(-1)?.how||null})),newest:placed.newest};
  req.scores=Object.fromEntries(askable.map(m=>[m.id,Math.max(0,...req.questions.map(x=>x.mods[m.id]??0))]));req.yesNo=!!placed.newest?.yesNo;
  rec.request({rev:question.rev,final:live?live.final:true,pause:live?.pause,text:question.text,sentences,idx,routes:st.routes,book,touched:placed.touched,focus:st.focus.ids,rejudged:unjudged,moved,groundingCalls});
  const abouts=[...new Set(req.questions.flatMap(q=>q.abouts))];
  // the sentences asked about now and where each went; the themes of the question (their words' end), the focus
  trace('modos_themes',JSON.stringify({routed:idx.map(i=>({text:sentences[i].slice(0,50),...(({into,refs,adds,know,ends})=>({into,refs,adds,know,ends}))(st.routes[i].route)})),
    themes:req.questions.map(x=>({id:x.theme,text:x.text.length>50?'…'+x.text.slice(-50):x.text,about:x.about,focus:x.focus})),rejudged:unjudged,ended:book.themes.filter(t=>t.ended&&t.ended.at===now).map(t=>t.id)}));
  // what the question refers to in the world: the thing its themes are about, and the item an earlier theme found (modos/grounding.mjs)
  const themesNow=req.questions.map(x=>({...book.themes.find(t=>t.id===x.theme),focus:x.focus})),referent=referentOf(view,themesNow),reference=referenceOf(themesNow);
  rec.grounding({referent,reference});filler.setReference(reference);
  trace('modos_request',JSON.stringify({referent,reference:reference.status,questions:req.questions.map(q=>({text:q.text,about:q.about,know:q.know,focus:q.focus})),yes_no:req.yesNo}));
  trace('view_grounding',JSON.stringify({looking:view.candidate?view.nameOf(view.candidate):null,score:null,referent:referent?.name||null,reference:reference.status,
    questions:req.questions.map(q=>({text:q.text,focus:q.focus,about:q.about==='referent'&&view.candidate?view.nameOf(view.candidate):q.about==='here'&&view.places.length?view.nameOf(view.places[0]):q.about.startsWith('place:')?view.nameOf(q.about.slice(6)):ABOUT[q.about]}))}));

  // Stage 2: the MODs. A MOD scoped to the referent (WorldInfo) is taken when a question is about the thing and no place MOD speaks for it.
  const placeMod=placeModFor(mods,referent),ctx={...early,referent},shownBefore=new Set(live?.state.shown||[]);
  // WorldInfo answers a question about the thing when no other MOD takes that question (e.g. Send takes "send this to Alice").
  const untaken=req.questions.filter(q=>(q.about==='referent'||req.questions.length===1&&referent?.kind==='object')&&!askable.some(m=>q.mods[m.id]>=.5));
  const auto=referent&&!placeMod&&untaken.length?mods.filter(m=>m.scope==='referent'&&eligible(m,ctx)):[];
  // While typing (live), which MODs show is held steady across revisions (liveChoice); a MOD kept below CLEAR serves the questions it
  // scores KEEP or more on.
  let keep=m=>auto.includes(m)||req.scores[m.id]>=.5;
  if(live){const scores={...Object.fromEntries(askable.map(m=>[m.id,req.scores[m.id]])),...Object.fromEntries(auto.map(m=>[m.id,1]))};
    const on=liveChoice(scores,{previous:live.state.scores,shown:live.state.shown,final:live.final||live.pause});live.state.scores=scores;keep=m=>on.has(m.id);
    trace('view_live',JSON.stringify({final:!!live.final,pause:!!live.pause,shown:[...on]}));}
  // The themes a MOD serves: those that need it (.5 or more); a MOD kept on while typing with none that clearly does (LIVE.KEEP), the
  // ones it is kept for. The same whether or not the user paused, so what a part shows and whether it is in focus do not flip with it.
  const serves=m=>{if(auto.includes(m))return req.questions.map((_,k)=>k);const of=t=>req.questions.map((q,k)=>(q.mods[m.id]??0)>=t?k:-1).filter(k=>k>=0),clear=of(.5);return clear.length||!live?clear:of(LIVE.KEEP);};
  const chosen=[...auto.filter(keep).map(m=>({mod:m,score:1,abouts:['referent'],questions:serves(m)})),
    ...askable.filter(keep).map(m=>({mod:m,score:req.scores[m.id],abouts:[...new Set(serves(m).flatMap(k=>req.questions[k].abouts))],questions:serves(m)}))];
  trace('modos_mods',JSON.stringify(chosen.map(c=>[c.mod.id,r2(c.score)])));
  trace('view_mods',JSON.stringify({options:[...auto.map(m=>[m.name,'auto']),...askable.map(m=>[m.name,r2(req.scores[m.id])])],
    skipped:mods.filter(m=>!auto.includes(m)&&!askable.includes(m)).map(m=>m.name),chosen:chosen.map(c=>c.mod.name)}));

  // Stage 3: each MOD's context info (rules); with no MOD, what the questions are about.
  let requests=chosen.map(c=>({mod:c.mod,score:c.score,questions:c.questions,...requestContext(view,c.mod,{referent,abouts:c.abouts})}));
  // Two MODs for the same question that ask about the same things are two ways to show one need (ObjectStatus or IoTControl for
  // "is the printer free?"): the better one stays. Ones that ask about different things are two needs ("should I bring my umbrella?":
  // the forecast, and where the umbrella is): both stay.
  // The user is not a thing: belongings and contacts are both about `user:me`, and finding the umbrella and messaging Alice are two needs.
  const things=r=>new Set(r.items.flatMap(id=>view.snap.items.find(i=>i.id===id)?.about||[]).filter(a=>!a.startsWith('user:')));
  // While typing, the way already shown stays unless the other is clearly better (ALT_GAP): two near-equal ways do not take turns.
  const eff=r=>r.score+(shownBefore.has(r.mod.id)?ALT_GAP:0);
  const alternatives=[];
  for(const r of [...requests].sort((a,b)=>eff(b)-eff(a))){
    const kept=requests.find(k=>k!==r&&eff(k)>=eff(r)&&!alternatives.some(x=>x.mod===k.mod)&&k.questions.some(q=>r.questions.includes(q))&&[...things(r)].some(t=>things(k).has(t)));
    if(kept&&r.mod.scope!=='referent')alternatives.push({mod:r.mod,instead:kept.mod});
  }
  rec.mods({mods:[...auto,...askable],scores:{...req.scores,...Object.fromEntries(auto.map(m=>[m.id,1]))},before:shownBefore,chosen:chosen.filter(c=>!alternatives.some(x=>x.mod===c.mod)),alternatives,serves:m=>serves(m).map(k=>req.questions[k].theme)});
  if(alternatives.length){requests=requests.filter(r=>!alternatives.some(x=>x.mod===r.mod));chosen.splice(0,chosen.length,...chosen.filter(c=>!alternatives.some(x=>x.mod===c.mod)));
    trace('view_alternatives',JSON.stringify(alternatives.map(x=>[x.mod.name,x.instead.name])));trace('modos_mods_final',JSON.stringify(chosen.map(c=>[c.mod.id,r2(c.score)])));}
  // Fill. While typing, a MOD is filled again only when what it reads changed: its own questions (not the whole utterance), the
  // referent, its context info; and within it only the selectors whose evidence changed (modos/fill.mjs, `kept`).
  const ownText=mod=>(requests.find(r=>r.mod===mod)?.questions||[]).map(k=>req.questions[k]?.text).filter(Boolean).join(' ');
  // What a MOD's selectors answer: its theme being spoken of now (the focus; else the one said last), its other themes as context. A
  // MOD has one part per question, so when two of its themes ask for different things (next week's weather, then the umbrella today)
  // it shows the one the user is on.
  const askedOf=mod=>{const qs=(requests.find(r=>r.mod===mod)?.questions||[]).map(k=>req.questions[k]).filter(Boolean);if(!qs.length)return null;
    // what is said now: the themes the latest sentence went into (a theme it only uses is context), else the focus, else the one said last
    const on=qs.some(x=>x.said)?qs.filter(x=>x.said):qs.some(x=>x.focus)?qs.filter(x=>x.focus):[qs.reduce((a,b)=>b.last>=a.last?b:a)];
    // a correction: the latest sentence of those themes corrects a detail, so its words decide over their earlier ones (a detail added
    // or a question asked more counts with the rest)
    const lastI=Math.max(-1,...on.map(x=>x.last)),now=on.map(x=>x.text).join(' '),corrects=on.find(x=>x.last===lastI)?.lastHow==='correct',
      last=corrects&&lastI>=0&&sentences[lastI]!==now?sentences[lastI]:null;
    return {now,...(last?{last}:{}),before:qs.filter(x=>!on.includes(x)).map(x=>x.text),themes:{now:on.map(x=>x.theme),before:qs.filter(x=>!on.includes(x)).map(x=>x.theme)}};};
  const noted=(mod,asked,reused,p)=>p.then(v=>{rec.fill(mod.id,{asked:asked&&{now:asked.themes.now,before:asked.themes.before},reused,kept:reused?[]:keptOf[mod.id]||[],selectors:reused?[]:selOf[mod.name]||[]});return v;});
  const fillOf=mod=>{const r=requests.find(r=>r.mod===mod),items=r?.items||[],asked=askedOf(mod);if(!live)return noted(mod,asked,false,filler.fill(mod,items,{asked}));
    const k=JSON.stringify([mod.id,asked,referent?.entity||null,reference?.status||null,items]);
    live.state.selectors||=new Map();const reused=live.state.fills.has(k);
    if(!reused)live.state.fills.set(k,filler.fill(mod,items,{asked,kept:live.state.selectors}).catch(e=>{live.state.fills.delete(k);throw e;}));
    else trace('view_live',JSON.stringify({kept:{fill:mod.id}}));
    return noted(mod,asked,reused,live.state.fills.get(k));};
  const fallback=chosen.length?null:fallbackContext(view,abouts,referent);
  const picked=[...new Set([...requests.flatMap(r=>r.items),...(fallback?.items||[])])];
  // Where it came from, short: a place stands for the things in it.
  const fromLabel=ids=>{const places=ids.filter(id=>view.entities.get(id)?.kind==='place');
    const rest=ids.filter(id=>!places.includes(id)&&!places.includes(view.entities.get(id)?.place));
    return [...(places.length>2?[`${places.length} places`]:places.map(id=>`${view.nameOf(id)}${ids.length>places.length+rest.length?' and the things in it':''}`)),...rest.map(view.nameOf)];};
  trace('view_context_info',JSON.stringify([...requests.map(r=>({mod:r.mod.name,from:fromLabel(r.from),items:r.items.map(itemLabel)})),
    ...(fallback?[{mod:null,from:fromLabel(fallback.from),items:fallback.items.map(itemLabel)}]:[])]));

  // Stage 4: the text (one of the host MOD's slots) and each MOD's other slots, in parallel; stage 5 as parts become ready.
  const host=textHost(chosen,referent,placeMod,question.text);
  {const m=mods.find(x=>x.id===host.mod),slot=m?.slots.find(x=>x.id===m.text);
    trace('view_text',JSON.stringify(host.none?{none:true}:{mod:m?.name||null,use:host.voice?'dialogue':slot?.use||'situated-text',voice:host.voice?.name||null}));}
  if(live)live.state.shown=new Set(chosen.map(c=>c.mod.id));
  // The text is a slot like the others (design doc 12.20): it answers only the newest sentence that wants to be told something (`know`,
  // modos/request.mjs), briefly: the user cannot take in every answer again each time; a request that only asks for something to be
  // done (send a message, turn something on) has none. While typing it is written once what it answers is clear and its facts known:
  // at once the first time, then on a pause or at the question's end. A revision that changes what it answers but writes nothing new
  // leaves it in view, dimmed (it never blinks out); a new text takes its place in place. The question's end is its last pause: it
  // writes what a pause would, and changes nothing only because it ended (a text with nothing left to answer stays dimmed).
  const newest=req.newest,toKnow=newest?[{text:newest.text,about:req.questions.find(x=>newest.themes.includes(x.theme))?.about}]:[];
  const forKnowing=newest?chosen.filter(c=>c.questions.some(k=>newest.themes.includes(req.questions[k].theme))):[];
  const textKey=newest?JSON.stringify([normalize(newest.text),forKnowing.map(c=>c.mod.id).sort(),newest.yesNo]):null;
  const shownText=live?.state.textKey??null;   // what the text in view answers (null: none in view)
  const writeNow=!!textKey&&(!live||textKey!==shownText&&(live.final||live.pause||shownText==null));
  const dimText=async on=>{if(!live||live.state.textKey==null||!!live.state.textDim===on)return;await live.dim(['text:'],on);live.state.textDim=on;
    trace('view_live',JSON.stringify({text:on?'dimmed: it no longer answers what is asked':'answers again'}));};
  const kept=[],updated=[];   // while typing: the parts this revision left as they were, and the ones it sent new data for
  const visual=(async()=>{
    const out=[],now=new Set();
    await Promise.all(chosen.map(async({mod})=>{
      const selection=await fillOf(mod);if(live?.stale())return;
      const parts=partsFor(mod,selection,{referent,abouts:chosen.find(c=>c.mod===mod)?.abouts||[],question:question.text});
      // an action part (Send) carries its message, written apart from the answer (text.mjs writeDraft); while typing, only at the
      // question's end (the words in a control are written once, when the request is whole; meanwhile its Text Input is empty)
      for(const p of parts)if(p.action&&(!live||live.final)){
        // the message rests on what is asked of its MOD and what it chose, not on the rest of the utterance
        const k=JSON.stringify([live?ownText(mod):question.text,selection]);if(live?.state.drafts?.[k])trace('view_live',JSON.stringify({kept:{draft:mod.id}}));
        const d=live?.state.drafts?.[k]||await writeDraft({view,question,picked,items,answer,selection,mod,questions:(m=>m.length?m:req.questions)(serves(mod).map(k=>req.questions[k])),trace}).catch(e=>{trace('modos_error','draft: '+e.message);return null;});
        if(d?.body){p.action={...p.action,draft:d};if(live)live.state.drafts={[k]:d};}
        if(live?.stale())return;}
      // The parts shown, by slot (a highlight also shows the direction arrow and sign on the same choice).
      const shown=parts.flatMap(p=>{const slot=mod.slots.find(x=>x.id===p.mod?.slot);
        const extra=p.highlight?mod.slots.filter(x=>x!==slot&&x.data===slot?.data&&((x.use==='guidance'&&p.highlight.guidance)||(x.use==='label'&&p.highlight.label))):[];
        return (p.control?.panel===false?[]:[slot,...extra]).filter(Boolean).map(x=>({slot:x.id,use:x.use,kind:p.weather?'weather':p.findmy?'findmy':p.ego?'ego':p.animation?'animation':p.highlight?'highlight':p.control?'control':p.action?'action':p.part}));});
      if(parts.length)trace('view_compose',JSON.stringify({mod:mod.name,parts:shown}));
      for(const part of parts){
        // the theme(s) it shows and whether one is the focus (a fact the MOD's UI rules may read; how background steps aside is future work)
        const of=serves(mod).map(k=>req.questions[k]),theme={ids:of.map(x=>x.theme),focus:of.some(x=>x.focus)};
        const p={question_id:question.id,reserve_text:true,...part,theme};
        // unchanged: stays as shown; except on Enter, a part that acts (a device's asked change, only previewed while typing) is sent again
        if(live){const k=partKey(p),json=JSON.stringify(p);now.add(k);if(live.state.published.get(k)===json&&!(live.final&&p.control?.action)){kept.push(k);rec.part(k,mod.id,'kept');out.push({mod:mod.id,...part});continue;}
          const was=live.state.published.has(k);await publish(p);live.state.published.set(k,json);updated.push(k);rec.part(k,mod.id,was?'updated':'new');}
        else{await publish(p);rec.part(partKey(p),mod.id,'new');}
        out.push({mod:mod.id,...part});}
    }));
    // what the last revision showed and this one does not: withdrawn (a MOD no longer needed, a part it no longer has)
    if(live&&!live.stale()){const gone=[...live.state.published.keys()].filter(k=>!now.has(k));
      for(const k of gone)rec.part(k,k.split(':')[1]||'','withdrawn');
      if(gone.length){await live.retract(gone);for(const k of gone)live.state.published.delete(k);trace('view_live',JSON.stringify({withdrawn:gone}));}
      if(kept.length||updated.length)trace('view_live',JSON.stringify({kept,updated}));}
    return out;
  })();
  // the text's theme (that of the sentence it answers) and whether it is the focus: when the user has moved on (to a message), the text
  // steps back with its theme (src/attention.mjs); it carries this from when it is written, and later changes are logged on it
  const textTheme=newest?{ids:newest.themes,focus:newest.themes.some(id=>st.focus.ids.includes(id))}:null;
  const publishText=p=>publish(p.part==='text'&&textTheme?{...p,theme:textTheme}:p);
  const write=()=>runText({view,question,picked,referent,reference,items,answer,publish:publishText,hostP:Promise.resolve(host),recordInfo,trace,asked:toKnow[0]?.text,yesNo:req.yesNo});
  // a fact is missing when a part of a MOD the text rests on says it found nothing ({status: not_found, ...}); a MOD with nothing to
  // show (no part) does not hold the text back (the parts are all known when this is asked: the fills are done)
  const missing=p=>Object.values(p).some(v=>v&&typeof v==='object'&&typeof v.status==='string'&&v.status!=='found');
  const known=out=>out.filter(p=>forKnowing.some(c=>c.mod.id===(p.mod?.id??p.mod))).every(p=>!missing(p));
  // the old dims until the new one begins, and shows it is being written (src/agent.mjs: a ball breathing at its left)
  const answers=newest?sentences.lastIndexOf(newest.text):-1,ans=answers>=0?answers:null;
  const begin=async()=>{rec.text('writing',ans);if(live){if(live.state.textKey!=null)await live.writing?.(['text:'],true);await dimText(true);live.state.textKey=textKey;live.state.textDim=false;live.state.textFocus=textTheme?.focus;}return write();};
  // a write this revision does not go on with (an earlier revision's, given up when this one came) is no longer shown as writing
  const notWriting=async()=>{if(live?.state.textKey!=null)await live.writing?.(['text:'],false);};
  let language;
  if(!writeNow){
    await notWriting();
    rec.text(!live?'none':shownText==null?'none':textKey===shownText?'kept':'dimmed',ans);
    if(live&&shownText!=null){
      if(textKey===shownText)await dimText(false);
      else await dimText(true);}
    language=Promise.resolve(live?.state.textKey!=null?{kept:true}:null);}
  else if(live&&!live.final)language=visual.catch(()=>[]).then(async out=>{
    if(!chosen.length||!known(out)||live.stale()){rec.text(live.state.textKey!=null?'dimmed':'not yet',ans);await notWriting();await dimText(true);trace('view_live',JSON.stringify({text:'not yet: the intent or a fact is not clear'}));return live.state.textKey!=null?{kept:true}:null;}
    return begin();});
  else language=begin();
  const [lang,vis]=await Promise.allSettled([language,visual]);
  // a theme keeps the item found for it (FindMy), so "where is it?" later goes on with it (modos/grounding.mjs referenceOf)
  if(vis.status==='fulfilled')for(const p of vis.value)if(p.findmy?.status==='found'){const mod=chosen.find(c=>c.mod.id===p.mod)?.mod;
    for(const k of mod?serves(mod):[]){const t=book.themes.find(x=>x.id===req.questions[k].theme);if(t)t.items=[...(t.items||[]).filter(x=>x.item_id!==p.findmy.item_id),{item_id:p.findmy.item_id}].slice(-4);}}
  // the text's focus follows its theme only while it answers that sentence (a dimmed one waiting to be written anew keeps its own)
  if(live&&!live.stale()&&textTheme&&live.state.textKey===textKey&&live.state.textFocus!==textTheme.focus){await live.focus(['text:'],textTheme.focus);live.state.textFocus=textTheme.focus;}
  if(vis.status==='rejected')trace('modos_error',vis.reason.message);
  // a text that failed is taken away (no "Answer unavailable", and no older text left dimmed for what it does not answer); while typing
  // it is written again with the next revision
  if(lang.status==='rejected'&&live&&!live.stale()){await live.retract(['text:']).catch(()=>{});live.state.textKey=null;live.state.textDim=false;}
  if(lang.status==='rejected'){rec.text('failed',ans);trace('language_error',lang.reason.message);if(vis.status!=='fulfilled'||!vis.value.length)throw lang.reason;return {question_id:question.id,message:'UI ready; language response failed.',themes:book};}
  if(!lang.value||lang.value.kept)return {question_id:question.id,message:lang.value?.kept?'Text kept.':toKnow.length?'MOD UI only (no text slot).':'Nothing asked to be told: MOD UI only.',parts:vis.status==='fulfilled'?vis.value:[],themes:book};
  rec.written(lang.value.title,req.yesNo);
  const {interaction_id,...shown}=lang.value;
  return {...shown,question_id:question.id,parts:vis.status==='fulfilled'?vis.value:[],themes:book};
}
