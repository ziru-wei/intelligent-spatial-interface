import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {place} from '../src/placement.mjs';
import {bounceOffset,growScale} from '../src/ego.mjs';

// The recorded view at 1.5 m, level, looking down -z; objects ahead of it.
const D=Math.PI/180,cam=(pitch=0)=>{const c=new THREE.PerspectiveCamera(60,1,.01,100);c.position.set(0,1.5,0);c.rotation.set(pitch*D,0,0);c.updateMatrixWorld(true);return c;};
const at=(target,{pitch=0,previousPose,fallback}={})=>place({frame:0,aspect:.4,textMetrics:{xHeightRatio:.04},ego:{main:'layout:x'},previousPose},
  {frames:[{t:0}],frameCamera:()=>cam(pitch),viewport:()=>({width:600,height:600}),egoTarget:id=>id==='layout:x'?target:null,getSettings:()=>({fallback}),
   relationAt:()=>null,getStaticSurfaces:()=>[],visible:async(_,pts)=>pts.map(()=>true)});

test('a desk ahead: the bubble sits just above it, a line down to its top',async()=>{
  const p=await at({center:[0,.7,-2],size:[1.2,.1,.6],yaw:0});
  assert.equal(p.kind,'bubble');assert.deepEqual(p.anchor,[0,.75,-2]);assert.ok(p.position.y>.75&&p.position.y<1.5,`${p.position.y}`);
});
test('a tall cabinet whose top is out of view: the bubble comes down onto its front, still on the object',async()=>{
  const p=await at({center:[0,1.2,-1.2],size:[.8,2.4,.5],yaw:0},{pitch:-25});
  assert.equal(p.kind,'bubble');assert.equal(p.anchor,null);
  assert.ok(p.position.z>-1.2+.25&&p.position.z<-.9,`in front of it: ${p.position.z}`);assert.ok(p.position.y<2.4&&p.position.y>0,`on it: ${p.position.y}`);
});
test('the object behind the viewer: no spot in view, the fallback shows the answer; kept while it stays in view',async()=>{
  assert.equal((await at({center:[0,.7,2],size:[1,.1,.5],yaw:0})).unreadable,true);
  assert.equal((await at({center:[0,.7,2],size:[1,.1,.5],yaw:0},{fallback:'floating'})).kind,'view-fallback');
  const first=await at({center:[0,.7,-2],size:[1.2,.1,.6],yaw:0});
  assert.equal((await at({center:[0,.7,-2],size:[1.2,.1,.6],yaw:0},{previousPose:first})).reusedSurface,true);
});
test('effects: bounce and grow run in the first 1.2 s of every 3 s',()=>{
  assert.equal(bounceOffset(2,1),0);assert.ok(bounceOffset(.2,1)>.1);assert.equal(growScale(2),1);assert.ok(Math.abs(growScale(.6)-1.3)<1e-9);assert.ok(Math.abs(growScale(3.6)-1.3)<1e-9);
});
test('touch removal: each object loses its effect on its own; the mod stays active while one is left',async()=>{
  const {createEgo}=await import('../src/ego.mjs');
  const ego=createEgo({getTarget:id=>({center:[0,1,-2],size:[.5,.5,.5],yaw:0})});
  ego.setResponse({question_id:1,ego:{main:'layout:a',effect:{type:'bounce',color:'calm'},objects:[{id:'layout:a'},{id:'layout:b'}]}});
  assert.equal(ego.active,true);ego.setRemoved(['layout:a']);assert.equal(ego.active,true);ego.setRemoved(['layout:a','layout:b']);assert.equal(ego.active,false);
  ego.setRemoved([]);assert.equal(ego.active,true);ego.dispose();
});
