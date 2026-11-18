import test from 'node:test';import assert from 'node:assert/strict';
import {createHandPerception} from '../src/hand-perception/index.mjs';
test('shared frame requests deduplicate, retain typed data and isolate out-of-order results',async t=>{
 globalThis.createImageBitmap=async()=>({close(){}});t.after(()=>delete globalThis.createImageBitmap);
 const messages=[],events=[],worker={postMessage(v){messages.push(v);},terminate(){}};
 const service=createHandPerception({cacheSize:1,workerFactory:()=>worker});t.after(()=>service.dispose());service.subscribe(v=>events.push(v.status));
 const a=service.request('a',{}),same=service.request('a',{}),b=service.request('b',{});assert.equal(a,same);await Promise.resolve();assert.equal(messages.length,2);
 const rb={id:messages[1].id,key:'b',status:'ready',mask:new Uint8Array([255])};worker.onmessage({data:rb});assert.equal(await b,rb);assert.equal(service.get('a').status,'processing');
 const ra={id:messages[0].id,key:'a',status:'ready',mask:new Uint8Array([0])};worker.onmessage({data:ra});assert.equal(await a,ra);assert.equal(service.get('b'),undefined);assert.equal(await service.request('a',{}),ra);assert.deepEqual(events,['processing','processing','ready','ready']);
});
test('worker failure resolves pending requests; dispose settles work and rejects new work',async t=>{
 globalThis.createImageBitmap=async()=>({close(){}});t.after(()=>delete globalThis.createImageBitmap);
 let worker;const service=createHandPerception({workerFactory:()=>worker={postMessage(){},terminate(){}}});
 const a=service.request('a',{});worker.onerror({message:'Model unavailable'});assert.equal((await a).status,'error');assert.equal(service.get('a').error,'Model unavailable');
 const b=service.request('b',{});service.dispose();assert.equal((await b).status,'cancelled');await assert.rejects(service.request('c',{}),/disposed/);
});
