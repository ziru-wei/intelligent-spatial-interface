import {test} from 'node:test';import assert from 'node:assert/strict';
import {createLegibilityTracker} from '../src/legibility-temporal.mjs';
import {pickStyle} from '../src/legibility.mjs';
const sample=value=>{const pixels=new Uint8ClampedArray(16*16*4);for(let i=0;i<pixels.length;i+=4)pixels.set([value,value,value,255],i);return {pixels,w:16,h:16};};
test('the first visible style is the current-background solution with no convergence step',()=>{
 for(const v of [20,90,170,235]){const tracker=createLegibilityTracker(),s=sample(v),actual=tracker.sample(s,.01,0),expected=pickStyle(s.pixels,s.w,s.h,.01);assert.deepEqual(actual,{...expected,glassAlpha:expected.glass?1:0});assert.deepEqual(tracker.value(500),actual);}
});
test('dark weather chooses muted light text immediately without a temporary bright panel',()=>{
 const tracker=createLegibilityTracker();assert.equal(tracker.sample(sample(235),0,0).side,'dark');
 const style=tracker.sample(sample(25),.01,200);assert.equal(style.side,'light');assert.equal(style.glass,null);assert.equal(style.glassAlpha,0);assert.ok(Math.max(...style.text)<.6);assert.deepEqual(tracker.value(201),style);
});
test('small exposure noise retains a feasible polarity without adding backing',()=>{
 const tracker=createLegibilityTracker();for(const v of [220,210,235,225,218]){const style=tracker.sample(sample(v),.02);assert.equal(style.side,'dark');assert.equal(style.glass,null);}
});
test('a mixed background receives backing only when bare text is not legible',()=>{
 const tracker=createLegibilityTracker(),busy=sample(25);for(let i=0;i<busy.pixels.length;i+=4)if((i/4)%16<8)busy.pixels.set([245,245,245,255],i);
 assert.ok(tracker.sample(busy,.18).glass);assert.equal(tracker.sample(sample(25),.01).glass,null);
});
test('causal output is identical for identical prefixes regardless of later frames',()=>{
 const run=values=>{const tracker=createLegibilityTracker();return values.map((v,i)=>tracker.sample(sample(v),.02,i*200));};
 const prefix=[30,200,80,230,100,180],a=run([...prefix,10,10,10]),b=run([...prefix,245,245,245]);assert.deepEqual(a.slice(0,prefix.length),b.slice(0,prefix.length));
});
test('the tracker does not retain or re-read pixel buffers after sampling',()=>{
 const tracker=createLegibilityTracker(),input=sample(70);tracker.sample(input,0,0);input.pixels.fill(255);const clean=createLegibilityTracker();clean.sample(sample(70),0,0);assert.deepEqual(tracker.value(32),clean.value(32));
});
