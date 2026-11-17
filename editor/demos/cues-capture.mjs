#!/usr/bin/env node
// Screenshot each spatial UI cue (src/spatial-ui/cues.mjs) on a real object of a recorded scene, for the cue gallery of the reel dashboard.
// A tool around the editor, not part of ModOS. It uses the editor's preview hook window.modosCues.show(cue, target, options).
//   node demos/cues-capture.mjs --out ../context/recordings/cues            every cue
//   node demos/cues-capture.mjs --out DIR pinnedTags footprintRing          only these
//   --server URL   another editor server (default http://127.0.0.1:8766)
// Needs: the editor server (npm start) and a Chromium (Playwright's, or CHROME=/path). Writes <cue>.jpg at 1440×1080 (the camera view).
import {chromium} from 'playwright';
import {existsSync,readdirSync,mkdirSync} from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),flag=k=>{const i=args.indexOf(k);return i<0?null:args.splice(i,2)[1];};
const OUT=path.resolve(flag('--out')||'demos/cues'),SERVER=flag('--server')||'http://127.0.0.1:8766';mkdirSync(OUT,{recursive:true});
function chromePath(){
  if(process.env.CHROME)return process.env.CHROME;
  const base=path.join(process.env.HOME,'Library/Caches/ms-playwright');
  for(const d of existsSync(base)?readdirSync(base).filter(d=>d.startsWith('chromium-')).sort().reverse():[]){
    const p=path.join(base,d,'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');if(existsSync(p))return p;}
  return undefined;
}
// [image name, recording, seconds, target ('layout:<box>' or 'zone:<room>'), options]; an image name that is not a cue says which cue it shows
const SHOTS=[
  ['breathingBox','atlas_rec_5',.5,'layout:lab-printer'],
  ['footprintRing','atlas_rec_5',.5,'layout:lab-desk-lamp'],
  ['cornerBrackets','atlas_rec_5',.5,'layout:lab-central-tv'],
  ['floorArea','atlas_rec_5',.5,'zone:lab-2f'],
  ['doorwayGlow','atlas_rec_4',1.0,'layout:lab-entry',{name:'Lab corridor'}],
  ['arrowAhead','atlas_rec_4',.5,'layout:kitchen-south-entry'],
  ['floorPath','atlas_rec_4',1.0,'layout:lab-entry',{floorY:5.6}],
  ['haloDial','atlas_rec_5',.5,'layout:lab-desk-lamp',{value:60,name:'brightness',unit:'%'}],
  ['edgeBar','atlas_rec_5',.5,'layout:lab-central-tv',{value:20,name:'volume'}],
  ['iconButton','atlas_rec_5',.5,'layout:lab-desk-lamp',{icon:'⏻',text:'Turn off',on:true}],
  ['textButton','atlas_rec_5',.5,'layout:lab-printer',{icon:null,text:'Clean print head',on:true}],
  ['datePicker','atlas_rec_5',.5,'layout:lab-central-tv',{dates:['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20'],value:'2026-11-17',y:.05}],
  ['playback','atlas_rec_5',.5,'layout:lab-central-tv',{stops:['6 AM','9 AM','12 PM','3 PM','6 PM','9 PM'],index:2,playing:true,y:-.15}],
  ['edgeTabs','atlas_rec_5',.5,'layout:lab-central-tv',{options:['HDMI 1','HDMI 2','HDMI 3'],value:'HDMI 2'}],
  ['progressRail','atlas_rec_5',.5,'layout:lab-printer',{}],
  ['cardStack','atlas_rec_5',.5,'layout:lab-printer',{}],
  ['pinnedTags','atlas_rec_5',.5,'layout:lab-printer',{}],
  ['statusPulse','atlas_rec_5',.5,'layout:lab-printer',{level:'attention',message:'Paper low'}],
  ['tetherSend','atlas_rec_2',6.9,'layout:custom_0',{to:'Alice Chen',initials:'AC'}],
];
const CUE_OF={textButton:'iconButton'};
const browser=await chromium.launch({executablePath:chromePath(),headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
for(const [name,rec,t,target,opts] of SHOTS.filter(s=>!args.length||args.includes(s[0]))){
  const page=await (await browser.newContext({viewport:{width:1920,height:1080}})).newPage();
  page.on('pageerror',e=>console.log(name,'page error',e.message));
  await page.goto(`${SERVER}/?session=./spaces/atlas/scenarios/${rec}/session.json&present=1`);
  await page.waitForFunction(()=>document.getElementById('conv').options.length>0,null,{timeout:60000});await page.waitForTimeout(1500);
  await page.evaluate(()=>{for(const id of ['fovea-zone','show-selection','video-twins','video-objects']){const x=document.getElementById(id);if(x.checked){x.checked=false;x.dispatchEvent(new Event('change'));}}});
  await page.evaluate(()=>document.getElementById('conv-new').click());await page.waitForTimeout(1200);   // no earlier answers in view
  await page.evaluate(t=>{const s=document.getElementById('timeline');s.value=t;s.dispatchEvent(new Event('input'));},t);await page.waitForTimeout(2500);
  const err=await page.evaluate(([c,tg,o])=>{try{window.modosCues.show(c,tg,o||{});return null;}catch(e){return e.message;}},[CUE_OF[name]||name,target,opts]);
  if(err){console.log(name,'error',err);await page.close();continue;}
  await page.waitForTimeout(1300);
  const box=await page.evaluate(()=>{const r=document.getElementById('stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
  await page.screenshot({path:path.join(OUT,`${name}.jpg`),clip:box,quality:88,type:'jpeg'});console.log('ok',name);await page.close();
}
await browser.close();
