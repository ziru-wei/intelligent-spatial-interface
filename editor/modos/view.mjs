// ModOS: what every stage reads about the current request, derived once from the memory snapshot (no model involved).
export const placeIds=loc=>[loc?.in?.id,loc?.facing?.id].filter(Boolean).map(id=>'zone:'+id);

export function createView(snap,question){
  const entities=new Map(snap.entities.map(e=>[e.id,e]));
  const sel=snap.selection||null;
  return {
    question,snap,entities,selection:sel,
    candidate:sel?.box_id||null,
    places:placeIds(snap.location),
    itemIds:new Set(snap.items.map(i=>i.id)),
    aboutIds:new Set(snap.items.flatMap(i=>i.about)),
    conversation:snap.conversation||{recent_turns:[],referents:[]},
    nameOf:id=>entities.get(id)?.name||id,
    /** The state every decision call starts from. */
    state:{user_question:question.text,time:snap.time,conversation:snap.conversation||{recent_turns:[],referents:[]},
      location:{in:snap.location?.in?.name||null,facing:snap.location?.facing?.name||null}}
  };
}

/** Questions from several modules sent in one decision call: namespaced on the way in, split on the way out. */
export function merge(groups){
  const out={};
  for(const [ns,qs] of Object.entries(groups))for(const [id,q] of Object.entries(qs))out[`${ns}__${id}`]=q;
  return out;
}
export function split(answers,ns){
  const pre=`${ns}__`,out={};
  for(const [id,a] of Object.entries(answers))if(id.startsWith(pre))out[id.slice(pre.length)]=a;
  return out;
}
