// ModOS stage 1 · The request's sentences and what each asks (design doc 12.32): decisions in order, each call given what the one
// before decided; the themes they belong to are modos/themes.mjs's (ThemeRouter). Kept minimal and fast:
//   split    a rule cuts the request into its sentences ("What's the weather next week and what should I bring?" → two)
//   type     call 1, for a sentence: information (to be told), action (to have something done), stop_prev, or none (a filler)
//   about    call 2 (grounding), for a new request: what in the world it is about (the thing looked at, here, a place, the user, outside)
//   yes/no   call 2, for information only: whether it is answered by yes or no (the text's heading is then the answer)
//   MODs     call 3, for a theme: one 0-1 score per MOD, on all its words
// No text is generated: everything is a choose or a score.
import {choose,score} from './decision.mjs';
import {hereArea} from './context-request.mjs';
import {fill} from './prompts.mjs';
import PROMPTS from './prompts.json' with {type:'json'};
export {PROMPTS};

const START=/^(and\s+)?(what|where|when|who|which|how|why|is|are|am|was|were|do|does|did|can|could|should|would|will|may|might|shall|tell|show|remind|find|turn|switch|help)\b/i;

/** The sentences of a request: split at ? ; and at "and"/"also" that start a new question. No limit: each sentence is routed to its
 *  theme(s) on its own (modos/themes.mjs). */
export function splitRequest(text){
  const parts=[];
  // a question ends at ? or ! whether or not a space follows ("umbrella?where is it"); a full stop only before a space ("3.5")
  for(const sentence of String(text).split(/(?<=[?!])\s*|(?<=\.)\s+|;\s*/).map(s=>s.trim()).filter(Boolean)){
    const pieces=sentence.split(/,?\s+(?:and|also|plus)\s+(?=(?:what|where|when|who|which|how|why|is|are|do|does|can|could|should|will|tell|show|remind|find)\b)/i);
    parts.push(...pieces.map(p=>p.trim()).filter(p=>p.split(/\s+/).length>=2||START.test(p)));
  }
  return parts.length?parts:[String(text).trim()];
}

/** What a question can be about, here: {id: description}. */
export function aboutOptions(view){
  const o={};
  const P=PROMPTS.context_anchor;
  if(view.candidate)o.referent=fill(P.referent,{name:view.nameOf(view.candidate)});
  if(view.places.length)o.here=fill(P.here,{names:hereArea(view).map(view.nameOf).join(', ')});
  // another place of the twin, named in what is asked ("the printer in my lab" from the corridor): its things are looked up there
  const area=new Set(hereArea(view));
  for(const e of view.entities?.values?.()||[])if(e.kind==='place'&&!area.has(e.id))o[`place:${e.id}`]=fill(P.place,{name:view.nameOf(e.id)});
  o.user=P.user;o.world=P.world;o.other=P.other;
  return o;
}

// Call 1 · the request type of a sentence: what the user wants with it. Several may hold ("check the weather and send it to Alice");
// none ends the sentence there (nothing after it runs for it).
export const SURE=.85;
const KEY={info:'information',action:'action',stop:'stop_prev',none:'none'};
export function typeQuestions(part,suffix){
  return Object.fromEntries(Object.entries(KEY).map(([,k])=>[`request_type_${k}_${suffix}`,score(fill(PROMPTS.request_type[k],{sentence:part}))]));
}
/** The types that hold (.5), and none: said so (unless another type is clear, SURE), or no type holds. p: the scores, for the record. */
export function resolveType(a,suffix){
  const p=Object.fromEntries(['info','action','stop','none'].map(k=>[k,a[`request_type_${KEY[k]}_${suffix}`]?.score??(k==='info'?1:0)]));
  const info=p.info>=.5,action=p.action>=.5,stop=p.stop>=.5,clear=Math.max(p.info,p.action,p.stop)>=SURE;
  const none=p.none>=.5&&!clear||!(info||action||stop);
  return none?{none:true,info:false,action:false,stop:false,p}:{none:false,info,action,stop,p};
}
/** For information only: the answer's form (the text's heading is then the answer, Yes, No or Not sure). */
export const yesnoQuestion=(part,suffix)=>({[`answer_form_${suffix}`]:score(fill(PROMPTS.answer_form.question,{sentence:part}))});

// Call 2 (grounding) · what in the world a new request is about (an earlier one keeps its own): one bounded choice.
export const aboutQuestion=(view,part,suffix)=>({[`context_anchor_${suffix}`]:choose(fill(PROMPTS.context_anchor.question,{sentence:part}),aboutOptions(view))});
// abouts: every reading with real weight (the model may be torn between here and a place the words name): context is looked up for each
export const resolveAbout=(a,suffix)=>{const c=a[`context_anchor_${suffix}`],about=c?.choice||'other',p=c?.probabilities||{};
  return {about,abouts:[about,...Object.entries(p).filter(([k,v])=>k!==about&&v>=.3).sort((x,y)=>y[1]-x[1]).map(([k])=>k)]};};

// Call 3 · the MODs a theme needs, judged once on all its words (in the state, `requests.<suffix>`), knowing what it is about.
export function modQuestions(mods,suffix){
  return Object.fromEntries(mods.map(m=>[`mod_need_${m.id}__${suffix}`,score(fill(PROMPTS.mod_need.question,{request:suffix,mod:m.name,description:m.description,examples:(m.examples||[]).join(' / ')}))]));
}
export const resolveMods=(a,mods,suffix)=>Object.fromEntries(mods.map(m=>[m.id,a[`mod_need_${m.id}__${suffix}`]?.score??0]));
