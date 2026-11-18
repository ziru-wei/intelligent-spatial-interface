import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {TEXT_VIEW,textViewMetrics,viewSizedWidth} from '../src/text-view.mjs';import {place as placeText} from '../src/placement.mjs';
// Surface placement itself: an answer whose declaration has only Embedded Text (no float), so a missing surface stays unreadable.
const EMBEDDED={fixed:['embeddedText']},place=(r,ctx)=>placeText({text_ui:EMBEDDED,...r},ctx);
const metrics={xHeightRatio:35/1024,box:{x0:.06,x1:.94,y0:.1,y1:.9}},viewport={width:540,height:720};
const camera=()=>{const c=new THREE.PerspectiveCamera(60,.75,.02,100);c.updateMatrixWorld(true);return c;};
test('world size grows with distance while recorded-view glyph pixels stay constant',()=>{
 const c=camera();let previous=0;
 for(const distance of [.25,1,4,9]){const position=new THREE.Vector3(0,0,-distance),q=new THREE.Quaternion(),width=viewSizedWidth(position,q,c,viewport,metrics);
  assert.ok(width>previous);previous=width;const m=textViewMetrics({position,quaternion:q,width,height:width*.4},c,viewport,metrics);assert.ok(Math.abs(m.minPx-TEXT_VIEW.targetPx)<.001);assert.equal(m.readable,true);}
});
test('video CSS size and foreshortening are measured, not source-image resolution',()=>{
 const c=camera(),p={position:new THREE.Vector3(0,0,-2),quaternion:new THREE.Quaternion(),width:1,height:.4};
 const large=textViewMetrics(p,c,viewport,metrics),small=textViewMetrics(p,c,{width:270,height:360},metrics);assert.ok(Math.abs(small.minPx-large.minPx/2)<1e-8);
 p.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),1.2);assert.ok(textViewMetrics(p,c,viewport,metrics).minPx<large.minPx*.6);
});
// One layout face 2 m ahead (a cabinet's front, z = -2), and the person facing it (relation B). Tests that change the surfaces name the
// relation's surface in ctx.relationSurface. ctx.searches counts full searches (each asks for the relation).
const surfaceContext=()=>{
 const c=camera(),frame={position:[0,0,0],quaternion:[0,0,0,1]};
 const ctx={frames:[frame],frameCamera:()=>c,viewport:()=>viewport,visible:async(_,points)=>points.map(()=>true),searches:0,relationSurface:'wall:front',
  getStaticSurfaces:()=>wallTargets,relationAt:()=>{ctx.searches++;return ctx.relationSurface&&{relation:'B',surfaceId:ctx.relationSurface,distance:2};}};
 return ctx;
};
let wallTargets=[];
test('setup: layout targets',async()=>{const {buildWeatherTargets}=await import('../src/weather-scene.mjs');wallTargets=buildWeatherTargets({objects:[{id:'wall',center:[0,0,-2.1],size:[4,3,.2]}]});});
test('screen-readable text goes on the surface the person relates to, with only a small normal lift',async()=>{
 const pose=await place({frame:0,aspect:.4,textMetrics:metrics},surfaceContext());
 assert.equal(pose.unreadable,undefined);assert.equal(pose.kind,'plane');assert.equal(pose.surfaceId,'wall:front');assert.equal(pose.relation,'B');assert.ok(Math.abs(pose.position.z+2)<=.04);assert.ok(pose.viewMetrics.minPx>=TEXT_VIEW.minPx&&pose.viewMetrics.maxPx<=TEXT_VIEW.maxPx);
});
test('no relation: no surface pose for embedded-only text; the default text form floats instead',async()=>{
 const ctx=surfaceContext();ctx.relationSurface=null;
 const pose=await place({frame:0,aspect:.4,textMetrics:metrics},ctx);assert.equal(pose.unreadable,true);assert.equal(pose.kind,'unavailable');
 const float=await placeText({frame:0,aspect:.4,textMetrics:metrics},ctx);assert.equal(float.kind,'view-float');assert.equal(float.viewFixed,true);
});
test('blocked surfaces do not become a floating eye-facing panel',async()=>{
 const ctx=surfaceContext();ctx.visible=async(_,pts)=>pts.map(()=>false);
 const pose=await place({frame:0,aspect:.4,textMetrics:metrics},ctx);
 assert.equal(pose.unreadable,true);assert.equal(pose.kind,'unavailable');
});

test('Floating Text is fixed to the camera: centred, its bottom edge just above the caption, leaning back; it stays a float',async()=>{
 const {FLOAT_VIEW}=await import('../src/placement.mjs');
 const ctx=surfaceContext();const visible=ctx.visible;ctx.visible=async(_,pts)=>pts.map(()=>false);
 const response={frame:0,aspect:.4,textMetrics:metrics};
 const float=await placeText(response,ctx);assert.equal(float.kind,'view-float');assert.equal(float.align,'bottom');assert.equal(float.viewFixed,true);
 assert.ok(float.viewMetrics.minPx>=.85*TEXT_VIEW.targetPx,`readable: ${float.viewMetrics.minPx}`);   // view-sized at its edge; leaning back makes its far lines a little smaller
 // no caption showing: the ink's bottom at FLOAT_VIEW.bottom (the panel's padding hangs below it)
 const c0=camera(),ink=float.position.clone().addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(float.quaternion),(1-metrics.box.y1)*float.width*.4).project(c0);
 assert.ok(Math.abs(ink.x)<1e-6&&Math.abs(ink.y-FLOAT_VIEW.bottom)<1e-3,`ink bottom at ${ink.x},${ink.y}`);
 // a caption showing: just above its top
 const capped=await placeText(response,{...ctx,captionTop:()=>-.8}),i2=capped.position.clone().addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(capped.quaternion),(1-metrics.box.y1)*capped.width*.4).project(c0);
 assert.ok(Math.abs(i2.y-(-.8+FLOAT_VIEW.gap))<1e-3,`above the caption: ${i2.y}`);
 // it leans back: its normal turns up from the view's backward axis by FLOAT_VIEW.lean
 const n=new THREE.Vector3(0,0,1).applyQuaternion(float.quaternion);assert.ok(Math.abs(THREE.MathUtils.radToDeg(Math.asin(n.y))-FLOAT_VIEW.lean)<1e-6);
 // once shown it stays a float, even when a surface fits again; and it follows the camera
 ctx.visible=visible;const c=camera();c.position.set(3,2,1);c.rotation.y=Math.PI;c.updateMatrixWorld(true);ctx.frameCamera=()=>c;
 const moved=await placeText({...response,previousPose:float},ctx);assert.equal(moved.kind,'view-float');
 const v=moved.position.clone().project(c);assert.ok(Math.abs(v.x)<1e-6&&v.y<FLOAT_VIEW.bottom+.01);   // it follows the camera
});

test('a valid existing anchor skips the search but rechecks current depth and full footprint',async()=>{
 const ctx=surfaceContext(),response={frame:0,aspect:.4,textMetrics:metrics};
 const pose=await place(response,ctx);let checks=0;ctx.searches=0;ctx.visible=async(_,points)=>{checks+=points.length;return points.map(()=>true);};
 const reused=await place({...response,previousPose:pose},ctx);
 assert.equal(reused.reusedSurface,true);assert.equal(ctx.searches,0);assert.ok(checks>=45);
 ctx.visible=async(_,points)=>points.map(()=>false);
 assert.equal((await place({...response,previousPose:pose},ctx)).unreadable,true);assert.ok(ctx.searches>0);
});

test('reserved streamed text keeps a readable off-centre anchor, but releases it when occluded',async()=>{
 const ctx=surfaceContext(),response={frame:0,aspect:.4,textMetrics:metrics,reserve_text:true};
 const pose=await place(response,ctx);pose.position.x+=.5;pose.surfaceAnchor.x+=.5;
 assert.ok(Math.abs(pose.surfaceAnchor.clone().project(ctx.frameCamera()).x)>.55);
 ctx.searches=0;
 const kept=await place({...response,previousPose:pose},ctx);assert.equal(kept.reusedSurface,true);assert.ok(kept.position.equals(pose.position));assert.equal(ctx.searches,0);
 ctx.visible=async(_,points)=>points.map(()=>false);
 assert.equal((await place({...response,previousPose:pose},ctx)).unreadable,true);assert.ok(ctx.searches>0);
});

test('deferred full search does not search surfaces or expose an uncertified pose',async()=>{
 const c=camera();let probes=0;
 const pose=await place({frame:0,aspect:.4,textMetrics:metrics,allowSearch:false},{frameCamera:()=>c,viewport:()=>viewport,relationAt:()=>{probes++;throw Error('Unbudgeted search');}});
 assert.equal(probes,0);assert.equal(pose.unreadable,true);
});


test('high stability preserves the exact anchor through a transient loss, then releases after 0.8 seconds',async()=>{
 const ctx=surfaceContext(),response={frame:0,aspect:.4,textMetrics:metrics},pose=await place(response,ctx),state={};
 ctx.getSettings=()=>({stability:1});ctx.frames=Array.from({length:40},(_,i)=>({t:i/30}));
 ctx.visible=async(_,points)=>points.map(()=>false);
 for(const frame of [0,6,15,23]){const kept=await place({...response,frame,previousPose:pose,anchorState:state,allowSearch:false},ctx);assert.equal(kept.reusedSurface,true);assert.ok(kept.position.equals(pose.position));assert.ok(kept.quaternion.equals(pose.quaternion));assert.equal(kept.width,pose.width);}
 assert.equal((await place({...response,frame:25,previousPose:pose,anchorState:state,allowSearch:false},ctx)).unreadable,true);
 ctx.visible=async(_,points)=>points.map(()=>true);
 const recovered=await place({...response,frame:26,previousPose:pose,anchorState:state,allowSearch:false},ctx);assert.equal(recovered.reusedSurface,true);assert.equal(state.badSince,null);
});

test('small environment overlap and noisy surface samples cannot move a readable anchor',async()=>{
 const ctx=surfaceContext(),response={frame:0,aspect:.4,textMetrics:metrics},pose=await place(response,ctx);
 ctx.relationAt=()=>{throw Error('Retained anchors must not search again');};
 ctx.visible=async(_,points)=>points.map((_,i)=>i%10!==0);
 const kept=await place({...response,previousPose:pose},ctx);
 assert.equal(kept.reusedSurface,true);assert.ok(kept.position.equals(pose.position));assert.ok(kept.quaternion.equals(pose.quaternion));
});

test('the relation names a furniture face; the text respects its boundary',async()=>{
 const ctx=surfaceContext(),response={frame:0,aspect:.4,textMetrics:metrics};
 const {buildWeatherTargets}=await import('../src/weather-scene.mjs');
 ctx.getStaticSurfaces=()=>buildWeatherTargets({objects:[{id:'cabinet',center:[0,0,-2.1],size:[3,2,.2]}]});ctx.relationSurface='cabinet:front';
 const pose=await place(response,ctx);assert.equal(pose.source,'parametric-layout');assert.equal(pose.surfaceId,'cabinet:front');assert.ok(Math.abs(pose.position.z+1.982)<.001);assert.equal(pose.viewMetrics.inView,true);
});

test('small surface overhang is allowed but a mostly unsupported panel is rejected',async()=>{
 const {surfaceSupports}=await import('../src/text-surfaces.mjs');
 const t={origin:new THREE.Vector3(0,0,-2),right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0),width:1,height:1};
 const p={position:t.origin.clone(),surfaceAnchor:t.origin.clone(),quaternion:new THREE.Quaternion(),width:1.12};
 assert.equal(surfaceSupports(t,p,.4),true);p.width=1.8;assert.equal(surfaceSupports(t,p,.4),false);
});

test('stability searches the previous surface before a more central different surface',async()=>{
 const {staticTextPlacement}=await import('../src/text-surfaces.mjs');const {readableSurfaceBasis}=await import('../src/placement.mjs');
 const ctx=surfaceContext(),{buildWeatherTargets}=await import('../src/weather-scene.mjs');
 const targets=buildWeatherTargets({objects:[{id:'old',center:[.45,0,-2.1],size:[1.3,2,.2]},{id:'new',center:[0,0,-1.9],size:[1.3,2,.2]}]});
 ctx.getStaticSurfaces=()=>targets;ctx.getSettings=()=>({stability:1});
 const old=targets.find(t=>t.id==='old:front'),previous={surfaceId:old.id,surfaceAnchor:old.origin.clone(),width:.4};
 const r={frame:0,aspect:.4,textMetrics:metrics,previousPose:previous};
 assert.equal((await staticTextPlacement(r,ctx,readableSurfaceBasis)).surfaceId,old.id);
 ctx.visible=async(_,pts)=>pts.map(p=>p.z>-1.9);
 assert.equal((await staticTextPlacement(r,ctx,readableSurfaceBasis)).surfaceId,'new:front');
});

test('clutter relocation keeps font size even when quality alternately rewards huge and tiny panels',async()=>{
 const ctx=surfaceContext(),{buildWeatherTargets}=await import('../src/weather-scene.mjs');
 ctx.getStaticSurfaces=()=>buildWeatherTargets({objects:[{id:'desk',center:[0,0,-2.1],size:[3,2,.2]}]});ctx.relationSurface='desk:front';
 ctx.getSettings=()=>({stability:0});ctx.frames=Array.from({length:6},(_,i)=>({t:i/30}));
 let pose=await place({frame:0,aspect:.4,textMetrics:metrics},ctx);const width=pose.width;
 // Keep every candidate crowded to force repeated searches; invert scale preference.
 for(let frame=1;frame<6;frame++){
  ctx.getSurfaceQuality=async()=>p=>({cost:4+(frame%2?p.width:1/p.width)});
  pose=await place({frame,aspect:.4,textMetrics:metrics,previousPose:pose},ctx);
  assert.ok(!pose.unreadable);assert.ok(Math.abs(pose.width-width)<1e-10);
 }
});

test('size reacquisition cannot jump between widely separated scale candidates',async()=>{
 const {staticTextPlacement}=await import('../src/text-surfaces.mjs'),{readableSurfaceBasis}=await import('../src/placement.mjs');
 const ctx=surfaceContext(),{buildWeatherTargets}=await import('../src/weather-scene.mjs');
 ctx.getStaticSurfaces=()=>buildWeatherTargets({objects:[{id:'wall',center:[0,0,-2.1],size:[3,2,.2]}]});
 const response={frame:0,aspect:.4,textMetrics:metrics};
 const first=await staticTextPlacement(response,ctx,readableSurfaceBasis);
 for(const factor of [.65,1.4]){
  const previous={...first,width:first.width*factor};
  ctx.getSurfaceQuality=async()=>p=>({cost:100/(p.width+.01)});
  const next=await staticTextPlacement({...response,previousPose:previous},ctx,readableSurfaceBasis);
  assert.ok(next);assert.ok(next.width<=previous.width*1.15+1e-10);assert.ok(next.width>=previous.width*.85-1e-10);
 }
});

test('a closer clean surface cannot abruptly magnify an otherwise readable response',async()=>{
 const ctx=surfaceContext(),{buildWeatherTargets}=await import('../src/weather-scene.mjs');
 const far=buildWeatherTargets({objects:[{id:'far',center:[0,0,-2.1],size:[3,2,.2]}]});
 ctx.getStaticSurfaces=()=>far;ctx.relationSurface='far:front';ctx.getSettings=()=>({stability:0});
 const response={frame:0,aspect:.4,textMetrics:metrics},first=await place(response,ctx);
 const near=buildWeatherTargets({objects:[{id:'near',center:[0,0,-1.1],size:[2,2,.2]}]});
 ctx.getStaticSurfaces=()=>[...far,...near];ctx.relationSurface='near:front';ctx.getSurfaceQuality=async()=>p=>({cost:p.surfaceId?.startsWith('near')?0:3});
 const next=await place({...response,previousPose:first},ctx);
 const a=textViewMetrics({...first,height:first.width*.4},ctx.frameCamera(),viewport,metrics);
 const b=textViewMetrics({...next,height:next.width*.4},ctx.frameCamera(),viewport,metrics);
 assert.ok(!next.unreadable);assert.ok(b.maxPx<=a.maxPx*1.15+1e-8);
});
