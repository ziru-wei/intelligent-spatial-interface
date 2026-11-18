// Jev (TypeSafe systemone): bounded judgments (a choice among options, or a 0-1 score) for ModOS's decision module (modos/decision.mjs).
// One call answers many questions; every answer is checked against what was asked.
export function createJev({apiKey=process.env.TYPESAFE_API_KEY,model=process.env.TYPESAFE_MODEL||'jev-latest',fetchImpl=fetch,trace=()=>{}}={}) {
  return async (stage,state,questions)=>{
    if(!apiKey)throw Error('Set apiKey in editor/agent-config.local.json or TYPESAFE_API_KEY, then restart the bridge.');
    const start=Date.now();trace(stage,'Started');
    const response=await fetchImpl('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,state,questions}),signal:AbortSignal.timeout(45000)});
    if(!response.ok){const detail=await response.text().catch(()=>'');throw Error(`TypeSafe ${stage} failed (HTTP ${response.status})${detail?': '+detail.slice(0,200):''}.`);}
    const data=await response.json();
    for(const [id,q] of Object.entries(questions)){
      const a=data.answers?.[id];
      if(a?.type!==q.type || (q.type==='choice'?!Object.hasOwn(q.criteria,a.choice):!Number.isFinite(a.noul)||a.noul<0||a.noul>1))throw Error(`Invalid TypeSafe answer for ${stage}.${id}`);
    }
    trace(stage,JSON.stringify({elapsed_ms:Date.now()-start,answers:data.answers,usage:data.usage}));
    return data.answers;
  };
}
