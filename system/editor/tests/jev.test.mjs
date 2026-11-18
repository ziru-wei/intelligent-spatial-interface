import test from 'node:test';
import assert from 'node:assert/strict';
import {createJev} from '../scripts/jev.mjs';
import {streamAnswer} from '../modos/text.mjs';
import {referenceCandidates,validatedReferenceIds} from '../scripts/reference-entities.mjs';
const c=value=>({type:'choice',choice:value,confidence:1,probabilities:{[value]:1}});

test('TypeSafe contract validates bounded answers and reports missing credentials',async()=>{
  const ask=createJev({apiKey:'test-only',fetchImpl:async(url,request)=>{assert.equal(url,'https://api.typesafe.ai/v1/systemone');const body=JSON.parse(request.body);assert.equal(body.model,'jev-latest');assert.equal(request.headers.Authorization,'Bearer test-only');return {ok:true,json:async()=>({answers:{mod:c('invented')}})};}});
  await assert.rejects(()=>ask('route',{}, {mod:{type:'choice',criteria:{none:'none'}}}),/Invalid TypeSafe/);
  await assert.rejects(()=>createJev({apiKey:''})('route',{},{}),/apiKey/);
});

test('streaming publishes revisions before completion and withholds references until final validation',async()=>{
  const parts=[];let release,first;const gate=new Promise(r=>release=r),ready=new Promise(r=>first=r);
  const work=streamAnswer({question:{id:42,text:'Read?'},context:{},publish:async p=>parts.push(p),
    answer:async(q,ctx,{onPartial})=>{await onPartial({title:'Read',body:'Continue '});first();await gate;await onPartial({title:'Read tonight',body:'Continue your book.'});return {title:'Read tonight',body:'Continue your book.',referenced_item_ids:['invented']};}});
  await ready;assert.equal(parts.length,1);assert.equal(parts[0].stream.status,'streaming');assert.deepEqual(parts[0].referenced_item_ids,[]);assert.equal(parts[0].anchor,undefined);
  release();await work;assert.deepEqual(parts.map(p=>p.stream.seq),[1,2,3]);assert.equal(parts[2].stream.status,'complete');assert.deepEqual(parts[2].referenced_item_ids,[]);
});

test('a broken stream replaces its partial answer with an error',async()=>{
  const parts=[];
  await assert.rejects(()=>streamAnswer({question:{id:43,text:'Weather?'},context:{},publish:async p=>parts.push(p),
    answer:async(q,ctx,{onPartial})=>{await onPartial({title:'Weather'});throw Error('Stream interrupted');}}),/Stream interrupted/);
  assert.equal(parts.at(-1).stream.status,'failed');assert.equal(parts.at(-1).title,'Answer unavailable');
});

test('only known IDs from items actually referenced are recorded',()=>{
  const book={item_id:'to-the-lighthouse',label:'To the Lighthouse'};
  const context={preferences:{reading:{current_book:{title:book.label,stored_item_id:book.item_id}}}};
  assert.equal(referenceCandidates(context)[0].item_id,book.item_id);
  assert.deepEqual(validatedReferenceIds({referenced_item_ids:[book.item_id,'invented',book.item_id]},context),[book.item_id]);
  assert.deepEqual(validatedReferenceIds({title:'Good night'},context),[]);
});
