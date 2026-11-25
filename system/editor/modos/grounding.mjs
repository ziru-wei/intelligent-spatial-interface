// ModOS stage 1 · Grounding, the rules after the decision model (design doc 12.32): what the request refers to in the world. The model
// decides, per sentence (modos/themes.mjs, call 2), whether it is about an earlier request (a theme) or something new, and what in the
// world a new one is about (the thing looked at, here, a place, the user, outside data). A theme keeps what it is about: the thing
// looked at when it began, and the items found for it (FindMy), so a later "is it free?" or "where is it?" that goes on with it refers
// to them. Here: the referent of the question and the item a pronoun resolves to.
//   anchorThemes(...)         what each theme is about, from its sentences' context anchors (earlier themes move to a new thing)
//   referentOf(view, themes)  the thing (or area) the question is about, from its themes (in focus first). How the thing looked at
//                             is chosen (Jev's judgement, or the headset's score: selection mode 'score') does not decide whether
//                             the question is about it: a question about the lab while a poster is scored has no referent
//   referenceOf(themes)       the item an earlier theme found ({status: 'resolved', referent: {item_id}}), else standalone
const thing=view=>{const zone=String(view.candidate).startsWith('zone:');
  return view.candidate&&view.selection?{entity:view.candidate,key:view.selection.key,name:view.nameOf(view.candidate),kind:zone?'place':'object',source:'selection'}:null;};
/** What each theme is about, from its sentences' context anchors (cache: the routes by sentence; went: the themes each went into):
 *  a theme begun now is about what its sentence anchors (the thing looked at, kept); a sentence that goes on with an earlier theme
 *  while it anchors another thing looked at, or another named place, moves the theme there ("what's this?", then "and this one?"
 *  pointing elsewhere); anchored to the user or outside data, the theme keeps its own. → the themes moved. */
export function anchorThemes(view,book,cache,went,q){
  const moved=new Set(),looked=thing(view);
  cache.forEach((c,i)=>{const r=c.route;if(!r?.adds||!r.need)return;
    for(const id of went[i]||[]){const t=book.themes.find(x=>x.id===id);if(!t)continue;
      const begun=t.created_q===q&&t.sentences[0]?.i===i;
      if(begun){if(t.about==='referent'&&looked&&!t.referent)t.referent=looked;continue;}
      if(r.need.about==='referent'&&looked&&looked.entity!==t.referent?.entity){Object.assign(t,{referent:looked,about:'referent',abouts:['referent']});moved.add(id);}
      else if(r.need.about.startsWith('place:')&&r.need.about!==t.about){Object.assign(t,{about:r.need.about,abouts:r.need.abouts});delete t.referent;moved.add(id);}}});
  return [...moved];
}
export function referentOf(view,themes){
  const ordered=[...themes.filter(t=>t.focus),...themes.filter(t=>!t.focus)];
  return ordered.find(t=>t.referent)?.referent||null;
}
export function referenceOf(themes){
  const t=[...themes.filter(t=>t.focus),...themes.filter(t=>!t.focus)].find(t=>t.items?.length);
  return t?{status:'resolved',referent:t.items.at(-1)}:{status:'standalone'};
}
