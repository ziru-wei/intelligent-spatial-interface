// ModOS stage 1 · Grounding: what the request refers to in the world. Two sources, both judged here and nowhere else:
//   the candidate the headset offers (what the user looks at, points at or touches, or the zone they stand in; computed on the
//   client by geometry, scripts/info_context.py checks it), and earlier turns (pronouns such as "it", follow-ups on the last thing).
// Output: the referent (or none), how a conversation reference resolved, and whether to ask the user which item they mean.
import {choose,score} from './decision.mjs';

export function groundingQuestions(view){
  const q={},sel=view.selection,active=view.snap.active_info,referents=(view.conversation.referents||[]).slice(0,8);
  if(sel&&sel.mode!=='score'){
    q.referent=String(sel.box_id).startsWith('zone:')
      ?score(`While asking, the user is standing in an area that carries information named "${sel.key}". Is user_question about this area or that information (e.g. "what is this place?", "what are the rules here?", "what are they working on?")? No when it asks about something else (a particular object, plans, weather) or when a pronoun refers to something from the conversation rather than to this area.`)
      :score(`While asking, the user is looking at, pointing at or touching "${view.nameOf(sel.box_id)}" (information item "${sel.key}"). Is user_question about it, including deictic questions such as "what is this?" or "can I eat this?", and questions put to the thing itself in the second person such as "what are you?" or "can I eat you?"? No when it asks about something else, or when "you" is the assistant being asked to do something ("can you turn on the lamp?").`);
  }
  if(active&&sel?.mode!=='score')q.followup=score(`The previous answer was about "${active.key}". Is user_question a follow-up about that same thing (a pronoun such as "it" or "that", or an elliptical continuation)? No for a new subject.`);
  if(referents.length){
    const options={standalone:'The question names its own subject or does not need an earlier item; also when its words point at the place the user is in ("here", "this lab", "they" meaning its people).',unresolved:'The question refers to an earlier item but no unique one is supported.'};
    referents.forEach((r,i)=>options[`ref_${i}`]=JSON.stringify(r));
    q.conversation_reference=choose('Does user_question depend on a previously discussed physical item, such as "OK, where is it?"? Pick it from conversation.referents, or standalone / unresolved.',options);
  }
  return q;
}

/** The candidate's description for the decision state. */
export const groundingState=view=>({candidate:view.candidate?{name:view.nameOf(view.candidate),info:view.selection.key}:null});

export function resolveGrounding(view,a){
  const sel=view.selection,referents=view.conversation.referents||[];
  let reference={status:'standalone'};
  if(a.conversation_reference&&a.conversation_reference.choice!=='standalone'){
    const c=a.conversation_reference,r=referents[Number(String(c.choice).slice(4))];
    reference=c.choice.startsWith('ref_')&&r&&(c.probability??1)>=.7&&(c.confidence??1)>=.3?{status:'resolved',referent:r}:{status:'unresolved'};
  }
  const zone=String(view.candidate).startsWith('zone:');
  let referent=null;
  // A zone the user merely stands in loses to a pronoun the conversation resolves ("where is it?" after asking about a book).
  if(sel&&!(zone&&reference.status==='resolved')&&(sel.mode==='score'||a.referent?.score>=.5))
    referent={entity:view.candidate,key:sel.key,name:view.nameOf(view.candidate),kind:zone?'place':'object',source:'selection'};
  else if(view.snap.active_info&&a.followup?.score>=.5)
    referent={entity:null,key:view.snap.active_info.key,name:view.snap.active_info.key,kind:'object',source:'follow-up'};
  const clarify=reference.status==='unresolved'&&!zone&&!referent;
  return {referent,reference,clarify};
}

// A question put to the thing in the second person ("can I eat you?") while the user looks at it, and judged to be about it: the thing is
// the referent even when grounding's own score stayed under the bar. "You" as the assistant ("can you turn on…") is not this.
const ADDRESSES_ASSISTANT=/\b(can|could|would|will)\s+you\s+(please\s+)?(tell|show|turn|switch|help|find|send|remind|make|set|open|start|stop|give|play|take|describe|draft)\b/i;
export function addressedReferent(view,question,questions){
  if(!view.candidate||String(view.candidate).startsWith('zone:')||!view.selection)return null;
  const text=String(question||'');
  if(!/\b(you|your|yourself)\b/i.test(text)||ADDRESSES_ASSISTANT.test(text)||!questions.some(q=>q.about==='referent'))return null;
  return {entity:view.candidate,key:view.selection.key,name:view.nameOf(view.candidate),kind:'object',source:'addressed'};
}

export function clarifyText(view,question){
  const names=(view.conversation.referents||[]).map(i=>i.label).slice(0,3);
  return {question_id:question.id,part:'text',title:'Which item do you mean?',body:names.length?'Please name the item: '+names.join(' or ')+'.':'Please name the item you mean.',anchor:{object:'user-view',relation:'in-front'},referenced_item_ids:[]};
}
