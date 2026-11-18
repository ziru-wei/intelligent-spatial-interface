import test from 'node:test';import assert from 'node:assert/strict';
import {createLatestFrameJob} from '../src/latest-frame-job.mjs';
test('slow perception keeps only the latest waiting frame and deduplicates requests',async()=>{
 const gates=new Map(),started=[],results=[];
 const jobs=createLatestFrameJob(key=>{started.push(key);return new Promise(resolve=>gates.set(key,resolve));},(key,result)=>results.push([key,result]));
 const first=jobs.request(1);assert.equal(jobs.request(1),first);
 const skipped=jobs.request(2),last=jobs.request(3);assert.equal(jobs.request(3),last);
 assert.equal(await skipped,null);assert.deepEqual(started,[1]);
 gates.get(1)('mask1');assert.equal(await first,'mask1');assert.deepEqual(started,[1,3]);
 gates.get(3)('mask3');assert.equal(await last,'mask3');assert.deepEqual(results,[[1,'mask1'],[3,'mask3']]);
});
test('a failed frame releases the worker for the next frame',async()=>{
 let reject;const jobs=createLatestFrameJob(key=>key===1?new Promise((_,r)=>reject=r):Promise.resolve(key));
 const first=jobs.request(1),next=jobs.request(2);reject(Error('bad frame'));await assert.rejects(first,/bad frame/);assert.equal(await next,2);
});
