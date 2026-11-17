// ModOS stage 3a · MOD selection: which MODs the request needs. Eligibility (scope and data) is a rule; among eligible MODs the
// model scores each one, and several may be chosen. A MOD scoped to the referent (WorldInfo) needs no judgment once there is one,
// unless a place MOD (the lab's) already speaks for that referent.
import {score} from './decision.mjs';

export function eligible(mod,{places,candidate,referent,itemIds,aboutIds}){
  const scope=mod.scope||'global';
  if(scope==='referent'){if(!referent)return false;}
  else if(scope!=='global'&&!scope.some(e=>places.includes(e)||e===candidate))return false;
  return (mod.knowledge||[]).every(k=>{
    if(k.added||!k.ref)return true;   // added when tailoring, or a type only (a spec MOD): never a condition   // knowledge added when tailoring the MOD: read if there, never a condition
    if(k.ref==='referent')return mod.scope!=='referent'||!!referent;   // for a global MOD, what is pointed at is context to read, not a condition
    if(k.ref.startsWith('about:'))return aboutIds.has(k.ref.slice(6));
    return itemIds.has(k.ref);
  });
}

/** The place MOD that speaks for a place referent, if any. */
export const placeModFor=(mods,referent)=>referent?.kind==='place'?mods.find(m=>Array.isArray(m.scope)&&m.scope.includes(referent.entity))||null:null;

export function modCandidates(view,referent){
  const ctx={places:view.places,candidate:view.candidate,referent,itemIds:view.itemIds,aboutIds:view.aboutIds};
  const usable=view.snap.mods.filter(m=>eligible(m,ctx)),speaker=placeModFor(view.snap.mods,referent);
  return {auto:usable.filter(m=>m.scope==='referent'&&!speaker),ask:usable.filter(m=>m.scope!=='referent')};
}

export const modQuestions=ask=>Object.fromEntries(ask.map(m=>[`mod_${m.id}`,score(`Does user_question need the capability "${m.name}": ${m.description} Examples: ${(m.examples||[]).join(' / ')}. Yes only when what it shows is part of what is asked.`)]));

export const resolveMods=({auto,ask},a)=>[...auto.map(m=>({mod:m,score:1})),...ask.filter(m=>a[`mod_${m.id}`]?.score>=.5).map(m=>({mod:m,score:a[`mod_${m.id}`].score}))];
