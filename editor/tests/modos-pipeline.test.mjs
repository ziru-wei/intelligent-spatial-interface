import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runModos,eligible,partsFor,textHost} from '../modos/pipeline.mjs';
import {createDecisionModule} from '../modos/decision.mjs';

const mod=id=>JSON.parse(readFileSync(new URL(`../modos/mods/${id}.json`,import.meta.url),'utf8'));
const MODS=['findmy','lab','weather','worldinfo'].map(mod);
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
async function run(text,{yes,selection=null,location=null}){
  const published=[],decide=createDecisionModule(engine(yes)).decide;
  const memory=async()=>({time:{date:'2026-10-09'},conversation:{recent_turns:[],referents:[]},selection,location,mods:MODS,entities:ENTITIES,items:ITEMS});
  const items=async ids=>ids.map(id=>BODIES[id]);
  const answer=async()=>({title:'T',body:'B',anchor:{object:'x',relation:'on'},referenced_item_ids:[]});
  const result=await runModos({question:{id:1,text},memory,items,decide,answer,publish:async p=>published.push(p)});
  return {result,published,ui:published.filter(p=>p.part==='ui'),anim:published.filter(p=>p.part==='animation'),text:published.filter(p=>p.part==='text')};
}

test('weather: the feed is retrieved, the Weather MOD fills days, layout is derived', async()=>{
  const r=await run('What is the weather this weekend?',{yes:['weather','2026-10-10','2026-10-11','08:00']});
  assert.deepEqual(r.ui.map(p=>Object.keys(p).find(k=>k==='weather'||k==='findmy')),['weather']);
  assert.deepEqual(r.ui[0].weather,{forecast_ids:['sat-am','sun-am'],preview:{component:'weather-day-buttons'}});
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

test('lab: the zone is the referent, the lab MOD plays the work diorama, knowledge comes from retrieval', async()=>{
  const r=await run('What are they working on?',{yes:['standing in an area','researches','capability "Lab"','labResearchWork'],
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
  const lab=mod('lab'),info=mod('worldinfo'),ids=new Set(ITEMS.map(i=>i.id)),about=new Set(ITEMS.flatMap(i=>i.about));
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
  assert.equal(partsFor(mod('lab'),{asset:{kind:'allowed',id:'none'}}).length,0);
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
