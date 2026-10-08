import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {fitSurface,classify,place} from '../src/placement.mjs';
// Deterministic noise (LiDAR-like, σ in metres).
let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647,gauss=s=>s*Math.sqrt(-2*Math.log(rnd()||1e-9))*Math.cos(2*Math.PI*rnd());
const eye=new THREE.Vector3(0,1.5,2),R=.6,W=.6;
function patch(f,noise=.006){const pts=[];for(let i=-20;i<=20;i++)for(let j=-20;j<=20;j++){const x=i/20*R,y=j/20*R;if(x*x+y*y>R*R)continue;pts.push(f(x,y).add(new THREE.Vector3(gauss(noise),gauss(noise),gauss(noise))));}return pts;}
// A wall facing +z, tilted 10° about y.
const tilt=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.17),wallN=new THREE.Vector3(0,0,1).applyQuaternion(tilt);
const onWall=(x,y,z=0)=>new THREE.Vector3(x,1.5+y,z).applyQuaternion(tilt);
const decide=fit=>{const n=fit.normal,up=new THREE.Vector3(0,1,0).addScaledVector(n,-n.y).normalize();return classify(fit,up.clone().cross(n),up,W,W*.5);};
test('noisy wall: average normal within 1.5°, plane',()=>{
  const fit=fitSurface(patch((x,y)=>onWall(x,y)),onWall(0,0),eye);
  assert.ok(fit.normal.angleTo(wallN)<1.5*Math.PI/180,`${fit.normal.angleTo(wallN)*180/Math.PI}°`);assert.equal(decide(fit),'plane');
});
test('large column (R = 0.8 m): curved, and the fitted heights follow it within 1 cm',()=>{
  const Rc=.8,f=(x,y)=>onWall(Rc*Math.sin(x/Rc),y,Rc*Math.cos(x/Rc)-Rc);
  const fit=fitSurface(patch(f),f(0,0),eye);assert.equal(decide(fit),'curved',`sag ${fit.sag}`);
  const n=fit.normal,up=new THREE.Vector3(0,1,0).addScaledVector(n,-n.y).normalize(),right=up.clone().cross(n);
  for(const x of [-.3,-.15,.15,.3]){const truth=Rc*Math.cos(Math.asin(x/Rc))-Rc;assert.ok(Math.abs(fit.height(right,up,x,0)-truth)<.01,`x=${x}: ${fit.height(right,up,x,0)} vs ${truth}`);}
});
test('corner (wall meets desk): rough',()=>{
  // Below the edge a wall facing +z; above it the desk top at 1.5 m, extending away.
  const fit=fitSurface(patch((x,y)=>y<0?new THREE.Vector3(x,1.5+y,0):new THREE.Vector3(x,1.5,-y)),new THREE.Vector3(0,1.5,0),eye);
  assert.equal(decide(fit),'rough');
});
test('bottle-sized curve (R = 0.15 m) under 0.6 m text: rough',()=>{
  const Rc=.15,pts=patch((x,y)=>{const a=THREE.MathUtils.clamp(x/Rc,-1.4,1.4);return onWall(Rc*Math.sin(a),y,Rc*Math.cos(a)-Rc);});
  const fit=fitSurface(pts,onWall(0,0),eye);assert.equal(decide(fit),'rough');
});
test('a few outliers (another object) are trimmed',()=>{
  const pts=patch((x,y)=>onWall(x,y));for(let i=0;i<60;i++)pts.push(onWall(.2+rnd()*.1,rnd()*.1,.15));
  const fit=fitSurface(pts,onWall(0,0),eye);assert.ok(fit.normal.angleTo(wallN)<2*Math.PI/180);assert.equal(decide(fit),'plane');
});
test('wall measured bowed (R = 4 m, like depth error on glass): plane; column radius estimated',()=>{
  const bow=(Rc,x,y)=>onWall(Rc*Math.sin(x/Rc),y,Rc*Math.cos(x/Rc)-Rc);
  const fit=fitSurface(patch((x,y)=>bow(4,x,y)),bow(4,0,0),eye);assert.equal(decide(fit),'plane');
  const col=fitSurface(patch((x,y)=>bow(.8,x,y)),bow(.8,0,0),eye);decide(col);assert.ok(Math.abs(col.curveRadius-.8)<.12,`radius ${col.curveRadius}`);
});
test('free rectangle avoids a window mullion that hides part of the surface, and stays near the gaze point',async()=>{
  const {freeRect}=await import('../src/placement.mjs');
  const fit=fitSurface(patch((x,y)=>onWall(x,y),.003),onWall(0,0),eye),n=fit.normal,up=new THREE.Vector3(0,1,0).addScaledVector(n,-n.y).normalize(),right=up.clone().cross(n);
  // Points whose text-x falls in [-0.22, -0.16] are behind the mullion.
  const visible=async pts=>pts.map(p=>{const x=p.clone().sub(fit.atText(right,up,0,0)).dot(right);return !(x>-.22&&x<-.16);});
  const r=await freeRect({fit,right,up,n,lift:.015,W:W,aspect:.4,visible});
  assert.ok(r.cx-r.w/2>=-.16-1e-9,`left edge ${r.cx-r.w/2} clear of the mullion`);assert.ok(Math.abs(r.cx)<.35*W);
  const all=await freeRect({fit,right,up,n,lift:.015,W:W,aspect:.4,visible:null});assert.ok(all.w>=r.w&&Math.hypot(all.cx,all.cy)<1e-9,'unobstructed: full width at the centre');
});
test('legibility floor: x-height 0.3° → about 0.45 m wide at 2 m head-on, wider when foreshortened',async()=>{
  const {minWidth}=await import('../src/placement.mjs');const up=new THREE.Vector3(0,1,0);
  const head=minWidth(new THREE.Vector3(0,0,-2),up,new THREE.Vector3());assert.ok(Math.abs(head-.447)<.01,String(head));
  const lying=minWidth(new THREE.Vector3(0,-1,-2),new THREE.Vector3(0,0,-1),new THREE.Vector3());assert.ok(lying>head*1.5,String(lying));
});

test('ceiling and floor text project upright across camera pitch, yaw and roll',async()=>{
 for(const ceiling of [true,false])for(const pitch of [.65,1.15,1.56])for(const yaw of [-2,0,1.8])for(const roll of [-.3,.2]){
  const camera=new THREE.PerspectiveCamera(60,1,.01,100);camera.position.set(0,1.5,0);camera.quaternion.setFromEuler(new THREE.Euler(ceiling?pitch:-pitch,yaw,roll,'YXZ'));camera.updateMatrixWorld(true);
  const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion),distance=(ceiling?1:-1)/forward.y,point=camera.position.clone().addScaledVector(forward,distance),normal=new THREE.Vector3(0,ceiling?-1:1,0);
  const f={position:camera.position.toArray(),quaternion:camera.quaternion.toArray()},pose=await place({frame:0,aspect:.5},{frames:[f],surfaceAt:async()=>({point,normal})});
  const up=new THREE.Vector3(0,1,0).applyQuaternion(pose.quaternion),top=pose.position.clone().addScaledVector(up,.05).project(camera),bottom=pose.position.clone().addScaledVector(up,-.05).project(camera);
  assert.ok(top.y>bottom.y,`upside down: ceiling=${ceiling}, pitch=${pitch}, yaw=${yaw}, roll=${roll}`);
 }
});

test('a noisy laptop-sized patch yields a smooth support, while a large bend is rejected',async()=>{
 const {smoothScanTarget}=await import('../src/placement.mjs');
 const fit=fitSurface(patch((x,y)=>onWall(x,y),.022),onWall(0,0),eye);
 const target=smoothScanTarget(fit,'laptop');assert.ok(target);assert.equal(target.source,'smoothed-scan');assert.ok(target.width>.3&&target.height>.3);
 assert.equal(smoothScanTarget({...fit,coef:[10,0,10,0,0,0]},'fold'),null);
 assert.equal(smoothScanTarget({...fit,rms:.1},'clutter'),null);
});
