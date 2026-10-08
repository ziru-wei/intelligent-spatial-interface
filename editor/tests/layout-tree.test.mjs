import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {path,parentLabel,resolveParents,arrange,toLocal,toWorld,contains} from '../src/layout-tree.mjs';
const close=(a,b,e=1e-3)=>a.every((v,i)=>Math.abs(v-b[i])<e);

test('label paths and parents',()=>{assert.deepEqual(path(' fridge / shelf 1 '),['fridge','shelf 1']);assert.equal(parentLabel('a/b/c'),'a/b');assert.equal(parentLabel('a'),null);});
test('local axes match three.js rotation.y',()=>{const box={center:[1,2,3],size:[1,1,1],yaw:90};const o=new THREE.Object3D();o.position.set(1,2,3);o.rotation.y=Math.PI/2;o.updateMatrixWorld();
  const w=new THREE.Vector3(.3,.1,-.2).applyMatrix4(o.matrixWorld).toArray();assert.ok(close(toWorld(box,[.3,.1,-.2]),w));assert.ok(close(toLocal(box,w),[.3,.1,-.2]));});
test('a shared parent label resolves to the box that contains the child',()=>{
  const A={id:'a',label:'cabinet',center:[0,1,0],size:[.4,.6,.4],yaw:0},B={id:'b',label:'cabinet',center:[2,1,0],size:[.4,.6,.4],yaw:0},k={id:'k',label:'cabinet/shelf',center:[2.05,1.1,0],size:[.3,.1,.3],yaw:0};
  assert.equal(resolveParents([A,B,k]).get('k'),B);assert.equal(resolveParents([A,B]).size,0);});
test('arrange: same yaw, centred, equal gaps, order kept',()=>{
  const P={id:'p',label:'fridge',center:[1,.5,-2],size:[.8,1,.5],yaw:90};
  const kids=[{id:'top',center:[1.03,.8,-2.02],size:[.7,.2,.4],yaw:90},{id:'mid',center:[.98,.55,-2],size:[.7,.2,.4],yaw:90},{id:'low',center:[1,.2,-1.99],size:[.4,.3,.7],yaw:0}];
  const r=Object.fromEntries(arrange(P,kids).map(x=>[x.id,x]));
  for(const x of Object.values(r)){assert.equal(x.yaw,90);const l=toLocal(P,x.center);assert.ok(Math.abs(l[0])<1e-3&&Math.abs(l[2])<1e-3);assert.ok(contains(P,x.center,0));}
  assert.deepEqual(r.low.size,[.7,.3,.4]);   // turned 90° from the parent: width and depth swapped
  const gap=(1-.7)/4,top=y=>r[y].center[1]+r[y].size[1]/2,bottom=y=>r[y].center[1]-r[y].size[1]/2;
  assert.ok(Math.abs((1-top('top'))-gap)<1e-3&&Math.abs(bottom('top')-top('mid')-gap)<1e-3&&Math.abs(bottom('mid')-top('low')-gap)<1e-3&&Math.abs(bottom('low')-gap)<1e-3);});
test('arrange: too thick children are scaled to fit; side by side children stack along x',()=>{
  const P={id:'p',center:[0,1,0],size:[1,.4,.4],yaw:0},kids=[{id:'l',center:[-.3,1,0],size:[.6,.3,.3],yaw:0},{id:'r',center:[.3,1,0],size:[.6,.3,.3],yaw:0}];
  const r=arrange(P,kids);assert.deepEqual(r.map(x=>x.id),['r','l']);assert.ok(close(r.map(x=>x.size[0]),[.5,.5]));assert.ok(close(r.map(x=>x.center[0]),[.25,-.25]));});
test('outline: zones in order, hand-added zones first, nested boxes under their parent sorted top-down',async()=>{
  const {outline,roomOf}=await import('../src/layout-tree.mjs');
  const rooms=[{id:'hall',name:'Hall',triangles:[[[0,0],[4,0],[4,4]],[[0,0],[4,4],[0,4]]]},{id:'nook',name:'Nook',kind:'zone',triangles:[[[3,3],[4,3],[4,4]],[[3,3],[4,4],[3,4]]]}];
  assert.equal(roomOf(rooms,[3.5,0,3.5]),'nook');assert.equal(roomOf(rooms,[1,0,1]),'hall');assert.equal(roomOf(rooms,[9,0,9]),null);
  const boxes=[{id:'f',label:'fridge',center:[1,.5,1],size:[.8,1,.6],yaw:0},{id:'l',label:'fridge/low',center:[1,.2,1],size:[.7,.2,.5],yaw:0},{id:'h',label:'fridge/high',center:[1,.8,1],size:[.7,.2,.5],yaw:0},
    {id:'w',label:'washer',center:[3.5,.4,3.5],size:[.6,.8,.6],yaw:0},{id:'x',label:'lost',center:[9,0,9],size:[.1,.1,.1],yaw:0}];
  const t=outline(boxes,rooms);assert.deepEqual(t.map(g=>g.zone.name),['Hall','Nook','No zone']);
  assert.deepEqual(t[0].nodes.map(n=>n.box.id),['f']);assert.deepEqual(t[0].nodes[0].children.map(n=>n.box.id),['h','l']);assert.deepEqual(t[1].nodes.map(n=>n.box.id),['w']);});
test('repeated names are numbered in zone order then along x; children follow their parent',async()=>{
  const {numberDuplicates}=await import('../src/layout-tree.mjs');
  const rooms=[{id:'a',triangles:[[[0,0],[4,0],[4,4]],[[0,0],[4,4],[0,4]]]},{id:'b',triangles:[[[4,0],[8,0],[8,4]],[[4,0],[8,4],[4,4]]]}];
  const box=(id,label,x,size=[.4,.6,.4])=>({id,label,center:[x,.5,1],size,yaw:0});
  const boxes=[box('c1','cabinet',5),box('c2','cabinet',1),box('c3','Cabinet 7',2),box('k','cabinet/layer1',5,[.3,.1,.3]),box('t','table',3)];
  assert.deepEqual(numberDuplicates(boxes,rooms),{c2:'cabinet 1',c3:'Cabinet 2',c1:'cabinet 3',k:'cabinet 3/layer1'});
  assert.deepEqual(numberDuplicates([box('t','table',1)],rooms),{});});
