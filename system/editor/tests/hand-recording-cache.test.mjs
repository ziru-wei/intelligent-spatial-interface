import test from 'node:test';import assert from 'node:assert/strict';
import {encodeMask,decodeRecord,createRecordingHandCache} from '../src/hand-perception/recording-cache.mjs';
test('binary masks roundtrip including empty and all-foreground masks',()=>{
 for(const mask of [new Uint8Array(12),new Uint8Array(12).fill(255),Uint8Array.from([255,0,255,255,0,0,255,0,0,0,0,255])]){
  const result=decodeRecord({width:4,height:3,landmarks:[[]],runs:encodeMask(mask)},'frame');assert.deepEqual(result.mask,mask);
 }
 assert.throws(()=>decodeRecord({width:1,height:1,landmarks:[[]],runs:[2]},'f'),/Invalid/);
});
test('recorded no-hand frames bypass fetching masks and survive client reload',async()=>{
 const entries={};let frameReads=0;
 const fetcher=async(url,options)=>{
  if(options){const body=JSON.parse(options.body);entries[body.frame]={empty:true,width:4,height:3};return {ok:true,json:async()=>entries[body.frame]};}
  if(url.searchParams.has('frame'))frameReads++;
  return {ok:true,json:async()=>({token:'v',total:2,entries:{...entries}})};
 };
 const first=createRecordingHandCache({session:'http://local/scenarios/a/session.json',fetcher});await first.write(0,{status:'ready',width:4,height:3,landmarks:[],mask:new Uint8Array(12)});
 const second=createRecordingHandCache({session:'http://local/scenarios/a/session.json',fetcher});const result=await second.read(0,'recording#0');
 assert.equal(result.status,'ready');assert.equal(result.mask.some(Boolean),false);assert.equal(frameReads,0);assert.equal(await second.read(1,'recording#1'),null);
});
