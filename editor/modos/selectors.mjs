// ModOS stage 3b: the questions a MOD's selectors turn into, and what the answers select. Questions are generated from the selector's
// kind and the type of data it picks from, never written per MOD, so a new MOD made of known parts needs no code here.
//   pick-many over a timeseries  → one score per date and one per time of day (the old jev_UI_dec, unchanged in substance)
//   pick-one  over item-location → one choose among the available items, plus the selector's extra outcomes
//   pick-one  from an allowed list → one choose among the allowed entries, by their descriptions
//   enum                          → one choose among the values
import {choose,score} from './decision.mjs';

const TIME=e=>e.local_time||e.time;

function timeseries(name,sel,body){
  const rows=body.data?.forecast||[];
  const dates=[...new Set(rows.map(e=>e.date))].sort();
  const slots=[...new Set(rows.flatMap(e=>(e.samples?.length?e.samples:[e]).map(TIME)))].sort();
  const questions={};
  dates.forEach((date,i)=>questions[`${name}_date_${i}`]=score(`Does user_question ask about ${date}, directly or for a related calendar event? Resolve relative dates using time.date. Next week means the next seven days; this weekend means the coming Saturday and Sunday. With no date specified use today. Do not substitute an available date for an unavailable requested date.`));
  slots.forEach((t,i)=>questions[`${name}_slot_${i}`]=score(`Is ${t} within the time of day user_question asks about? Morning=before 12:00, afternoon=12:00-17:59, evening/tonight=18:00 onward. Whole days include every time. An exact time selects the nearest available one; a bounded range includes only times within it. Available times: ${slots.join(', ')}.`));
  const data={forecast:rows.map(({samples,...e})=>({id:e.id,date:e.date,period:e.period,time:e.time,summary:e.summary,temp_c:e.temp_c}))};
  return {questions,data,interpret(a){
    const selDates=new Set(dates.filter((_,i)=>a[`${name}_date_${i}`].score>=.5)),selSlots=new Set(slots.filter((_,i)=>a[`${name}_slot_${i}`].score>=.5));
    const ids=[];
    for(const row of rows){
      if(!selDates.has(row.date))continue;
      const samples=row.samples?.length?row.samples:[row],chosen=samples.filter(s=>selSlots.has(TIME(s)));
      if(chosen.length===samples.length)ids.push(row.id);else ids.push(...chosen.map(s=>s.id));
    }
    if(!ids.length)return null;
    // derived (primitives.json data-widget.layout): the rule, not a model, picks the layout from what was selected.
    const layout=selDates.size>1?'weather-day-buttons':selSlots.size===1?'weather-single':'weather-timeline';
    return {kind:'timeseries',ids,layout,dates:[...selDates],times:[...selSlots]};
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

/** For one MOD: {questions, data, interpret(answers) → {selector: selection}}. bodies: {itemId: body} of the items selectors read. */
export function selectorQuestions(mod,bodies,ctx){
  const parts=Object.entries(mod.selectors||{}).map(([name,sel])=>{
    if(sel.kind==='enum')return [name,enumerated(name,sel)];
    if(sel.from==='allowed')return [name,allowed(name,sel,mod)];
    const body=bodies[sel.from];
    if(!body)throw Error(`MOD ${mod.id}: no data for ${sel.from}.`);
    if(body.type==='timeseries'&&sel.kind==='pick-many')return [name,timeseries(name,sel,body)];
    if(body.type==='item-location'&&sel.kind==='pick-one')return [name,itemLocation(name,sel,body,ctx)];
    throw Error(`MOD ${mod.id}: selector ${name} (${sel.kind} over ${body.type}) is not supported yet.`);
  });
  return {
    questions:Object.assign({},...parts.map(([,p])=>p.questions)),
    data:Object.fromEntries(parts.filter(([,p])=>p.data).map(([n,p])=>[n,p.data])),
    interpret:a=>Object.fromEntries(parts.map(([n,p])=>[n,p.interpret(a)]))
  };
}

/** The items a MOD's selectors read from (feed:weather, user:belongings, ...). */
export const selectorSources=mod=>[...new Set(Object.values(mod.selectors||{}).map(s=>s.from).filter(f=>f&&f!=='allowed'))];
