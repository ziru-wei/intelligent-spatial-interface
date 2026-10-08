// Offline recording preparation: uses the same local detector/cache as the editor,
// in a minimal page with no 3D renderer, agent, or external API.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const recording=process.argv[2];if(!recording)throw Error('Usage: node scripts/prepare-recording-hands.mjs ./spaces/<scene>/scenarios/<take>/session.json');
const server=spawn(root+'.venv/bin/python',[root+'scripts/server.py','0'],{cwd:root,stdio:['ignore','pipe','pipe']});let browser;
try{
 const base=await new Promise((resolve,reject)=>{
  let output='';const timer=setTimeout(()=>reject(Error('Local preparation server did not start')),15000);
  server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  server.once('error',e=>{clearTimeout(timer);reject(e);});server.once('exit',code=>{clearTimeout(timer);reject(Error(`Preparation server exited (${code})`));});
 });
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();
 await page.route('**/__prepare_hands',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Offline hand preparation</title>'}));
 await page.exposeFunction('handProgress',value=>console.log(JSON.stringify({progress:value})));
 await page.goto(base+'/__prepare_hands');
 const result=await page.evaluate(async recording=>{
  const {createHandPerception}=await import('/src/hand-perception/index.mjs');
  const {createRecordingHandCache}=await import('/src/hand-perception/recording-cache.mjs');
  const session=new URL(recording,location.origin+'/'),manifest=await(await fetch(session)).json();
  const cache=createRecordingHandCache({session:session.href}),service=createHandPerception();
  try{
   await cache.ready;if(cache.status.error)throw Error(cache.status.error);
   for(let i=0;i<manifest.frames.length;i++){
    if(cache.has(i))continue;
    const image=new Image();image.src=new URL(manifest.frames[i].image,session).href;await image.decode();
    const data=await service.request(`${session.href}#${i}`,image);if(data.status!=='ready')throw Error(`Frame ${i}: ${data.error}`);
    await cache.write(i,data);if(cache.status.error)throw Error(cache.status.error);
    if(i%100===0)await window.handProgress(cache.status);
   }
   return cache.status;
  }finally{service.dispose();}
 },recording);
 if(result.cached!==result.total)throw Error('Hand cache is incomplete');console.log(JSON.stringify({ok:true,...result}));
}finally{await browser?.close();server.kill();}
