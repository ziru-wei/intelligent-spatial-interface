import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const saved={};
 await p.route('**/composition.json',r=>{const scope=r.request().url().includes('/scenarios/')?'recording':'scene';return r.fulfill(saved[scope]?{json:saved[scope]}:{status:404,body:'{}'});});
 await p.route('**/api/composition',r=>{const d=r.request().postDataJSON(),scope=d.scope||'recording';saved[scope]={version:2,revision:(saved[scope]?.revision||0)+1,components:d.components};return r.fulfill({json:{revision:saved[scope].revision}});});
 await p.goto('http://127.0.0.1:8766/');await p.waitForFunction(()=>window.replay?.ready);
 assert.equal(await p.locator('[data-category=persistent] .name').textContent(),'Persistent objects');
 assert.equal(await p.locator('[data-category=opportunistic] .name').textContent(),'Opportunistic objects');
 // Old category metadata maps to persistent; scope follows category, not the caller's wrong scope.
 assert.deepEqual(await p.evaluate(async()=>{const r=window.replay;r.components.library.get('calibration-cube').category='digital twin';const i=await r.addComponent({component:'calibration-cube',position:[0,0,-2],scope:'recording'});return [i.spec.category,i.spec.scope];}),['persistent','scene']);
 const bytes=await p.evaluate(async()=>{const THREE=await import('three'),{GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');const model=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshStandardMaterial());return [...new Uint8Array(await new GLTFExporter().parseAsync(model,{binary:true}))];});
 await p.locator('#opportunistic-import').setInputFiles({name:'sam-cup.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(bytes)});
 await p.waitForFunction(()=>window.replay.components.get(window.replay.selected)?.spec.name==='sam-cup.glb');
 assert.deepEqual(await p.evaluate(()=>{const r=window.replay,s=r.components.get(r.selected).spec;return [s.category,s.scope];}),['opportunistic','recording']);
 assert.equal(await p.locator('#comp-save').isVisible(),true);
 await p.locator('#x').fill('0.7');await p.locator('#comp-save').click();await p.waitForFunction(()=>document.getElementById('take-status').textContent.startsWith('Saved defaults'));
 assert.ok(saved.recording.components.some(c=>c.name==='sam-cup.glb'&&c.category==='opportunistic'));
 assert.ok(!saved.scene.components.some(c=>c.name==='sam-cup.glb'));
 await p.reload();await p.waitForFunction(()=>window.replay?.ready);
 await p.evaluate(()=>{const r=window.replay;r.select(r.components.instances.find(i=>i.spec.name==='sam-cup.glb').spec.id);});
 assert.equal(await p.evaluate(()=>window.replay.components.get(window.replay.selected).spec.category),'opportunistic');
 await p.locator('#x').fill('1');await p.locator('#comp-reset').click();assert.equal(await p.locator('#x').inputValue(),'0.7');
 await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>window.replay.selected),null);
 assert.deepEqual(errors,[]);console.log('PASS: categories, legacy migration, GLB import, recording scope isolation, reload, saved defaults, Escape');
}finally{await browser.close();}
