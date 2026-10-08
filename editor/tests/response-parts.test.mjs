import test from 'node:test';
import assert from 'node:assert/strict';
import {responseReady,weatherResponse,responseSlot,presentationResponses,latestPresentation,streamResponseAt} from '../src/response-parts.mjs';
test('independent arrival times replay UI before delayed text',()=>{
  const ui={part:'ui',latency:2},text={part:'text',latency:20};
  assert.equal(responseReady(ui,{}, {h:1,shownAt:20}),false);
  assert.equal(responseReady(ui,{}, {h:3,shownAt:20}),true);
  assert.equal(responseReady(text,{}, {h:3,shownAt:20}),false);
  assert.equal(responseReady(text,{}, {h:21,shownAt:20}),true);
  assert.equal(responseReady({}, {}, {h:3,shownAt:20}),false);
});
test('late text preserves exact weather object; unrelated newer answer clears it',()=>{
  const ui={id:1,part:'ui',question_id:4,weather:{}},text={id:2,part:'text',question_id:4};
  assert.equal(weatherResponse([ui]),ui);assert.equal(weatherResponse([ui,text]),ui);
  assert.equal(weatherResponse([ui,text,{question_id:5}]),null);
  assert.equal(responseSlot({part:'text',layout_slot:1},0),1);
  assert.equal(responseSlot({part:'ui'},1),0);
});

test('parts join one placement container; replay gates each child independently',async()=>{
  const {presentationResponses}=await import('../src/response-parts.mjs');
  const ui={id:1,question_id:7,part:'ui',latency:2,weather:{forecast:[]}},text={id:2,question_id:7,part:'text',latency:10,title:'Weather',body:'Answer'};
  assert.deepEqual(presentationResponses([ui,text],[],{id:7,h:1}),[]);
  const early=presentationResponses([ui,text],[],{id:7,h:3});assert.equal(early.length,1);assert.equal(early[0].title,'');assert.equal(early[0].weather,ui.weather);
  const joined=presentationResponses([ui,text],[],{id:7,h:12});assert.equal(joined.length,1);assert.equal(joined[0].title,'Weather');assert.equal(joined[0].weather_identity,early[0].weather_identity);assert.deepEqual(joined[0].component_ids,[1,2]);assert.equal(joined[0].layout_slot,0);
  const textFirst=presentationResponses([text,ui],[],null);assert.equal(textFirst.length,1);assert.equal(textFirst[0].id,1);
});

test('early resume retains a separate progressive replay clock',()=>{
 const records=[{id:1,question_id:7,part:'ui',latency:2,weather:{}},{id:2,question_id:7,part:'text',latency:10,title:'Late words'}];
 const clocks=new Map([[7,{id:7,h:3,shownAt:10}]]);
 assert.deepEqual(presentationResponses(records,[{id:7}],null,clocks)[0].component_ids,[1]);
 clocks.get(7).h=10;
 assert.deepEqual(presentationResponses(records,[{id:7}],null,clocks)[0].component_ids,[1,2]);
});

test('the prior answer stays until the new question has a ready part, then it is replaced',()=>{
 const q=[{id:1,t:0},{id:2,t:5}],old={id:1,question_id:1,t:0,title:'Old answer'},next={id:2,question_id:2,t:5,part:'presentation',latency:2,findmy:{}};
 assert.equal(latestPresentation([old,next],q,5,{id:2,h:1}),old);
 assert.equal(latestPresentation([old,next],q,5,{id:2,h:2}),next);
 assert.equal(latestPresentation([old,next],q,4),old);
 // Expiring the new answer must not bring an older answer back.
 assert.equal(latestPresentation([old,{...next,autoHide:true}],q,30).id,next.id);
});

test('late text for an older question cannot replace a newer UI or reset its focus',()=>{
 const questions=[{id:7,t:0},{id:8,t:5}];
 const records=[{id:1,question_id:7,part:'ui',latency:1,weather:{}},{id:2,question_id:8,part:'ui',latency:1,findmy:{}},{id:3,question_id:7,part:'text',latency:10,title:'Older late text'}];
 const list=presentationResponses(records,questions,null);
 assert.equal(latestPresentation(list,questions,5).question_id,8);
 assert.equal(latestPresentation(list,questions,0).question_id,7);
});

test('replay at the same frame excludes future questions and early resume respects arrival clocks',()=>{
 const questions=[{id:1,t:0},{id:2,t:0}],a={id:1,question_id:1,part:'presentation',latency:1},b={id:2,question_id:2,part:'presentation',latency:3};
 assert.equal(latestPresentation([a,b],questions,0,{id:1,h:2}),a);
 const clocks=new Map([[2,{id:2,h:2}]]);
 assert.equal(latestPresentation([a,b],questions,0,null,clocks),a);
 clocks.get(2).h=3;assert.equal(latestPresentation([a,b],questions,0,null,clocks),b);
});

test('replay projects the exact stream prefix; revisions keep one ID and do not reveal future text',()=>{
 const ui={id:1,question_id:7,part:'ui',latency:1,reserve_text:true,weather:{}},text={id:2,question_id:7,part:'text',latency:2,reserve_text:true,title:'Final title',body:'Final body',stream:{seq:3,status:'complete',updates:[
  {seq:1,status:'streaming',at:2,title:'Read',body:'',anchor:null},{seq:2,status:'streaming',at:3,title:'Read tonight',body:'Continue ',anchor:null},
  {seq:3,status:'complete',at:4,title:'Read tonight',body:'Continue your book.',anchor:{object:'Table 2'}}]}};
 const at=h=>presentationResponses([ui,text],[{id:7}],{id:7,h})[0];
 assert.equal(at(1.5).title,'');assert.equal(at(1.5).reserve_text,true);
 assert.equal(at(2).title,'Read');assert.equal(at(2).anchor,null);assert.equal(at(3).body,'Continue ');
 assert.equal(at(4).body,'Continue your book.');assert.equal(at(4).anchor.object,'Table 2');
 assert.equal(at(2).id,at(4).id);assert.equal(at(2).weather_identity,at(4).weather_identity);assert.notEqual(at(2).component_key,at(3).component_key);
 assert.equal(streamResponseAt(text,{h:1}),null);
 assert.equal(at(2).title,'Read','rewinding must restore the earlier prefix');
});
