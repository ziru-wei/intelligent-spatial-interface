import test from 'node:test';
import assert from 'node:assert/strict';
import {createResponseWidget,updateResponseWidget} from '../src/agent.mjs';
// A measuring canvas exercises real widget geometry/texture updates without needing WebGL.
const canvas=()=>{const image={width:0,height:0,calls:[]};const ctx={font:'500 46px sans-serif',measureText(text){const size=Number(this.font.match(/(\d+)px/)[1]);return {width:text.length*size*.5,actualBoundingBoxAscent:size*.55,actualBoundingBoxDescent:0};},fillText(...args){image.calls.push(args);}};image.getContext=()=>ctx;return image;};
test('streaming preserves surface pose, glyph scale, geometry and controls footprint across partial/final text',async()=>{
 const previous=globalThis.document;globalThis.document={createElement:canvas};
 try{
  let placements=0;const ctx={frames:[{position:[0,0,0],quaternion:[0,0,0,1]}],surfaceAt:async()=>{placements++;return null;}};
  const response={id:1,question_id:1,frame:0,reserve_text:true,title:'Read',weather:{forecast:[{},{}],preview:{component:'weather-timeline'}}};
  const w=await createResponseWidget(response,ctx),d=w.userData,position=w.position.clone(),quaternion=w.quaternion.clone(),geometry=d.text.geometry,glass=d.glass.geometry,pose=d.pose,height=d.height,width=d.width;
  for(const body of ['Pick up ','Pick up your book.','Continue around page 68.']){
   assert.equal(updateResponseWidget(w,{...response,title:'Read tonight',body}),true);
   assert.equal(d.text.geometry,geometry);assert.equal(d.glass.geometry,glass);assert.equal(d.pose,pose);assert.ok(w.position.equals(position));assert.ok(w.quaternion.equals(quaternion));assert.equal(d.width,width);assert.equal(d.height,height);
   assert.equal(d.text.material.map.image.weatherFooter,352);
  }
  assert.equal(placements,1);
  const before=d.text.material.map.image.calls.find(v=>v[0]==='Continue around page 68.')[2];
  assert.equal(updateResponseWidget(w,{...response,title:'Read',body:'Continue around page 68.'}),true);
  assert.equal(d.text.material.map.image.calls.find(v=>v[0]==='Continue around page 68.')[2],before,'body baseline is reserved independently of title length');
 }finally{globalThis.document=previous;}
});
test('overflow requests a larger placement, then final short text cannot shrink the reserved region',async()=>{
 const previous=globalThis.document;globalThis.document={createElement:canvas};
 try{
  const ctx={frames:[{position:[0,0,0],quaternion:[0,0,0,1]}]},response={id:1,frame:0,reserve_text:true,title:'Read',body:'Short'};
  const old=await createResponseWidget(response,ctx),overflow={...response,body:'A long word '.repeat(150)};
  assert.equal(updateResponseWidget(old,overflow),false);
  const larger=await createResponseWidget(overflow,ctx,0,0,old),height=larger.userData.height;
  assert.equal(updateResponseWidget(larger,response),true);assert.equal(larger.userData.height,height);
 }finally{globalThis.document=previous;}
});
