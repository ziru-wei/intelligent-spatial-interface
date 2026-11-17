// ModOS stage 3 · Context info: each chosen MOD asks for the context info it needs, and gets it by rules along the digital twin (no
// model, no search over the whole space). A MOD's `knowledge` says what it asks for:
//   {ref: "feed:weather"} / {ref: "user:belongings"}   that item
//   {ref: "about:<entity>"}                           what is attached to that entity (LabInfo: the lab)
//   {ref: "referent"}                                 what is attached to what the user points at, then to what it is in, up to its place
//   {type: "schedule"} (no ref)                       items of that type around what its questions are about (the thing, the place
//                                                     here, the user)
// With no MOD chosen, the answer's context comes the same way from what the questions are about (fallback). At most MAX items each.
export const MAX_CONTEXT_ITEMS=6;

/** An entity and what it is in, up to its place. */
export function upChain(view,id){
  const out=[],seen=new Set();
  for(let e=view.entities.get(id);e&&!seen.has(e.id);e=view.entities.get(e.parent||e.place)){out.push(e.id);seen.add(e.id);if(!e.parent&&!e.place)break;}
  if(!out.length&&id)out.push(id);
  return out;
}

const about=(view,ids,types)=>{
  const set=new Set(ids);
  // In the order of `ids`: what is closest first (the thing, then its container, then the place).
  return view.snap.items.filter(i=>i.about.some(a=>set.has(a))&&(!types||types.includes(i.type)))
    .sort((a,b)=>Math.min(...a.about.map(x=>ids.indexOf(x)).filter(x=>x>=0))-Math.min(...b.about.map(x=>ids.indexOf(x)).filter(x=>x>=0)));
};

/** The nodes a question about `kind` starts from. */
export function anchorNodes(view,kind,referent){
  if(kind==='referent')return upChain(view,referent?.entity||view.candidate);
  // here: the places, and what is in them (a status or a device belongs to a thing in the room, not to the room)
  if(kind==='here')return [...view.places,...[...view.entities.values()].filter(e=>view.places.includes(e.place)&&e.id!==e.place).map(e=>e.id)];
  if(kind==='user')return ['user:me'];
  if(kind==='world')return view.snap.items.filter(i=>i.id.startsWith('feed:')).flatMap(i=>i.about);
  return [];
}

/** {from: [entity ids], items: [item ids]} for one chosen MOD. abouts: what its questions are about. */
export function requestContext(view,mod,{referent=null,abouts=[]}={}){
  const from=[],items=[];
  for(const k of mod.knowledge||[]){
    if(k.ref==='referent'){const up=upChain(view,referent?.entity||view.candidate);from.push(...up);
      if(referent?.key&&view.itemIds.has('info:'+referent.key))items.push('info:'+referent.key);   // its own information first
      items.push(...about(view,up).map(i=>i.id));}
    else if(k.ref?.startsWith('about:')){const id=k.ref.slice(6);from.push(id);items.push(...about(view,[id]).map(i=>i.id));}
    else if(k.ref){if(view.itemIds.has(k.ref)){from.push(...(view.snap.items.find(i=>i.id===k.ref)?.about||[]));items.push(k.ref);}}
    else if(k.from==='places'){   // about the building's places as a whole (a floor directory): what is about the most places first
      const places=[...view.entities.values()].filter(e=>e.kind==='place').map(e=>e.id),set=new Set(places);
      const hits=view.snap.items.filter(i=>(!k.type||i.type===k.type)&&i.about.filter(a=>set.has(a)).length>=2).sort((a,b)=>b.about.length-a.about.length);
      from.push(...places);items.push(...hits.map(i=>i.id));}
    // By type: from what its questions are about, then from here (devices and statuses belong to things in the room, even when the
    // question is "my print job").
    else if(k.type){const nodes=[...new Set([...abouts.flatMap(a=>anchorNodes(view,a,referent)),...anchorNodes(view,'here',referent)])];from.push(...nodes);items.push(...about(view,nodes,[k.type]).map(i=>i.id));}
  }
  return {from:[...new Set(from)],items:[...new Set(items)].slice(0,MAX_CONTEXT_ITEMS)};
}

/** Context for an answer no MOD takes: what is attached to what its questions are about. */
export function fallbackContext(view,abouts,referent){
  const nodes=[...new Set(abouts.flatMap(a=>anchorNodes(view,a,referent)))];
  return {from:nodes,items:about(view,nodes).map(i=>i.id).slice(0,MAX_CONTEXT_ITEMS)};
}
