// What a MOD part points at (src/cue-host.mjs draws it with the cues the MOD declared): a response's `highlight`
// ({targets, guidance, label}, scripts/modos_parts.py) or FindMy's found container (with its parent, faint).
/** The highlight to draw for an answer: its own `highlight`, or FindMy's found container (with its parent, faint). */
export function highlightOf(r){
  if(r?.highlight)return r.highlight;
  const f=r?.findmy;if(f?.status!=='found'||!f.target)return null;
  const t=f.target;return {targets:[{id:t.id,label:t.label,center:t.center,size:t.size,yaw:t.yaw,tone:'neutral'}],
    faint:t.parent?[{...t.parent,tone:'neutral'}]:[],guidance:true,label:false};
}
