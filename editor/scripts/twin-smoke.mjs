import {chromium} from 'playwright';import {rmSync} from 'node:fs';
// Start from the demo's default composition (the editor autosaves components per scenario).
const resetDemo=()=>{for(const f of ['spaces/demo/scenarios/demo/composition.json','spaces/demo/scenarios/demo/assets'])rmSync(new URL('../'+f,import.meta.url),{recursive:true,force:true});};resetDemo();
import assert from 'node:assert/strict';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
try {
 const p=await b.newPage({viewport:{width:1440,height:1500}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(process.env.TEST_URL || 'http://127.0.0.1:8766/');await p.waitForFunction(()=>window.replay?.ready);
 await p.evaluate(()=>window.replay.at(5.1));
 assert.match(await p.locator('#time').textContent(),/^5\.\d\d s$/);
 const before=await p.locator('#stage').screenshot();
 // Test actual TransformControls object-change event propagation to the composite inputs.
 await p.evaluate(()=>{const r=window.replay;r.anchor.position.set(.3,.8,-1.2);r.twin.gizmo.dispatchEvent({type:'objectChange'});});
 assert.equal(Number(await p.locator('#x').inputValue()),.3);assert.equal(Number(await p.locator('#y').inputValue()),.8);
 assert.notDeepEqual(await p.locator('#stage').screenshot(),before,'Moving the object must change the composite pixels');
 // Default: the 3D view follows the recorded camera. Switching to orbit keeps that exact view (no jump).
 assert.equal(await p.locator('[data-mode=follow]').getAttribute('aria-pressed'),'true');assert.equal(await p.evaluate(()=>window.replay.twin.mode),'follow');
 const followPose=await p.evaluate(()=>{const c=window.replay.twin.camera;return [...c.position.toArray(),...c.getWorldDirection(c.position.clone()).toArray()];});
 await p.locator('[data-mode=orbit]').click();
 const orbitPose=await p.evaluate(()=>{const c=window.replay.twin.camera;return [...c.position.toArray(),...c.getWorldDirection(c.position.clone()).toArray()];});
 assert.ok(followPose.every((v,i)=>Math.abs(v-orbitPose[i])<1e-3),'Orbit starts from the follow view: '+followPose+' vs '+orbitPose);
 // Walk: WASD on the walkable floor, never leaving it.
 await p.locator('[data-mode=walk]').click();
 const walkStart=await p.evaluate(()=>{const t=window.replay.twin,g=t.walkGrid(),c=t.walker.position;return {x:c.x,z:c.z,ok:g.walkable(c.x,c.z)};});assert.ok(walkStart.ok,'Walk starts on walkable floor');
 await p.locator('#time').click();await p.keyboard.down('w');await p.waitForTimeout(700);await p.keyboard.up('w');
 const walked=await p.evaluate(()=>{const t=window.replay.twin,c=t.walker.position;return {x:c.x,z:c.z,ok:t.walkGrid().walkable(c.x,c.z)};});
 assert.ok(Math.hypot(walked.x-walkStart.x,walked.z-walkStart.z)>.2,'W moves forward');assert.ok(walked.ok);
 await p.keyboard.down('a');await p.waitForTimeout(6000);await p.keyboard.up('a');
 assert.ok(await p.evaluate(()=>{const t=window.replay.twin,c=t.walker.position;return t.walkGrid().walkable(c.x,c.z);}),'Walking into a boundary stops at it');
 await p.locator('[data-mode=orbit]').click();
 await p.locator('summary[aria-label="Display options"]').click();
 await p.locator('#debug-trajectory').uncheck();
 assert.equal(await p.evaluate(()=>window.replay.twin.trajectory.visible),false);
 await p.locator('#debug-trajectory').check();
 await p.locator('#debug-frustum').uncheck();
 assert.equal(await p.evaluate(()=>window.replay.twin.frustum.visible),false);
 await p.locator('#debug-frustum').check();
 await p.locator('#debug-video').check();
 assert.equal(await p.evaluate(()=>window.replay.twin.videoPanel.visible),true);
 const first=await p.evaluate(()=>window.replay.camera.position.toArray());
 await p.evaluate(()=>window.replay.at(1));
 assert.notDeepEqual(await p.evaluate(()=>window.replay.camera.position.toArray()),first);
 await p.locator('#reset-view').click();await p.locator('#time').click();
 const saved=await p.evaluate(()=>window.replay.placement());assert.deepEqual(saved.components.find(c=>c.id===saved.selected).position,[.3,.8,-1.2]);
 // Room mesh through the file-input route; the twin draws it, occlusion state round-trips.
 await p.evaluate(async()=>{const THREE=await import('three');const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');const m=new THREE.Mesh(new THREE.PlaneGeometry(2,2).rotateX(-Math.PI/2));const data=await new GLTFExporter().parseAsync(m,{binary:true});await window.replay.loadGLB(new File([data],'test-plane.glb'),true);});
 await p.waitForFunction(()=>window.replay.placement().room==='test-plane.glb');await p.evaluate(([id,on])=>{const c=document.getElementById(id);c.checked=on;c.dispatchEvent(new Event('change'));},['occlude',true]);
 const state=await p.evaluate(()=>window.replay.placement());assert.equal(state.occlude,true);assert.ok(state.roomData.startsWith('data:'));
 await p.evaluate(state=>window.replay.loadPlacement(state),state);
 assert.equal(await p.evaluate(()=>window.replay.placement().room),'test-plane.glb');
 // View modes: follow uses the recorded pose; plan/elevations are orthographic with a section plane that the slider and flip move.
 await p.locator('[data-mode=follow]').click();
 assert.deepEqual(await p.evaluate(()=>{const t=window.replay.twin.camera.position.toArray(),c=window.replay.camera.position.toArray();return t.map((v,i)=>Math.abs(v-c[i])<1e-9);}),[true,true,true]);
 await p.locator('[data-mode=plan]').click();assert.equal(await p.locator('#cut-flip-label').isVisible(),false);assert.equal(await p.locator('[data-mode=plan]').getAttribute('aria-pressed'),'true');
 assert.equal(await p.evaluate(()=>window.replay.twin.camera.isOrthographicCamera),true);assert.equal(await p.locator('#cut-controls').isVisible(),true);
 await p.locator('#cut').fill('0.3');assert.deepEqual(await p.evaluate(()=>[window.replay.twin.clip.normal.y,window.replay.twin.clip.constant]),[-1,.3]);
 await p.locator('[data-mode=elevation-x]').click();await p.locator('#cut').fill('0.1');await p.locator('#cut-flip').check();
 assert.deepEqual(await p.evaluate(()=>[window.replay.twin.clip.normal.x,window.replay.twin.clip.constant]),[1,-.1]);
 await p.locator('[data-mode=orbit]').click();assert.equal(await p.locator('#cut-controls').isVisible(),false);
 assert.deepEqual(errors,[]);await p.screenshot({path:'/tmp/twin-editor-test.png',fullPage:true});
 resetDemo();console.log('PASS: dual view, transform-event propagation, room mesh load/round-trip; synthetic camera path loaded. Debug toggles, preview panel, camera scrubbing, changed composite pixels, follow/plan/elevation views and section planes verified.');
} finally {await b.close();}
