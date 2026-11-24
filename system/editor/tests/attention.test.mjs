import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAttention,EFFECTS} from '../src/attention.mjs';

const draw=(o,m)=>{o.onBeforeRender(null,null,null,o.geometry,m);const seen={opacity:m.opacity,sat:m.userData.attSat?.value??1};o.onAfterRender(null,null,null,o.geometry,m);return seen;};

test('a background part is drawn fainter and greyer, eased in; its renderer never sees the change', ()=>{
  const m=new THREE.MeshBasicMaterial({color:0x3ff0ff,transparent:true,opacity:.8}),o=new THREE.Mesh(new THREE.PlaneGeometry(),m),root=new THREE.Group();root.add(o);
  const a=createAttention({ms:400});
  a.set(root,'focus',0);assert.deepEqual(draw(o,m),{opacity:.8,sat:1});
  a.set(root,'background',200);const half=draw(o,m);assert.ok(half.opacity<.8&&half.opacity>.8*EFFECTS.background.opacity,'halfway');assert.ok(a.easing);
  a.set(root,'background',400);const bg=draw(o,m);
  assert.ok(Math.abs(bg.opacity-.8*EFFECTS.background.opacity)<1e-9);assert.ok(Math.abs(bg.sat-EFFECTS.background.saturation)<1e-9);
  assert.equal(m.opacity,.8);                                  // put back after drawing: the renderer reads its own value
  m.opacity=.5;a.set(root,'background',500);assert.ok(Math.abs(draw(o,m).opacity-.5*EFFECTS.background.opacity)<1e-9);   // its own changes still count
  const n=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial());root.add(n);a.set(root,'background',600);
  assert.ok(draw(n,n.material).opacity<1);                     // a part made since takes it too
  assert.ok(Math.abs(a.scaleOf(root)-EFFECTS.background.scale)<1e-9);   // smaller on the view stack
  a.set(root,'focus',1050);assert.equal(draw(o,m).opacity,.5);  // back in focus
  assert.equal(a.scaleOf(root),1);assert.equal(a.scaleOf(new THREE.Group()),1);
});
