import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const server=spawn('.venv/bin/python',['scripts/server.py','8885'],{stdio:'ignore'});let browser;
try{
 for(let i=0;i<60;i++){try{await fetch('http://127.0.0.1:8885/api/spaces');break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
 const p=await browser.newPage({viewport:{width:1100,height:800}});p.on('pageerror',e=>console.error(e.message));
 await p.route('**/api/agent/**',route=>{const path=new URL(route.request().url()).pathname;let json={ok:true};if(path.endsWith('/command'))json={command:'test'};if(path.endsWith('/conversations'))json=[{id:'perf',name:'Perf',created:1}];if(path.endsWith('/status'))json={connected:false,questions:[],responses:[]};return route.fulfill({json});});
 await p.goto('http://127.0.0.1:8885/?session=./spaces/home/scenarios/record3d/session.json');await p.waitForFunction(()=>window.replay?.ready,null,{timeout:90000});
 const result=await p.evaluate(async()=>{const r=window.replay;r.agent.stop();const samples=[];const request=r.handPerception.request.bind(r.handPerception);let handMs=0;r.handPerception.request=async(...args)=>{const t=performance.now();const result=await request(...args);handMs+=performance.now()-t;return result;};for(let i=180;i<190;i++){handMs=0;const t=performance.now();await r.setFrame(i,{realtime:true});const ms=Math.round(performance.now()-t);await new Promise(requestAnimationFrame);samples.push({frame:i,ms,handMs:Math.round(handMs)});}return {samples,resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('/scenarios/')&&e.name.endsWith('session.json')).map(e=>e.name)};});console.log(result);assert.equal(result.resources.length,1);
 const safety=await p.evaluate(async()=>{const r=window.replay,original=r.handPerception.request.bind(r.handPerception);let release;const gate=new Promise(resolve=>release=resolve);r.handPerception.request=async(...args)=>{await gate;return original(...args);};
  const before=r.handData.key;await r.setFrame(250,{realtime:true});const pending=r.handData;
  await r.setFrame(251,{realtime:true});release();await r.setFrame(252);
  return {before,pending:pending.status,pendingKey:pending.key,ready:r.handData.status,readyKey:r.handData.key};});
 assert.equal(safety.pending,'ready');assert.equal(safety.pendingKey,safety.before);assert.equal(safety.ready,'ready');assert.ok(safety.readyKey.endsWith('#252'));console.log('PASS: delayed inference retains the complete displayed frame; seek awaits the matching frame; only one scenario loaded.');
}finally{await browser?.close();server.kill();}
