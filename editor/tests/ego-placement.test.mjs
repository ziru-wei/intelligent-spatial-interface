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
// The bubble's corners and its tail's tip on the screen (NDC), for the bubble at pose p.
const onScreen=p=>{const c=cam(),h=p.width*.4,pts=[[-1,-1],[1,-1],[-1,1],[1,1]].map(([x,y])=>new THREE.Vector3(x*p.width/2,y*h/2,0).applyQuaternion(p.quaternion).add(p.position).project(c));
  return {corners:pts,tip:new THREE.Vector3(...p.tail).project(c),center:p.position.clone().project(c)};};
const inside=v=>Math.abs(v.x)<=1&&Math.abs(v.y)<=1&&v.z<1;
test('the tail: down to the top above the object; toward the face when on its side',async()=>{
  const above=await at({center:[0,.7,-2],size:[1.2,.1,.6],yaw:0});assert.deepEqual(above.tail,[0,.75,-2]);
  const side=await at({center:[0,1.2,-1.2],size:[.8,2.4,.5],yaw:0},{pitch:-25}),h=side.width*.4;
  assert.ok(side.tail[2]>-1.2&&side.tail[1]<side.position.y-h/2&&side.tail[1]>=0,`on the face below the bubble: ${side.tail}`);
});
test('the object behind the viewer: the bubble is held in the view on its side, its tail toward it; kept while it stays in view',async()=>{
  for(const [x,side] of [[-1.5,-1],[1.5,1]]){
    const p=await at({center:[x,.7,1],size:[1,.1,.5],yaw:0});
    assert.equal(p.kind,'bubble');assert.equal(p.edge,true);assert.ok(!p.unreadable);
    const s=onScreen(p);assert.ok(s.corners.every(inside)&&inside(s.tip),'bubble and tail in view');
    assert.ok(Math.sign(s.center.x)===side&&Math.abs(s.center.x)>.3,`on the object's side: ${s.center.x}`);assert.ok(Math.sign(s.tip.x-s.center.x)===side,'tail toward it');
  }
  // Straight behind: still in view; in a small view it is made smaller to fit, never cut off.
  assert.ok(onScreen(await at({center:[0,.7,2],size:[1,.1,.5],yaw:0})).corners.every(inside));
  const small=await place({frame:0,aspect:.4,textMetrics:{xHeightRatio:.04},ego:{main:'layout:x'}},{frames:[{t:0}],frameCamera:()=>cam(),viewport:()=>({width:120,height:120}),
    egoTarget:()=>({center:[1.5,.7,1],size:[1,.1,.5],yaw:0}),getSettings:()=>({}),relationAt:()=>null,getStaticSurfaces:()=>[],visible:async(_,pts)=>pts.map(()=>true)});
  assert.equal(small.edge,true);const ss=onScreen(small);assert.ok(ss.corners.every(inside)&&inside(ss.tip));
  const first=await at({center:[0,.7,-2],size:[1.2,.1,.6],yaw:0});
  assert.equal((await at({center:[0,.7,-2],size:[1.2,.1,.6],yaw:0},{previousPose:first})).reusedSurface,true);
});
test('an object in view whose spots do not fit: the bubble just above it on the screen, its tail reaching it',async()=>{
  // A small thing at the right edge of the view: a bubble centred on it would be cut off.
  const p=await at({center:[1.05,1.4,-2],size:[.15,.15,.15],yaw:0});
  assert.equal(p.edge,true);const s=onScreen(p),obj=new THREE.Vector3(1.05,1.4,-2).project(cam());
  assert.ok(s.corners.every(inside));assert.ok(s.center.y>obj.y&&s.center.x<obj.x,'above it, pulled into the view');
  assert.ok(Math.hypot(s.tip.x-obj.x,s.tip.y-obj.y)<1e-6,'the tail reaches it');
});
test('bubble outline: a tail on the side facing the tip, its base clear of the corners; none when the tip is inside',async()=>{
  const {bubbleOutline}=await import('../src/ego.mjs');const box={x0:-1,x1:1,y0:-.5,y1:.5};
  const pts=bubbleOutline(box,.1,{x:3,y:-3},.1),tip=pts.findIndex(v=>v.x===3&&v.y===-3);
  assert.ok(tip>0);assert.equal(pts[tip-1].y,-.5);assert.ok(pts[tip+1].x<=.9+1e-9,'clear of the corner');
  assert.ok(bubbleOutline(box,.1,{x:.2,y:.1},.1).every(v=>Math.abs(v.x)<=1&&Math.abs(v.y)<=.5));
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
