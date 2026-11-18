// ModOS stage 4 · Composition: a MOD's selections become response parts, and one chosen MOD hosts the answer text.
// Each part carries its slot's `ui` declaration; the client draws it (modos/ui-rules.mjs). The text part carries its text form: the host
// slot's declaration, and `dialogue: {speaker}` when Object-centric Dialogue holds (the thing says the answer in a bubble on it).
// A MOD here is already effective (scripts/modos_registry.py): `slots` are the active variant's, settled params carry {fixed}.

import {partsToDraw} from './ui-rules.mjs';

const SPEAKERS=/^(layout|comp):/;   // what can speak: furniture, openings and scene objects (modos_twin.boxes), not places

// The facts of the request itself: a thing clearly pointed at (the referent was resolved) and the question put to it in the second person.
export const requestFacts=(question,referent)=>({'target.pointed':!!referent?.entity,'request.second_person':/\b(you|your|yours|yourself)\b/i.test(String(question||''))});

// A part carries what its MOD declared it draws (`ui` of the slot, and of the slots drawn with it on the same choice: a highlight's
// direction and sign) and the facts known when composing; the renderer adds what the view knows and decides (modos/ui-rules.mjs).
const COMPANIONS={highlight:['guidance','label'],'ambient-effect':['data-widget'],'data-widget':['ambient-effect']};
const uiOf=(mod,slot)=>Object.fromEntries([slot,...mod.slots.filter(s=>s!==slot&&s.data&&s.data===slot.data&&(COMPANIONS[slot.use]||[]).includes(s.use))]
  .filter(s=>s.ui).map(s=>[s.id,{use:s.use,ui:s.ui}]));
const meta=(mod,slot,facts={})=>({mod:{id:mod.id,variant:mod.variant||null,slot:slot.id,
  settings:Object.fromEntries(Object.entries(slot.params||{}).filter(([,p])=>'fixed' in p).map(([k,p])=>[k,p.fixed])),
  ui:uiOf(mod,slot),facts}});

export function partsFor(mod,selection,{referent=null,abouts=[],question=''}={}){
  const out=[],asked=abouts.includes('here')?'here':abouts[0],said=requestFacts(question,referent);
  // facts from the request (what the question is about) and from each slot's data
  const factsFor=sel=>({...said,...(asked?{'question.about':asked}:{}),
    ...(sel?.kind==='timeseries'?{'data.days':(sel.dates||[]).length,'data.steps_per_day':(sel.times||[]).length}:{}),
    ...(sel?.kind==='device'?{intent:sel.action?'change':'read'}:{})});
  for(const slot of mod.slots){
    // An action card (Delegate): what will be done, for whom and with what; it runs only when the user confirms it.
    if(slot.use==='action-card'){
      // what goes with the message: the thing itself, a photo taken of it, or nothing (the request says which)
      const [to,what,cap]=(slot.data||[]).map(d=>selection?.[d]),capture=what?.entity?(cap?.id||'thing'):'none';
      if(to)out.push({part:'ui',action:{kind:'send',to:to.id,capture,...(capture!=='none'?{attachment:what.entity}:{})},...meta(mod,slot,{...factsFor(null),'attachment.kind':capture})});
      continue;
    }
    const sel=slot.data?selection?.[slot.data]:null;
    if(!sel)continue;
    const meta_=()=>meta(mod,slot,factsFor(sel));
    if((slot.use==='ambient-effect'||slot.use==='data-widget')&&sel.kind==='timeseries'&&!out.some(p=>p.weather))
      out.push({part:'ui',weather:{forecast_ids:sel.ids,preview:{component:sel.layout}},...meta_()});
    // Highlight from a choice of things (ObjectStatus: by state), a device (IoTControl) or a place (Wayfinding: its door); the MOD's
    // direction arrow and sign on the same choice travel with it.
    if(slot.use==='highlight'&&['entities','device','place'].includes(sel.kind)){
      const same=use=>mod.slots.some(s=>s.use===use&&s.data===slot.data);
      out.push({part:'ui',highlight:{targets:sel.kind==='entities'?sel.ids:[sel.entity],...(sel.tones?{tones:sel.tones}:{}),...(sel.states&&Object.keys(sel.states).length?{states:sel.states}:{}),...(sel.kind==='place'?{door:true}:{}),
        guidance:same('guidance'),label:same('label')},...meta_()});
    }
    if(slot.use==='control'&&sel.kind==='device')out.push({part:'ui',control:{device:sel.entity,action:sel.action||null},...meta_()});
    if(slot.use==='highlight'&&sel.kind==='item-location')
      out.push({part:'ui',findmy:sel.status==='found'?{status:'found',item_id:sel.item_id}:{status:sel.status},...meta_()});
    if(slot.use==='scene-asset'&&sel.kind==='allowed'&&sel.id!=='none'){
      const zone=String(slot.anchor?.of||'').replace(/^zone:/,'');
      out.push({part:'animation',animation:{id:sel.id,zone},...meta_()});
    }
  }
  return out;
}

// The text form the host's text slot declares (Embedded or Floating Text by surface.score, §4.4) and its settings (how long it stays):
// they travel with the text part; the client decides the form once it knows the surface (src/placement.mjs).
const textUi=(mod,slot)=>slot?.use==='situated-text'?{...(slot.ui?{text_ui:slot.ui}:{}),
  text_mod:{id:mod.id,settings:Object.fromEntries(Object.entries(slot.params||{}).filter(([,p])=>'fixed' in p).map(([k,p])=>[k,p.fixed]))}}:{};

/** Where a MOD's text goes: in a speaking object's voice, or as situated text. Layout slot 1 is the place below a data view (the
 *  weather view) the text is placed relative to; everything else uses slot 0. */
function hostOf(mod,referent,said={}){
  const slot=mod.slots.find(s=>s.id===mod.text);
  if(slot?.use==='action-card')return {extra:{},slot:0,mod:mod.id,draft:true};   // the text is the draft inside the card
  // Object-centric Dialogue: when the text slot declares it and its rule holds (the thing pointed at, asked as "you") and the thing can
  // speak, it says the answer in the first person in a bubble on it; otherwise the slot's other text forms show the answer.
  const speaker=referent?.entity&&SPEAKERS.test(referent.entity)?referent.entity:null;
  if(speaker&&slot?.ui&&partsToDraw(slot.ui,said).includes('dialogue'))
    return {extra:{...textUi(mod,slot),dialogue:{speaker}},slot:0,mod:mod.id,voice:{speaker,name:referent.name||null}};
  const to=slot?.anchor?.kind==='relative'?mod.slots.find(s=>s.id===slot.anchor.to):null;
  return {extra:textUi(mod,slot),slot:to&&['ambient-effect','data-widget'].includes(to.use)?1:0,mod:mod.id};
}

/** Which chosen MOD carries the answer text: the referent's first, then the highest scored one with a text slot. */
export function textHost(chosen,referent,placeMod=null,question=''){
  const said=requestFacts(question,referent);
  // A MOD that acts for the user (its text slot is an action card) carries the text: the text is its draft.
  const acting=chosen.find(c=>c.mod.slots.find(s=>s.id===c.mod.text)?.use==='action-card');
  if(acting)return hostOf(acting.mod,referent,said);
  if(referent){
    // The referent's MOD: a place MOD that speaks for the place, else the referent-scoped MOD chosen for it (WorldInfo).
    const own=placeMod||chosen.find(c=>c.mod.scope==='referent')?.mod||null;
    const host=own?.text?hostOf(own,referent,said):null;
    if(host?.voice)return host;
    return {extra:{info:{key:referent.key},...(own?textUi(own,own.slots.find(s=>s.id===own.text)):{})},slot:0,mod:own?.id||'worldinfo'};
  }
  // Whether a MOD shows text is authored (its variant's text slot). When MODs were chosen and none of them has one, the response has
  // no text; with no MOD at all, the text is the whole response and goes in front of the user.
  if(chosen.length&&!chosen.some(c=>c.mod.text))return {none:true};
  const best=[...chosen].filter(c=>c.mod.text).sort((a,b)=>b.score-a.score)[0];
  return best?hostOf(best.mod,null):{extra:{},slot:0,mod:null};
}
