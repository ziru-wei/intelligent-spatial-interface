// ModOS · the prompts the decision model is asked (design doc 12.35). Their words are in modos/prompts.json, by decision (the names the
// pipeline page shows: request_type, earlier_or_new, continuation, context_anchor, also_uses, answer_form, mod_need), with the words
// that name a sentence shared by all of them. The words can be edited (the pipeline page: double-click a decision); what is filled in
// at run time is a placeholder ({sentence}, {theme}, …), and an edit keeps each one. Options that come from the space or the
// conversation (the earlier themes, the places, the MODs) are not words of a prompt: they are filled in from there.
// Pure, for the pipeline (modos/request.mjs, modos/themes.mjs) and the page's preview alike.

/** A prompt with its placeholders filled in (a placeholder not given stays as it is). */
export const fill=(t,v={})=>String(t).replace(/\{(\w+)\}/g,(m,k)=>Object.hasOwn(v,k)?String(v[k]):m);
/** The placeholders a prompt has. */
export const placeholders=t=>[...new Set([...String(t).matchAll(/\{(\w+)\}/g)].map(m=>m[1]))].sort();
/** How sentence i of the question is named in a prompt ({sentence}): the whole question when it is one sentence, else this sentence with
 *  the one said before it (speech to text cuts "Uh, no. I mean, Alice and Rebecca." into pieces); still being said, when it is the last
 *  one of a question being typed or spoken. */
export function sentenceName(P,sentences,i,typing=false){
  const s=P.sentence,one=sentences.length===1,last=i===sentences.length-1;
  return (one?s.whole:fill(s.part,{text:sentences[i]})+(i?fill(s.after,{before:sentences[i-1]}):''))+(typing&&last?s.typing:'');
}
