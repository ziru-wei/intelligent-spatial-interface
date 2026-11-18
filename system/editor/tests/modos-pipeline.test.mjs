import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runModos,eligible,partsFor,textHost,liveChoice,partKey} from '../modos/pipeline.mjs';
import {createDecisionModule} from '../modos/decision.mjs';

// The MODs as the pipeline reads them: resolved by the registry (variant, settings), optionally with a customization.
const EDITOR=fileURLToPath(new URL('..',import.meta.url));
const mod=(id,custom=null)=>JSON.parse(execFileSync('python3',['-c',`import json,sys;sys.path.insert(0,'scripts');import modos_registry as r
b=r.base_mods();b['labinfo']=r.validate(r.extend(json.load(open('modos/examples/atlas/mods/labinfo.json')),b))
print(json.dumps(r.validate(r.effective(b[sys.argv[1]],json.loads(sys.argv[2])))))`,id,JSON.stringify(custom)],{cwd:EDITOR,encoding:'utf8'}));
const MODS=['findmy','labinfo','weather','worldinfo'].map(id=>mod(id));
const forecast=[
  {id:'sat-am',date:'2026-10-10',period:'morning',time:'08:00',summary:'Rain',temp_c:9,samples:[{id:'sat-am-08',date:'2026-10-10',time:'08:00'}]},
  {id:'sun-am',date:'2026-10-11',period:'morning',time:'08:00',summary:'Clear',temp_c:12,samples:[{id:'sun-am-08',date:'2026-10-11',time:'08:00'}]},
  {id:'mon-ev',date:'2026-10-12',period:'evening',time:'21:00',summary:'Rain',temp_c:6,samples:[{id:'mon-ev-21',date:'2026-10-12',time:'21:00'}]}];
const BODIES={
  'feed:weather':{id:'feed:weather',type:'timeseries',data:{forecast}},
  'user:belongings':{id:'user:belongings',type:'item-location',data:[{item_id:'headphones',label:'Headphones',aliases:[],box_id:'shelf',box_label:'lab shelf 3',available:true},{item_id:'umbrella',label:'Umbrella',aliases:[],box_id:'rack',box_label:'coat rack',available:true}]},
  'info:candy':{id:'info:candy',type:'text',text:'Grad tea leftovers; help yourself.'},
  'info:PRL research theme':{id:'info:PRL research theme',type:'text',text:'Programmable reality.'},
  'info:window':{id:'info:window',type:'text',text:'South window; close it when it rains.'}};
const ITEMS=[
  {id:'feed:weather',about:['feed:weather'],type:'timeseries',summary:'Weather forecast by day and period.'},
  {id:'user:belongings',about:['user:me'],type:'item-location',summary:'Where the user\'s registered belongings are kept.'},
  {id:'info:candy',about:['comp:c3'],type:'text',summary:'The candy bowl: grad tea leftovers.'},
  {id:'info:PRL research theme',about:['zone:lab-2f','zone:lab-hall-2f'],type:'text',summary:'What PRL researches: programmable reality.'},
  {id:'info:window',about:['layout:window-1'],type:'text',summary:'The south window and when to close it.'}];
const ENTITIES=[{id:'comp:c3',name:'candy'},{id:'zone:lab-2f',name:'Lab'},{id:'zone:lab-hall-2f',name:'Lab corridor'},{id:'layout:window-1',name:'window'},{id:'user:me',name:'the user'}];

// A scripted decision engine: a score is 1 when its instructions mention one of `yes`; a choice takes the first option whose
// id or description mentions one of `yes`, else the first option.
function engine(yes){
  const hit=t=>yes.some(w=>t.toLowerCase().includes(w.toLowerCase()));
  return {name:'script',async ask(stage,state,questions){
    return Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,q.kind==='score'?{score:hit(q.instructions)?1:0}
      :{choice:Object.keys(q.options).find(k=>hit(k+' '+q.options[k]))||Object.keys(q.options)[0],probability:.9,confidence:.9}]));
  }};
}
async function run(text,{yes,selection=null,location=null,mods=MODS,stages=[]}){
  const published=[],contexts=[],base=createDecisionModule(engine(yes)).decide,decide=(stage,...a)=>{stages.push(stage);return base(stage,...a);};
  const memory=async()=>({time:{date:'2026-10-09'},conversation:{recent_turns:[],referents:[]},selection,location,mods,entities:ENTITIES,items:ITEMS});
  const items=async ids=>ids.map(id=>BODIES[id]);
  const answer=async(q,context)=>{contexts.push(context);return {title:'T',body:'B',anchor:{object:'x',relation:'on'},referenced_item_ids:[]};};
  const result=await runModos({question:{id:1,text},memory,items,decide,answer,publish:async p=>published.push(p)});
  return {result,published,contexts,ui:published.filter(p=>p.part==='ui'),anim:published.filter(p=>p.part==='animation'),text:published.filter(p=>p.part==='text')};
}

test('weather: the feed is retrieved, the Weather MOD fills days, layout is derived', async()=>{
  const r=await run('What is the weather this weekend?',{yes:['weather','2026-10-10','2026-10-11','08:00']});
  assert.deepEqual(r.ui.map(p=>Object.keys(p).find(k=>k==='weather'||k==='findmy')),['weather']);
  // the focus: the moment that answers the question (the scripted engine picks the first moment of Saturday), one of the selected
  assert.deepEqual(r.ui[0].weather,{forecast_ids:['sat-am','sun-am'],focus:'sat-am-08',preview:{component:'weather-day-buttons'}});
  assert.equal(r.text[0].layout_slot,1);
});

test('findmy: one item chosen; the highlight part names it', async()=>{
  const r=await run('Where are my headphones?',{yes:['belongings','FindMy','headphones']});
  assert.deepEqual(r.ui.map(p=>p.findmy),[{status:'found',item_id:'headphones'}]);
});

test('candy: the referent is confirmed, WorldInfo hosts the text next to it, no MOD UI', async()=>{
  const r=await run('Can I eat this?',{yes:['looking at','candy bowl'],selection:{box_id:'comp:c3',key:'candy',mode:'jev'}});
  assert.equal(r.ui.length,0);
  assert.deepEqual(r.text[0].info,{key:'candy'});
});

test('lab: the zone is the referent, LabInfo (WorldInfo extended by the space owner) plays the work diorama, knowledge comes from retrieval', async()=>{
  const r=await run('What are they working on?',{yes:['standing in an area','researches','capability "LabInfo"','labResearchWork'],
    selection:{box_id:'zone:lab-hall-2f',key:'Programmable Reality Lab',mode:'jev'},location:{in:{id:'lab-hall-2f',name:'Lab corridor'}}});
  assert.deepEqual(r.anim.map(p=>p.animation),[{id:'labResearchWork',zone:'lab-2f'}]);
  assert.deepEqual(r.text[0].info,{key:'Programmable Reality Lab'});
});

test('window: local and global combine; weather UI appears beside the window info', async()=>{
  const r=await run('Will it rain tonight? Should I close this?',{yes:['looking at','window','weather','2026-10-12','Is 21:00'],selection:{box_id:'layout:window-1',key:'window',mode:'jev'}});
  assert.equal(r.ui.length,1);
  assert.equal(r.ui[0].weather.preview.component,'weather-single');
  assert.deepEqual(r.text[0].info,{key:'window'});
});

test('packing: two MODs in one response', async()=>{
  const r=await run('What is the weather next week and what should I bring?',{yes:['weather','belongings','FindMy','umbrella','2026-10-10','2026-10-11','2026-10-12','08:00','21:00']});
  assert.deepEqual(r.ui.map(p=>p.weather?'weather':'findmy').sort(),['findmy','weather']);
});

test('stage 0: place-scoped MODs only where they belong, referent MODs only with a referent', ()=>{
  const lab=mod('labinfo'),info=mod('worldinfo'),ids=new Set(ITEMS.map(i=>i.id)),about=new Set(ITEMS.flatMap(i=>i.about));
  assert.equal(eligible(lab,{places:['zone:kitchen-2f'],candidate:null,referent:null,itemIds:ids,aboutIds:about}),false);
  assert.equal(eligible(lab,{places:['zone:lab-hall-2f'],candidate:null,referent:null,itemIds:ids,aboutIds:about}),true);
  assert.equal(eligible(info,{places:[],candidate:null,referent:null,itemIds:ids,aboutIds:about}),false);
});

test('decision module rejects answers outside the question', async()=>{
  const bad={name:'bad',async ask(){return {a:{choice:'nope'}};}};
  await assert.rejects(createDecisionModule(bad).decide('s',{},{a:{kind:'choose',instructions:'',options:{x:'x'}}}),/unknown option/);
});

test('text host: referent first, then the highest scored MOD with a text slot', ()=>{
  assert.equal(textHost([{mod:mod('weather'),score:.8},{mod:mod('findmy'),score:.9}],null).mod,'findmy');
  assert.deepEqual(textHost([],{key:'candy'}).extra,{info:{key:'candy'}});
  assert.equal(partsFor(mod('labinfo'),{asset:{kind:'allowed',id:'none'}}).length,0);
});

test('grounding is its own module: a zone loses to a resolved pronoun, an object referent wins', async()=>{
  const {createView}=await import('../modos/view.mjs');
  const {resolveGrounding}=await import('../modos/grounding.mjs');
  const snap=(selection,referents=[])=>({time:{},conversation:{recent_turns:[],referents},selection,location:null,mods:[],entities:ENTITIES,items:ITEMS});
  const book={item_id:'book',label:'Book'};
  const zone=createView(snap({box_id:'zone:lab-2f',key:'Lab',mode:'jev'},[book]),{text:'Where is it?'});
  const g1=resolveGrounding(zone,{referent:{score:.9},conversation_reference:{choice:'ref_0',probability:.9,confidence:.9}});
  assert.equal(g1.referent,null);assert.equal(g1.reference.status,'resolved');
  const obj=createView(snap({box_id:'comp:c3',key:'candy',mode:'jev'}),{text:'Can I eat this?'});
  assert.equal(resolveGrounding(obj,{referent:{score:.8}}).referent.kind,'object');
  const unclear=createView(snap(null,[book,{item_id:'pen',label:'Pen'}]),{text:'Where is it?'});
  assert.equal(resolveGrounding(unclear,{conversation_reference:{choice:'unresolved'}}).clarify,true);
});

test('text is authored: chosen MODs without a text slot give a response with no text', async()=>{
  const silent={...mod('findmy'),slots:mod('findmy').slots.filter(s=>s.use!=='situated-text'),text:undefined};
  assert.deepEqual(textHost([{mod:silent,score:.9}],null),{none:true});
  assert.notEqual(textHost([],null).none,true);
});

test('variants: Weather as text only shows no weather view and asks nothing for it; its text goes in front of the user', async()=>{
  const stages=[];
  const r=await run('What is the weather this weekend?',{yes:['weather','2026-10-10','08:00'],mods:[mod('weather',{variant:'text'})],stages});
  assert.equal(r.ui.length,0);
  assert.equal(r.text[0].layout_slot,0);
  assert.ok(!stages.includes('modos_fill_weather'));
  assert.equal(textHost([{mod:mod('weather'),score:.8}],null).slot,1);   // the full variant: text below the weather view
});

test('WorldInfo: the thing speaks in the first person only by its rule (pointed at, asked as "you"): Object-centric Dialogue on the text', async()=>{
  const info=mod('worldinfo');
  assert.equal(info.variant??null,null);   // one representation: no variant to switch the voice on
  const r=await run('Can I eat you?',{yes:['looking at','candy bowl'],selection:{box_id:'comp:c3',key:'candy',mode:'jev'},mods:[info]});
  assert.equal(r.ui.length,0);   // no part of its own: the text part carries the dialogue
  assert.deepEqual(r.text.at(-1).dialogue,{speaker:'comp:c3'});
  assert.equal(r.contexts[0].voice.speak_as,'candy');
  assert.equal(r.text[0].info,undefined);
  // Asked about it, not to it (no second person): text beside it, no voice, no motion.
  const t=await run('Can I eat this?',{yes:['looking at','candy bowl'],selection:{box_id:'comp:c3',key:'candy',mode:'jev'},mods:[info]});
  assert.equal(t.ui.length,0);assert.equal(t.contexts[0].voice,undefined);assert.equal(t.text.at(-1).dialogue,undefined);
  // A place cannot speak: the answer stays text beside it.
  assert.deepEqual(textHost([{mod:info,score:1}],{key:'Lab',entity:'zone:lab-2f',kind:'place'},null,'What are you?').extra.info,{key:'Lab'});
});

test('grounding: a thing asked in the second person is the referent even when grounding scored it under the bar', async()=>{
  const voice=mod('worldinfo'),selection={box_id:'comp:c3',key:'candy',mode:'jev'};
  // grounding says no; the request's `about` picks the thing looked at (its option reads "the thing the user is looking at")
  const r=await run('Can I eat you?',{yes:['the thing the user is looking'],selection,mods:[voice]});
  assert.deepEqual(r.text.at(-1).dialogue,{speaker:'comp:c3'});
  assert.equal(r.contexts[0].voice.speak_as,'candy');
  // "you" as the assistant is not the thing
  const a=await run('Can you tell me what time it is?',{yes:['the thing the user is looking'],selection,mods:[voice]});
  assert.equal(a.text.at(-1)?.dialogue,undefined);
});

test('the request: split into its questions by rules (no model)', async()=>{
  const {splitRequest}=await import('../modos/request.mjs');
  assert.deepEqual(splitRequest('What is the weather next week and what should I bring?'),['What is the weather next week','what should I bring?']);
  assert.deepEqual(splitRequest('Will it rain tonight? Should I close this?'),['Will it rain tonight?','Should I close this?']);
  assert.deepEqual(splitRequest('Where are my headphones?'),['Where are my headphones?']);
  assert.deepEqual(splitRequest('Can I eat this?'),['Can I eat this?']);
  assert.deepEqual(splitRequest('should i bring my umbrella?where is it'),['should i bring my umbrella?','where is it']);   // no space needed after ?
  assert.deepEqual(splitRequest('Is it 3.5 degrees?'),['Is it 3.5 degrees?']);
});

test('context info: each MOD asks for what it needs along the twin; nothing else in the space is considered', async()=>{
  const {createView}=await import('../modos/view.mjs');
  const {requestContext,fallbackContext}=await import('../modos/context-request.mjs');
  const items=[...ITEMS,{id:'info:fridge flyer',about:['layout:fridge'],type:'text',summary:'A flyer in the kitchen.'}];
  const view=createView({time:{},conversation:{recent_turns:[],referents:[]},selection:{box_id:'comp:c3',key:'candy',mode:'jev'},location:{in:{id:'lab-2f'}},mods:[],
    entities:[...ENTITIES,{id:'layout:fridge',name:'fridge',place:'zone:kitchen-2f'}],items},{text:'x'});
  const lab=requestContext(view,mod('labinfo'),{abouts:['here']});
  assert.deepEqual(lab.items,['info:PRL research theme']);
  assert.deepEqual(requestContext(view,mod('weather')).items,['feed:weather']);
  const info=requestContext(view,mod('worldinfo'),{referent:{entity:'comp:c3',key:'candy'}});
  assert.equal(info.items[0],'info:candy');
  assert.ok(!fallbackContext(view,['here'],null).items.includes('info:fridge flyer'));
});

test('one need, two ways to show it: the better MOD stays; two needs in one sentence: both stay', async()=>{
  const {runModos}=await import('../modos/pipeline.mjs');
  const items=[...ITEMS,{id:'status:printer',about:['layout:printer'],type:'status',summary:'Printer: in use.'},{id:'device:layout:printer',about:['layout:printer'],type:'device-state',summary:'printer: power on'}];
  const entities=[...ENTITIES,{id:'layout:printer',name:'printer',place:'zone:lab-2f'}];
  async function chosen(text,yes,mods){
    const traces=[],decide=createDecisionModule(engine(yes)).decide;
    const memory=async()=>({time:{date:'2026-10-09'},conversation:{recent_turns:[],referents:[]},selection:null,location:{in:{id:'lab-2f',name:'Lab'}},mods,entities,items});
    await runModos({question:{id:1,text},memory,items:async ids=>ids.map(id=>BODIES[id]||{id,type:'text',text:'x'}),decide,answer:async()=>({title:'T',body:'B',anchor:null,referenced_item_ids:[]}),publish:async()=>{},trace:(t,x)=>traces.push([t,x])}).catch(()=>{});
    const last=[...traces].reverse().find(([t])=>t==='modos_mods_final'||t==='modos_mods');return JSON.parse(last[1]).map(([id])=>id);
  }
  assert.equal((await chosen('Is the printer free?',['ObjectStatus','IoTControl','printer'],[mod('objectstatus'),mod('iotcontrol')])).length,1);
  assert.deepEqual((await chosen('Should I bring my umbrella?',['Weather','FindMy','umbrella'],[mod('weather'),mod('findmy')])).sort(),['findmy','weather']);
});

test('status: the state in a few words from the data, never the thing\'s name', async()=>{
  const {stateText}=await import('../modos/selectors.mjs');
  assert.equal(stateText({summary:'Lab printer: in use, printing a 12-page poster for Ana; about 4 minutes left.'}),'In use');
  assert.equal(stateText({summary:'Espresso machine: water tank almost empty; refill before making coffee.'}),'Water tank almost empty');
  assert.equal(stateText({state:'Paper low',summary:'Lab printer: in use'}),'Paper low');
  assert.equal(stateText({summary:'No name and state here'}),'');
});

test('send: recipients are picked many (the selector kind); its message is written apart from the answer, names nobody, has no heading', async()=>{
  const send=mod('send'),people=[{id:'alice',name:'Alice Chen',role:'PhD student',email:'alice@example.edu'},{id:'ryo',name:'Ryo Suzuki',role:'advisor',email:'ryo@example.edu'},
    {id:'ana',name:'Ana Ruiz',role:'PhD student',email:'ana@example.edu'}];
  BODIES['user:contacts']={id:'user:contacts',type:'text',data:people};ITEMS.push({id:'user:contacts',about:['user:me'],type:'text',summary:'The user\'s contacts.'});
  try{
    const r=await run('send a note to Alice and Ryo',{yes:['reaches other people','Alice','Ryo','nothing attached'],mods:[send]});
    const a=r.ui.find(p=>p.action)?.action;
    assert.deepEqual(a,{kind:'send',to:['alice','ryo'],pick:'many',capture:'none',draft:{body:'B'}});   // its message, its own
    const ctx=r.contexts.find(c=>c.request);assert.ok(ctx&&!JSON.stringify(ctx).includes('Ryo Suzuki'),'the message context names no recipient');
    assert.equal(r.text.length,0);                                                                       // Send alone: no answer text
    // with something else asked too, the answer is the other MOD's, and the message is still written apart
    const w=await run('what is the weather this weekend? send it to Alice',{yes:['reaches other people','Alice','nothing attached','weather','2026-10-10','08:00'],mods:[send,mod('weather')]});
    assert.ok(w.ui.find(p=>p.action)?.action.draft.body);assert.ok(w.text.length>0);
    assert.ok(w.contexts.some(c=>c.request?.length===2),'the message sees what was asked to send');
  }finally{delete BODIES['user:contacts'];ITEMS.pop();}
});

test('days: a stray stretch beside the strongest one is dropped; two days asked for together stay', async()=>{
  const {stretches}=await import('../modos/selectors.mjs');
  const D=['2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22'];
  assert.deepEqual([...stretches(D,i=>[.69,.06,.07,.96,.94][i])],['2026-11-21','2026-11-22']);
  assert.deepEqual([...stretches(D,i=>[.9,.1,.1,.88,.2][i])],['2026-11-18','2026-11-21']);
  assert.deepEqual([...stretches(D,i=>[.8,.7,.1,.1,.1][i])],['2026-11-18','2026-11-19']);
  assert.deepEqual([...stretches(D,()=>.1)],[]);
});

test('live: a MOD shows once its need is clear (twice at .5, or once at .85) and stays until it falls under .35; Enter uses .5', ()=>{
  assert.deepEqual([...liveChoice({w:.6})],[]);                                             // once at .6: not yet
  assert.deepEqual([...liveChoice({w:.6},{previous:{w:.55}})],['w']);                       // twice: clear
  assert.deepEqual([...liveChoice({w:.9})],['w']);                                          // sure at once
  assert.deepEqual([...liveChoice({w:.4},{shown:new Set(['w'])})],['w']);                   // shown: kept above .35
  assert.deepEqual([...liveChoice({w:.3},{shown:new Set(['w'])})],[]);                      // clearly gone
  assert.deepEqual([...liveChoice({w:.4},{shown:new Set(['w']),final:true})],[]);           // Enter: the plain rule
  assert.equal(partKey({part:'ui',highlight:{},mod:{id:'objectstatus'}}),'highlight:objectstatus');
  assert.equal(partKey({part:'text'}),'text:');
});

test('live: revisions reconcile what shows: parts replaced only when changed, text once the intent and its facts are clear, a MOD gone is withdrawn', async()=>{
  const live={state:{},final:false,pause:false,stale:()=>false,retracted:[]};live.retract=async keys=>live.retracted.push(...keys);
  const revise=async(text,yes,{pause=false,final=false}={})=>{
    const published=[];Object.assign(live,{pause,final});
    const memory=async()=>({time:{date:'2026-10-09'},conversation:{recent_turns:[],referents:[]},selection:null,location:null,mods:MODS,entities:ENTITIES,items:ITEMS});
    await runModos({question:{id:1,text},memory,items:async ids=>ids.map(id=>BODIES[id]),decide:createDecisionModule(engine(yes)).decide,
      answer:async()=>({title:'T',body:'B',anchor:{object:'x',relation:'on'},referenced_item_ids:[]}),publish:async p=>published.push(p),live,trace:(t,x)=>{if(process.env.DBG&&/view_live|view_mods|modos_text|error/.test(t))console.log(t,x);}});
    return {ui:published.filter(p=>p.part==='ui'),text:published.filter(p=>p.part==='text')};
  };
  const W=['weather','2026-10-10','08:00'];
  let r=await revise('Where are my',['belongings','FindMy']);
  assert.equal(r.ui[0].findmy.status,'not_found');assert.equal(r.text.length,0);                 // a fact missing (which item): no text
  r=await revise('Where are my',['belongings','FindMy'],{pause:true});
  assert.equal(r.text.length,0);                                                                 // not even on a pause
  r=await revise('What is the weather this',W);
  assert.equal(r.ui.length,1);assert.equal(r.ui[0].upsert,true);assert.ok(r.text.length>0);     // another intent, clear and known: its text
  r=await revise('What is the weather this',W,{pause:true});
  assert.equal(r.ui.length,0);assert.equal(r.text.length,0);                                    // the same words: nothing redone
  r=await revise('What is the weather this',W,{final:true});
  assert.equal(r.ui.length,0);assert.equal(r.text.length,0);                                    // Enter on the same words: nothing redone
  r=await revise('Where did I put',[]);
  assert.deepEqual(live.retracted.slice(-2),['text:','weather:weather']);                       // its need gone: text and parts withdrawn
});
