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

// A typed question replayed (Answer while typing; typing = {id, e}: e seconds after the question began, the clock of its revisions): a
// part shows from when it was made until it left the surface (withdrawn_at), and streamed text as it had been written by then.
// a version shows from when it was made or last updated (updated_at: the same part with new data, scripts/agent_store.py)
const since=(at,q)=>at-(q?.created??0);
export function typedReady(response,question,e){
  return since(response.updated_at??response.created,question)<=e+1e-6&&(response.withdrawn_at==null||e<since(response.withdrawn_at,question)-1e-6);
}
export function typedStreamAt(response,question,e){
  if(!response.stream)return response;
  const update=response.stream.updates?.filter(u=>since(u.created,question)<=e+1e-6).at(-1);
  return update?{...response,...update,stream:{seq:update.seq,status:update.status}}:null;
}

// The video's frames do not fall on a question's exact moment: reached means within half a frame (FRAME_EPS seconds).
export const FRAME_EPS=.02;
// A new question replaces the prior answer only after its first part arrives.
// Rank questions, not individual part IDs: late text for an older question cannot take focus back.
export function latestPresentation(responses,questions,time,hold=null,deliveries=new Map(),typing=null){
  const order=new Map(questions.map((q,i)=>[q.id,i]));
  const heldOrder=order.get(hold?.id);
  let latest=null,rank=-Infinity;
  for(const r of responses){
    const q=questions.find(q=>q.id===r.question_id),position=order.get(q?.id);
    if(heldOrder!=null&&position!=null&&position>heldOrder)continue;
    if(q&&typing?.id===q.id)return r;   // a typed question being replayed: what it showed at that moment
    if(time<(q?.t??r.t??0)-FRAME_EPS)continue;
    const clock=hold?.id===q?.id?hold:deliveries.get(q?.id);
    if(clock&&!responseReady(r,q,clock))continue;
    if(q&&hold?.id===q.id)return r;
    const candidate=position??questions.length+(r.id||0);
    if(candidate>=rank){latest=r;rank=candidate;}
  }
  return latest;
}

// One presentation/container per question, assembled from independently arriving parts.
export function presentationResponses(records,questions,hold,deliveries=new Map(),typing=null){
  const output=[],groups=new Map();
  for(const r of records){
    if(!r.part){output.push(r);continue;}
    if(!groups.has(r.question_id))groups.set(r.question_id,[]);
    groups.get(r.question_id).push(r);
  }
  for(const [qid,parts] of groups){
    const q=questions.find(q=>q.id===qid);
    const clock=hold?.id===qid?hold:deliveries.get(qid);
    // replaying a typed question: its surface as it was e seconds in; otherwise only the parts it ended with
    const ready=typing?.id===qid?parts.filter(r=>typedReady(r,q,typing.e)).map(r=>typedStreamAt(r,q,typing.e)).filter(Boolean)
      :parts.filter(r=>!r.withdrawn&&(!clock||responseReady(r,q,clock))).map(r=>streamResponseAt(r,clock)).filter(Boolean);
    if(!ready.length)continue;
    // Several MODs can each add a ui part (ModOS): each kind is taken from whichever part carries it.
    const uis=ready.filter(r=>r.part==='ui'),ui=uis[0],text=ready.find(r=>r.part==='text'),pick=k=>uis.find(r=>r[k])?.[k];
    const animation=ready.find(r=>r.part==='animation')?.animation;
    // the answer's identity is its first part's, whichever version of it shows (a withdrawn version carries its part's id as part_id)
    const idOf=r=>r.part_id??r.id,first=parts.reduce((a,b)=>idOf(a)<idOf(b)?a:b),base={...first,id:idOf(first)};
    // a text left in view that no longer answers what is asked (a draft revised; stale_at) is drawn dimmed; replayed, from that moment
    const staleText=!!text?.stale_at&&(typing?.id!==qid||text.stale_at-(q?.created??0)<=typing.e+1e-6);
    // whether the language model is writing the text (its window {from, to}): now, or replayed, at the moment replayed
    const textWriting=(w=>{if(!w?.from)return false;if(typing?.id!==qid)return w.to==null;const at=(q?.created??0)+typing.e+1e-6;return w.from<=at&&(w.to==null||w.to>at);})(text?.writing);
    // whether the text's theme is the user's focus: as logged up to the moment replayed (else its last); no theme, in focus
    const textFocus=!text?true:(()=>{const log=text.focus_log||[];if(!log.length)return text.theme?.focus!==false;const upTo=typing?.id===qid?(q?.created??0)+typing.e+1e-6:Infinity;
      let f=log[0][1];for(const [t,v] of log)if(t<=upTo)f=v;return f;})();
    output.push({...base,title:text?.title||'',body:text?.body||'',items:text?.items||[],anchor:text?.anchor||null,...(text?.text_ui?{text_ui:text.text_ui}:{}),...(text?.dialogue?{dialogue:text.dialogue}:{}),...(text?.text_mod?{text_mod:text.text_mod}:{}),
      findmy:pick('findmy'),weather:pick('weather'),highlight:pick('highlight'),control:pick('control'),action:pick('action'),...(animation?{animation}:{}),weather_identity:(w=>w&&`${w.id}@${w.updated_at??''}`)(uis.find(r=>r.weather))??ui?.id,
      // each kind keeps its own MOD's metadata (what it declared it draws, modos/ui-rules.mjs)
      mods:Object.fromEntries(['findmy','weather','highlight','control','action'].map(k=>[k,uis.find(r=>r[k])?.mod]).filter(([,m])=>m)),part:'presentation',layout_slot:0,
      // each kind: whether the theme it shows is the user's focus (modos/themes.mjs; drawn by src/attention.mjs); no theme: in focus
      focus:{...Object.fromEntries(['findmy','weather','highlight','control','action'].map(k=>[k,uis.find(r=>r[k])?.theme?.focus!==false])),text:textFocus},
      // each kind: when its part first showed (the view stack puts what came later below what came earlier)
      since:Object.fromEntries(['weather','control','action'].map(k=>[k,uis.find(r=>r[k])?.created]).filter(([,t])=>t!=null)),
      reserve_text:!!(ui?.reserve_text||text?.reserve_text||text?.stream),stream:text?.stream,text_stale:staleText,text_writing:textWriting,text_version:text?(text.updated_at??text.created):null,
      latency:Math.min(...ready.map(r=>r.latency||0)),component_ids:ready.map(r=>r.id),
      component_key:ready.map(r=>r.id+(r.updated_at?`~${r.updated_at}`:'')+(r.stream?`@${r.stream.seq}`:'')).join(':')+(staleText?':dim':'')+(textWriting?':writing':'')+(textFocus?'':':bg')});
  }
  return output.sort((a,b)=>a.id-b.id);
}
