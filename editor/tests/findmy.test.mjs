import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {targetGuidance} from '../src/findmy.mjs';
import {jev_findmy_UI_dec,jev_call_mod,runPipeline} from '../scripts/jev-pipeline.mjs';
import {normalize,resolve,modOf,textResponses} from '../src/response-settings.mjs';
const item={item_id:'brush',label:'Brush',aliases:['刷子'],box_id:'cabinet3',box_label:'cabinet 3',available:true};
test('Jev outputs only known item id; unknown and ambiguous do not manufacture coordinates',async()=>{
 const ask=async(stage,state,questions)=>{assert.equal(stage,'jev_UI_dec_findmy');assert.deepEqual(Object.keys(questions.target.criteria),['not_found','ambiguous','item_0']);return {target:{choice:'item_0'}};};
 assert.deepEqual(await jev_findmy_UI_dec(ask,'brush在哪里',{findmy_catalog:[item]}),{status:'found',item_id:'brush'});
 for(const status of ['not_found','ambiguous'])assert.deepEqual(await jev_findmy_UI_dec(async()=>({target:{choice:status}}),'?',{}),{status});
});
test('FindMy off is excluded; overrides retain global settings and skip Luna',async()=>{
 await jev_call_mod(async(_,state,q)=>{assert.equal(q.mod.criteria.findmy,undefined);return {mod:{choice:'none'}};},'brush',{});
 const settings=normalize({global:{textResponse:true},mods:{findmy:{enabled:true,overrides:{textResponse:false,autoHide:true}}}});
 assert.equal(modOf(settings,{findmy:{}}),'findmy');assert.equal(resolve(settings,'findmy').autoHide,true);assert.equal(settings.global.textResponse,true);
 const parts=[];await runPipeline({question:{id:1,text:'where brush',text_response:textResponses(settings)},readContext:async()=>({context_groups:{storage:{description:'stored items'}},findmy_catalog:[item],interaction:{findmy_mod:true}}),ask:async stage=>stage==='jev_call_context_read'?{storage:{noul:1}}:stage==='jev_call_mod'?{mod:{choice:'findmy',confidence:1,probabilities:{findmy:1,none:0}}}:{target:{choice:'item_0'}},answer:async()=>{throw Error('Luna should be skipped');},publish:async p=>parts.push(p)});
 assert.deepEqual(parts,[{question_id:1,part:'ui',findmy:{status:'found',item_id:'brush'}}]);
});
test('guidance handles front, offscreen, and behind-user targets',()=>{
 const camera=new THREE.PerspectiveCamera(60,1,.01,100);camera.updateMatrixWorld();
 const t=center=>({center,size:[.5,.5,.5],yaw:30});
 assert.equal(targetGuidance(camera,t([0,0,-3])).visible,true);
 const right=targetGuidance(camera,t([10,0,-3]));assert.equal(right.visible,false);assert.ok(right.x>0);
 const behind=targetGuidance(camera,t([0,0,3]));assert.equal(behind.visible,false);assert.equal(behind.behind,true);assert.ok(Number.isFinite(behind.angle));
});
