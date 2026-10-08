import test from 'node:test';
import assert from 'node:assert/strict';
import {createJev,runPipeline,jev_call_mod,jev_UI_dec} from '../scripts/jev-pipeline.mjs';
const n=value=>({type:'noul',noul:value});
const c=value=>({type:'choice',choice:value,confidence:1,probabilities:{[value]:1}});
const catalog={time:{date:'2026-10-07'},context_groups:{weather:{description:'forecast'},storage:{description:'inventory'},user_events:{description:'calendar'}}};
const weather={forecast:[{id:'a',date:'2026-10-07',time:'14:00',samples:[{id:'a12',time:'12:00'},{id:'a15',time:'15:00'},{id:'a17',time:'17:00'}]},{id:'b',date:'2026-10-08',time:'14:00',samples:[{id:'b12',time:'12:00'},{id:'b15',time:'15:00'},{id:'b17',time:'17:00'}]}]};
test('catalog only routing, multi-group retrieval and overlapping branches',async()=>{
  const reads=[];let answerStarted=false,release;const gate=new Promise(r=>release=r);
  const result=await runPipeline({question:{id:8,text:'Weather for badminton?'},readContext:async groups=>{reads.push(groups);return groups.length?{...catalog,weather,calendar:[],interaction:{weather_mod:true}}:catalog;},
    ask:async(stage,state,questions)=>{
      if(stage==='jev_call_context_read'){assert.equal(state.context,undefined);assert.equal(state.weather,undefined);return {weather:n(.9),storage:n(.1),user_events:n(.8)};}
      if(stage==='jev_call_mod'){await gate;assert.ok(answerStarted);return {mod:c('weather')};}
      return Object.fromEntries(Object.keys(questions).map(k=>[k,n(1)]));
    },answer:async()=>{answerStarted=true;release();return {title:'Weather',body:'Mock forecast'};}});
  assert.deepEqual(reads,[[],['weather','user_events']]);assert.equal(result.question_id,8);assert.deepEqual(result.weather.forecast_ids,['a','b']);assert.equal(result.weather.preview.component,'weather-day-buttons');
});
test('disabled mod cannot select weather',async()=>{
  assert.equal(await jev_call_mod(async(_,state,questions)=>{assert.deepEqual(Object.keys(questions.mod.criteria),['none']);return {mod:c('none')};},'rain?',{weather,interaction:{weather_mod:false}}),'none');
});
test('exact range only emits selected samples, unavailable date emits no UI',async()=>{
  const ask=async()=>({date_0:n(1),date_1:n(0),slot_0:n(0),slot_1:n(1),slot_2:n(1)});
  const ui=await jev_UI_dec(ask,'today 15–17',{weather});assert.deepEqual(ui,{forecast_ids:['a15','a17'],preview:{component:'weather-timeline'}});
  assert.equal(await jev_UI_dec(async()=>({date_0:n(0),date_1:n(0),slot_0:n(1),slot_1:n(1),slot_2:n(1)}),'December',{weather}),null);
});
test('no selected groups remains catalog-only and visual failure preserves answer',async()=>{
  const traces=[];const result=await runPipeline({question:{id:1,text:'Hello'},readContext:async groups=>{assert.deepEqual(groups,[]);return catalog;},ask:async stage=>{if(stage==='jev_call_context_read')return {weather:n(0),storage:n(0),user_events:n(0)};throw Error('Service unavailable');},answer:async()=>({title:'Hello',body:''}),trace:(...args)=>traces.push(args)});
  assert.equal(result.title,'Hello');assert.equal(result.weather,undefined);assert.ok(traces.some(([s])=>s==='mod_error'));
});
test('TypeSafe contract validates bounded answers and reports missing credentials',async()=>{
  const ask=createJev({apiKey:'test-only',fetchImpl:async(url,request)=>{assert.equal(url,'https://api.typesafe.ai/v1/systemone');const body=JSON.parse(request.body);assert.equal(body.model,'jev-latest');assert.equal(request.headers.Authorization,'Bearer test-only');return {ok:true,json:async()=>({answers:{mod:c('invented')}})};}});
  await assert.rejects(()=>ask('route',{}, {mod:{type:'choice',criteria:{none:'none'}}}),/Invalid TypeSafe/);
  await assert.rejects(()=>createJev({apiKey:''})('route',{},{}),/apiKey/);
});
test('publishes UI while Luna is still pending, then publishes separate text',async()=>{
  let release;const delayed=new Promise(r=>release=r),parts=[];let uiReady;
  const first=new Promise(r=>uiReady=r);
  const work=runPipeline({question:{id:3,text:'weather'},readContext:async()=>({...catalog,weather,interaction:{weather_mod:true}}),ask:async(stage,state,questions)=>stage==='jev_call_context_read'?{weather:n(1),storage:n(0),user_events:n(0)}:stage==='jev_call_mod'?{mod:c('weather')}:Object.fromEntries(Object.keys(questions).map(k=>[k,n(1)])),answer:()=>delayed,publish:async part=>{parts.push(part);if(part.part==='ui')uiReady();}});
  await first;assert.equal(parts.length,1);assert.equal(parts[0].part,'ui');assert.equal(parts[0].title,undefined);
  release({title:'Forecast',body:'Cloudy'});await work;
  assert.deepEqual(parts.map(p=>p.part),['ui','text']);assert.equal(parts[1].weather,undefined);
});
test('text is published before slow mod, and survives mod failure',async()=>{
  let release,ready;const gate=new Promise(r=>release=r),shown=new Promise(r=>ready=r),parts=[];
  const work=runPipeline({question:{id:4,text:'question'},readContext:async()=>catalog,ask:async stage=>{if(stage==='jev_call_context_read')return {weather:n(0),storage:n(0),user_events:n(0)};await gate;throw Error('mod failed');},answer:async()=>({title:'Answer'}),publish:async part=>{parts.push(part);ready();}});
  await shown;assert.equal(parts[0].part,'text');release();await work;assert.equal(parts.length,1);
});
test('Luna failure cannot discard the successful UI branch',async()=>{
  const parts=[];
  const result=await runPipeline({question:{id:5,text:'weather'},readContext:async()=>({...catalog,weather,interaction:{weather_mod:true}}),ask:async(stage,state,questions)=>stage==='jev_call_context_read'?{weather:n(1),storage:n(0),user_events:n(0)}:stage==='jev_call_mod'?{mod:c('weather')}:Object.fromEntries(Object.keys(questions).map(k=>[k,n(1)])),answer:async()=>{throw Error('Luna timeout');},publish:async part=>parts.push(part)});
  assert.deepEqual(parts.map(p=>p.part),['ui']);assert.match(result.message,/language response failed/);
});
test('text response off per mod skips the language model',async()=>{
  const weatherAsk=async(stage,state,questions)=>stage==='jev_call_context_read'?{weather:n(1),storage:n(0),user_events:n(0)}:stage==='jev_call_mod'?{mod:c('weather')}:Object.fromEntries(Object.keys(questions).map(k=>[k,n(1)]));
  const noneAsk=async stage=>stage==='jev_call_context_read'?{weather:n(1),storage:n(0),user_events:n(0)}:{mod:c('none')};
  const run=async(ask,text_response)=>{let answered=0;const parts=[];const result=await runPipeline({question:{id:9,text:'weather',text_response},readContext:async()=>({...catalog,weather,interaction:{weather_mod:true}}),ask,answer:async()=>{answered++;return {title:'Words',body:''};},publish:async p=>parts.push(p.part)});return {answered,parts,result};};
  let r=await run(weatherAsk,{default:true,weather:false});assert.equal(r.answered,0);assert.deepEqual(r.parts,['ui']);assert.ok(r.result.weather);
  r=await run(noneAsk,{default:true,weather:false});assert.equal(r.answered,1,'answers outside the mod keep their text');
  r=await run(noneAsk,{default:false,weather:false});assert.equal(r.answered,0);assert.deepEqual(r.parts,[]);
  r=await run(weatherAsk,{default:false,weather:true});assert.equal(r.answered,1);assert.deepEqual(r.parts.sort(),['text','ui']);
  r=await run(weatherAsk,undefined);assert.equal(r.answered,1,'older questions: text on');
});

test('streaming publishes revisions before completion and withholds references until final validation',async()=>{
 const parts=[];let release,first;const gate=new Promise(r=>release=r),ready=new Promise(r=>first=r);
 const work=runPipeline({question:{id:42,text:'Read?'},readContext:async()=>catalog,ask:async stage=>stage==='jev_call_context_read'?{weather:n(0),storage:n(0),user_events:n(0)}:{mod:c('none')},
  answer:async(q,ctx,{onPartial})=>{await onPartial({title:'Read',body:'Continue '});first();await gate;await onPartial({title:'Read tonight',body:'Continue your book.'});return {title:'Read tonight',body:'Continue your book.',referenced_item_ids:['invented']};},publish:async p=>parts.push(p)});
 await ready;assert.equal(parts.length,1);assert.equal(parts[0].stream.status,'streaming');assert.deepEqual(parts[0].referenced_item_ids,[]);assert.equal(parts[0].anchor,undefined);
 release();await work;assert.deepEqual(parts.map(p=>p.stream.seq),[1,2,3]);assert.equal(parts[2].stream.status,'complete');assert.deepEqual(parts[2].referenced_item_ids,[]);
});
test('a broken stream replaces its partial answer with an error and preserves successful UI',async()=>{
 const parts=[];
 const result=await runPipeline({question:{id:43,text:'Weather?'},readContext:async()=>({...catalog,weather,interaction:{weather_mod:true}}),ask:async(stage,state,questions)=>stage==='jev_call_context_read'?{weather:n(1),storage:n(0),user_events:n(0)}:stage==='jev_call_mod'?{mod:c('weather')}:Object.fromEntries(Object.keys(questions).map(k=>[k,n(1)])),
  answer:async(q,ctx,{onPartial})=>{await onPartial({title:'Weather'});throw Error('Stream interrupted');},publish:async p=>parts.push(p)});
 assert.ok(result.weather);assert.ok(parts.find(p=>p.part==='ui').reserve_text);assert.equal(parts.filter(p=>p.part==='text').at(-1).stream.status,'failed');assert.equal(parts.filter(p=>p.part==='text').at(-1).title,'Answer unavailable');
});
