import test from 'node:test';import assert from 'node:assert/strict';
import {runPipeline,jev_ego_UI_dec} from '../scripts/jev-pipeline.mjs';
const n=value=>({type:'noul',noul:value}),c=value=>({type:'choice',choice:value,confidence:1,probabilities:{[value]:1}});
const ego_catalog=[{id:'layout:fridge',label:'fridge',kind:'furniture',zone:'Kitchen',has_model:false},{id:'comp:plant',label:'plant',kind:'object',zone:null,has_model:true},{id:'layout:Window_0',label:'window',kind:'opening',zone:'Kitchen',has_model:false}];
const weather={forecast:[{id:'a',date:'2026-10-07',time:'14:00',samples:[{id:'a15',time:'15:00'}]}]};
const catalog={time:{date:'2026-10-07'},context_groups:{weather:{description:'forecast'}}};
// Jev: context read, mod choice, is_ego score, object selection (main = obj_i, also_ for the others), weather UI.
function jev({mod='none',ego=.9,main='obj_0',also={},effect='bounce',color='attention'}={}){
  const calls=[];return {calls,ask:async(stage,state,questions)=>{calls.push(stage);
    if(stage==='jev_call_context_read')return {weather:n(1)};
    if(stage==='jev_call_mod')return {mod:c(mod)};
    if(stage==='jev_call_is_ego')return {ego:n(ego)};
    if(stage==='jev_ego_UI_dec')return Object.fromEntries(Object.keys(questions).map(k=>[k,k==='main'?c(main):k==='effect'?c(effect):k==='color'?c(color):n(also[k]??0)]));
    return Object.fromEntries(Object.keys(questions).map(k=>[k,n(1)]));}};
}
const run=async(j,{visible={},egoMod=true}={})=>{const parts=[],contexts=[];
  const result=await runPipeline({question:{id:7,text:'q'},ask:j.ask,checkVisible:async ids=>Object.fromEntries(ids.map(id=>[id,visible[id]??0])),
    readContext:async groups=>groups.length?{...catalog,weather,interaction:{weather_mod:true,ego_mod:egoMod},...(egoMod?{ego_catalog}:{})}:catalog,
    answer:async(q,ctx)=>{contexts.push(ctx);return {title:'T',body:'B',anchor:{object:'x',relation:'on'},referenced_item_ids:[]};},publish:async p=>parts.push(p)});
  return {result,parts,contexts};};

test('object question, no other mod: the objects carry it and the main one speaks',async()=>{
  const {parts,contexts}=await run(jev({mod:'none',also:{also_1:.8}}));
  const ui=parts.find(p=>p.part==='ui');assert.deepEqual(ui.ego,{objects:['layout:fridge','comp:plant'],main:'layout:fridge',effect:{type:'bounce',color:'attention'}});
  assert.equal(ui.reserve_text,true);assert.deepEqual(contexts[0].voice,{speak_as:'fridge',kind:'furniture',zone:'Kitchen'});
});
test('object mod and weather both fit: the main object in view decides',async()=>{
  const inView=await run(jev({mod:'weather',main:'obj_2'}),{visible:{'layout:Window_0':.8}});
  assert.equal(inView.parts.find(p=>p.part==='ui').ego.main,'layout:Window_0');assert.equal(inView.parts.find(p=>p.part==='ui').weather,undefined);
  assert.equal(inView.contexts[0].voice.speak_as,'window');
  const away=await run(jev({mod:'weather',main:'obj_2'}),{visible:{'layout:Window_0':.2}});
  const ui=away.parts.find(p=>p.part==='ui');assert.ok(ui.weather);assert.equal(ui.ego,undefined);assert.equal(away.contexts[0].voice,undefined);
});
test('a low score or the mod switched off keeps the normal answer (and no extra Jev calls when off)',async()=>{
  const low=await run(jev({mod:'none',ego:.2}));assert.equal(low.parts.find(p=>p.part==='ui'),undefined);assert.equal(low.contexts[0].voice,undefined);
  const j=jev({mod:'none'}),off=await run(j,{egoMod:false});assert.ok(!j.calls.includes('jev_call_is_ego'));assert.equal(off.contexts[0].voice,undefined);
});
test('no fitting object (none) keeps the other route; at most 6 objects',async()=>{
  const none=await run(jev({mod:'weather',main:'none'}));assert.ok(none.parts.find(p=>p.part==='ui').weather);
  const many=Array.from({length:10},(_,i)=>({id:`comp:o${i}`,label:`o${i}`,kind:'object',zone:null,has_model:true}));
  const pick=await jev_ego_UI_dec(jev({also:Object.fromEntries(many.map((_,i)=>[`also_${i}`,.9]))}).ask,'q',{ego_catalog:many});
  assert.equal(pick.objects.length,6);assert.equal(pick.objects[0],'comp:o0');
});
