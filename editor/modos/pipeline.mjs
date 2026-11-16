// ModOS pipeline (modos-system-design.md section 6): orchestration only. Each stage is its own module:
//   view.mjs           what the stages read about the request (from the memory snapshot)
//   grounding.mjs      1  what the request refers to (the headset's candidate, earlier turns)
//   retrieval.mjs      2  which items of memory the answer needs          (1 and 2 travel in one decision call)
//   mod-selection.mjs  3a which MODs the request needs (rule for eligibility, model for relevance)
//   fill.mjs           3b each chosen MOD's selectors (selectors.mjs generates the questions)
//   compose.mjs        4  selections → response parts; which MOD hosts the text
//   text.mjs              the generated answer text, started after stage 2
// Every model decision goes through the decision module (decision.mjs), so an engine can be swapped or compared.
import {createView,merge,split} from './view.mjs';
import {groundingQuestions,groundingState,resolveGrounding,clarifyText} from './grounding.mjs';
import {candidateItems,retrievalQuestions,resolveRetrieval} from './retrieval.mjs';
import {eligible,modCandidates,modQuestions,resolveMods,placeModFor} from './mod-selection.mjs';
import {createFiller} from './fill.mjs';
import {partsFor,textHost} from './compose.mjs';
import {runText} from './text.mjs';

export {eligible,partsFor,textHost};
export {MAX_CANDIDATE_ITEMS} from './retrieval.mjs';
export {MODOS_INSTRUCTION} from './text.mjs';

export async function runModos({question,memory,items,decide,answer,publish=async()=>{},recordInfo=async()=>{},trace=()=>{}}){
  const view=createView(await memory(),question);
  // Stage 0: candidates and eligibility are rules; place-scoped MODs start filling now (unused fills are dropped).
  const candidates=candidateItems(view),filler=createFiller({view,items,decide,trace});
  const early={places:view.places,candidate:view.candidate,referent:null,itemIds:view.itemIds,aboutIds:view.aboutIds};
  for(const mod of view.snap.mods)if(Array.isArray(mod.scope)&&eligible(mod,early))filler.fill(mod).catch(e=>trace('modos_error',e.message));
  trace('modos_prefetch',JSON.stringify({mods:view.snap.mods.map(m=>m.id),candidates:candidates.length,places:view.places,candidate:view.candidate}));

  // Stages 1 + 2: two modules, one call.
  const a=await decide('modos_read',{...view.state,...groundingState(view)},merge({grounding:groundingQuestions(view),retrieval:retrievalQuestions(view,candidates)}));
  const {referent,reference,clarify}=resolveGrounding(view,split(a,'grounding'));
  filler.setReference(reference);
  if(clarify){const text=clarifyText(view,question);await publish(text);return text;}
  const picked=resolveRetrieval(view,candidates,split(a,'retrieval'),referent);
  trace('modos_read',JSON.stringify({referent,reference:reference.status,items:picked}));

  // Stage 3a, with the text branch starting alongside it.
  const pool=modCandidates(view,referent),placeMod=placeModFor(view.snap.mods,referent);
  const choiceP=(async()=>{
    const r=await decide('modos_mods',{...view.state,referent:referent?.name||null,items:picked.map(id=>view.snap.items.find(i=>i.id===id)?.summary)},modQuestions(pool.ask));
    const chosen=resolveMods(pool,r);trace('modos_mods',JSON.stringify(chosen.map(c=>[c.mod.id,c.score])));return chosen;
  })();
  const hostP=choiceP.then(c=>textHost(c,referent,placeMod),()=>textHost([],referent,placeMod));
  const language=runText({view,question,picked,referent,reference,items,answer,publish,hostP,recordInfo,trace});

  // Stages 3b + 4.
  const visual=choiceP.then(async chosen=>{
    const out=[];
    await Promise.all(chosen.map(async({mod})=>{
      if(!Object.keys(mod.selectors||{}).length)return;
      const selection=await filler.fill(mod);
      for(const part of partsFor(mod,selection)){await publish({question_id:question.id,reserve_text:true,...part});out.push({mod:mod.id,...part});}
    }));
    return out;
  });
  const [lang,vis]=await Promise.allSettled([language,visual]);
  if(vis.status==='rejected')trace('modos_error',vis.reason.message);
  if(lang.status==='rejected'){trace('language_error',lang.reason.message);if(vis.status!=='fulfilled'||!vis.value.length)throw lang.reason;return {question_id:question.id,message:'UI ready; language response failed.'};}
  if(!lang.value)return {question_id:question.id,message:'MOD UI only (no text slot).',parts:vis.status==='fulfilled'?vis.value:[]};
  const {interaction_id,...shown}=lang.value;
  return {...shown,question_id:question.id,parts:vis.status==='fulfilled'?vis.value:[]};
}
