#!/usr/bin/env node
// Record the MOD demo videos described in demos/modos-videos.json. A tool around the editor, not part of ModOS.
//   node demos/record.mjs                      every clip
//   node demos/record.mjs findmy weather-lab   only these
//   node demos/record.mjs weather iotcontrol   every clip of these MODs (a name is a clip, a MOD, or a name prefix)
//   npm run record -- weather                  the same, asking again, into the reel (../../context/recordings)
// The clips run as one queue: a clip that fails is reported at the end and the others are still recorded.
//   --reask      ask again even when the clip's question was already asked (else its conversation is reused and only recorded)
//   --out DIR    where the videos go (default the reel, ../../context/recordings, when it exists; else demos/videos)
//   --spec FILE  another spec
//   --server URL another editor server (e.g. http://127.0.0.1:8777, so a server someone is using is left alone)
// For each clip: the agent bridge runs for its recording; the question is asked through the editor's own ask box at ask_at (so the
// editor computes what the user looks at, as for any question); then the replay from `start` is recorded in presentation mode (the
// headset view and the pipeline), cut to `duration` seconds and saved as <name>.mp4 with a contact sheet <name>.jpg.
// Needs: the editor server (npm start), ffmpeg, a Chromium (Playwright's, or CHROME=/path), and agent-config.local.json.
import {chromium} from 'playwright';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const EDITOR=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),flag=k=>{const i=args.indexOf(k);return i<0?null:args.splice(i,2)[1];};
const reask=args.includes('--reask');if(reask)args.splice(args.indexOf('--reask'),1);
const specPath=path.resolve(flag('--spec')||path.join(EDITOR,'demos/modos-videos.json'));
const REEL=path.resolve(EDITOR,'../../context/recordings');
const out=path.resolve(flag('--out')||(existsSync(REEL)?REEL:path.join(EDITOR,'demos/videos')));
const spec=JSON.parse(readFileSync(specPath,'utf8'));
const serverFlag=flag('--server');if(serverFlag||process.env.SERVER)spec.server=serverFlag||process.env.SERVER;   // e.g. a second editor server, not to disturb one in use
const statePath=path.join(path.dirname(specPath),'.record-state.json');
const state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{};
const picks=args.map(a=>a.toLowerCase()),picked=c=>picks.some(a=>c.name===a||String(c.mod||'').toLowerCase()===a||c.name.startsWith(a+'-'));
const clips=spec.clips.filter(c=>!picks.length||picked(c));
const unknown=picks.filter(a=>!spec.clips.some(c=>c.name===a||String(c.mod||'').toLowerCase()===a||c.name.startsWith(a+'-')));
if(unknown.length){console.error(`No clip or MOD named: ${unknown.join(', ')}`);process.exit(1);}
const [W,H]=spec.viewport||[1600,900];
const session=c=>`./spaces/${spec.space}/scenarios/${c.recording}/session.json`;
const signature=c=>JSON.stringify([c.recording,c.ask_at,c.question,c.setup||{}]);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function chromePath(){
  if(process.env.CHROME)return process.env.CHROME;
  const base=path.join(process.env.HOME,'Library/Caches/ms-playwright');
  for(const d of existsSync(base)?readdirSync(base).filter(d=>d.startsWith('chromium-')).sort().reverse():[]){
    const p=path.join(base,d,'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if(existsSync(p))return p;
  }
  return undefined;   // Playwright's own
}
async function api(p,body){
  const u=new URL(p,spec.server);
  const r=await fetch(u,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;
}

let bridge=null,bridgeFor=null;
async function startBridge(c){
  if(bridgeFor===c.recording)return;
  stopBridge();
  const b=spec.bridge||{};
  bridge=spawn(process.execPath,[path.join(EDITOR,'scripts/agent-bridge.mjs'),'--url',spec.server,'--session',session(c),'--config',path.join(EDITOR,'agent-config.local.json'),
    '--provider',b.provider||'gemini','--model',b.model||'gemini-3.5-flash-lite','--effort',b.effort||'minimal'],{cwd:EDITOR,stdio:['ignore','pipe','pipe']});
  let warm=false;bridge.stdout.on('data',d=>{if(/warm:/.test(d))warm=true;if(process.env.VERBOSE)process.stdout.write(d);});
  bridge.stderr.on('data',d=>process.stderr.write(d));
  bridgeFor=c.recording;for(const until=Date.now()+20000;!warm&&Date.now()<until;)await sleep(250);   // the bridge warms up its language model
}
function stopBridge(){if(bridge){bridge.kill();bridge=null;bridgeFor=null;}}

async function openEditor(browser,c,{present=false,video=null}={}){
  const ctx=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:1,...(video?{recordVideo:{dir:video,size:{width:W,height:H}}}:{})});
  const opened=Date.now(),page=await ctx.newPage();
  page.on('pageerror',e=>console.log('  page error:',e.message));
  const q=new URLSearchParams({session:session(c),...(present?{present:'1',pipeline:spec.pipeline||'side',...(spec.agent_speed?{agentSpeed:String(spec.agent_speed)}:{})}:{})});
  await page.goto(`${spec.server}/?${q}`);
  // Asking needs the agent connected; recording a replay only needs the conversations loaded (no agent runs then).
  await page.waitForFunction(present=>present?document.getElementById('conv').options.length>0:!document.getElementById('ask-input').disabled,present,{timeout:60000});
  await page.waitForTimeout(1500);
  // Presentation: no debugging overlays (fovea circles, selection marks) and no twin boxes over the video.
  await page.evaluate(()=>{for(const id of ['fovea-zone','show-selection','video-twins','video-objects']){const x=document.getElementById(id);if(x.checked){x.checked=false;x.dispatchEvent(new Event('change'));}}});
  const seek=async t=>{await page.evaluate(t=>{const s=document.getElementById('timeline');s.value=t;s.dispatchEvent(new Event('input'));},t);await page.waitForTimeout(1500);};
  return {ctx,page,opened,seek};
}

async function ask(browser,c){
  // Devices start from the same state each time (their power), so an action is shown from the beginning.
  for(const [id,st] of Object.entries(c.devices||{}))for(const [key,value] of Object.entries(typeof st==='string'?{power:st}:st))
    await api('/api/modos/devices',{space:spec.space,id,key,op:'set',value}).catch(e=>console.log('  device:',e.message));
  for(const [mod,change] of Object.entries(c.setup||{}))await api('/api/modos/mods',{space:spec.space,op:'customize',mod,change});
  try{
    const {ctx,page,seek}=await openEditor(browser,c);
    await page.evaluate(()=>document.getElementById('conv-new').click());await page.waitForTimeout(1500);
    const conversation=await page.evaluate(()=>document.getElementById('conv').value);
    await seek(c.ask_at);
    await page.fill('#ask-input',c.question);await page.press('#ask-input','Enter');
    // Answered: the question is done and its text (if any) finished streaming.
    const until=Date.now()+60000;let q=null;
    while(Date.now()<until){
      await sleep(1000);
      const conv=await api(`/api/agent/conversations/export?session=${encodeURIComponent(session(c))}&conversation=${conversation}`);
      q=conv.questions.at(-1);
      if(q&&['answered','failed'].includes(q.status)&&q.parts?.text?.status!=='streaming')break;
    }
    await ctx.close();
    if(!q||q.status!=='answered'||q.parts?.text?.status==='failed')throw Error(`no usable answer (${q?.status||'none'}${q?.parts?.text?.status==='failed'?', text failed':''})`);
    const mods=[...(q.trace||[])].reverse().find(s=>/^modos_mods(_final)?$/.test(s.tool)&&s.text.startsWith('['))?.text;
    console.log(`  asked · MODs ${mods||'[]'} · ${q.latency}s`);
    return conversation;
  }finally{
    for(const mod of Object.keys(c.setup||{}))await api('/api/modos/mods',{space:spec.space,op:'reset',mod}).catch(()=>{});
  }
}

async function record(browser,c,conversation){
  const raw=path.join(out,'.raw');mkdirSync(raw,{recursive:true});
  const {ctx,page,opened,seek}=await openEditor(browser,c,{present:true,video:raw});
  await page.evaluate(id=>{const s=document.getElementById('conv');s.value=id;s.dispatchEvent(new Event('change'));},conversation);
  await page.waitForTimeout(1500);
  await seek(c.start);await page.waitForTimeout(2000);
  const lead=(Date.now()-opened)/1000;
  await page.evaluate(()=>document.getElementById('play').click());
  // press: the user confirms an action card at that second of the clip (Delegate's Send)
  if(c.press)setTimeout(()=>page.evaluate(()=>window.modosUI?.actionCard?.confirm()).catch(()=>{}),c.press.at*1000);
  await page.waitForTimeout(c.duration*1000);
  const video=page.video();await ctx.close();
  const webm=path.join(raw,c.name+'.webm');renameSync(await video.path(),webm);
  const dir=path.join(out,(c.mod||'other').toLowerCase());mkdirSync(dir,{recursive:true});
  const mp4=path.join(dir,c.name+'.mp4');
  execFileSync('ffmpeg',['-loglevel','error','-y','-ss',String(lead),'-i',webm,'-t',String(c.duration),'-c:v','libx264','-pix_fmt','yuv420p','-crf','18',mp4]);
  // a poster frame (late in the clip, when the answer is shown) for the dashboard
  execFileSync('ffmpeg',['-loglevel','error','-y','-ss',String(Math.max(0,c.duration*.62)),'-i',mp4,'-frames:v','1','-vf','scale=960:-1','-q:v','3',path.join(dir,c.name+'.jpg')]);
  return mp4;
}

const health=await fetch(spec.server).catch(()=>null);
if(!health?.ok){console.error(`The editor server is not running at ${spec.server} (npm start).`);process.exit(1);}
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:chromePath(),headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const done=[],failed=[];
try{
  for(const c of [...clips].sort((a,b)=>a.recording.localeCompare(b.recording)))try{
    console.log(`${c.name} (${c.mod||''}) · ${c.recording} @ ${c.ask_at}s · "${c.question}"`);
    let conversation=state[c.name]?.signature===signature(c)&&!reask?state[c.name].conversation:null;
    if(!conversation){await startBridge(c);
      for(let attempt=1;!conversation;attempt++){   // a model call can fail now and then: ask again (a new conversation each time)
        try{conversation=await ask(browser,c);}catch(e){if(attempt>=3)throw e;console.log(`  ${e.message}; asking again`);}
      }state[c.name]={conversation,signature:signature(c)};writeFileSync(statePath,JSON.stringify(state,null,1));}
    else console.log('  reusing the asked question (--reask to ask again)');
    const mp4=await record(browser,c,conversation);console.log('  saved',mp4);
    // the manifest the dashboard reads: one entry per clip, with what the system chose
    const conv=await api(`/api/agent/conversations/export?session=${encodeURIComponent(session(c))}&conversation=${conversation}`).catch(()=>null);
    const q=conv?.questions.at(-1),step=t=>{try{return JSON.parse((q?.trace||[]).find(s=>s.tool===t&&/^[\[{]/.test(s.text))?.text);}catch{return null;}};
    const mpath=path.join(out,'manifest.json'),manifest=existsSync(mpath)?JSON.parse(readFileSync(mpath,'utf8')):{clips:{}};
    manifest.clips[c.name]={name:c.name,mod:c.mod,question:c.question,recording:c.recording,ask_at:c.ask_at,video:path.relative(out,mp4),poster:path.relative(out,mp4).replace(/\.mp4$/,'.jpg'),
      chosen:step('modos_mods_final')||step('modos_mods'),about:step('modos_request')?.questions,answer:q&&(conv.responses.filter(r=>r.question_id===q.id&&r.part==='text').map(r=>({title:r.title,body:r.body}))[0]||null),
      latency:q?.latency??null,agent_speed:spec.agent_speed||1};
    manifest.recorded=new Date().toISOString();writeFileSync(mpath,JSON.stringify(manifest,null,1));
    writeFileSync(path.join(out,'manifest.js'),`window.MANIFEST=${JSON.stringify(manifest)};\n`);   // for the dashboard opened as a local file
    done.push(c.name);
  }catch(e){console.log(`  FAILED: ${e.message}`);failed.push(`${c.name} (${e.message})`);}
}finally{stopBridge();await browser.close();}
console.log(`\nrecorded ${done.length}/${clips.length} into ${out}${done.length?`: ${done.join(', ')}`:''}`);
if(failed.length){console.log(`failed: ${failed.join('; ')}`);process.exitCode=1;}
