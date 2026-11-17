// Independent arrival clocks preserve progressive delivery during live holds and replay.
export function responseArrival(response,question,hold){
  return response.part?response.latency??question?.parts?.[response.part]?.latency??0:hold?.shownAt;
}
export function responseReady(response,question,hold){
  const at=responseArrival(response,question,hold);
  return at!=null&&hold.h>=0&&hold.h+1e-6>=at;
}
export function weatherResponse(responses){
  const latest=responses.at(-1);
  if(!latest)return null;
  return [...responses].reverse().find(r=>r.weather&&r.question_id===latest.question_id)||null;
}
export function responseSlot(response,fallback=0){return response.part?response.layout_slot||0:fallback;}

export function streamResponseAt(response,clock){
  if(!response.stream)return response;
  if(clock&&clock.h<0)return null;
  const update=response.stream.updates?.filter(u=>!clock||u.at<=clock.h+1e-6).at(-1);
  if(!update)return null;
  return {...response,...update,stream:{seq:update.seq,status:update.status}};
}

// A new question replaces the prior answer only after its first part arrives.
// Rank questions, not individual part IDs: late text for an older question cannot take focus back.
export function latestPresentation(responses,questions,time,hold=null,deliveries=new Map()){
  const order=new Map(questions.map((q,i)=>[q.id,i]));
  const heldOrder=order.get(hold?.id);
  let latest=null,rank=-Infinity;
  for(const r of responses){
    const q=questions.find(q=>q.id===r.question_id),position=order.get(q?.id);
    if(heldOrder!=null&&position!=null&&position>heldOrder)continue;
    if(time<(q?.t??r.t??0)-1e-6)continue;
    const clock=hold?.id===q?.id?hold:deliveries.get(q?.id);
    if(clock&&!responseReady(r,q,clock))continue;
    if(q&&hold?.id===q.id)return r;
    const candidate=position??questions.length+(r.id||0);
    if(candidate>=rank){latest=r;rank=candidate;}
  }
  return latest;
}

// One presentation/container per question, assembled from independently arriving parts.
export function presentationResponses(records,questions,hold,deliveries=new Map()){
  const output=[],groups=new Map();
  for(const r of records){
    if(!r.part){output.push(r);continue;}
    if(!groups.has(r.question_id))groups.set(r.question_id,[]);
    groups.get(r.question_id).push(r);
  }
  for(const [qid,parts] of groups){
    const q=questions.find(q=>q.id===qid);
    const clock=hold?.id===qid?hold:deliveries.get(qid);
    const ready=parts.filter(r=>!clock||responseReady(r,q,clock)).map(r=>streamResponseAt(r,clock)).filter(Boolean);
    if(!ready.length)continue;
    // Several MODs can each add a ui part (ModOS): each kind is taken from whichever part carries it.
    const uis=ready.filter(r=>r.part==='ui'),ui=uis[0],text=ready.find(r=>r.part==='text'),pick=k=>uis.find(r=>r[k])?.[k];
    const animation=ready.find(r=>r.part==='animation')?.animation;
    const base=parts.reduce((a,b)=>a.id<b.id?a:b);
    output.push({...base,title:text?.title||'',body:text?.body||'',items:text?.items||[],anchor:text?.anchor||null,
      findmy:pick('findmy'),weather:pick('weather'),ego:pick('ego'),highlight:pick('highlight'),control:pick('control'),action:pick('action'),...(animation?{animation}:{}),weather_identity:uis.find(r=>r.weather)?.id??ui?.id,
      // each kind keeps its own MOD's metadata (what it declared it draws, modos/ui-rules.mjs)
      mods:Object.fromEntries(['findmy','weather','ego','highlight','control','action'].map(k=>[k,uis.find(r=>r[k])?.mod]).filter(([,m])=>m)),part:'presentation',layout_slot:0,
      reserve_text:!!(ui?.reserve_text||text?.reserve_text||text?.stream),stream:text?.stream,
      latency:Math.min(...ready.map(r=>r.latency||0)),component_ids:ready.map(r=>r.id),
      component_key:ready.map(r=>r.id+(r.stream?`@${r.stream.seq}`:'')).join(':')});
  }
  return output.sort((a,b)=>a.id-b.id);
}
