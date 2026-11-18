// ModOS decision module (modos-system-design.md 6.4). The pipeline never calls a model directly: every bounded decision is a
// `choose` (one option) or a `score` (0-1 per question) sent through decide(stage, state, questions). An engine turns those into
// its own calls; today the engine is Jev (scripts/jev.mjs createJev). Any other decision model plugs in by implementing
// engine.ask(stage, state, questions) with the same two question kinds, and every decision is logged (stage, inputs, outputs,
// latency) so the same requests can be replayed through different engines and compared.

/** Pick exactly one of `options` ({id: description}); answer {choice, probability, confidence}. */
export const choose=(instructions,options)=>({kind:'choose',instructions,options});
/** A 0-1 judgment; answer {score}. */
export const score=instructions=>({kind:'score',instructions});

/** Jev: choose → choice (criteria), score → noul. `ask` is createJev(...). */
export function jevEngine(ask){
  return {name:'jev',async ask(stage,state,questions){
    const q={};
    for(const [id,x] of Object.entries(questions))
      q[id]=x.kind==='choose'?{type:'choice',instructions:x.instructions,criteria:x.options}:{type:'noul',instructions:x.instructions};
    const raw=await ask(stage,state,q),out={};
    for(const [id,x] of Object.entries(questions)){
      const a=raw[id];
      out[id]=x.kind==='choose'?{choice:a.choice,probability:a.probabilities?.[a.choice]??null,probabilities:a.probabilities||null,confidence:a.confidence??null}:{score:a.noul};
    }
    return out;
  }};
}

/** decide(stage, state, questions) → {id: answer}. Empty question sets cost nothing. */
export function createDecisionModule(engine,{log=()=>{}}={}){
  const records=[];
  async function decide(stage,state,questions){
    if(!Object.keys(questions).length)return {};
    const started=Date.now();
    const answers=await engine.ask(stage,state,questions);
    for(const [id,x] of Object.entries(questions)){
      const a=answers[id];
      if(!a)throw Error(`Decision ${stage}.${id} has no answer.`);
      if(x.kind==='choose'&&!Object.hasOwn(x.options,a.choice))throw Error(`Decision ${stage}.${id} chose an unknown option.`);
      if(x.kind==='score'&&!(Number.isFinite(a.score)&&a.score>=0&&a.score<=1))throw Error(`Decision ${stage}.${id} scored outside 0-1.`);
    }
    const record={engine:engine.name,stage,questions:Object.keys(questions),answers,elapsed_ms:Date.now()-started};
    records.push(record);log(record);
    return answers;
  }
  return {decide,engine:engine.name,records};
}
