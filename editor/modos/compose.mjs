// ModOS stage 4 · Composition: a MOD's selections become response parts, and one chosen MOD hosts the answer text.
// Rendering still uses today's renderers: slots map onto the existing parts (weather, findmy, animation, text with info), so the
// web editor and the headset show these responses unchanged. A generic primitive-representation renderer replaces this mapping later.

export function partsFor(mod,selection){
  const out=[];
  for(const slot of mod.slots){
    const sel=slot.data?selection[slot.data]:null;
    if(!sel)continue;
    if((slot.use==='ambient-effect'||slot.use==='data-widget')&&sel.kind==='timeseries'&&!out.some(p=>p.weather))
      out.push({part:'ui',weather:{forecast_ids:sel.ids,preview:{component:sel.layout}}});
    if(slot.use==='highlight'&&sel.kind==='item-location')
      out.push({part:'ui',findmy:sel.status==='found'?{status:'found',item_id:sel.item_id}:{status:sel.status}});
    if(slot.use==='scene-asset'&&sel.kind==='allowed'&&sel.id!=='none'){
      const zone=String(slot.anchor?.of||'').replace(/^zone:/,'');
      out.push({part:'animation',animation:{id:sel.id,zone}});
    }
  }
  return out;
}

/** Which chosen MOD carries the answer text: the referent's first, then the highest scored one with a text slot. */
export function textHost(chosen,referent,placeMod=null){
  if(referent)return {extra:{info:{key:referent.key}},slot:0,mod:placeMod?.id||'worldinfo'};
  // Whether a MOD shows text is authored (its `text` slot). When MODs were chosen and none of them has one, the response has no text;
  // with no MOD at all, the text is the whole response and goes in front of the user.
  if(chosen.length&&!chosen.some(c=>c.mod.text))return {none:true};
  const best=[...chosen].filter(c=>c.mod.text).sort((a,b)=>b.score-a.score)[0];
  if(best?.mod.id==='weather')return {extra:{},slot:1,mod:'weather'};
  return {extra:{},slot:0,mod:best?.mod.id||null};
}
