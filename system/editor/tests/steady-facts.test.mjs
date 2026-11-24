import test from 'node:test';
import assert from 'node:assert/strict';
import {createSteadyFacts} from '../src/steady-facts.mjs';

test('a fact flipping at an edge is taken only once it has held', ()=>{
  const s=createSteadyFacts(500);
  assert.deepEqual(s({path:true,room:'lab'},0),{path:true,room:'lab'});            // the first values at once
  assert.equal(s({path:false,room:'lab'},250).path,true);                          // flipped: not yet
  assert.equal(s({path:true,room:'lab'},500).path,true);                           // and back: nothing happened
  assert.equal(s({path:false,room:'lab'},750).path,true);
  assert.equal(s({path:false,room:'lab'},1000).path,true);
  assert.equal(s({path:false,room:'lab'},1250).path,false);                        // held for 500 ms: taken
});
