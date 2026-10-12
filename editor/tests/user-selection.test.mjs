import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {selectInfoBox,angleToBox,rayHitsBox,pointingRays,gazeScore,FOVEA} from '../src/user-selection.mjs';

const info=(id,label,center,size=[.2,.2,.2])=>({id,label,info:label.split('/').at(-1),kind:'object',center,size,yaw:0});
const keyOf=b=>b.info;
const view={position:[0,1.6,0],forward:[0,0,-1]};

test('fovea: inside the inner circle selects, the outer ring fades, behind or hidden does not',()=>{
  assert.equal(gazeScore(FOVEA.inner),1);assert.equal(gazeScore(FOVEA.outer),0);
  const ahead=info('a','wifi',[0,1.6,-2]),side=info('b','manual',[Math.tan(THREE.MathUtils.degToRad(14))*2,1.6,-2],[.02,.02,.02]),behind=info('c','router',[0,1.6,2]);
  const r=selectInfoBox({view,boxes:[side,behind,ahead,{...ahead,id:'f',info:undefined}],keyOf});
  assert.equal(r.selected.box_id,'a');assert.equal(r.selected.cues.gaze,1);assert.equal(r.selected.score,.75);
  const s=r.candidates.find(c=>c.box_id==='b');assert.ok(s.cues.gaze>0&&s.cues.gaze<1&&s.score<.5);
  assert.equal(r.candidates.find(c=>c.box_id==='c').score,0);
  assert.equal(selectInfoBox({view,boxes:[ahead],keyOf,visible:()=>false}).selected,null);
});

test('a pointing finger or a touching hand selects a box outside the fovea',()=>{
  const box=info('a','wifi/router',[1.5,1,-1]),hand=(points)=>({status:'ready',hands:[{points}]});
  assert.equal(selectInfoBox({view,boxes:[box],keyOf}).selected,null);
  // Index base (5) to tip (8) aimed at the box, wrist (0) behind: straight and out.
  const pointing=hand([{joint:0,position:[.2,1.2,-.3]},{joint:5,position:[.3,1.2,-.4]},{joint:8,position:[.4,1.18,-.47]}]);
  assert.equal(pointingRays(pointing).length,1);
  const p=selectInfoBox({view,boxes:[box],hands:pointing,keyOf}).selected;assert.equal(p.key,'router');assert.ok(p.cues.point>.9);
  // A curled finger (tip no farther from the wrist than the base) does not point.
  assert.equal(pointingRays(hand([{joint:0,position:[0,1,0]},{joint:5,position:[0,1,-.1]},{joint:8,position:[.05,1,-.05]}])).length,0);
  const t=selectInfoBox({view,boxes:[box],hands:hand([{joint:8,position:[1.45,1,-1]}]),keyOf}).selected;assert.equal(t.cues.touch,1);assert.ok(t.score>=.95);
});

test('ray tests follow the box yaw',()=>{
  const box={center:[0,0,-3],size:[2,.2,.2],yaw:90};
  const o=new THREE.Vector3(0,0,0),slant=new THREE.Vector3(.3,0,-1).normalize();
  assert.equal(rayHitsBox(o,slant,{...box,yaw:0}),true);assert.equal(rayHitsBox(o,slant,box),false);   // turned 90°: long along z, thin in x
  assert.equal(rayHitsBox(o,new THREE.Vector3(.02,0,-1).normalize(),box),true);
  assert.equal(angleToBox(new THREE.Vector3(0,0,0),new THREE.Vector3(0,0,1),box),null);
});

test('several boxes can be selected: the best one is the selection, all are listed with their scores',()=>{
  const a=info('a','wifi',[0,1.6,-2]),b=info('b','router',[.05,1.6,-2.5]),c=info('c','manual',[0,1.6,3]);
  const r=selectInfoBox({view,boxes:[a,b,c],keyOf});
  assert.deepEqual(r.selectedAll.map(x=>x.box_id).sort(),['a','b']);assert.ok(['a','b'].includes(r.selected.box_id));
  assert.equal(r.scores.length,3);assert.equal(r.scores.at(-1).score,0);
});

test('pointing is judged in the image: a finger whose tip is over the box, or aimed at it, points at it; a curled one does not',async()=>{
  const {pointingRays2D,pointScore2D}=await import('../src/user-selection.mjs');
  const V=(x,y)=>new THREE.Vector2(x,y),box=[V(340,180),V(700,180),V(700,680),V(340,680)];
  // atlas_rec_2 frame 431: wrist low left, knuckle, tip already over the poster.
  const lm=(w,b,t)=>{const h=Array.from({length:21},()=>({x:0,y:0}));h[0]={x:w[0]/960,y:w[1]/720};h[5]={x:b[0]/960,y:b[1]/720};h[8]={x:t[0]/960,y:t[1]/720};return [h];};
  const over=pointingRays2D(lm([230,640],[330,560],[440,470]),960,720);assert.equal(over.length,1);assert.equal(pointScore2D(over[0],box),1);
  const aimed=pointingRays2D(lm([60,700],[150,640],[250,575]),960,720);assert.ok(pointScore2D(aimed[0],box)>.9);
  const away=pointingRays2D(lm([300,600],[250,560],[150,500]),960,720);assert.equal(pointScore2D(away[0],box),0);
  assert.equal(pointingRays2D(lm([230,640],[330,560],[300,600]),960,720).length,0);   // curled
});

test('a finger MediaPipe folded (tip landmark below the knuckle) still points when the hand mask reaches out over the box',async()=>{
  const {pointingRays2D,pointScore2D}=await import('../src/user-selection.mjs');
  const V=(x,y)=>new THREE.Vector2(x,y),box=[V(343,176),V(730,176),V(730,710),V(343,710)];
  // atlas_rec_2 frame 431 landmarks: wrist (290,615), knuckle (333,545), tip (371,588); the mask runs on to (440,470).
  const h=Array.from({length:21},()=>({x:0,y:0}));h[0]={x:290/960,y:615/720};h[5]={x:333/960,y:545/720};h[8]={x:371/960,y:588/720};
  const mw=96,mh=72,m=new Uint8Array(mw*mh);for(let t=0;t<=1;t+=.01){const x=290+t*150,y=615-t*145;m[Math.floor(y/10)*mw+Math.floor(x/10)]=255;}
  assert.equal(pointingRays2D([h],960,720).length,0);
  const rays=pointingRays2D([h],960,720,{mask:m,width:mw,height:mh});assert.equal(rays.length,1);assert.equal(pointScore2D(rays[0],box),1);
});
