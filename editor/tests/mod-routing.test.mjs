import test from 'node:test';
import assert from 'node:assert/strict';
import {jev_call_mod,runPipeline,MOD_MIN_PROBABILITY,MOD_MIN_CONFIDENCE} from '../scripts/jev-pipeline.mjs';
const item={item_id:'to-the-lighthouse',label:'To the Lighthouse',available:true};
const context={context_groups:{personal:{description:'Reading'},storage:{description:'Items'}},findmy_catalog:[item],interaction:{findmy_mod:true},preferences:{reading:{title:'To the Lighthouse',page:68}}};
const selected=(probability,confidence)=>({mod:{type:'choice',choice:'findmy',probabilities:{findmy:probability,none:1-probability},confidence}});

test('captured 0.58 probability / 0.16 confidence falls back to direct answer',async()=>{
 const traces=[];
 const result=await jev_call_mod(async()=>selected(.58,.16),'what should i read tonight?',context,(...args)=>traces.push(args));
 assert.equal(result,'none');assert.equal(traces[0][0],'mod_fallback');
});
test('both thresholds must pass; boundary accepted; missing certainty rejected',async()=>{
 for(const [p,c,expected] of [[.64,.9,'none'],[.9,.24,'none'],[MOD_MIN_PROBABILITY,MOD_MIN_CONFIDENCE,'findmy'],[.95,.8,'findmy']]){
  assert.equal(await jev_call_mod(async()=>selected(p,c),'Where is my book?',context),expected);
 }
 assert.equal(await jev_call_mod(async()=>({mod:{choice:'findmy'}}),'Where is my book?',context),'none');
});
test('FindMy not offered without mapped candidates; prompt separates recommendations from locating',async()=>{
 for(const findmy_catalog of [undefined,[],[{...item,available:false}]]){
  assert.equal(await jev_call_mod(async(_,state,q)=>{assert.equal(q.mod.criteria.findmy,undefined);return {mod:{choice:'none'}};},'what should i read tonight?',{...context,findmy_catalog}),'none');
 }
 await jev_call_mod(async(_,state,q)=>{
  assert.match(q.mod.criteria.findmy.rule,/page progress/);assert.match(q.mod.criteria.findmy.rule,/physical/);
  assert.ok(q.mod.criteria.none.examples.includes('What should I read tonight?'));
  return {mod:{choice:'none'}};
 },'what should i read tonight?',context);
});
test('weak FindMy route preserves normal text despite the FindMy text override',async()=>{
 let calls=0;const parts=[];
 await runPipeline({question:{id:1,text:'what should i read tonight?',text_response:{default:true,findmy:false}},readContext:async()=>context,ask:async stage=>stage==='jev_call_context_read'?{personal:{noul:1},storage:{noul:1}}:selected(.58,.16),answer:async()=>{calls++;return {title:'Continue To the Lighthouse'};},publish:async p=>parts.push(p)});
 assert.equal(calls,1);assert.deepEqual(parts.map(p=>p.part),['text']);
});
test('failed FindMy restores default text but preserves a global text-off preference',async()=>{
 for(const defaultText of [true,false]){
  let calls=0;const parts=[];
  await runPipeline({question:{id:2,text:'where is my book?',text_response:{default:defaultText,findmy:false}},readContext:async()=>context,ask:async stage=>stage==='jev_call_context_read'?{personal:{noul:0},storage:{noul:1}}:stage==='jev_call_mod'?selected(.95,.8):{target:{choice:'not_found'}},answer:async()=>{calls++;return {title:'Location unavailable'};},publish:async p=>parts.push(p)});
  assert.equal(calls,defaultText?1:0);assert.deepEqual(parts.map(p=>p.part),defaultText?['ui','text']:['ui']);
 }
});
