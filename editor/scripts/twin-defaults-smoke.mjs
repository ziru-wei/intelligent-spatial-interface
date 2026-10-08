import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const home=JSON.parse(readFileSync(new URL('../spaces/home/composition.json',import.meta.url)));
assert.ok(!home.components.some(c=>c.component==='sink_faucet'));
assert.ok(!existsSync(new URL('../spaces/home/components/sink_faucet/component.json',import.meta.url)));
for(const c of home.components){const m=JSON.parse(readFileSync(new URL(`../spaces/home/components/${c.component}/component.json`,import.meta.url)));assert.equal(m.defaultScale,1);assert.notEqual(c.scale,1.05);}
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // No user data is written: compositions are served empty and saves are swallowed.
 await page.route('**/composition.json',r=>r.fulfill({status:404,body:'{}'}));
 await page.route('**/api/composition',r=>r.fulfill({json:{revision:1}}));
 // The calibration cube stands in for a persistent object; a recording-only .glb for an opportunistic one.
 await page.route('**/components/calibration-cube/component.json',async r=>{const response=await r.fetch(),m=await response.json();await r.fulfill({json:{...m,category:'persistent'}});});
 await page.goto('http://127.0.0.1:8766/');await page.waitForFunction(()=>window.replay?.ready);
 await page.evaluate(async()=>{const THREE=await import('three'),{GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
   const data=await new GLTFExporter().parseAsync(new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2),new THREE.MeshStandardMaterial()),{binary:true});
   await window.replay.loadGLB(new File([data],'cup.glb'),false,'opportunistic');});
 const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 // Which views drew each kind since the last call: 'video' (the recorded camera) or 'twin' (the 3D view).
 await page.evaluate(()=>{const r=window.replay;window.draws={persistent:new Set(),opportunistic:new Set()};
   for(const i of r.components.instances)i.root.traverse(o=>{if(o.isMesh)o.onBeforeRender=(renderer,scene,camera)=>window.draws[i.spec.category]?.add(camera===r.camera?'video':'twin');});});
 const draws=async()=>{await page.evaluate(()=>document.getElementById('shadows').dispatchEvent(new Event('change')));await frame();await page.evaluate(()=>window.replay.twin.render());return page.evaluate(()=>{const d=Object.fromEntries(Object.entries(window.draws).map(([k,v])=>[k,[...v].sort()]));for(const v of Object.values(window.draws))v.clear();return d;});};
 await draws();assert.deepEqual(await draws(),{persistent:['twin','video'],opportunistic:['twin','video']});
 await page.locator('[aria-label="Video options"]').click();await page.locator('#video-objects').uncheck();await page.locator('[aria-label="Video options"]').click();
 await draws();assert.deepEqual(await draws(),{persistent:['twin','video'],opportunistic:['twin']},'Obj library objects left out of the camera only');
 await page.locator('[aria-label="Display options"]').click();await page.locator('#twin-persistent').uncheck();await page.locator('[aria-label="Display options"]').click();
 await draws();assert.deepEqual(await draws(),{persistent:['video'],opportunistic:['twin']},'persistent objects left out of the 3D view only');
 // Escape deselects (no handles left behind).
 await page.evaluate(()=>{const r=window.replay;r.editObjects(true);r.select(r.components.instances.find(i=>i.spec.category!=='persistent').spec.id);});
 await page.keyboard.press('Escape');await frame();
 assert.equal(await page.evaluate(()=>window.replay.selected),null);assert.equal(await page.evaluate(()=>new Promise(f=>requestAnimationFrame(()=>requestAnimationFrame(()=>f(!!window.replay.twin.gizmo.object))))),false);
 // Remembered in this browser.
 await page.reload();await page.waitForFunction(()=>window.replay?.ready);
 assert.deepEqual(await page.evaluate(()=>['video-twins','video-objects','twin-persistent','twin-objects'].map(id=>document.getElementById(id).checked)),[true,false,false,true]);
 await page.evaluate(()=>{for(const id of ['video-objects','twin-persistent'])localStorage.removeItem('spatial-take:'+id);});
 assert.deepEqual(errors,[]);console.log('PASS: per-view visibility of persistent and Obj library objects, remembered, Esc deselect, faucet removal, 1× defaults');
}finally{await browser.close();}
