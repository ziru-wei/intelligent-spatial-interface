// Real browser + local models; deterministic Jev fixture, no model API calls.
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';import assert from 'node:assert/strict';
import {runPipeline} from './jev-pipeline.mjs';
const base='http://127.0.0.1:8879',session='./spaces/home/scenarios/record3d/session.json';
const server=spawn('.venv/bin/python',['scripts/server.py','8879'],{stdio:'ignore',cwd:fileURLToPath(new URL('../',import.meta.url))});let browser,cid;
const api=async(path,body)=>{const url=new URL(path,base);url.searchParams.set('session',session);const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,...body})}:{});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;};
try{
 for(let i=0;i<50;i++){try{await api('/api/spaces');break;}catch{}await new Promise(r=>setTimeout(r,100));}
 cid=(await api('/api/agent/conversations',{name:'FindMy verification'})).id;
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.text().includes('THREE.WebGLProgram'))errors.push(m.text());});
 await p.goto(base+'/?session='+encodeURIComponent(session));await p.waitForFunction(()=>window.replay?.ready,{},{timeout:90000});
 await p.locator('#conv').selectOption(cid);await p.waitForFunction(cid=>window.replay.agent.conversation===cid,cid);
 await p.locator('#findmy-mod').check({force:true});
 assert.equal(await p.locator('#findmy-stability').count(),0);assert.equal(await p.locator('#weather-stability').count(),1);assert.equal(await p.locator('#findmy-remove-on-hand-approach').count(),1);assert.equal(await p.locator('#findmy-hand-approach-distance').count(),1);
 const next=api('/api/agent/questions/next');await p.waitForFunction(()=>!document.getElementById('ask-input').disabled);
 await p.locator('#ask-input').fill('Where is my Brush?');await p.locator('#ask-input').press('Enter');const q=await next;assert.equal(q.findmy_mod,true);
 let textReady;const textPromise=new Promise(r=>textReady=r),parts=[];
 const pipeline=runPipeline({trace:(stage,text)=>{if(stage.endsWith('error')||stage==='text_skipped')console.log(stage,text);},question:q,readContext:groups=>api('/api/agent/context?question_id='+q.id+'&'+(groups.length?'groups='+groups.join(','):'catalog=1')),ask:async(stage,state,questions)=>{
  if(stage==='jev_call_context_read')return Object.fromEntries(Object.keys(questions).map(k=>[k,k==='conversation_reference'?{type:'choice',choice:'standalone',confidence:1,probabilities:{standalone:1}}:{type:'noul',noul:k==='storage'?1:0}]));
  if(stage==='jev_call_mod')return {mod:{type:'choice',choice:'findmy',confidence:1,probabilities:{findmy:1}}};
  return {target:{choice:Object.keys(questions.target.criteria).find(k=>k==='brush'||questions.target.criteria[k]?.item==='Brush')}};
 },answer:()=>textPromise,publish:async part=>parts.push(await api('/api/agent/responses',part))});
 await p.waitForFunction(()=>window.replay.findmyScene.group.visible);
 assert.equal(parts.length,1);assert.equal(parts[0].findmy.target.id,'storage_cabinet_mid1_1');
 textReady({title:'Brush is in cabinet 3',body:'Look for the highlighted cabinet.'});await pipeline;
 await p.waitForFunction(id=>[...window.replay.agent.widgets.values()].some(w=>w.userData.response.component_ids?.includes(id)),parts[1].id);
 assert.equal(await p.evaluate(()=>window.replay.agent.widgets.size),1);
 // Offscreen guide and in-view box using the actual mapped container.
 const guidance=await p.evaluate(async()=>{
  const THREE=await import('three'),r=window.replay,target=[...r.agent.widgets.values()][0].userData.response.findmy.target;
  const cam=new THREE.PerspectiveCamera(55,1,.01,100);cam.position.fromArray(target.center).add(new THREE.Vector3(0,0,2));cam.lookAt(new THREE.Vector3(...target.center));r.findmyScene.render(r.renderer,cam);const front=r.findmyScene.arrow.visible;cam.rotation.y+=Math.PI;cam.updateMatrixWorld();r.findmyScene.render(r.renderer,cam);return {front,behind:r.findmyScene.arrow.visible};
 });assert.deepEqual(guidance,{front:false,behind:true});
 // Any virtual geometry, HUD, or FindMy is composited before the shared hand pass.
 const pixels=await p.evaluate(async()=>{
  const THREE=await import('three'),{createHandCompositor}=await import('./src/hand-perception/compositor.mjs'),{createFindMy}=await import('./src/findmy.mjs');
  const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const source=document.createElement('canvas');source.width=source.height=64;const c=source.getContext('2d');c.fillStyle='#145082';c.fillRect(0,0,64,64);const rgb=new THREE.CanvasTexture(source);rgb.colorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();scene.background=new THREE.Color('red');const camera=new THREE.PerspectiveCamera(60,1,.01,20);
  // Solid wall fully hides box in ordinary depth rendering.
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial({color:'red'})));scene.children[0].position.z=-1;
  renderer.render(scene,camera);const mod=createFindMy();mod.setResponse({findmy:{status:'found',target:{center:[0,0,-3],size:[2,2,1]}}});mod.render(renderer,camera);
  const mask=new Uint8Array(64*64);for(let y=0;y<32;y++)for(let x=0;x<32;x++)mask[y*64+x]=255;
  const pass=createHandCompositor();pass.render(renderer,rgb,{status:'ready',width:64,height:64,mask});
  const gl=renderer.getContext(),sample=(x,y)=>{const out=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);return [...out];};
  const result={hand:sample(24,40),effect:sample(40,24),background:sample(1,1)};
  pass.render(renderer,rgb,{status:'error'});result.failure=sample(40,24);
  pass.dispose();mod.dispose();rgb.dispose();scene.children[0].geometry.dispose();scene.children[0].material.dispose();renderer.dispose();return result;
 });assert.deepEqual(pixels.hand,[20,80,130,255]);assert.ok(pixels.effect[1]>10&&pixels.effect[2]>10,'FindMy must remain visible through furniture');assert.deepEqual(pixels.background,[255,0,0,255]);assert.deepEqual(pixels.failure,[20,80,130,255]);
 const perception=await p.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const result=await window.replay.handPerception.request('blank-fixture',canvas);return {status:result.status,hands:result.landmarks?.length,area:result.mask?.reduce((n,v)=>n+(v>0),0),error:result.error};});assert.equal(perception.status,'ready',perception.error);assert.equal(perception.hands,0);assert.equal(perception.area,0);
 if(process.env.TEST_HAND_PHOTO){const positive=await p.evaluate(async()=>{const image=new Image();image.crossOrigin='anonymous';image.src='https://storage.googleapis.com/mediapipe-tasks/hand_landmarker/woman_hands.jpg';await image.decode();const r=await window.replay.handPerception.request('official-hand-fixture',image);return {status:r.status,error:r.error,hands:r.landmarks?.length,area:r.mask?.reduce((n,v)=>n+(v>0),0),ms:r.elapsed_ms};});assert.equal(positive.status,'ready',positive.error);assert.ok(positive.hands>0);assert.ok(positive.area>100);console.log('Official hand photo:',positive);}
 // Controlled hand/depth frames exercise the actual app integration without modifying recording files.
 await p.locator('#findmy-remove-on-hand-approach').check({force:true});
 const approach=await p.evaluate(async()=>{
  const r=window.replay,target=[...r.agent.widgets.values()][0].userData.response.findmy.target,k=r.session.intrinsics;
  const saved=r.handPerception.request,poses=[1,2].map(i=>({i,position:r.session.frames[i].position,quaternion:r.session.frames[i].quaternion}));
  const copies=[];r.handPerception.request=async key=>({key,status:'ready',width:16,height:16,mask:new Uint8Array(256).fill(255),landmarks:[Array.from({length:21},()=>({x:k.cx/k.width,y:k.cy/k.height}))]});
  try{
   for(const i of [1,2]){const distance=i===1?.35:.17;r.session.frames[i].position=[target.center[0],target.center[1],target.center[2]+target.size[2]/2+distance+1];r.session.frames[i].quaternion=[0,0,0,1];const tx=await r.depthMap(i);copies.push({tx,data:tx.image.data.slice()});tx.image.data.fill(1);tx.needsUpdate=true;}
   await r.setFrame(1);const first=r.findmyScene.group.visible;await r.setFrame(2);const removed=!r.findmyScene.group.visible,textVisible=[...r.agent.widgets.values()].some(w=>w.visible&&w.userData.response.body);
   const status=document.getElementById('findmy-status').textContent;await r.setFrame(0);return {first,removed,textVisible:!!textVisible,rewound:r.findmyScene.group.visible,status};
  }finally{r.handPerception.request=saved;for(const p of poses)Object.assign(r.session.frames[p.i],{position:p.position,quaternion:p.quaternion});for(const c of copies){c.tx.image.data.set(c.data);c.tx.needsUpdate=true;}await r.setFrame(0);}
 });
 assert.equal(approach.first,true);assert.equal(approach.removed,true);assert.equal(approach.textVisible,true);assert.equal(approach.rewound,true);assert.match(approach.status,/Effect removed/);
 assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('spatial-take:response-settings')).mods.findmy.options.removeOnHandApproach),true);
 await p.locator('#findmy-remove-on-hand-approach').uncheck({force:true});
 await p.locator('#findmy-mod').uncheck({force:true});await p.waitForFunction(()=>!window.replay.findmyScene.group.visible);
 assert.deepEqual(errors,[]);await p.screenshot({path:'/tmp/findmy-hand-smoke.png'});
 console.log('PASS: Jev fixture → canonical Brush box; progressive shared container; front/behind arrows; furniture-transparent highlight; global pixel-exact hand restoration; real local hand model; mod-specific controls and approach removal/replay.');
}finally{if(cid)await api('/api/agent/conversations/delete',{conversation:cid}).catch(()=>{});await browser?.close();server.kill();}
