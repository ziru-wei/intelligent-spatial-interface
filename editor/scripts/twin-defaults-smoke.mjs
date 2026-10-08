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
 let saved=null,failSave=false;
 await page.route('**/composition.json',r=>r.fulfill(saved&&r.request().url().includes('/scenarios/')?{json:saved}:{status:404,body:'{}'}));
 await page.route('**/api/composition',async r=>{if(failSave)return r.fulfill({status:409,json:{error:'Test conflict'}});const data=r.request().postDataJSON();saved={version:2,revision:(saved?.revision||0)+1,components:data.components};await r.fulfill({json:{revision:saved.revision}});});
 // Lightweight twin fixture using the real component host; no user data is written.
 await page.route('**/components/calibration-cube/component.json',async r=>{const response=await r.fetch(),m=await response.json();await r.fulfill({json:{...m,category:'opportunistic'}});});
 await page.goto('http://127.0.0.1:8766/');await page.waitForFunction(()=>window.replay?.ready);
 await page.locator('#x').fill('0.45');await page.locator('#yaw').fill('35');await page.locator('#sx').fill('1.2');
 const transform=()=>page.evaluate(()=>{const r=window.replay;return r.components.transform(r.components.get(r.selected).spec);});
 const desired=await transform();await page.locator('#comp-save').click();await page.waitForFunction(()=>document.getElementById('take-status').textContent.startsWith('Saved defaults'));
 assert.deepEqual(saved.components[0].initial,desired);
 await page.locator('#x').fill('0.9');await page.locator('#comp-reset').click();assert.deepEqual(await transform(),desired);
 await page.waitForTimeout(600);await page.reload();await page.waitForFunction(()=>window.replay?.ready);
 await page.locator('#sx').fill('1.8');await page.locator('#comp-reset').click();assert.deepEqual(await transform(),desired,'baseline survives reload');
 await page.evaluate(()=>{const r=window.replay;window.draws=[];r.anchor.traverse(o=>{if(o.isMesh)o.onBeforeRender=(renderer,scene,camera)=>window.draws.push(camera===r.camera?'video':'twin');});});
 await page.locator('[aria-label="Video options"]').click();await page.locator('#video-twins').uncheck();
 assert.deepEqual(await page.evaluate(()=>[...new Set(window.draws)]),['twin'],'hidden only from camera render');
 assert.equal(await page.evaluate(()=>window.replay.anchor.visible),true);
 await page.evaluate(()=>window.draws=[]);await page.locator('#video-twins').check();assert.ok((await page.evaluate(()=>window.draws)).includes('video'));
 await page.locator('#video-twins').uncheck();await page.locator('[aria-label="Video options"]').click();
 await page.waitForTimeout(600);failSave=true;await page.locator('#x').fill('0.8');await page.locator('#comp-save').click();
 await page.waitForFunction(()=>document.getElementById('take-status').textContent.includes('Test conflict'));
 assert.deepEqual(await page.evaluate(()=>{const r=window.replay;return r.components.get(r.selected).spec.initial;}),desired,'failed save keeps baseline');
 await page.locator('#x').focus();await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>window.replay.selected),null);assert.equal(await page.evaluate(()=>window.replay.twin.gizmo.object??null),null);
 await page.reload();await page.waitForFunction(()=>window.replay?.ready);assert.equal(await page.locator('#video-twins').isChecked(),false);
 assert.deepEqual(errors,[]);console.log('PASS: saved defaults, Reset/reload, failure recovery, camera-only visibility, Esc deselect, faucet removal, 1× defaults');
}finally{await browser.close();}
