import {chromium} from 'playwright';import assert from 'node:assert/strict';import {rmSync,readFileSync,existsSync} from 'node:fs';
// Components: library and imported .glb, animation on the scenario clock, time span, parameters, interaction, autosave per scenario.
const dir=new URL('../spaces/demo/scenarios/demo/',import.meta.url),reset=()=>{for(const f of ['composition.json','assets'])rmSync(new URL(f,dir),{recursive:true,force:true});};reset();
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
try{const p=await b.newPage({viewport:{width:1280,height:950}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:8766');await p.waitForFunction(()=>window.replay?.ready);
  // Default: the calibration cube, half the old size (22.5 cm), from the library.
  assert.deepEqual(await p.evaluate(()=>window.replay.components.specs().map(s=>[s.component,s.params.size])),[['calibration-cube',.225]]);
  // The panel neither adds components nor edits time spans or parameters: those come from the library and composition.json.
  for(const id of ['#from','#component-params','#add-menu','#model','#room'])assert.equal(await p.locator(id).count(),0,id);
  const names=await p.evaluate(()=>[...window.replay.components.library.values()].map(m=>m.name));assert.ok(names.includes('Calibration cube')&&names.includes('Pulse marker'),names);
  // Parameters rebuild or update the component.
  await p.evaluate(async()=>{const r=window.replay;await r.components.setParams(r.selected,{size:.5});});
  assert.ok(Math.abs(await p.evaluate(async()=>{const THREE=await import('three');return new THREE.Box3().setFromObject(window.replay.anchor).getSize(new THREE.Vector3()).y;})-.5)<.01);
  // An imported .glb with an animation (y from 0 to 1 over 2 s) follows the scenario clock and appears only from its start time.
  await p.evaluate(async()=>{const THREE=await import('three');const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
    const m=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshStandardMaterial());m.name='mover';const clip=new THREE.AnimationClip('up',2,[new THREE.VectorKeyframeTrack('mover.position',[0,2],[0,0,0,0,1,0])]);
    const data=await new GLTFExporter().parseAsync(m,{binary:true,animations:[clip]});await window.replay.loadGLB(new File([data],'mover.glb'),false);});
  await p.waitForFunction(()=>{const r=window.replay;return r.components.get(r.selected)?.spec.name==='mover.glb';});
  // Time spans are set in the spec (not in the panel).
  await p.evaluate(()=>{const r=window.replay;r.components.get(r.selected).spec.start=1;r.select(r.selected);});
  // Visibility and the handles follow at the next paint (requestAnimationFrame).
  const frame=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const moverY=async t=>p.evaluate(async t=>{const r=window.replay;await r.at(t);await new Promise(f=>requestAnimationFrame(()=>requestAnimationFrame(f)));const i=r.components.get(r.selected),m=i.root.getObjectByName('mover');return {visible:i.root.visible,y:m.position.y};},t);
  assert.equal((await moverY(.5)).visible,false,'hidden before its start');
  const a=await moverY(2),c=await moverY(2);assert.ok(a.visible&&Math.abs(a.y-.5)<.02&&a.y===c.y,'1 s into its animation: halfway, the same every time '+JSON.stringify(a));
  // Interactive: a click on the pulse marker in the video selects it (while editing objects) and reaches its onPointer.
  await p.locator('#objects-edit').click();
  await p.evaluate(()=>window.replay.at(0));
  await p.evaluate(async()=>{const r=window.replay;const i=await r.addComponent({component:'pulse-marker',position:[.8,0,-2.5]});});
  const pt=await p.evaluate(async()=>{const THREE=await import('three');const v=new THREE.Vector3(.8,0,-2.5).project(window.replay.camera);return [(v.x+1)/2,(1-v.y)/2];});
  await p.evaluate(()=>window.replay.select(window.replay.components.instances[0].spec.id));
  const box=await p.locator('#stage').boundingBox();await p.locator('#stage').click({position:{x:pt[0]*box.width,y:pt[1]*box.height}});
  assert.equal(await p.evaluate(()=>{const r=window.replay;return [r.components.get(r.selected).spec.component,r.components.get(r.selected).runtime.active].join();}),'pulse-marker,true');
  // The move gizmo only on a selected, showing component.
  const gizmo=async()=>{await frame();return p.evaluate(()=>{const r=window.replay;return r.twin.gizmo.object===r.anchor&&!!r.twin.gizmo.object;});};assert.equal(await gizmo(),true);
  const eyeOfSelected=()=>p.evaluate(()=>document.querySelector('#object-library li[aria-current=true] .eye input').click());
  await eyeOfSelected();assert.equal(await gizmo(),false,'hidden: no gizmo');
  await eyeOfSelected();assert.equal(await gizmo(),true);
  await p.evaluate(()=>window.replay.select(null));await frame();assert.equal(await p.evaluate(()=>new Promise(f=>requestAnimationFrame(()=>requestAnimationFrame(()=>f(!!window.replay.twin.gizmo.object))))),false,'nothing selected: no gizmo');
  await p.evaluate(()=>window.replay.select(window.replay.components.instances.at(-1).spec.id));
  // 6 DoF (the handles set the same spec fields): rotation about X and per-axis scale reach the object; ⌘/Ctrl+Z undoes them one step
  // at a time.
  const xf=()=>p.evaluate(()=>{const a=window.replay.anchor;return {r:a.rotation.toArray().slice(0,3).map(v=>+v.toFixed(3)),s:a.scale.toArray().map(v=>+v.toFixed(3)),p:a.position.toArray().map(v=>+v.toFixed(3))};});
  const start=await xf();
  await p.evaluate(()=>{const r=window.replay,s=r.components.get(r.selected).spec;r.setSelected({rotation:[30,s.rotation[1],s.rotation[2]]});});assert.equal((await xf()).r[0],+(Math.PI/6).toFixed(3));
  await p.evaluate(()=>{const r=window.replay,s=r.components.get(r.selected).spec,v=Array.isArray(s.scale)?s.scale:[s.scale,s.scale,s.scale];r.setSelected({scale:[v[0],2,v[2]]});});assert.equal((await xf()).s[1],2);assert.notEqual((await xf()).s[0],2);
  await p.keyboard.press('Control+z');assert.notEqual((await xf()).s[1],2,'undo the scale');assert.equal((await xf()).r[0],+(Math.PI/6).toFixed(3));
  await p.keyboard.press('Control+z');assert.deepEqual(await xf(),start,'undo the rotation');
  // The Objects section lists the widgets, one row each.
  assert.equal(await p.evaluate(()=>document.querySelectorAll('#object-library li.obj').length),3);
  // Autosaved per scenario (the imported file stored next to it), and restored on reload.
  await p.waitForTimeout(900);const saved=JSON.parse(readFileSync(new URL('composition.json',dir)));
  assert.deepEqual(saved.components.map(s=>s.component),['calibration-cube','file','pulse-marker']);assert.equal(saved.components[1].start,1);
  assert.match(saved.components[1].src,/^assets\/.+\.glb$/);assert.ok(existsSync(new URL(saved.components[1].src,dir)));
  await p.reload();await p.waitForFunction(()=>window.replay?.ready);
  assert.deepEqual(await p.evaluate(()=>window.replay.components.specs().map(s=>[s.component,s.params.size??null])),[['calibration-cube',.5],['file',null],['pulse-marker',null]]);
  reset();assert.deepEqual(errors,[]);console.log('PASS: library, default cube at 22.5 cm, parameters, imported .glb with animation on the scenario clock, time span, interactive click while editing, gizmo only on a selected showing component, 6 DoF, undo, Objects rows, autosave with stored asset, restore on reload');
}finally{await b.close();}
