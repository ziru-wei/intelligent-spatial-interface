import test from 'node:test';
import assert from 'node:assert/strict';
import {isTyped,typedReplay} from '../src/typed-replay.mjs';
import {presentationResponses,latestPresentation} from '../src/response-parts.mjs';

// typed from video 5 s to 9 s, then the video stopped (its end) while it was said on, asked at e = 6
const q={id:7,status:'answered',created:1000,t:9,frame:90,live:{read_s:5},revisions:[{at:0,t:5,text:'what'},{at:2,t:7,text:'what is the weather'},{at:4,t:9,text:'what is the weather this weekend'},{at:6,t:9,text:'what is the weather this weekend? send it to Alice',final:true}]};
const weather={id:3,question_id:7,part:'ui',created:1002.5,weather:{w:1}};
const action={id:5,question_id:7,part:'ui',created:1007,action:{a:1}};
const oldText={id:-1,question_id:7,part:'text',created:1004.5,withdrawn_at:1006.5,title:'Rain',body:'b',withdrawn:true};
const text={id:6,question_id:7,part:'text',created:1007,title:'Yes',body:'',stream:{seq:2,status:'complete',updates:[{seq:1,status:'streaming',created:1007,title:'Yes',body:'Ra'},{seq:2,status:'complete',created:1008,title:'Yes',body:'Rain on Saturday'}]}};
const parts=[weather,action,oldText,text];

test('a typed line plays on the clock of its revisions, past the video stopping', ()=>{
  assert.ok(isTyped(q));assert.ok(!isTyped({...q,status:'drafting'}));assert.ok(!isTyped({...q,revisions:[]}));
  const r=typedReplay(q,parts);
  assert.equal(r.e0,0);assert.equal(r.e1,8+5);   // the last part (the text's last words at e = 8), then reading time
  assert.equal(r.tAt(1),6);assert.equal(r.tAt(5),9);assert.equal(r.tAt(12),9);   // the video waits on its last frame
  assert.equal(r.eAt(6),1);assert.equal(r.t0,5);assert.equal(r.t1,9);
});

test('replayed, the surface is what it was then; otherwise what it ended with', ()=>{
  const at=e=>presentationResponses(parts,[q],null,new Map(),{id:7,e})[0];
  assert.equal(at(1),undefined);   // nothing shown yet
  assert.deepEqual([at(3).weather,at(3).action,at(3).title],[{w:1},undefined,'']);
  assert.equal(at(5).title,'Rain');   // a text later withdrawn
  assert.equal(at(7).body,'Ra');assert.deepEqual(at(7).action,{a:1});   // the text written again, as streamed by then
  assert.equal(at(9).body,'Rain on Saturday');
  const done=presentationResponses(parts,[q],null)[0];
  assert.equal(done.body,'Rain on Saturday');assert.deepEqual(done.component_ids.sort(),[3,5,6]);   // withdrawn parts never show outside a replay
  const p=at(3);assert.equal(latestPresentation([p],[q],5.5,null,new Map(),{id:7,e:3}),p);   // before the question's moment, while replayed
});

test('a spoken question\'s line runs from its recording\'s first sound to its last', ()=>{
  const spoken={...q,audio:{file:'agent/audio/7.wav',at:-2.5,duration:12}};
  const r=typedReplay(spoken,parts,{read_s:0});
  assert.equal(r.e0,-2.5);assert.equal(r.e1,9.5);   // from 2.5 s before the first revision, to the recording's end (after the last part at 8)
  assert.equal(r.tAt(-2.5),5);                       // before the first revision, the video waits where typing began
});

test('a spoken line\'s video moves from where it was when listening began, not waiting on the first revision', ()=>{
  const spoken={...q,audio:{file:'agent/audio/7.wav',at:-2.5,duration:12,video:{t:3,at:-2}}};
  const r=typedReplay(spoken,parts,{read_s:0});
  assert.equal(r.tAt(-2.5),3);assert.equal(r.tAt(-1),4);assert.equal(r.tAt(0),5);   // from 3 s (at e = -2) to the first revision (5 s at e = 0)
});

test('after Space is let go, the video goes on as it went on (its speed then), to the recording\'s end', ()=>{
  // Space down at e = -2 (video 3 s), let go at e = 4.5 (video 9.5 s) with the video playing at 0.5×; the last revision (e = 6) came after
  const spoken={...q,audio:{file:'agent/audio/7.wav',at:-2.5,duration:8,video:{t:3,at:-2,t_end:9.5,at_end:4.5,rate:.5}}};
  const r=typedReplay(spoken,parts,{read_s:0,duration:10});
  assert.equal(r.tAt(4.5),9.5);assert.equal(r.tAt(5.5),10);assert.equal(r.tAt(7),10);   // on at 0.5×, no further than the recording
  assert.equal(r.eAt(9.75),5);assert.equal(r.t1,10);
  const paused=typedReplay({...spoken,audio:{...spoken.audio,video:{...spoken.audio.video,rate:0}}},parts,{read_s:0,duration:10});
  assert.equal(paused.tAt(7),9.5);   // paused when let go: it stays
});

test('a text left in view that no longer answers what is asked is drawn dimmed; replayed, from the moment it became so', ()=>{
  const stale={...text,stale_at:1007.5};
  const at=e=>presentationResponses([weather,stale],[q],null,new Map(),{id:7,e})[0];
  assert.equal(at(7).text_stale,false);assert.equal(at(9).text_stale,true);
  assert.equal(presentationResponses([weather,stale],[q],null)[0].text_stale,true);
  assert.notEqual(at(7).component_key,at(9).component_key);   // the widget takes it in place (the same text, dimmed)
});

test('the text steps back with its theme: as logged up to the moment replayed', ()=>{
  const t={...text,theme:{ids:[1],focus:true},focus_log:[[1007,true],[1008.5,false]]};
  const at=e=>presentationResponses([weather,t],[q],null,new Map(),{id:7,e})[0];
  assert.equal(at(7.5).focus.text,true);assert.equal(at(9).focus.text,false);
  assert.equal(presentationResponses([weather,t],[q],null)[0].focus.text,false);
  assert.equal(presentationResponses([weather,text],[q],null)[0].focus.text,true);   // no theme: in focus
});

test('a text being written shows it (text_writing): now while its window is open; replayed, inside the window', ()=>{
  const t={...text,writing:{from:1007.5,to:1009}};
  const at=e=>presentationResponses([weather,t],[q],null,new Map(),{id:7,e})[0];
  assert.equal(at(7).text_writing,false);assert.equal(at(8).text_writing,true);assert.equal(at(9.5).text_writing,false);
  assert.equal(presentationResponses([weather,t],[q],null)[0].text_writing,false);                              // written
  assert.equal(presentationResponses([weather,{...text,writing:{from:1007.5}}],[q],null)[0].text_writing,true);  // still writing
});

test('a version answered again from the question plays on the question\'s clock, not where it was typed again', ()=>{
  const again={...q,revisions:q.revisions.map(r=>({...r,t:9})),clock:q.revisions.map(r=>({at:r.at,t:r.t}))};
  const a=typedReplay(again),o=typedReplay(q);
  for(const e of [0,1,2,3,4])assert.equal(a.tAt(e),o.tAt(e));   // the video moves as it moved when asked
  assert.equal(typedReplay({...again,clock:undefined}).tAt(1),9);  // without it: stuck where it was typed again
});
