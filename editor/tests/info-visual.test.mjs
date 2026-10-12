import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {faceToward,cornerMarks,arrowBetween} from '../src/info-visual.mjs';

test('the face toward the viewer follows the box yaw; corners sit just outside it with inward arms',()=>{
  const box={center:[0,1,-2],size:[.4,.2,.1],yaw:90},eye=new THREE.Vector3(2,1,-2);
  const f=faceToward(box,eye);
  // Turned 90°: the box's local x points to world -z, its z to world +x (toward the eye).
  assert.ok(f.normal.distanceTo(new THREE.Vector3(1,0,0))<1e-9);assert.ok(Math.abs(f.center.x-.05)<1e-9);
  const {marks,arm}=cornerMarks(f);assert.equal(marks.length,4);assert.ok(arm>=.025&&arm<=.09);
  for(const m of marks){const toCentre=f.center.clone().sub(m.at);for(const d of m.arms)assert.ok(d.dot(toCentre)>0);}
});

test('corner marks sit inside the face',()=>{
  const f=faceToward({center:[0,1,-2],size:[.4,.3,.1],yaw:0},new THREE.Vector3(0,1,0));
  for(const m of cornerMarks(f).marks){const d=m.at.clone().sub(f.center);assert.ok(Math.abs(d.dot(f.a))<f.ha&&Math.abs(d.dot(f.b))<f.hb);}
});

test('the arrow colour is vivid and stands apart from a grey cluttered background; its border is at the other end of lightness',async()=>{
  const {accentStyle,linToOklab}=await import('../src/legibility.mjs');
  const w=16,h=16,px=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){const v=(i*37)%2?60:180;px.set([v,v,v,255],i*4);}
  const a=accentStyle(px,w,h),c=linToOklab(a.color),halo=linToOklab(a.halo);
  assert.ok(Math.hypot(c[1],c[2])>.1);assert.ok(Math.abs(c[0]-halo[0])>.4);
  const dark=new Uint8ClampedArray(w*h*4).fill(20);for(let i=3;i<dark.length;i+=4)dark[i]=255;
  assert.ok(linToOklab(accentStyle(dark,w,h).color)[0]>.7);
});

test('the arrow is short and straight, on the line from the text centre to the box face centre, ending at the box; none when they overlap',()=>{
  const V=(x,y)=>new THREE.Vector2(x,y),rect=(x0,y0,x1,y1)=>[V(x0,y0),V(x1,y0),V(x1,y1),V(x0,y1)];
  const text=rect(400,300,600,360),box=rect(100,100,200,250),aim=V(150,175),tc=V(500,330);
  const r=arrowBetween(text,box,{aim});
  const line=aim.clone().sub(tc).normalize(),off=p=>Math.abs((p.x-tc.x)*line.y-(p.y-tc.y)*line.x);
  assert.ok(off(r.start)<1e-6&&off(r.end)<1e-6);                                // on the centre-to-centre line
  assert.ok(Math.abs(r.length-60)<1e-6);                                         // capped: only the last stretch
  assert.ok(r.end.x>200&&r.end.distanceTo(V(200,aim.y+(200-aim.x)*line.y/line.x))<8);   // just before the box's outline
  for(const b of r.barbs)assert.ok(b.clone().sub(r.end).dot(r.start.clone().sub(r.end))>0);
  assert.equal(arrowBetween(rect(150,200,400,300),box,{aim}),null);
});
