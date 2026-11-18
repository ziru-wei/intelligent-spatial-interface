// A slot's spatial UI (modos-system-design.md 4.4, 5.1): what the MOD declared it draws, decided by rules, not a model.
//   ui: {fixed: [part], flexible: [{cue, when, instead_of?}]}
//   when: terms joined by "&"; a term is a fact ("target.out_of_view"), its negation ("!user.in_target"), or a comparison
//         ("data.days>1", "value.type=level", "value.type=toggle|command", "state.level!=ok").
// Facts come from where they are known: the data and the request when composing (server), the view and the device's values when drawing
// (client). A fact that is not known makes its term false, so a flexible part is drawn only when everything it asks for holds.
// Shared by modos/compose.mjs and the renderers (src/cue-host.mjs).

/** The terms of a `when`. */
export function parseWhen(when){
  return String(when||'').split('&').map(t=>t.trim()).filter(Boolean).map(t=>{
    const neg=t.startsWith('!'),body=neg?t.slice(1):t,m=body.match(/^([\w.]+)\s*(!=|>=|<=|=|>|<)\s*(.+)$/);
    return m?{neg,fact:m[1],op:m[2],value:m[3]}:{neg,fact:body,op:null,value:null};
  });
}

function term({neg,fact,op,value},facts){
  const v=facts[fact];let ok;
  if(op===null)ok=v===true;
  else if(v===undefined||v===null)ok=false;
  else if(op==='='||op==='!='){const hit=value.split('|').includes(String(v));ok=op==='='?hit:!hit;}
  else{const a=Number(v),b=Number(value);ok=op==='>'?a>b:op==='<'?a<b:op==='>='?a>=b:a<=b;}
  return neg?!ok:ok;
}

/** Whether a `when` holds for these facts (no `when`: always). */
export const holds=(when,facts={})=>parseWhen(when).every(t=>term(t,facts));

/** The facts a `when` reads (to know which side can decide it). */
export const factsOf=when=>parseWhen(when).map(t=>t.fact);

/** The parts a slot draws for these facts: its fixed parts and the flexible parts that hold, in the declared order, minus those a
 *  holding flexible part stands in for (`instead_of`: one part or several, fixed or flexible). */
export function partsToDraw(ui,facts={}){
  if(!ui)return [];
  const on=(ui.flexible||[]).filter(f=>holds(f.when,facts)),gone=new Set(on.flatMap(f=>[].concat(f.instead_of||[])));
  const out=(ui.fixed||[]).filter(p=>!gone.has(p));
  for(const f of on)if(!out.includes(f.cue)&&!gone.has(f.cue))out.push(f.cue);
  return out;
}
