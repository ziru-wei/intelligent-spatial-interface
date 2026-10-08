import {spawn} from 'node:child_process';import {chromium} from 'playwright';import assert from 'node:assert/strict';
const server=spawn('.venv/bin/python',['scripts/server.py','8882'],{stdio:'ignore'});let browser;
try{
 for(let i=0;i<60;i++){try{await fetch('http://127.0.0.1:8882/api/spaces');break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/agent/**',route=>{const path=new URL(route.request().url()).pathname;let json={ok:true};if(path.endsWith('/command'))json={command:'test'};if(path.endsWith('/conversations'))json=[{id:'legibility-test',name:'Legibility test',created:1}];if(path.endsWith('/status'))json={connected:false,questions:[],responses:[]};return route.fulfill({json});});
 await page.goto('http://127.0.0.1:8882/?session=./spaces/home/scenarios/record3d/session.json');await page.waitForFunction(()=>window.replay?.ready,null,{timeout:90000});
 const results=[];
 for(const frame of [0,180,570,1020,1650,2160,2700]){
  const result=await page.evaluate(async frame=>{
   const r=window.replay,{createResponseWidget}=await import('/src/agent.mjs'),{textViewMetrics}=await import('/src/text-view.mjs');
   await r.setFrame(frame);r.agent.stop();r.agent.group.clear();r.agent.widgets.clear();
   const viewport=()=>({width:document.getElementById('stage').clientWidth,height:document.getElementById('stage').clientHeight});
   const ctx={frames:r.session.frames,frameCamera:()=>r.camera,viewport,surfaceAt:(i,u,v)=>r.surfaceAt(u,v,i),surfacePatch:(i,u,v,rad,hit)=>r.surfacePatch(u,v,rad,i,hit),visible:r.visibleIn};
   const response={id:900,frame,t:r.session.frames[frame].t,title:'Read Today',body:'Continue “To the Lighthouse” from around page 46, in “The Window”.'};
   const {strategies}=await import('/src/placement.mjs'),{centeredPose}=await import('/src/text-view.mjs');const legacy=await strategies['user-view']({...response,aspect:.34},{...ctx,viewport:undefined});const before=textViewMetrics(centeredPose(legacy,.34),r.camera,viewport(),{xHeightRatio:24/1024});
   const widget=await createResponseWidget(response,ctx);r.agent.widgets.set(900,widget);r.agent.group.add(widget);r.agent.update=()=>{};
   await r.setFrame(frame);await r.agent.adapt(frame);
   const d=widget.userData,metrics=textViewMetrics({position:widget.position,quaternion:widget.quaternion,width:d.width,height:d.height,surface:d.pose.surface},r.camera,viewport(),d.text.material.map.image.textMetrics);
   return {frame,diagnostics:d.pose.diagnostics,beforePx:before.minPx,kind:d.pose.kind,reason:d.pose.reason,unreadable:d.pose.unreadable,width:d.width,lift:d.pose.normalLift,probe:d.pose.probe,...metrics,points:undefined,validation:d.pose.viewMetrics};
  },frame);
  results.push(result);if(process.env.DIAG){console.log(JSON.stringify(result));continue;}if(result.unreadable){assert.equal(result.kind,'unavailable');continue;}assert.ok(result.minPx>=4.45&&result.maxPx<=8.1&&result.inView,JSON.stringify(result));assert.equal(result.unreadable,undefined);assert.ok(['plane','curved'].includes(result.kind));assert.ok(result.lift<=.04);
  if(frame===570)await page.locator('#stage').screenshot({path:'/tmp/text-legibility-video.png'});
 }
 if(process.env.DIAG){await browser.close();server.kill();process.exit(0);}
 assert.ok(results.filter(r=>!r.unreadable).length>=6,'At least six sampled views must fit actual surfaces');
 // Resize and overlapping seeks must certify the final video frame, even at maximum stability.
 await page.evaluate(()=>{window.replay.agent.refreshSettings=()=>{};});
 await page.locator('#placement-stability').fill('100');await page.locator('#placement-stability').dispatchEvent('input');
 await page.setViewportSize({width:1200,height:1000});
 const moved=await page.evaluate(async()=>{const r=window.replay;await Promise.all([r.setFrame(180),r.setFrame(1020)]);await r.agent.adapt(1020);const w=r.agent.widgets.get(900),d=w.userData,{textViewMetrics}=await import('/src/text-view.mjs');const metrics=textViewMetrics({position:w.position,quaternion:w.quaternion,width:d.width,height:d.height},r.camera,{width:document.getElementById('stage').clientWidth,height:document.getElementById('stage').clientHeight},d.text.material.map.image.textMetrics);return {frame:d.adaptedFrame,metrics:{minPx:metrics.minPx,maxPx:metrics.maxPx,inView:metrics.inView}};});
 assert.equal(moved.frame,1020);assert.ok(moved.metrics.minPx>=3.6&&moved.metrics.maxPx<=11.2&&moved.metrics.inView,JSON.stringify(moved));
 console.log(JSON.stringify(results.map(({diagnostics,...r})=>r),null,2));assert.deepEqual(errors,[]);console.log('PASS: six real views retain readable surface attachment; cluttered view has no floating fallback; resize/seeks remain coherent.');
}finally{await browser?.close();server.kill();}
