import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,resolve,modOf,load,save,textResponses,resumeOnFirstResponse,disabledResponseMods} from '../src/response-settings.mjs';

test('a mod follows the global settings unless it overrides one',()=>{
  const s=normalize({global:{autoHide:true,stability:.4},mods:{weather:{enabled:true,overrides:{fixedText:true,stability:.9}}}});
  assert.deepEqual(resolve(s),{textResponse:true,resumeOnResponse:false,autoHide:true,surfaceFallback:false,fixedText:false,stability:.4});
  assert.deepEqual(resolve(s,'weather'),{textResponse:true,resumeOnResponse:false,autoHide:true,surfaceFallback:false,fixedText:true,stability:.9});
  delete s.mods.weather.overrides.stability;
  s.mods.weather.overrides.textResponse=false;assert.deepEqual(textResponses(s),{default:true,weather:false});s.mods.weather.enabled=false;assert.deepEqual(textResponses(s),{default:true});s.mods.weather.enabled=true;
assert.equal(resolve(s,'weather').stability,.4);
});
test('a response belongs to the weather mod only while it is on',()=>{
  const s=normalize({mods:{weather:{enabled:true}}});
  assert.equal(modOf(s,{weather:{forecast:[]}}),'weather');assert.equal(modOf(s,{text:'hi'}),null);
  s.mods.weather.enabled=false;assert.equal(modOf(s,{weather:{}}),null);
});
test('older keys carry over',()=>{
  const m=new Map(Object.entries({'spatial-take:placement-stability':'0.5','spatial-take:weather-mod':'true','spatial-take:weather-fixed-text':'true'})),store={getItem:k=>m.get(k)??null};
  const s=load(store);assert.equal(s.global.stability,.5);assert.equal(s.mods.weather.enabled,true);assert.deepEqual(s.mods.weather.overrides,{fixedText:true});
});
test('mods can omit global overrides and add private options without changing other mods',()=>{
 const s=normalize({global:{stability:.6},mods:{findmy:{enabled:true,overrides:{stability:.9},options:{removeOnHandApproach:true}},weather:{enabled:true,overrides:{stability:.8}}}});
 assert.equal(s.mods.findmy.overrides.stability,undefined);
 assert.equal(resolve(s,'findmy').stability,.6);assert.equal(resolve(s,'findmy').removeOnHandApproach,true);
 assert.equal(resolve(s,'weather').stability,.8);assert.equal(resolve(s,'weather').removeOnHandApproach,undefined);
 assert.equal(resolve(normalize(),'findmy').removeOnHandApproach,false);
});

test('FindMy distance tolerance defaults to 25 cm, persists and clamps to the UI range',()=>{
 assert.equal(resolve(normalize(),'findmy').handApproachDistance,.25);
 const s=normalize({mods:{findmy:{options:{handApproachDistance:.35}}}}),m=new Map(),store={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};
 save(s,store);assert.equal(resolve(load(store),'findmy').handApproachDistance,.35);
 assert.equal(resolve(normalize({mods:{findmy:{options:{handApproachDistance:10}}}}),'findmy').handApproachDistance,.5);
 assert.equal(resolve(normalize({mods:{findmy:{options:{handApproachDistance:0}}}}),'findmy').handApproachDistance,.05);
});

test('resume-on-first-response persists and can be overridden independently per mod',()=>{
 const s=normalize();assert.equal(resolve(s).resumeOnResponse,false);
 s.global.resumeOnResponse=true;s.mods.weather.overrides.resumeOnResponse=false;s.mods.findmy.overrides.resumeOnResponse=true;
 const m=new Map(),store={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};save(s,store);const restored=load(store);
 assert.equal(resolve(restored).resumeOnResponse,true);assert.equal(resolve(restored,'weather').resumeOnResponse,false);assert.equal(resolve(restored,'findmy').resumeOnResponse,true);
 delete restored.mods.weather.overrides.resumeOnResponse;assert.equal(resolve(restored,'weather').resumeOnResponse,true);
});

test('text-first delivery cannot bypass a mod override while mod selection is pending',()=>{
 const s=normalize({global:{resumeOnResponse:true},mods:{weather:{enabled:true,overrides:{resumeOnResponse:false}}}});
 const q={id:4,status:'running'},text={question_id:4,title:'Words'};
 assert.equal(resumeOnFirstResponse(s,text,q),false);
 assert.equal(resumeOnFirstResponse(s,text,q,[{question_id:4,weather:{}}]),false);
 q.status='answered';assert.equal(resumeOnFirstResponse(s,text,q),true);
 s.mods.weather.overrides.resumeOnResponse=true;assert.equal(resumeOnFirstResponse(s,{weather:{}},q),true);
});

test('surface fallback defaults off and persists independent mod overrides',()=>{
 const s=normalize({global:{surfaceFallback:true},mods:{weather:{overrides:{surfaceFallback:false}},findmy:{overrides:{surfaceFallback:true}}}});
 assert.equal(resolve(normalize()).surfaceFallback,false);
 const m=new Map(),store={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};save(s,store);const restored=load(store);
 assert.equal(resolve(restored).surfaceFallback,true);assert.equal(resolve(restored,'weather').surfaceFallback,false);assert.equal(resolve(restored,'findmy').surfaceFallback,true);
 delete restored.mods.weather.overrides.surfaceFallback;assert.equal(resolve(restored,'weather').surfaceFallback,true);
});

test('disabled response mods are explained without enabling unrelated effects',()=>{
 const s=normalize();assert.deepEqual(disabledResponseMods(s,[{findmy:{target:{}}}]),['findmy']);
 s.mods.findmy.enabled=true;assert.deepEqual(disabledResponseMods(s,[{findmy:{}}]),[]);
 assert.deepEqual(disabledResponseMods(s,[{weather:{}}]),['weather']);assert.deepEqual(disabledResponseMods(s,[{body:'Words'}]),[]);
});
