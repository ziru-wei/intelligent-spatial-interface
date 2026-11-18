import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {questionCaption,captionGraphemes,questionClock,questionTypingDuration,captionQuestion} from '../src/question-caption.mjs';
import {createAgentLayer,stepsAt,focusQuestion} from '../src/agent.mjs';
import {presentationResponses,streamResponseAt} from '../src/response-parts.mjs';
const q={text:'Where is my book?',status:'answered',latency:10,parts:{ui:{latency:2},text:{latency:10}}};
const replay=elapsed=>({clock:{...questionClock(q,elapsed),live:false}});
const afterTyping=h=>replay(questionTypingDuration(q.text)+h);
test('replay reveals a stable prefix and restarting the same question resets it',()=>{
  assert.equal(questionCaption(q,replay(0)).text,'W');
  assert.equal(questionCaption(q,replay(.1)).text,'Whe');
  assert.equal(questionCaption(q,replay(1)).text,q.text);
  assert.equal(questionCaption(q,replay(0)).text,'W');
  assert.deepEqual(questionCaption(q,replay(.2)),questionCaption(q,replay(.2)));
});
test('waiting follows the first UI or text arrival, not the completed historical status',()=>{
  assert.equal(questionCaption(q,afterTyping(1)).waiting,true);
  assert.equal(questionCaption(q,afterTyping(2)).waiting,false);
  const textFirst={...q,parts:{ui:{latency:10},text:{latency:1}}};
  assert.equal(questionCaption(textFirst,afterTyping(1)).waiting,false);
  assert.equal(questionCaption(q,{...afterTyping(.5),answerVisible:true}).waiting,false);
});
test('live questions are fully readable while waiting; completed/failed questions stop animation',()=>{
  const running={text:q.text,status:'running'};
  assert.equal(questionCaption(running,{clock:{h:.1,live:true}}).text,q.text);
  assert.equal(questionCaption(running,{elapsed:3}).waiting,true);
  assert.equal(questionCaption(q).animated,false);
  assert.equal(questionCaption({...running,status:'failed'},{clock:{h:3,live:true}}).animated,false);
});
test('legacy replay respects its measured arrival and reduced motion is static',()=>{
  const legacy={text:q.text,status:'answered',latency:3};
  assert.equal(questionCaption(legacy,afterTyping(2)).waiting,true);
  assert.equal(questionCaption(legacy,afterTyping(3)).waiting,false);
  const reduced=questionCaption(q,{clock:{...questionClock(q,.1,{reducedMotion:true}),live:false},reducedMotion:true});
  assert.equal(reduced.text,q.text);assert.equal(reduced.waiting,true);assert.equal(reduced.animated,false);assert.equal(reduced.dotOpacity,.65);
});
test('typing never splits Chinese, combining characters or multi-codepoint emoji',()=>{
  const text='👨‍👩‍👧‍👦书e\u0301';
  assert.deepEqual(captionGraphemes(text),['👨‍👩‍👧‍👦','书','e\u0301']);
  const at=elapsed=>({clock:{...questionClock({text},elapsed),live:false}});
  assert.equal(questionCaption({...q,text},at(0)).text,'👨‍👩‍👧‍👦');
  assert.equal(questionCaption({...q,text},at(.04)).text,'👨‍👩‍👧‍👦书');
});

test('even instant traces and streamed responses wait until replay finishes typing',()=>{
  const question={...q,id:7,text:'What should I bring when I leave the house today?',trace:[{at:0,text:'Context read'},{at:200,text:'Choose mod'}]};
  const duration=questionTypingDuration(question.text),ui={id:1,question_id:7,part:'ui',latency:0,weather:{}};
  const text={id:2,question_id:7,part:'text',latency:.2,stream:{updates:[{seq:1,status:'streaming',at:.2,title:'Take',body:''},{seq:2,status:'complete',at:.7,title:'Take an umbrella',body:'Rain tonight.'}]}};
  const clock=elapsed=>({id:7,live:false,...questionClock(question,elapsed)});
  for(const elapsed of [0,.3,duration-1e-8]){
    const c=clock(elapsed);assert.deepEqual(stepsAt(question,c.h),[]);assert.deepEqual(presentationResponses([ui,text],[question],c),[]);
    assert.equal(streamResponseAt({...text,stream:{updates:[{at:0,title:'Instant'}]}},c),null);
    assert.equal(questionCaption(question,{clock:c}).dotOpacity,0);
  }
  const start=clock(duration);assert.equal(questionCaption(question,{clock:start}).text,question.text);
  assert.equal(stepsAt(question,start.h).length,1);assert.deepEqual(presentationResponses([ui,text],[question],start)[0].component_ids,[1]);
  const partial=presentationResponses([ui,text],[question],clock(duration+.21))[0];assert.equal(partial.title,'Take');assert.equal(partial.body,'');
  assert.equal(presentationResponses([ui,text],[question],clock(duration+.71))[0].body,'Rain tonight.');
  assert.deepEqual(questionClock(question,.3,{live:true}),{h:.3,typingElapsed:.3,typingDuration:0},'live API timing has no typing delay');
});

test('the breathing point starts after typing, changes brightness, then disappears on arrival',()=>{
  assert.equal(questionCaption(q,replay(.1)).waiting,false);
  const first=questionCaption(q,afterTyping(0)),bright=questionCaption(q,afterTyping(1)),next=questionCaption(q,afterTyping(2));
  assert.equal(first.text,q.text);assert.equal(bright.text,first.text);assert.ok(bright.dotOpacity>first.dotOpacity);assert.equal(next.dotOpacity,0);
});

test('caption focus excludes old frame questions, dismissed turns and unresolved new holds',()=>{
  const old={...q,id:1,t:0},pending={...q,id:2,t:0,status:'running'};
  assert.equal(captionQuestion([old]),null);
  assert.equal(captionQuestion([old,pending]),pending);
  assert.equal(captionQuestion([old,pending],{id:3}),null);
  assert.equal(focusQuestion([old,pending],0,3),null);
  assert.equal(captionQuestion([old,pending],{id:2},2),null);
  assert.equal(captionQuestion([pending,old]),null,'an older still-running turn cannot regain the caption');
});

test('HUD replaces and clears captions across same-frame turns, replay restarts and conversation switches',async t=>{
  const saved={document:globalThis.document,fetch:globalThis.fetch,location:globalThis.location};
  const first={...q,id:1,t:0},second={...q,id:2,t:0,text:'OK, where is it?'};
  let status={questions:[first],responses:[]},hud,now=0,animations=0;
  t.mock.method(performance,'now',()=>now);
  globalThis.location={href:'http://localhost/'};
  globalThis.fetch=async()=>({ok:true,json:async()=>status});
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({measureText:text=>({width:text.length*22}),fillText(){}})})};
  const renderer={autoClear:true,getDrawingBufferSize:v=>v.set(1440,900),clearDepth(){},render:scene=>{hud=scene;}};
  const layer=createAgentLayer({scene:new THREE.Scene(),frames:[],sessionPath:'/session.json',onAnimate:()=>animations++});
  const holdAt=(question,elapsed)=>({id:question.id,live:false,shownAt:question.latency,...questionClock(question,elapsed)});
  try{
    await layer.setConversation('first');layer.update(0);layer.renderHud(renderer);assert.equal(layer.caption,null);
    layer.setHold(holdAt(first,0));layer.renderHud(renderer);assert.equal(layer.caption,'W');assert.equal(hud.children[1].visible,false);
    const duration=questionTypingDuration(first.text);
    layer.setHold(holdAt(first,duration));layer.renderHud(renderer);assert.equal(layer.caption,first.text);
    const [ink,dot]=hud.children,position=dot.position.clone(),map=ink.material.map,opacity=dot.material.uniforms.opacity.value;
    assert.equal(dot.visible,true);assert.equal(ink.material.type,'MeshBasicMaterial','letter brightness stays constant');
    const end=map.image.waitingDot;assert.ok(end.x>map.image.width/2,'dot follows the final letter');
    layer.setHold(holdAt(first,duration+1));layer.renderHud(renderer);
    assert.equal(ink.material.map,map);assert.ok(dot.position.equals(position));assert.ok(dot.material.uniforms.opacity.value>opacity);
    layer.setHold(null);assert.equal(layer.caption,null);layer.renderHud(renderer);assert.equal(dot.visible,false);assert.equal(layer.caption,null);
    layer.setHold(holdAt(first,duration+3));layer.setHold(null,{continueDelivery:true});animations=0;layer.renderHud(renderer);
    assert.equal(layer.caption,first.text);assert.ok(animations>0,'reading window keeps repainting when video has stopped');
    now=13000;layer.renderHud(renderer);assert.equal(layer.caption,null,'delivery clears on expiry even at the same paused frame');
    layer.setHold(holdAt(first,0));layer.renderHud(renderer);assert.equal(layer.caption,'W','same-question replay starts from the first letter');
    layer.setHold(holdAt(first,duration+1));layer.setHold(null,{continueDelivery:true});layer.renderHud(renderer);assert.equal(layer.caption,first.text);
    layer.setHold(holdAt(second,0));assert.equal(layer.caption,null);layer.renderHud(renderer);assert.equal(layer.caption,null,'unknown new question cannot show the previous caption');
    status={questions:[first,second],responses:[]};await layer.sync();layer.renderHud(renderer);assert.equal(layer.caption,'O');
    layer.setHold(null);layer.renderHud(renderer);assert.equal(layer.caption,null,'old delivery cannot resurface after a newer turn');
    layer.setHold(holdAt(second,0));await layer.setConversation('second');assert.equal(layer.hold,null);assert.equal(layer.caption,null);
    layer.renderHud(renderer);assert.equal(layer.caption,null,'history at the same frame is not an active caption');
  }finally{Object.assign(globalThis,saved);}
});
