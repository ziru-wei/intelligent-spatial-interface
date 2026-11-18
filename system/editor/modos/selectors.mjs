// ModOS stage 3b: the questions a MOD's selectors turn into, and what the answers select. Questions are generated from the selector's
// kind and the type of data it picks from, never written per MOD, so a new MOD made of known parts needs no code here.
//   pick-many over a timeseries  → one score per date and one per time of day (the old jev_UI_dec, unchanged in substance), and one
//                                  choose of the entry that answers the question (its focus: where a Playback or Date Picker opens)
//   pick-one  over item-location → one choose among the available items, plus the selector's extra outcomes
//   pick-one  from an allowed list → one choose among the allowed entries, by their descriptions
//   enum                          → one choose among the values
import {choose,score} from './decision.mjs';

const TIME=e=>e.local_time||e.time;

// The days a question asks about come as stretches of consecutive days ("this weekend", "today and tomorrow"). Of the days scored
// .5 or more, a stretch apart from the strongest one is kept only when it scores nearly as well (STRETCH_GAP): a stray day (today, out
// of habit, beside "this weekend") is dropped, two days asked for together ("today or Saturday?") stay.
const STRETCH_GAP=.2,DAY=86400000;
export function stretches(dates,scoreOf){
  const on=dates.map((d,i)=>({d,s:scoreOf(i)})).filter(x=>x.s>=.5),runs=[];
  for(const x of on){const last=runs.at(-1)?.at(-1);if(last&&Date.parse(x.d)-Date.parse(last.d)===DAY)runs.at(-1).push(x);else runs.push([x]);}
  const best=Math.max(...runs.map(r=>r.reduce((t,x)=>t+x.s,0)/r.length));
  return new Set(runs.filter(r=>Math.max(...r.map(x=>x.s))>=best-STRETCH_GAP).flat().map(x=>x.d));
}

function timeseries(name,sel,body){
  const rows=body.data?.forecast||[];
  const dates=[...new Set(rows.map(e=>e.date))].sort();
  const slots=[...new Set(rows.flatMap(e=>(e.samples?.length?e.samples:[e]).map(TIME)))].sort();
  const questions={};
  // a date as people say it: its weekday and how far from today (a model does not work out that 2026-11-21 is this Saturday)
  const WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const said=date=>{const off=rows.find(e=>e.date===date)?.day_offset,wd=WEEKDAYS[new Date(date+'T12:00:00Z').getUTCDay()];
    const rel=off==null?'':off===0?', today':off===1?', tomorrow':off===-1?', yesterday':off>1?`, in ${off} days`:`, ${-off} days ago`;return `${wd} ${date}${rel}`;};
  dates.forEach((date,i)=>questions[`${name}_date_${i}`]=score(`Does user_question ask about ${said(date)}, directly or for a related calendar event? Resolve relative dates using time.date. Next week means the next seven days; this weekend means the coming Saturday and Sunday, not the days before them. Only when user_question names no day or time span at all does it ask about today. Do not substitute an available date for an unavailable requested date.`));
  slots.forEach((t,i)=>questions[`${name}_slot_${i}`]=score(`Is ${t} within the time of day user_question asks about? Morning=before 12:00, afternoon=12:00-17:59, evening/tonight=18:00 onward. Whole days include every time. An exact time selects the nearest available one; a bounded range includes only times within it. Available times: ${slots.join(', ')}.`));
  // the focus: the one entry that answers the question (when asked whether something happens, the entry where it happens); the selected
  // entries then open there instead of at their start. A choice among the entries as the model sees them (data below), in the same
  // call whatever is selected; within an entry, its moment of the same summary (else its first). Not asked over more entries than a
  // choice holds.
  const focus=`${name}_focus`,line=e=>[said(e.date),e.period||TIME(e),e.summary].filter(Boolean).join(' · ');
  if(rows.length>1&&rows.length<255)questions[focus]=choose('Which one entry answers user_question most directly: where what it asks about happens, or the time it names? Choose none when no single entry answers it better than the others.',
    {none:'no single entry',...Object.fromEntries(rows.map((e,i)=>[`e${i}`,line(e)]))});
  const data={forecast:rows.map(({samples,...e})=>({id:e.id,date:e.date,day:said(e.date),period:e.period,time:e.time,summary:e.summary,temp_c:e.temp_c}))};
  return {questions,data,interpret(a){
    const selDates=stretches(dates,i=>a[`${name}_date_${i}`].score),selSlots=new Set(slots.filter((_,i)=>a[`${name}_slot_${i}`].score>=.5));
    const ids=[];
    for(const row of rows){
      if(!selDates.has(row.date))continue;
      const samples=row.samples?.length?row.samples:[row],chosen=samples.filter(s=>selSlots.has(TIME(s)));
      if(chosen.length===samples.length)ids.push(row.id);else ids.push(...chosen.map(s=>s.id));
    }
    if(!ids.length)return null;
    // derived (primitives.json data-widget.layout): the rule, not a model, picks the layout from what was selected.
    const layout=selDates.size>1?'weather-day-buttons':selSlots.size===1?'weather-single':'weather-timeline';
    // the focus counts only when it is one of the selected moments
    const n=a[focus]?.choice?.match(/^e(\d+)$/),row=n&&rows[Number(n[1])],moments=row?(row.samples?.length?row.samples:[row]):[];
    const pool=row&&ids.includes(row.id)?moments:moments.filter(m=>ids.includes(m.id)),f=pool.find(m=>m.summary&&m.summary===row.summary)||pool[0],inside=!!f;
    return {kind:'timeseries',ids,layout,dates:[...selDates],times:[...selSlots],...(inside?{focus:f.id}:{})};
  }};
}

function itemLocation(name,sel,body,ctx){
  const resolved=ctx.reference?.status==='resolved'?ctx.reference.referent?.item_id:null;
  const items=(body.data||[]).filter(i=>i.available&&(!resolved||i.item_id===resolved));
  if(items.length>250)throw Error('Too many items for one choice; split the belongings.');
  const options={...(sel.extra||{})};
  items.forEach((it,i)=>options[`item_${i}`]=JSON.stringify({item:it.label,aliases:it.aliases,container:it.box_label}));
  return {questions:{[name]:choose('Which registered item does user_question ask to locate? Use reference_resolution for pronouns and follow-ups. Match the item, not merely its container.',options)},
    data:{candidates:items.map(i=>({item:i.label,aliases:i.aliases,container:i.box_label}))},
    interpret(a){
      const c=a[name].choice;
      if(!c.startsWith('item_'))return {kind:'item-location',status:c};
      return {kind:'item-location',status:'found',item_id:items[Number(c.slice(5))].item_id};
    }};
}

function allowed(name,sel,mod){
  const options=Object.fromEntries(sel.allowed.map(x=>[x.id,x.description]));
  return {questions:{[name]:choose(`For the capability "${mod.name}" (${mod.description}), which of these does user_question call for? Choose by the descriptions; prefer a non-visual option when the question asks for a plain fact.`,options)},
    data:null,interpret(a){return {kind:'allowed',id:a[name].choice};}};
}

function enumerated(name,sel){
  const options=Object.fromEntries(sel.values.map(v=>[v,v]));
  return {questions:{[name]:choose(sel.instructions||`Which ${name} fits user_question?`,options)},data:null,interpret(a){return {kind:'enum',value:a[name].choice};}};
}

/** The selectors the MOD's active slots read (a variant that hides a slot does not ask for its data). */
const reads=(slot,name)=>Array.isArray(slot.data)?slot.data.includes(name):slot.data===name;
export const activeSelectors=mod=>Object.entries(mod.selectors||{}).filter(([name])=>mod.slots.some(s=>reads(s,name)));

// From the MOD's context info (the items it asked for, of the selector's type):
//   pick-one over device-state → which device and what to do with it (one of its actions, or just show its controls)
//   pick-many over status      → one score per thing: is the question about it
function fromContext(name,sel,ctx){
  const items=(ctx.context||[]).filter(i=>(!sel.type||i.type===sel.type)&&!i.about.every(a=>a.startsWith('user:')||a.startsWith('feed:')));
  const entityOf=i=>i.about[0],nameOf=i=>ctx.view?.nameOf(entityOf(i))||entityOf(i);
  // pick-one over things (Send's attachment): which of the things around, by their information
  if(sel.kind==='pick-one'&&sel.type!=='device-state'){
    // things only (not places), the one the user points at said so: "send this" means it
    const things=items.filter(it=>ctx.view?.entities.get(entityOf(it))?.kind!=='place'),pointed=ctx.view?.candidate;
    items.splice(0,items.length,...things);
    const options={none:'Something not listed here (the user names a thing that is not among these)'};items.forEach((it,i)=>options[`t${i}`]=`${entityOf(it)===pointed?'(the user is pointing at it) ':''}${nameOf(it)}: ${String(it.summary).replace(/\*\*/g,'').slice(0,90)}`);
    const pi=items.findIndex(it=>entityOf(it)===pointed);
    return {questions:{[name]:choose('Which of these things does user_question mean (what to send, share or act on)? "This", "it" or "the poster" while pointing means the thing the user is pointing at.',options)},data:null,
      interpret(a){let c=a[name].choice;
        // "this", "that" or "it" while pointing is the thing pointed at, by rule; otherwise a near tie with "not listed" goes to it
        const deictic=/\b(this|that|it|these|those)\b/i.test(ctx.question||'');
        if(c==='none'&&pi>=0&&(deictic||(a[name].probabilities?.[`t${pi}`]??0)>=.3))c=`t${pi}`;
        if(c==='none')return null;const it=items[Number(c.slice(1))];return {kind:'thing',entity:entityOf(it),item:it.id,label:nameOf(it)};}};
  }
  if(sel.kind==='pick-one'){
    // which device, and what to do with it, from its typed Inputs (modos-system-design.md 3.7): turn a toggle on or off, move a level up
    // or down (or to its ends), pick a choice, run a command; or only look at it
    const options={none:'None of these devices'},map={};
    items.forEach((it,i)=>{const dev=ctx.view?.entities.get(entityOf(it))?.device||{},n=nameOf(it);let j=0;
      const add=(text,action)=>{const id=`d${i}_${j++}`;options[id]=`${n}: ${text}`;map[id]=[it,action];};
      add(`look at it (${it.summary})`,null);
      for(const [k,v] of Object.entries(dev.inputs||{})){const what=k.replace(/_/g,' ');
        if(v.type==='toggle'){add(k==='power'?'turn on':`${what} on`,{key:k,op:'set',value:'on'});add(k==='power'?'turn off':`${what} off`,{key:k,op:'set',value:'off'});}
        else if(v.type==='level'){add(`${what} up`,{key:k,op:'up'});add(`${what} down`,{key:k,op:'down'});add(`${what} to maximum`,{key:k,op:'set',value:v.max??100});add(`${what} to minimum`,{key:k,op:'set',value:v.min??0});}
        else if(v.type==='choice')for(const o of v.options||[])add(`${what}: ${o}`,{key:k,op:'set',value:o});
        else if(v.type==='command')for(const cmd of v.commands||[])add(`${cmd}${v.for?' '+v.for.replace(/_/g,' '):''}`,{key:k,op:'command',value:cmd});
      }});
    if(Object.keys(options).length>250)throw Error('Too many device options for one choice.');
    return {questions:{[name]:choose('Which device does user_question mean, and what should happen to it? Choose a change only when the user asks for one (e.g. "make the light brighter" → lamp: brightness up); "look at it" when they ask what it is doing or how it is.',options)},
      data:{devices:items.map(i=>i.summary)},
      interpret(a){const c=a[name].choice;if(!map[c])return null;const [it,action]=map[c];return {kind:'device',entity:entityOf(it),action};}};
  }
  const qs=Object.fromEntries(items.map((it,i)=>[`${name}_${i}`,score(`Does user_question ask about the "${nameOf(it)}" (or about things like it)? Its state: ${it.summary}`)]));
  return {questions:qs,data:null,interpret(a){
    // The things asked about (0.5 and above); when none clearly is, the most likely one if it is still plausible (0.3).
    const sc=items.map((_,i)=>a[`${name}_${i}`].score),best=sc.indexOf(Math.max(...sc));
    const on=items.filter((_,i)=>sc[i]>=.5).concat(items.length&&sc[best]>=.3&&!sc.some(x=>x>=.5)?[items[best]]:[]);
    return on.length?{kind:'entities',ids:on.map(entityOf),tones:Object.fromEntries(on.map(i=>[entityOf(i),i.level||'neutral'])),states:Object.fromEntries(on.map(i=>[entityOf(i),stateText(i)]).filter(([,t])=>t))}:null;}};
}

/** A status item's state in a few words, from its data: its `state`, else the summary's first phrase after the thing's name
 *  ("Lab printer: in use, printing…" → "In use"). Nothing when the data has no such phrase (never the thing's name). */
export function stateText(item){
  if(typeof item?.state==='string'&&item.state.trim())return item.state.trim().slice(0,40);
  const m=String(item?.summary||'').match(/^[^:]{1,40}:\s*([^,;.]{2,40})/);if(!m)return '';
  const t=m[1].trim();return t[0].toUpperCase()+t.slice(1);
}

// pick-one over the user's contacts: to whom
// pick-many over contacts (Send's recipients): everyone the request names (first or full name, by rule), and one score per person for
// those meant but not named ("my advisor"): everyone at .5 or above; with no one named or scored that high, the best one at .3 or above.
const named=(p,q)=>[p.name,String(p.name).split(/\s+/)[0]].some(n=>n&&n.length>1&&new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(q));
function contacts(name,body,question=''){
  const people=body.data,questions=Object.fromEntries(people.map((p,i)=>[`${name}_${i}`,score(`Does user_question want to send or share it with ${p.name} (${p.role})?`)]));
  return {questions,data:null,interpret(a){const s=people.map((p,i)=>[p,a[`${name}_${i}`]?.score??0]);let on=s.filter(([,v])=>v>=.5);
    on=[...new Set([...people.filter(p=>named(p,question)).map(p=>s.find(([x])=>x===p)),...on])];
    if(!on.length){const best=[...s].sort((x,y)=>y[1]-x[1])[0];if(best&&best[1]>=.3)on=[best];}
    on.sort((x,y)=>people.indexOf(x[0])-people.indexOf(y[0]));
    return on.length?{kind:'contacts',people:on.map(([p])=>({id:p.id,name:p.name,email:p.email}))}:null;}};
}
function contact(name,body){
  const people=body.data,options={nobody:'Nobody named or meant'};people.forEach((p,i)=>options[`c${i}`]=`${p.name} (${p.role})`);
  return {questions:{[name]:choose('Who does user_question want to send or share it with?',options)},data:null,
    interpret(a){const c=a[name].choice;if(c==='nobody')return null;const p=people[Number(c.slice(1))];return {kind:'contact',id:p.id,name:p.name,email:p.email};}};
}

// pick-one over the places of the space (not where the user already is): which one to go to.
function place(name,sel,ctx){
  const v=ctx.view,here=new Set(v?.places||[]);
  const places=[...(v?.entities.values()||[])].filter(e=>e.kind==='place'&&!here.has(e.id));
  const options={none:'No place in the building'};places.forEach((p,i)=>options[`p${i}`]=`${p.name}${p.info?` (${p.info})`:''}`);
  return {questions:{[name]:choose('Which place in the building does user_question want to go to or find?',options)},data:null,
    interpret(a){const c=a[name].choice;return c==='none'?null:{kind:'place',entity:places[Number(c.slice(1))].id};}};
}

/** For one MOD: {questions, data, interpret(answers) → {selector: selection}}. Only data is chosen here, never how it is shown. bodies: {itemId: body} of the items
 *  selectors read. No questions means no decision call. */
export function selectorQuestions(mod,bodies,ctx){
  const parts=activeSelectors(mod).map(([name,sel])=>{
    if(sel.kind==='enum')return [name,enumerated(name,sel)];
    if(sel.from==='allowed')return [name,allowed(name,sel,mod)];
    if(sel.from==='context')return [name,fromContext(name,sel,ctx)];
    if(sel.from==='places')return [name,place(name,sel,ctx)];
    const body=bodies[sel.from];
    if(!body)throw Error(`MOD ${mod.id}: no data for ${sel.from}.`);
    if(body.type==='timeseries'&&sel.kind==='pick-many')return [name,timeseries(name,sel,body)];
    if(body.type==='item-location'&&sel.kind==='pick-one')return [name,itemLocation(name,sel,body,ctx)];
    if(Array.isArray(body.data)&&body.data[0]?.email&&sel.kind==='pick-one')return [name,contact(name,body)];
    if(Array.isArray(body.data)&&body.data[0]?.email&&sel.kind==='pick-many')return [name,contacts(name,body,ctx.question)];
    throw Error(`MOD ${mod.id}: selector ${name} (${sel.kind} over ${body.type}) is not supported yet.`);
  });
  return {
    questions:Object.assign({},...parts.map(([,p])=>p.questions)),
    data:Object.fromEntries(parts.filter(([,p])=>p.data).map(([n,p])=>[n,p.data])),
    interpret:a=>Object.fromEntries(parts.map(([n,p])=>[n,p.interpret(a)]))
  };
}

/** The items a MOD's selectors read from (feed:weather, user:belongings, ...). */
export const selectorSources=mod=>[...new Set(activeSelectors(mod).map(([,s])=>s.from).filter(f=>f&&!['allowed','context','places'].includes(f)))];
