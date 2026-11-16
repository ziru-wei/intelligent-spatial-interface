// ModOS stage 3b · Fill: each chosen MOD's selectors, one decision call per MOD (questions generated in selectors.mjs). A filler
// remembers what it started, so a place MOD filled early (while grounding runs) is not asked twice.
import {selectorQuestions,selectorSources} from './selectors.mjs';

export function createFiller({view,items,decide,trace=()=>{}}){
  const started=new Map();let reference=null;
  return {
    setReference(r){reference=r;},
    fill(mod){
      if(!started.has(mod.id))started.set(mod.id,(async()=>{
        const sources=selectorSources(mod),bodies=sources.length?Object.fromEntries((await items(sources)).map(b=>[b.id,b])):{};
        const qs=selectorQuestions(mod,bodies,{reference});
        const a=await decide(`modos_fill_${mod.id}`,{...view.state,capability:{name:mod.name,description:mod.description},data:qs.data,reference_resolution:reference},qs.questions);
        const selection=qs.interpret(a);trace('modos_fill',JSON.stringify({mod:mod.id,selection}));return selection;
      })());
      return started.get(mod.id);
    }
  };
}
