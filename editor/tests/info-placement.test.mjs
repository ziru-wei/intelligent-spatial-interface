import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {place,INFO_NEAR} from '../src/placement.mjs';

// A recorded camera at eye height looking down -z; an information box on a table 2 m ahead.
const camera=()=>{const c=new THREE.PerspectiveCamera(60,1.5,.02,50);c.position.set(0,1.55,0);c.lookAt(0,1.2,-2);c.updateMatrixWorld(true);return c;};
const box={id:'custom_1',center:[0,.9,-2],size:[.2,.2,.2],yaw:0};
const wall=(id,z)=>({id,kind:'wall',origin:new THREE.Vector3(0,1.4,z),n:new THREE.Vector3(0,0,1),right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0),width:3,height:2.4});
const ctx=(surfaces,cost=0)=>({frames:[{t:0},{t:1}],frameCamera:camera,viewport:()=>({width:1200,height:800}),getStaticSurfaces:()=>surfaces,infoTarget:()=>box,
  getSurfaceQuality:async()=>()=>({cost}),getSettings:()=>({stability:0,fallback:'fixed'})});
const response={id:1,frame:0,aspect:.4,info:{key:'wifi',box_id:'custom_1'}};

test('a good surface near the box: the answer settles there and stays when the viewer moves',async()=>{
  const c=ctx([wall('near',-2.4),wall('far',-6)]),pose=await place(response,c);
  assert.equal(pose.surfaceId,'near');assert.ok(pose.infoSettled);assert.equal(pose.infoBox,'custom_1');
  const moved={...c,frameCamera:()=>{const k=camera();k.position.x+=1.5;k.updateMatrixWorld(true);return k;}};
  const again=await place({...response,frame:1,previousPose:pose},moved);
  assert.ok(again.reusedSurface);assert.ok(again.position.equals(pose.position));
});

test('no good surface within reach: floats beside the box in its plane, in view, world-fixed',async()=>{
  for(const c of [ctx([wall('far',-2-INFO_NEAR-.5)]),ctx([wall('near',-2.8)],4)]){
    const pose=await place(response,c);
    assert.equal(pose.kind,'info-float');assert.ok(!pose.unreadable);
    assert.ok(new THREE.Vector3(...box.center).distanceTo(pose.position)<.6);assert.ok(pose.viewMetrics.inView);
    assert.ok(pose.position.y<=1.55+.1);
    const moved={...c,frameCamera:()=>{const k=camera();k.position.set(1,1.55,.5);k.updateMatrixWorld(true);return k;}};
    const again=await place({...response,frame:1,previousPose:pose},moved);
    assert.ok(again.position.equals(pose.position));
  }
});

test('spot score: near, facing the box face toward the viewer, clean',async()=>{
  const {infoSpotScore}=await import('../src/placement.mjs');
  const eye=new THREE.Vector3(0,1.5,0),flyer={center:[0,1.5,-2],size:[.3,.4,.02],yaw:0};
  const pose=(z,turn=0,cost=0)=>({surfaceId:'wall',surfaceAnchor:new THREE.Vector3(.2,1.5,z),quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),turn),surfaceQuality:{cost}});
  // On the surface the person relates to: everything perfect; no relation known: neutral; another surface related to: less.
  assert.deepEqual(infoSpotScore(pose(-2.01),flyer,eye,null,1,'wall'),{near:1,facing:1,clean:1,level:1,relation:1,score:1});
  assert.equal(infoSpotScore(pose(-2.01),flyer,eye).score,.95);assert.equal(infoSpotScore(pose(-2.01),flyer,eye,null,1,'desk').score,.9);
  const {infoSettles}=await import('../src/placement.mjs');const side=infoSpotScore(pose(-2.01,Math.PI/2),flyer,eye);assert.ok(side.facing<1e-6&&side.score<infoSpotScore(pose(-2.01),flyer,eye).score);
  // Cluttered, even right by the box and turned like it: not good enough to settle (clean weighs most).
  const cluttered=infoSpotScore(pose(-2.01,0,4),flyer,eye,null,1,'wall');assert.equal(cluttered.score,.45);assert.ok(!infoSettles(cluttered));
});

test('facing: a small box on a table seen from above shows its top most, so text on the table faces it better than text on the wall',async()=>{
  const {infoSpotScore}=await import('../src/placement.mjs');
  // The candy of atlas_rec_3 q5: eye up and to the side (-x, +z), its -x side and its top both in sight, the top larger.
  const candy={center:[1.14,6.3,8.98],size:[.21,.11,.14],yaw:0},eye=new THREE.Vector3(.56,6.82,9.39);
  const up=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(0,1,0)),west=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(-1,0,0));
  const table=infoSpotScore({surfaceId:'table',surfaceAnchor:new THREE.Vector3(1.0,6.25,9.25),quaternion:up},candy,eye);
  const wall=infoSpotScore({surfaceId:'wall',surfaceAnchor:new THREE.Vector3(1.53,6.6,9.1),quaternion:west},candy,eye);
  assert.ok(table.facing>wall.facing&&table.facing>.3&&wall.facing>.1,JSON.stringify({table,wall}));
});

test('an info answer never covers its box',async()=>{
  // The box on the wall itself: every spot on that wall around it is allowed except over the box.
  const onWall={id:'custom_1',center:[0,1.3,-2.38],size:[.3,.4,.02],yaw:0};
  const c={...ctx([wall('near',-2.4)]),infoTarget:()=>onWall},pose=await place(response,c);
  const {footprintPoints}=await import('../src/text-view.mjs');
  const pts=footprintPoints(pose,response.aspect,8,4);
  assert.ok(pts.every(p=>!(Math.abs(p.x)<=.15&&Math.abs(p.y-1.3)<=.2)));
});

test('floating on an upper floor: by the box, in view, a sane size',async()=>{
  const up=()=>{const c=camera();c.position.y+=6;c.lookAt(0,7.2,-2);c.updateMatrixWorld(true);return c;};
  const high={id:'custom_1',center:[0,6.9,-2],size:[.2,.2,.2],yaw:0};
  const pose=await place(response,{...ctx([]),frameCamera:up,infoTarget:()=>high});
  assert.equal(pose.kind,'info-float');assert.ok(new THREE.Vector3(...high.center).distanceTo(pose.position)<.6);assert.ok(pose.viewMetrics.inView);assert.ok(pose.width<=1.2);
});

test('placement picks the line length that fits: a short wide strip takes a wide, short block',async()=>{
  const {staticTextPlacement}=await import('../src/text-surfaces.mjs');const {readableSurfaceBasis}=await import('../src/placement.mjs');
  // A strip 1.4 m wide and only 6 cm tall: the default block (taller) cannot stand on it; the wide one can.
  const strip={id:'strip',kind:'wall',origin:new THREE.Vector3(0,1.4,-2),n:new THREE.Vector3(0,0,1),right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0),width:1.4,height:.06};
  const m=r=>({xHeightRatio:24/r,box:{x0:.06,x1:.94,y0:.1,y1:.9}});
  const layouts=[{columns:1024,aspect:.45,textMetrics:m(1024)},{columns:1440,aspect:.08,textMetrics:m(1440)},{columns:576,aspect:.9,textMetrics:m(576)}];
  const c={frames:[{t:0}],frameCamera:camera,viewport:()=>({width:1200,height:800}),getStaticSurfaces:()=>[strip],getSettings:()=>({stability:0})};
  const one=await staticTextPlacement({id:1,frame:0,aspect:.45,textMetrics:m(1024)},c,readableSurfaceBasis);
  const many=await staticTextPlacement({id:1,frame:0,aspect:.45,textMetrics:m(1024),layouts},c,readableSurfaceBasis);
  assert.equal(one,null);assert.equal(many.layout,1440);
});

test('an upright panel turned toward the eye while looking up at it slants on screen (keystone); one parallel to the wall does not',async()=>{
  const {screenTilt}=await import('../src/placement.mjs');
  // atlas_rec_3 at 47.8 s: close to the wall, looking up about 32°; the floating panel turned 38° toward the eye.
  const cam=new THREE.PerspectiveCamera(60,1.4,.02,50);cam.position.set(0,1.5,0);cam.lookAt(0,1.5+.53,-.85);cam.updateMatrixWorld(true);
  const at=new THREE.Vector3(.35,1.9,-.6),yaw=a=>new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),a);
  const turned=screenTilt({position:at,quaternion:yaw(-.66),width:.3},cam,1.4),wall=screenTilt({position:at,quaternion:yaw(0),width:.3},cam,1.4);
  assert.ok(THREE.MathUtils.radToDeg(turned)>10);assert.ok(THREE.MathUtils.radToDeg(wall)<3);
});

test('a floating panel is turned like its box face when that face is within the angle of facing the eye',async()=>{
  const {floatYaw}=await import('../src/placement.mjs');
  const box={center:[0,2,-1],size:[.2,.3,.02],yaw:0},eye=new THREE.Vector3(0,1.5,0),deg=v=>Math.round(THREE.MathUtils.radToDeg(v));
  // From beside the box, the eye is 54° off its face: parallel (yaw 0) within 80°, turned to the eye when the limit is 30°.
  const at=new THREE.Vector3(-.5,2,-.36);
  assert.equal(deg(floatYaw(box,at,eye,80)),0);assert.equal(deg(floatYaw(box,at,eye,30)),deg(Math.atan2(eye.x-at.x,eye.z-at.z)));
  // A box turned 90°: its broad face (now facing ±x) is used, not an edge.
  assert.equal(Math.abs(deg(floatYaw({...box,yaw:90},new THREE.Vector3(.5,2,-1),new THREE.Vector3(2,1.5,-1),80))),90);
});

test('text is not put far above the eye when a spot near eye height is there',async()=>{
  const {staticTextPlacement}=await import('../src/text-surfaces.mjs');const {readableSurfaceBasis}=await import('../src/placement.mjs');
  // Looking up at a tall clean wall: the middle of the view is high on it, but eye height is still in view.
  const cam=new THREE.PerspectiveCamera(70,1.5,.02,50);cam.position.set(0,1.5,0);cam.lookAt(0,2.1,-2);cam.updateMatrixWorld(true);
  const wall={id:'tall',kind:'wall',origin:new THREE.Vector3(0,2,-2),n:new THREE.Vector3(0,0,1),right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0),width:3,height:2};
  const c={frames:[{t:0}],frameCamera:()=>cam,viewport:()=>({width:1200,height:800}),getStaticSurfaces:()=>[wall],getSettings:()=>({stability:0})};
  const pose=await staticTextPlacement({id:1,frame:0,aspect:.4,textMetrics:{xHeightRatio:24/1024,box:{x0:.06,x1:.94,y0:.1,y1:.9}}},c,readableSurfaceBasis);
  assert.ok(pose.position.y-1.5<.35,`placed at ${pose.position.y.toFixed(2)} m with the eye at 1.5 m`);
});

test('standing close to a flyer above eye level (atlas_rec_3): the float is beside it at its distance, in view, not between the eye and it',async()=>{
  const cam=()=>{const c=new THREE.PerspectiveCamera(60,1.33,.02,50);c.position.set(-.06,7.06,6.94);c.lookAt(-.03,7.6,6.09);c.updateMatrixWorld(true);return c;};
  const flyer={id:'f',center:[-.05,7.335,6.539],size:[.12,.19,.14],yaw:90};
  const pose=await place(response,{...ctx([]),frameCamera:cam,infoTarget:()=>flyer});
  const eye=cam().position,toBox=new THREE.Vector3(...flyer.center).distanceTo(eye);
  // In the plane of the box's front face (this box is 14 cm deep: its front is 7 cm nearer than its centre), not out toward the eye.
  const toward=eye.clone().sub(new THREE.Vector3(...flyer.center)).setY(0).normalize(),ahead=pose.position.clone().sub(new THREE.Vector3(...flyer.center)).setY(0).dot(toward);
  assert.equal(pose.kind,'info-float');assert.ok(pose.viewMetrics.inView);assert.ok(ahead<.07+.04+.01,`ahead ${ahead}`);void toBox;
  assert.ok(pose.position.y<eye.y+.35);
});
