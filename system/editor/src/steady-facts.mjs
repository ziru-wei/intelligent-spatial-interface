// Facts computed from the view at each check (whether any of a path is in view, which room the user is in) flip back and forth while the
// view sits at an edge (a doorway, a path at the view's border): each is taken only once its new value has held for `ms` (the first
// values at once), so the cues that depend on it (Floor Path or Arrow Ahead) do not flicker. No dependencies.
export function createSteadyFacts(ms=500){
  let shown=null;const pending=new Map();
  return (raw,now)=>{
    if(!shown){shown={...raw};return {...shown};}
    for(const [k,v] of Object.entries(raw)){
      if(shown[k]===v){pending.delete(k);continue;}
      const p=pending.get(k);if(!p||p.v!==v){pending.set(k,{v,at:now});continue;}
      if(now-p.at>=ms){shown[k]=v;pending.delete(k);}
    }
    return {...shown};
  };
}
