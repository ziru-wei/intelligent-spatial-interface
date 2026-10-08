import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// Read-only recording check; model endpoints mocked, saved conversations untouched.
const base=process.env.EDITOR_URL||'http://127.0.0.1:8766';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/agent/**',route=>{const path=new URL(route.request().url()).pathname;let json={ok:true};if(path.endsWith('/command'))json={command:'test'};if(path.endsWith('/conversations'))json=[{id:'anchor-test',name:'Anchor test',created:1}];if(path.endsWith('/status'))json={connected:false,questions:[],responses:[]};return route.fulfill({json});});
 await page.goto(base+'/?session=./spaces/home/scenarios/reco_reading/session.json');await page.waitForFunction(()=>window.replay?.ready,null,{timeout:90000});
 await page.locator('#placement-stability').fill('100');await page.locator('#placement-stability').dispatchEvent('input');
 const result=await page.evaluate(async()=>{
  const r=replay,{createResponseWidget}=await import('/src/agent.mjs');
  r.agent.stop();r.agent.update=()=>{};r.agent.widgets.clear();r.agent.group.clear();
  await r.at(10);const frame=Number(r.handData.key.split('#').at(-1));
  const ctx={frames:r.session.frames,frameCamera:()=>r.camera,viewport:()=>({width:document.getElementById('stage').clientWidth,height:document.getElementById('stage').clientHeight}),getStaticSurfaces:()=>r.weatherScene.surfaceTargets,surfaceAt:(i,u,v)=>r.surfaceAt(u,v,i),surfacePatch:(i,u,v,rad,hit)=>r.surfacePatch(u,v,rad,i,hit),visible:(i,points,options)=>r.visibleIn(i,points,{...options,text:true})};
  const w=await createResponseWidget({id:900,frame,title:'Read Today',body:'Continue “To the Lighthouse” from around page 46, in “The Window”.'},ctx);
  r.agent.widgets.set(900,w);r.agent.group.add(w);
  const samples=[];
  for(let i=frame;i<frame+24;i++){await r.setFrame(i);await r.agent.adapt(i);samples.push({position:w.position.toArray(),quaternion:w.quaternion.toArray(),width:w.userData.width,hidden:!!w.userData.placementHidden,anchored:!!w.userData.pose.surfaceAnchor,source:w.userData.pose.source,surface:w.userData.pose.surfaceId});}
  return samples;
 });
 console.log(JSON.stringify({first:result[0],last:result.at(-1),hidden:result.filter(s=>s.hidden).length}));
 assert.equal(result[0].anchored,true);assert.ok(!result[0].hidden);
 assert.ok(result.every(s=>JSON.stringify(s.position)===JSON.stringify(result[0].position)),'No anchor translation in this stable view');
 assert.ok(result.every(s=>JSON.stringify(s.quaternion)===JSON.stringify(result[0].quaternion)),'No anchor rotation');
 assert.ok(result.every(s=>s.width===result[0].width),'No scale pumping');assert.deepEqual(errors,[]);
 await page.locator('#stage').screenshot({path:'/tmp/reading-static-anchor.png'});
 console.log('PASS: real reco_reading text stays surface-attached and retains position, rotation and scale across 24 frames.');
}finally{await browser.close();}
