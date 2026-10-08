import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Isolate the test from user compositions; no autosave writes.
 await page.route('**/composition.json',r=>r.fulfill({status:404,body:'{}'}));
 await page.route('**/api/composition',r=>r.fulfill({json:{ok:true}}));
 await page.goto('http://127.0.0.1:8766/');await page.waitForFunction(()=>window.replay?.ready);
 await page.evaluate(()=>{const r=window.replay;r.twin.setView({mode:'orbit'});r.twin.view.position.set(2,2,1);r.twin.view.lookAt(r.anchor.position);r.twin.render();});
 assert.equal(await page.locator('[data-gizmo]').count(),0);
 const before=await page.evaluate(()=>window.replay.placement().components);
 await page.locator('#stage').click({position:{x:20,y:20}});
 assert.deepEqual(await page.evaluate(()=>window.replay.placement().components),before,'video background click cannot place objects');
 assert.equal(await page.evaluate(()=>window.replay.twin.helper.parent.children.some(o=>o.type==='TransformControlsRoot')),false,'no video gizmo');
 for(const mode of ['translate','rotate','scale']){
  const target=await page.evaluate(async mode=>{
   const THREE=await import('three'),g=window.replay.twin.gizmo,rect=document.getElementById('twin').getBoundingClientRect();
   g.root.updateMatrixWorld(true);const ray=new THREE.Raycaster();
   for(let y=4;y<rect.height-4;y+=3)for(let x=4;x<rect.width-4;x+=3){
    ray.setFromCamera({x:x/rect.width*2-1,y:1-y/rect.height*2},g.camera);let best=null;
    for(const c of g.controls){const hit=ray.intersectObject(c._gizmo.picker[c.mode],true).find(h=>h.object.visible);if(hit&&(!best||hit.distance<best.hit.distance))best={c,hit};}
    if(best?.c.mode===mode&&best.hit.object.name==='X')return {x:rect.x+x,y:rect.y+y};
   }
  },mode);assert.ok(target,`${mode} X handle is independently pickable`);
  const state=()=>page.evaluate(()=>{const r=window.replay;return {transform:r.components.transform(r.components.get(r.selected).spec),camera:r.twin.camera.position.toArray(),selected:r.selected};});
  const initial=await state();await page.mouse.move(target.x,target.y);await page.mouse.down();
  assert.equal(await page.evaluate(()=>window.replay.twin.gizmo.active?.mode),mode);
  await page.mouse.move(target.x+35,target.y-25,{steps:8});await page.mouse.up();const after=await state();
  const field={translate:'position',rotate:'rotation',scale:'scale'}[mode];assert.notDeepEqual(after.transform[field],initial.transform[field],`${mode} changes ${field}`);
  assert.deepEqual(after.camera,initial.camera,'drag does not orbit');assert.equal(after.selected,initial.selected);
  await page.locator('#comp-withdraw').click();assert.deepEqual((await state()).transform,initial.transform,'one undo restores full drag');
 }
 await page.screenshot({path:'/tmp/gumball-smoke.png'});
 await page.evaluate(()=>window.replay.select(null));assert.equal(await page.evaluate(()=>window.replay.twin.gizmo.object??null),null);
 assert.deepEqual(errors,[]);console.log('PASS: combined move/rotate/scale, pointer ownership, single-step undo, no video gizmo or click placement, deselection');
}finally{await browser.close();}
