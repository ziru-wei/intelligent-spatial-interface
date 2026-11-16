// ModOS stage 2 · Retrieval: which items of memory the answer needs. Candidates come from the snapshot (spatially narrowed when
// memory is large); each gets one 0-1 judgment on its summary; the referent's own item is always kept.
import {score} from './decision.mjs';

export const MAX_CANDIDATE_ITEMS=60;

export function candidateItems(view){
  const all=view.snap.items;
  if(all.length<=MAX_CANDIDATE_ITEMS)return all;
  const near=new Set([...view.places,view.candidate,'user:me'].filter(Boolean));
  return all.filter(i=>i.about.some(a=>near.has(a)||a.startsWith('feed:')));
}

export function retrievalQuestions(view,candidates){
  return Object.fromEntries(candidates.map((it,i)=>[`item_${i}`,score(`Does answering user_question need this piece of knowledge: "${it.summary}" (about ${it.about.map(view.nameOf).join(', ')||'the space'})? Yes when it is about what the question asks, or would personalize the answer. No when it is merely nearby or loosely related.`)]));
}

export function resolveRetrieval(view,candidates,a,referent){
  const ids=candidates.filter((_,i)=>a[`item_${i}`]?.score>=.5).map(i=>i.id);
  if(referent?.kind==='object'&&view.itemIds.has('info:'+referent.key))ids.push('info:'+referent.key);
  return [...new Set(ids)];
}
