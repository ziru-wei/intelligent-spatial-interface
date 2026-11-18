import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeatherPlayback,FOCUS_HOLD} from '../src/weather-preview.mjs';

const timeline=['a','b','c','d'].map(id=>({id,date:'2026-11-21'}));
const at=(p,t)=>{performance.now=()=>t;return p.tick(t).entry.id;};

test('Playback opens at the focus, holds it FOCUS_HOLD, then plays on', ()=>{
  const p=createWeatherPlayback(),now=performance.now;
  try{
    performance.now=()=>1000;p.load({timeline,preview:{focus:'c',seconds_per_period:8}});
    assert.equal(at(p,1000),'c');assert.equal(at(p,1000+FOCUS_HOLD-100),'c');
    assert.equal(at(p,1000+FOCUS_HOLD+100),'d');assert.equal(at(p,1000+FOCUS_HOLD+8100),'a');
    performance.now=()=>20000;p.load({timeline,preview:{seconds_per_period:8}});   // no focus: the first moment, a whole period
    assert.equal(at(p,20000),'a');assert.equal(at(p,27000),'a');assert.equal(at(p,28100),'b');
  }finally{performance.now=now;}
});
