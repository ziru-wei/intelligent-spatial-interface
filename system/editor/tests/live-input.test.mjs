import test from 'node:test';
import assert from 'node:assert/strict';
import {appendOnly,adds,createBreaks,PAUSE_MIN,PAUSE_MAX} from '../src/live-input.mjs';

// A fake clock: typing is a list of [ms after the last key, text after it]; timers fire when the clock passes them.
function typist(){
  let t=0,timers=[];const out=[];
  const b=createBreaks({onRevision:(text,pause)=>out.push([text,pause]),now:()=>t,
    setTimer:(f,ms)=>{const x={at:t+ms,f};timers.push(x);return x;},clearTimer:x=>{timers=timers.filter(y=>y!==x);}});
  const wait=ms=>{const end=t+ms;for(;;){const next=timers.filter(x=>x.at<=end).sort((a,b)=>a.at-b.at)[0];if(!next)break;t=next.at;timers=timers.filter(x=>x!==next);next.f();}t=end;};
  return {out,b,type(steps){for(const [ms,text] of steps){wait(ms);b.feed(text);}},wait};
}

test('breaks: a revision at each finished word, and one on a pause longer than the typist\'s rhythm', ()=>{
  const k=typist();
  k.type([[0,'w'],[100,'wh'],[100,'wha'],[100,'what'],[100,'what '],[100,'what i'],[100,'what is'],[100,'what is ']]);
  assert.deepEqual(k.out,[['what',false],['what is',false]]);       // words as they finish; nothing from punctuation or letters
  k.type([[100,'what is t'],[100,'what is th'],[100,'what is the']]);
  k.wait(200);assert.equal(k.out.length,2);                          // 200 ms: within this typist's rhythm (2.5 × 100)
  k.wait(100);assert.deepEqual(k.out.at(-1),['what is the',true]);   // past it: a pause
  k.wait(2000);assert.equal(k.out.length,3);                         // one pause per stop
});

test('breaks: the pause threshold follows the rhythm, within bounds; the same words are not sent twice', ()=>{
  const slow=typist();slow.type([[0,'a'],[900,'ab'],[900,'abc']]);assert.equal(slow.b.pauseAfter(),PAUSE_MAX);
  const fast=typist();fast.type([[0,'a'],[20,'ab'],[20,'abc']]);assert.equal(fast.b.pauseAfter(),PAUSE_MIN);
  const k=typist();k.type([[0,'hi '],[50,'hi  ']]);assert.deepEqual(k.out,[['hi',false]]);
});

test('typed while answered, the text only grows at its end: what was typed is said', ()=>{
  assert.equal(appendOnly('turn on the',"turn on the TV"),'turn on the TV');
  assert.equal(appendOnly('turn on the TV','turn on the T'),'turn on the TV');           // a backspace: nothing taken back
  assert.equal(appendOnly('put it on HDMI 1','put it on HDMI 3'),'put it on HDMI 1');     // an edit: kept as said
  assert.equal(appendOnly('send it to Alice','send it to Alex and Bob'),'send it to Alice');   // replaced: kept as said
  assert.equal(appendOnly('',"what's"),"what's");
  for(const t of ['insertText','insertCompositionText','insertFromPaste'])assert.ok(adds(t));
  for(const t of ['deleteContentBackward','deleteWordBackward','deleteContentForward','historyUndo','insertReplacementText','insertFromDrop','deleteByCut','insertLineBreak'])assert.ok(!adds(t),t);
});
