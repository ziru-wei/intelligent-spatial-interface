#!/usr/bin/env node
// Ask the Gallery's examples again: replay-text-batch (demos/gallery-examples.json; scripts/gallery.py; each answer a new version in its
// question's replay history, scripts/versions.py). A tool around the editor, not part of ModOS.
//   npm run gallery                         every example
//   npm run gallery -- weather findmy-x     these: a name is an example, a MOD, or a name prefix
//   --server URL                            the system elsewhere (npm start)
//   --stills                                only take the stills again, from each example's replay (nothing asked, no model:
//                                           for a change in how answers are drawn, not in what they are)
// The examples run as one queue (an example of several questions asks them in order, in one conversation). For each: the agent bridge runs for its recording; a conversation of its own is made for asking it again (tagged gallery_example);
// the editor opens on it in its example view (?example=) and the question is asked through its own ask box at ask_at (so the editor
// computes what the user looks at, as for any question). Once answered, the editor sends a still of the camera view, and the older
// the new questions take the example's place in the conversation that holds it (scripts/gallery.py replace; a new example's
// conversation becomes that one). A failed example is reported at the end; its old one stays.
// Needs: the system (npm start), a Chromium (Playwright's, or CHROME=/path), and agent-config.local.json.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const EDITOR=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),flag=k=>{const i=args.indexOf(k);return i<0?null:args.splice(i,2)[1];};
const spec=JSON.parse(readFileSync(path.join(EDITOR,'demos/gallery-examples.json'),'utf8'));
const stillsOnly=args.includes('--stills');if(stillsOnly)args.splice(args.indexOf('--stills'),1);
const serverFlag=flag('--server');if(serverFlag||process.env.SERVER)spec.server=serverFlag||process.env.SERVER;
const picks=args.map(a=>a.toLowerCase()),matches=(c,a)=>c.name===a||String(c.mod||'').toLowerCase()===a||c.name.startsWith(a+'-');
const examples=spec.examples.filter(c=>!picks.length||picks.some(a=>matches(c,a)));
const unknown=picks.filter(a=>!spec.examples.some(c=>matches(c,a)));
if(unknown.length){console.error(`No example or MOD named: ${unknown.join(', ')}`);process.exit(1);}
const [W,H]=spec.viewport||[1920,1080];
const session=c=>`./spaces/${spec.space}/scenarios/${c.recording}/session.json`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// an example's questions: one (ask_at, question), or several asked one after another (questions: [{ask_at, question}]); typed: its
// revisions in Answer while typing ({at, t, text, pause}), typed again as they came
const questionsOf=c=>c.questions||[{ask_at:c.ask_at,question:c.question,typed:c.typed}];

function chromePath(){
  if(process.env.CHROME)return process.env.CHROME;
  const base=path.join(process.env.HOME,'Library/Caches/ms-playwright');
  for(const d of existsSync(base)?readdirSync(base).filter(d=>d.startsWith('chromium-')).sort().reverse():[]){
    const p=path.join(base,d,'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if(existsSync(p))return p;
  }
  return undefined;   // Playwright's own
}
async function api(p,body,s=null){
  const u=new URL(p,spec.server);if(s&&!body)u.searchParams.set('session',s);
  const r=await fetch(u,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s?{session:s,...body}:body)}:{});
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

async function ask(browser,c){
  const s=session(c);
  // the space as it was when the example was first asked (its question's state; else the initial state), then the devices it needs
  const was=(await api('/api/gallery')).examples.find(x=>x.name===c.name);
  await api('/api/agent/questions/start-replay',{conversation:was?.conversation||null,of:was?.first_question_id??null},s);
  for(const [id,st] of Object.entries(c.devices||{}))for(const [key,value] of Object.entries(typeof st==='string'?{power:st}:st))
    await api('/api/modos/devices',{space:spec.space,id,key,op:'set',value}).catch(e=>console.log('  device:',e.message));
  for(const [mod,change] of Object.entries(c.setup||{}))await api('/api/modos/mods',{space:spec.space,op:'customize',mod,change});
  const conv=await api('/api/agent/conversations',{gallery_example:{name:c.name,mod:c.mod}},s);
  const ctx=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:1});
  try{
    const page=await ctx.newPage();page.on('pageerror',e=>console.log('  page error:',e.message));
    await page.goto(`${spec.server}/system/editor/?${new URLSearchParams({session:s,conversation:conv.id,example:c.name,ask:'1'})}`);   // ask=1: the example view's ask box, for this tool
    await page.waitForFunction(()=>!document.getElementById('ask-input').disabled,null,{timeout:60000});await page.waitForTimeout(1500);
    await page.evaluate(()=>{for(const id of ['fovea-zone','show-selection','video-twins','video-objects']){const x=document.getElementById(id);if(x?.checked){x.checked=false;x.dispatchEvent(new Event('change'));}}});
    // its questions in order, each once the one before is answered; the still is the last one's (the editor sends one per answer)
    const qs=questionsOf(c);let askedAt=0;
    const seek=t=>page.evaluate(t=>{const s=document.getElementById('timeline');s.value=t;s.dispatchEvent(new Event('input'));},t);
    for(const [i,{ask_at,question,typed}] of qs.entries()){
      await seek(ask_at);await page.waitForTimeout(1500);
      askedAt=Date.now()/1000;
      if(typed){
        // typed in Answer while typing: the mode on, each revision's words typed over the time they took, at their moment in the recording
        await page.evaluate(()=>{const b=document.getElementById('ask-live');if(b.getAttribute('aria-pressed')!=='true')b.click();});
        let prev={at:0,t:ask_at},text='';
        for(const r of typed){
          if(Math.abs(r.t-prev.t)>.05)await seek(r.t);
          const add=r.text.startsWith(text)?r.text.slice(text.length):null,ms=Math.max(0,(r.at-prev.at)*1000);
          if(add==null){await page.fill('#ask-input',r.text);await page.waitForTimeout(ms);}
          else await page.type('#ask-input',add,{delay:Math.max(30,ms/Math.max(1,add.length))});
          if(r.pause)await page.waitForTimeout(1300);   // a pause the user made: long enough for any rhythm
          text=r.text;prev=r;
        }
        if(question!==text)await page.fill('#ask-input',question);
        await page.press('#ask-input','Enter');
      }else{await page.fill('#ask-input',question);await page.press('#ask-input','Enter');}
      const last=i===qs.length-1;
      // answered (and, for the last, its still sent by the editor: the example then shows in the gallery with this conversation)
      for(const until=Date.now()+90000;;){
        if(Date.now()>until)throw Error(`no answer${last?' with a still':''} within 90 s`);
        await sleep(1000);
        const q=(await api(`/api/agent/conversations/export?conversation=${conv.id}`,null,s)).questions.at(-1);
        if(q?.status==='failed')throw Error('the question failed: '+(q.message||''));
        if(!last){if(q?.status==='answered'){await page.waitForTimeout(4000);break;}continue;}
        const e=(await api('/api/gallery')).examples.find(x=>x.name===c.name&&x.conversation===conv.id);
        if(e?.still_at&&e.still_at>=askedAt-1&&(e.questions||[e.question]).length===qs.length)return {conv,example:e};
      }
    }
  }catch(e){await api('/api/agent/conversations/delete',{conversation:conv.id},s).catch(()=>{});await api('/api/agent/questions/end-replay',{},s).catch(()=>{});throw e;}
  finally{await ctx.close();for(const mod of Object.keys(c.setup||{}))await api('/api/modos/mods',{space:spec.space,op:'reset',mod}).catch(()=>{});}
}

// The still of an existing example, from its replay in the example view (?still=1).
async function still(browser,c){
  const e=(await api('/api/gallery')).examples.find(x=>x.name===c.name);if(!e)throw Error('not asked yet (run without --stills first)');
  const before=e.still_at||0,ctx=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:1});
  try{
    const page=await ctx.newPage();page.on('pageerror',x=>console.log('  page error:',x.message));
    await page.goto(`${spec.server}/system/editor/?${new URLSearchParams({session:e.session,conversation:e.conversation,example:c.name,still:'1'})}`);
    for(const until=Date.now()+90000;Date.now()<until;){await sleep(1000);
      const now=(await api('/api/gallery')).examples.find(x=>x.name===c.name);if(now?.still_at>before)return now;}
    throw Error('no still within 90 s');
  }finally{await ctx.close();}
}

const health=await fetch(spec.server).catch(()=>null);
if(!health?.ok){console.error(`ModOS is not running at ${spec.server} (npm start).`);process.exit(1);}
const browser=await chromium.launch({executablePath:chromePath(),headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const done=[],failed=[];
try{
  for(const c of [...examples].sort((a,b)=>a.recording.localeCompare(b.recording)))try{
    console.log(`${c.name} (${c.mod||''}) · ${c.recording} · ${questionsOf(c).map(q=>`@ ${q.ask_at}s "${q.question}"`).join(' → ')}`);
    if(stillsOnly){const e=await still(browser,c);console.log(`  still taken: ${e.still}`);done.push(c.name);continue;}
    await startBridge(c);let result=null;
    for(let attempt=1;!result;attempt++){   // a model call can fail now and then: ask again
      try{result=await ask(browser,c);}catch(e){if(attempt>=3)throw e;console.log(`  ${e.message}; asking again`);}
    }
    const {replaced:joined}=await api('/api/gallery/replace',{name:c.name,keep:result.conv.id,session:session(c)});
    console.log(`  answered: ${result.example.answer?.title||''} · ${result.example.latency??'?'} s · ${joined?`a new version of ${joined} question${joined>1?"s":""}`:"a new example"}`);done.push(c.name);
  }catch(e){console.log(`  FAILED: ${e.message}`);failed.push(`${c.name} (${e.message})`);}
}finally{stopBridge();await browser.close();}
console.log(`\nasked ${done.length}/${examples.length}${done.length?`: ${done.join(', ')}`:''}`);
if(failed.length){console.log(`failed: ${failed.join('; ')}`);process.exitCode=1;}
