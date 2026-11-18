// ModOS stage 1 · The request: which questions it asks and what each one is about. What informs MOD selection, kept minimal and fast:
//   split    a rule cuts the request into its questions ("What's the weather next week and what should I bring?" → two)
//   about    for each question, one bounded choice: the thing the user looks at, the place here, the user themself, the world outside
//            (weather and other outside data), or something else
//   MODs     for each question, one 0-1 score per MOD
// No text is generated: everything is a choose or a score, sent in the same decision call as grounding.
import {choose,score} from './decision.mjs';

const START=/^(and\s+)?(what|where|when|who|which|how|why|is|are|am|was|were|do|does|did|can|could|should|would|will|may|might|shall|tell|show|remind|find|turn|switch|help)\b/i;

/** The questions of a request (at most 3): split at ? ; and at "and"/"also" that start a new question. */
export function splitRequest(text){
  const parts=[];
  // a question ends at ? or ! whether or not a space follows ("umbrella?where is it"); a full stop only before a space ("3.5")
  for(const sentence of String(text).split(/(?<=[?!])\s*|(?<=\.)\s+|;\s*/).map(s=>s.trim()).filter(Boolean)){
    const pieces=sentence.split(/,?\s+(?:and|also|plus)\s+(?=(?:what|where|when|who|which|how|why|is|are|do|does|can|could|should|will|tell|show|remind|find)\b)/i);
    parts.push(...pieces.map(p=>p.trim()).filter(p=>p.split(/\s+/).length>=2||START.test(p)));
  }
  const out=parts.length?parts:[String(text).trim()];
  return out.length>3?[...out.slice(0,2),out.slice(2).join(' ')]:out;
}

/** What a question can be about, here: {id: description}. */
export function aboutOptions(view){
  const o={};
  if(view.candidate)o.referent=`the thing the user is looking at or pointing at: "${view.nameOf(view.candidate)}"`;
  if(view.places.length)o.here=`the place the user is in or faces: ${view.places.map(view.nameOf).join(', ')} (its people, work, rules or things in it)`;
  o.user='the user themself: their schedule, plans, belongings, preferences or body';
  o.world='the world outside: weather or other outside data';
  o.other='something else named in it, another place, or general knowledge';
  return o;
}

/** Decision questions for the request: about_<k> and mod_<id>__q<k> for each question k. */
// typing: the request is still being typed (answer while typing, design doc 12): its last part may stop mid-sentence, and is judged by
// the need its words show so far.
export function requestQuestions(view,questions,mods,{typing=false}={}){
  const q={},opts=aboutOptions(view),one=questions.length===1;
  questions.forEach((text,k)=>{
    const last=k===questions.length-1,part=(one?'user_question':`this part of user_question: "${text}"`)+(typing&&last?' (still being typed: it may stop mid-sentence; judge the need its words already show)':'');
    q[`about_${k}`]=choose(`What is ${part} about?`,opts);
    for(const m of mods)q[`mod_${m.id}__q${k}`]=score(`Does ${part} need the capability "${m.name}": ${m.description} Examples: ${(m.examples||[]).join(' / ')}. Yes only when what it shows is part of what is asked.`);
  });
  return q;
}

/** {questions: [{text, about, mods: {id: score}}], scores: {id: best score}}. */
export function resolveRequest(questions,mods,a){
  const qs=questions.map((text,k)=>({text,about:a[`about_${k}`]?.choice||'other',mods:Object.fromEntries(mods.map(m=>[m.id,a[`mod_${m.id}__q${k}`]?.score??0]))}));
  const scores=Object.fromEntries(mods.map(m=>[m.id,Math.max(0,...qs.map(x=>x.mods[m.id]))]));
  return {questions:qs,scores};
}
