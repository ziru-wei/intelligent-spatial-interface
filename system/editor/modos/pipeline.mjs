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
import {createView,merge,split} from './view.mjs';
import {groundingQuestions,groundingState,resolveGrounding,addressedReferent,clarifyText} from './grounding.mjs';
import {splitRequest,requestQuestions,resolveRequest} from './request.mjs';
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
export const LIVE={CLEAR:.5,SURE:.85,KEEP:.35};
/** Which MODs a revision shows: scores {id: 0-1} now, the last revision's and the ones shown; on Enter the plain rule (CLEAR). */
export function liveChoice(scores,{previous={},shown=new Set(),final=false}={}){
  return new Set(Object.entries(scores).filter(([id,s])=>final?s>=LIVE.CLEAR:shown.has(id)?s>=LIVE.KEEP:s>=LIVE.SURE||s>=LIVE.CLEAR&&(previous[id]??0)>=LIVE.CLEAR).map(([id])=>id));
}
/** A part's identity on its question's surface (as scripts/agent_store.py part_key): its kind and its MOD. */
export const partKey=p=>`${p.part!=='ui'?p.part:['weather','findmy','highlight','control','action'].find(k=>p[k]!=null)||'ui'}:${p.mod?.id||''}`;

const r2=x=>Math.round((x??0)*100)/100,itemLabel=id=>id.replace(/^(info|user|feed):/,'').replace(/^weather$/,'weather forecast');
const ABOUT={referent:'the thing looked at',here:'this place',user:'the user',world:'outside data',other:'something else'};

export async function runModos({question,memory,context,items,decide,answer,publish=async()=>{},recordInfo=async()=>{},trace=()=>{},live=null}){
  if(live)live.state={scores:{},shown:new Set(),published:new Map(),fills:new Map(),text:null,...live.state};
  const view=createView(await (context||memory)(),question);
  const mods=view.snap.mods,filler=createFiller({view,items,decide,trace});
  // Stage 0 (rules): which MODs can apply here; place-scoped MODs start filling now (unused fills are dropped).
  const early={places:view.places,candidate:view.candidate,referent:null,itemIds:view.itemIds,aboutIds:view.aboutIds};
  for(const mod of mods)if(Array.isArray(mod.scope)&&eligible(mod,early))filler.fill(mod).catch(e=>trace('modos_error',e.message));
  const askable=mods.filter(m=>m.scope!=='referent'&&eligible(m,early));
  trace('view_context',JSON.stringify({places:view.places.map(view.nameOf),looking:view.candidate?view.nameOf(view.candidate):null,mods:mods.map(m=>m.name)}));

  // Stage 1: grounding and the request in one decision call.
  const questions=splitRequest(question.text);
  const a=await decide('modos_request',{...view.state,...groundingState(view)},merge({grounding:groundingQuestions(view),request:requestQuestions(view,questions,askable,{typing:!!live&&!live.final})}));
  const ga=split(a,'grounding'),grounded=resolveGrounding(view,ga),{reference}=grounded;
  const req=resolveRequest(questions,askable,split(a,'request')),abouts=[...new Set(req.questions.map(q=>q.about))];
  const referent=grounded.referent||(reference.status==='resolved'?null:addressedReferent(view,question.text,req.questions));
  filler.setReference(reference);
  if(grounded.clarify&&!referent){if(live&&!live.final)return {question_id:question.id,message:'Unclear yet.'};   // asked only on Enter
    const text=clarifyText(view,question);await publish(text);return text;}
  trace('modos_request',JSON.stringify({referent,reference:reference.status,questions:req.questions.map(q=>({text:q.text,about:q.about}))}));
  trace('view_grounding',JSON.stringify({looking:view.candidate?view.nameOf(view.candidate):null,score:ga.referent?r2(ga.referent.score):null,referent:referent?.name||null,reference:reference.status,
    questions:req.questions.map(q=>({text:q.text,about:q.about==='referent'&&view.candidate?view.nameOf(view.candidate):q.about==='here'&&view.places.length?view.nameOf(view.places[0]):ABOUT[q.about]}))}));

  // Stage 2: the MODs. A MOD scoped to the referent (WorldInfo) is taken when a question is about the thing and no place MOD speaks for it.
  const placeMod=placeModFor(mods,referent),ctx={...early,referent};
  // WorldInfo answers a question about the thing when no other MOD takes that question (e.g. Send takes "send this to Alice").
  const untaken=req.questions.filter(q=>(q.about==='referent'||questions.length===1&&referent?.kind==='object')&&!askable.some(m=>q.mods[m.id]>=.5));
  const auto=referent&&!placeMod&&untaken.length?mods.filter(m=>m.scope==='referent'&&eligible(m,ctx)):[];
  // While typing (live), which MODs show is held steady across revisions (liveChoice); a MOD kept below CLEAR serves the questions it
  // scores KEEP or more on.
  let keep=m=>auto.includes(m)||req.scores[m.id]>=.5,floor=.5;
  if(live){const scores={...Object.fromEntries(askable.map(m=>[m.id,req.scores[m.id]])),...Object.fromEntries(auto.map(m=>[m.id,1]))};
    const on=liveChoice(scores,{previous:live.state.scores,shown:live.state.shown,final:live.final||live.pause});live.state.scores=scores;keep=m=>on.has(m.id);floor=live.final||live.pause?.5:LIVE.KEEP;
    trace('view_live',JSON.stringify({final:!!live.final,pause:!!live.pause,shown:[...on]}));}
  const chosen=[...auto.filter(keep).map(m=>({mod:m,score:1,abouts:['referent'],questions:req.questions.map((_,k)=>k)})),
    ...askable.filter(keep).map(m=>({mod:m,score:req.scores[m.id],abouts:req.questions.filter(q=>q.mods[m.id]>=floor).map(q=>q.about),questions:req.questions.map((q,k)=>q.mods[m.id]>=floor?k:-1).filter(k=>k>=0)}))];
  trace('modos_mods',JSON.stringify(chosen.map(c=>[c.mod.id,r2(c.score)])));
  trace('view_mods',JSON.stringify({options:[...auto.map(m=>[m.name,'auto']),...askable.map(m=>[m.name,r2(req.scores[m.id])])],
    skipped:mods.filter(m=>!auto.includes(m)&&!askable.includes(m)).map(m=>m.name),chosen:chosen.map(c=>c.mod.name)}));

  // Stage 3: each MOD's context info (rules); with no MOD, what the questions are about.
  let requests=chosen.map(c=>({mod:c.mod,score:c.score,questions:c.questions,...requestContext(view,c.mod,{referent,abouts:c.abouts})}));
  // Two MODs for the same question that ask about the same things are two ways to show one need (ObjectStatus or IoTControl for
  // "is the printer free?"): the better one stays. Ones that ask about different things are two needs ("should I bring my umbrella?":
  // the forecast, and where the umbrella is): both stay.
  const things=r=>new Set(r.items.flatMap(id=>view.snap.items.find(i=>i.id===id)?.about||[]));
  const alternatives=[];
  for(const r of [...requests].sort((a,b)=>b.score-a.score)){
    const kept=requests.find(k=>k!==r&&k.score>=r.score&&!alternatives.some(x=>x.mod===k.mod)&&k.questions.some(q=>r.questions.includes(q))&&[...things(r)].some(t=>things(k).has(t)));
    if(kept&&r.mod.scope!=='referent')alternatives.push({mod:r.mod,instead:kept.mod});
  }
  if(alternatives.length){requests=requests.filter(r=>!alternatives.some(x=>x.mod===r.mod));chosen.splice(0,chosen.length,...chosen.filter(c=>!alternatives.some(x=>x.mod===c.mod)));
    trace('view_alternatives',JSON.stringify(alternatives.map(x=>[x.mod.name,x.instead.name])));trace('modos_mods_final',JSON.stringify(chosen.map(c=>[c.mod.id,r2(c.score)])));}
  const fillOf=mod=>{const items=requests.find(r=>r.mod===mod)?.items||[];if(!live)return filler.fill(mod,items);
    const k=JSON.stringify([mod.id,question.text,referent?.entity||null,reference?.status||null,items]);
    if(!live.state.fills.has(k))live.state.fills.set(k,filler.fill(mod,items).catch(e=>{live.state.fills.delete(k);throw e;}));
    return live.state.fills.get(k);};
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
  // The text while typing: written once the intent is clear and its facts are known (no text with a fact missing: an item not found
  // yet), when the user pauses or the intent changes (another MOD, another question); a text whose intent changed is withdrawn at
  // once. On Enter, written again if the words changed since.
  const intent=JSON.stringify([chosen.map(c=>c.mod.id).sort(),req.questions.length]),textFor=JSON.stringify([question.text,intent]);
  const was=live?.state.text?JSON.parse(live.state.text):null,intentChanged=!!was&&was[1]!==intent;
  const wantText=!live||(live.final||live.pause||intentChanged||!was)&&live.state.text!==textFor;
  if(live&&was&&(wantText||intentChanged)){await live.retract(['text:']);live.state.text=null;}
  const visual=(async()=>{
    const out=[],now=new Set();
    await Promise.all(chosen.map(async({mod})=>{
      const selection=await fillOf(mod);if(live?.stale())return;
      const parts=partsFor(mod,selection,{referent,abouts:chosen.find(c=>c.mod===mod)?.abouts||[],question:question.text});
      // an action part (Send) carries its message, written apart from the answer (text.mjs writeDraft); while typing, on a pause or Enter
      for(const p of parts)if(p.action&&(!live||live.final||live.pause)){
        const k=JSON.stringify([question.text,selection]);
        const d=live?.state.drafts?.[k]||await writeDraft({view,question,picked,items,answer,selection,mod,questions:req.questions,trace}).catch(e=>{trace('modos_error','draft: '+e.message);return null;});
        if(d?.body){p.action={...p.action,draft:d};if(live)live.state.drafts={[k]:d};}
        if(live?.stale())return;}
      // The parts shown, by slot (a highlight also shows the direction arrow and sign on the same choice).
      const shown=parts.flatMap(p=>{const slot=mod.slots.find(x=>x.id===p.mod?.slot);
        const extra=p.highlight?mod.slots.filter(x=>x!==slot&&x.data===slot?.data&&((x.use==='guidance'&&p.highlight.guidance)||(x.use==='label'&&p.highlight.label))):[];
        return (p.control?.panel===false?[]:[slot,...extra]).filter(Boolean).map(x=>({slot:x.id,use:x.use,kind:p.weather?'weather':p.findmy?'findmy':p.ego?'ego':p.animation?'animation':p.highlight?'highlight':p.control?'control':p.action?'action':p.part}));});
      if(parts.length)trace('view_compose',JSON.stringify({mod:mod.name,parts:shown}));
      for(const part of parts){
        const p={question_id:question.id,reserve_text:true,...part};
        // unchanged: stays as shown; except on Enter, a part that acts (a device's asked change, only previewed while typing) is sent again
        if(live){const k=partKey(p),json=JSON.stringify(p);now.add(k);if(live.state.published.get(k)===json&&!(live.final&&p.control?.action)){out.push({mod:mod.id,...part});continue;}
          await publish({...p,upsert:true});live.state.published.set(k,json);}
        else await publish(p);
        out.push({mod:mod.id,...part});}
    }));
    // what the last revision showed and this one does not: withdrawn (a MOD no longer needed, a part it no longer has)
    if(live&&!live.stale()){const gone=[...live.state.published.keys()].filter(k=>!now.has(k));
      if(gone.length){await live.retract(gone);for(const k of gone)live.state.published.delete(k);trace('view_live',JSON.stringify({withdrawn:gone}));}}
    return out;
  })();
  // the answer covers what is asked to be known: not a question only a MOD that acts (Send) serves (its message is written apart)
  const actsOn=c=>c.mod.slots.find(x=>x.id===c.mod.text)?.use==='action-card',byActing=new Set(chosen.filter(actsOn).flatMap(c=>c.questions)),byOthers=new Set(chosen.filter(c=>!actsOn(c)).flatMap(c=>c.questions));
  const asked=req.questions.filter((q,k)=>!byActing.has(k)||byOthers.has(k));
  const write=()=>runText({view,question,picked,referent,reference,items,answer,publish,hostP:Promise.resolve(host),recordInfo,trace,questions:asked.length?asked:req.questions});
  // a fact is missing when a MOD that shows something has no part yet, or a part says it found nothing ({status: not_found, ...})
  const missing=p=>Object.values(p).some(v=>v&&typeof v==='object'&&typeof v.status==='string'&&v.status!=='found');
  const known=out=>chosen.every(({mod})=>!mod.slots.some(x=>x.id!==mod.text)||out.some(p=>(p.mod?.id??p.mod)===mod.id&&!missing(p)));
  const language=!wantText?Promise.resolve(live?.state.text?{kept:true}:null)
    :live&&!live.final?visual.catch(()=>[]).then(out=>{if(!chosen.length||!known(out)||live.stale()){trace('view_live',JSON.stringify({text:'not yet: the intent or a fact is not clear'}));return null;}live.state.text=textFor;return write();})
    :(live&&(live.state.text=textFor),write());
  const [lang,vis]=await Promise.allSettled([language,visual]);
  if(vis.status==='rejected')trace('modos_error',vis.reason.message);
  if(lang.status==='rejected'){trace('language_error',lang.reason.message);if(vis.status!=='fulfilled'||!vis.value.length)throw lang.reason;return {question_id:question.id,message:'UI ready; language response failed.'};}
  if(!lang.value||lang.value.kept)return {question_id:question.id,message:lang.value?.kept?'Text kept from the pause.':'MOD UI only (no text slot).',parts:vis.status==='fulfilled'?vis.value:[]};
  const {interaction_id,...shown}=lang.value;
  return {...shown,question_id:question.id,parts:vis.status==='fulfilled'?vis.value:[]};
}
