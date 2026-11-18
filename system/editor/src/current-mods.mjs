// The space's MODs as they are now (GET /api/modos/installed; scripts/modos_registry.py installed). A part keeps which MOD and slot made
// it (`mod: {id, slot, ...}`) and the facts known from its data; what that MOD declares it draws (`ui`) and how it is set (`settings`)
// are read from here when the part is drawn. So a change in a MOD's settings or declarations shows on every answer at once, old ones
// and the Gallery's included: drawing needs no new answer. No dependencies beyond fetch.

const byId=new Map();let revision=0;

/** Replace the known MODs (a list of effective MODs). */
export function setCurrentMods(list){byId.clear();for(const m of list||[])byId.set(m.id,m);revision++;}
/** Load the space's installed MODs; resolves to the revision (it changes on every load). */
export async function loadCurrentMods(space){
  try{const u=new URL('/api/modos/installed',location.href);u.searchParams.set('space',space);const r=await fetch(u);if(r.ok)setCurrentMods((await r.json()).mods);}catch{}
  return revision;
}
/** Changes on every load: renderers that keep what they built add it to their key. */
export const modsRevision=()=>revision;

const settled=slot=>Object.fromEntries(Object.entries(slot?.params||{}).filter(([,p])=>'fixed' in p).map(([k,p])=>[k,p.fixed]));

/** A part's MOD metadata with its MOD's current declarations and settings (unchanged when the MOD or slot is not known here). */
export function currentMeta(m){
  const mod=m&&byId.get(m.id),slot=mod?.slots.find(s=>s.id===m.slot);if(!slot)return m;
  const ui=Object.fromEntries(Object.entries(m.ui||{}).map(([id,was])=>{const s=mod.slots.find(x=>x.id===id);return [id,s?.ui?{use:s.use,ui:s.ui}:was];}));
  return {...m,settings:settled(slot),ui};
}

/** An answer's text form and its settings from the MOD hosting its text, as now declared (text_ui, text_mod). */
export function currentText(r){
  const mod=r?.text_mod&&byId.get(r.text_mod.id),slot=mod?.slots.find(s=>s.id===mod.text);
  if(!slot||slot.use!=='situated-text')return {text_ui:r?.text_ui,text_mod:r?.text_mod};
  return {text_ui:slot.ui||r.text_ui,text_mod:{...r.text_mod,settings:settled(slot)}};
}
