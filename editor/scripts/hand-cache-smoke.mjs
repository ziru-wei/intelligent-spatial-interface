import {spawn} from 'node:child_process';import {chromium} from 'playwright';import assert from 'node:assert/strict';
const server=spawn('.venv/bin/python',['scripts/server.py','8887'],{stdio:'ignore'});let browser;
try{
 for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:8887/api/spaces');break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
 const p=await browser.newPage({viewport:{width:1200,height:800}});p.on('pageerror',e=>console.error(e.message));
 await p.route('**/hand-test',route=>route.fulfill({contentType:'text/html',body:'<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script><body style="margin:0;background:#222">'}));await p.goto('http://127.0.0.1:8887/hand-test');
 const results=await p.evaluate(async()=>{
  const {createHandPerception}=await import('/src/hand-perception/index.mjs'),{createRecordingHandCache}=await import('/src/hand-perception/recording-cache.mjs');
  const session=new URL('/spaces/home/scenarios/reco_brush/session.json',location.href),manifest=await(await fetch(session)).json(),cache=createRecordingHandCache({session:session.href}),service=createHandPerception();const results=[];
  try{for(const frame of [0,180,570,1020,1650,2160,2700,300,600,900,1200,1500,1800,2100,2400]){
   if(frame>=manifest.frames.length)continue;
   const image=new Image();image.src=new URL(manifest.frames[frame].image,session).href;await image.decode();
   const data=await service.request(`${session}#${frame}`,image);if(data.status!=='ready')throw Error(data.error);
   await cache.write(frame,data);if(cache.status.error)throw Error(cache.status.error);
   results.push({frame,hands:data.landmarks.length,ms:Math.round(data.elapsed_ms),width:data.width,height:data.height});
   if(data.landmarks.length){
    const canvas=document.createElement('canvas');canvas.width=data.width*2;canvas.height=data.height;const c=canvas.getContext('2d');c.drawImage(image,0,0,data.width,data.height);c.drawImage(image,data.width,0,data.width,data.height);
    const overlay=c.createImageData(data.width,data.height);for(let i=0;i<data.mask.length;i++){overlay.data[i*4]=255;overlay.data[i*4+3]=data.mask[i]?100:0;}
    const mask=new OffscreenCanvas(data.width,data.height);mask.getContext('2d').putImageData(overlay,0,0);c.drawImage(mask,data.width,0);canvas.style.width='1200px';document.body.append(canvas);break;
   }
  }}finally{service.dispose();}
  window.testFrames=results.map(r=>r.frame);return results;
 });console.log(results);await p.screenshot({path:'/tmp/hand-mask-quality.png'});
 const frameIds=results.map(r=>r.frame);await p.reload();
 const cached=await p.evaluate(async frames=>{const {createRecordingHandCache}=await import('/src/hand-perception/recording-cache.mjs');const cache=createRecordingHandCache({session:new URL('/spaces/home/scenarios/reco_brush/session.json',location.href).href});let count=0;for(const i of frames){const r=await cache.read(i,'cache#'+i);if(r?.status==='ready')count++;}return {count,status:cache.status};},frameIds);
 assert.equal(cached.count,frameIds.length);assert.equal(cached.status.error,null);
 const pixels=await p.evaluate(async()=>{
  const THREE=await import('three'),{createHandCompositor}=await import('/src/hand-perception/compositor.mjs');const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(64,64);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const data=new Uint8Array(64*64*4);for(let i=0;i<4096;i++){data[4*i]=(i%64)*4;data[4*i+1]=Math.floor(i/64)*4;data[4*i+2]=127;data[4*i+3]=255;}
  const rgb=new THREE.DataTexture(data,64,64);rgb.colorSpace=THREE.SRGBColorSpace;rgb.needsUpdate=true;const scene=new THREE.Scene();scene.background=rgb;const camera=new THREE.Camera(),gl=renderer.getContext(),before=new Uint8Array(64*64*4),after=new Uint8Array(before.length);
  renderer.render(scene,camera);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,before);
  const compositor=createHandCompositor();const mask=Uint8Array.from({length:4096},(_,i)=>(i%7)<3?255:0);compositor.render(renderer,rgb,{status:'ready',width:64,height:64,mask});gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,after);
  const difference=Math.max(...before.map((v,i)=>Math.abs(v-after[i])));compositor.dispose();rgb.dispose();renderer.dispose();return difference;
 });assert.ok(pixels<=1,`Hand pass changes background RGB by ${pixels}`);
 console.log('PASS: actual local detection → recording cache → reload without detector; foreground restoration adds no texture/color pattern.');
}finally{await browser?.close();server.kill();}
