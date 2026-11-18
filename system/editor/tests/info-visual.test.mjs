import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {faceToward,arrowBetween,infoFacts} from '../src/info-visual.mjs';
import {partsToDraw} from '../modos/ui-rules.mjs';
import {readFileSync} from 'node:fs';

test('the face toward the viewer follows the box yaw',()=>{
  const box={center:[0,1,-2],size:[.4,.2,.1],yaw:90},eye=new THREE.Vector3(2,1,-2);
  const f=faceToward(box,eye);
  // Turned 90°: the box's local x points to world -z, its z to world +x (toward the eye).
  assert.ok(f.normal.distanceTo(new THREE.Vector3(1,0,0))<1e-9);assert.ok(Math.abs(f.center.x-.05)<1e-9);
});

test('an info answer\'s Mark is the one WorldInfo declares: Corner Brackets on content, else Breathing Box; none when the thing speaks',()=>{
  const ui=JSON.parse(readFileSync(new URL('../modos/mods/worldinfo.json',import.meta.url))).slots.find(s=>s.id==='answer').ui;
  const marks=f=>partsToDraw(ui,f).filter(p=>['cornerBrackets','breathingBox'].includes(p));
  assert.deepEqual(marks(infoFacts({info:{has_content:true}})),['cornerBrackets']);
  assert.deepEqual(marks(infoFacts({info:{}})),['breathingBox']);
  assert.deepEqual(marks({...infoFacts({info:{has_content:true}}),'target.pointed':true,'request.second_person':true}),[]);
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
