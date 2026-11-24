#!/usr/bin/env node
// One bridge coordinates Jev context routing and independent UI / language branches.
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createJev} from './jev.mjs';
import {runModos} from '../modos/pipeline.mjs';
import {createDecisionModule,jevEngine} from '../modos/decision.mjs';
import {lunaAnswer} from './luna-answer.mjs';
import {geminiAnswer} from './gemini-answer.mjs';
import {answerSettings} from './answer-settings.mjs';
import {resolveApiKey,resolveGeminiApiKey} from './api-key.mjs';
const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i>0?process.argv[i+1]:fallback;};
const url=arg('url','http://127.0.0.1:8766'),session=arg('session','./spaces/demo/scenarios/demo/session.json');
const configPath=arg('config',fileURLToPath(new URL('../agent-config.local.json',import.meta.url)));
let config={};try{config=JSON.parse(readFileSync(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Cannot read local agent config; check its JSON.');}
const {provider,model,effort}=answerSettings(config,{provider:arg('provider'),model:arg('model'),effort:arg('effort')});
let apiKey,geminiApiKey;
try{apiKey=await resolveApiKey({configKey:config.apiKey});if(provider==='gemini')geminiApiKey=await resolveGeminiApiKey({configKey:config.geminiApiKey});}
catch(e){console.error(e.message);process.exit(e.code==='CANCELLED'?130:1);}
async function api(p,body){
  const u=new URL(p,url);if(!body)u.searchParams.set('session',session);
  const r=await fetch(u,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,...body}),signal:AbortSignal.timeout(35000)}:{signal:AbortSignal.timeout(35000)});
  const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||r.statusText),{status:r.status});return data;
}
process.title='modos-agent';   // its name (the editor is modos-system, the speech relay modos-speech), its terminal's title too
if(process.stdout.isTTY)process.stdout.write('\x1b]0;modos-agent\x07');
console.log(`modos-agent · Jev + ${provider} ${model} (${effort}) · one bridge, two parallel branches\n${session} · ${url}`);
// The first call to the language model on a new connection is several seconds slower than later ones: warm it up at start, so the
// first question is answered as fast as the rest.
if(provider==='gemini'){const t=Date.now();geminiAnswer('Reply OK.',{},{apiKey:geminiApiKey,model,effort}).then(()=>console.log(`  warm: language model ready (${Date.now()-t} ms)`),e=>console.log('  warm: '+e.message));}
let warned=false;
// Answer while typing (design doc 12): each revision of a draft is answered in turn, from what the last one showed (the live state kept
// here per question); a revision being answered finishes even when the user types on, and the next one taken is the newest text.
const drafts=new Map();
// A bridge left running answers with the code it started with (a pipeline change would not show, and questions get stale answers). So
// between questions it checks its code (scripts/ and modos/): changed, it runs a fresh bridge with the same arguments and waits on it,
// passing on a stop, so whoever started it (a terminal, the server, demos/gallery.mjs) still stops it by the same process.
// The prompts' words (modos/prompts.json, edited on the pipeline page) count as its code.
const CODE=[new URL('./',import.meta.url),new URL('../modos/',import.meta.url)].flatMap(d=>readdirSync(d).filter(f=>f.endsWith('.mjs')||f==='prompts.json').map(f=>fileURLToPath(new URL(f,d))));
const stamp=()=>CODE.map(f=>{try{return statSync(f).mtimeMs;}catch{return 0;}}).join(),born=stamp();
function renewIfChanged(){
  if(stamp()===born)return false;console.log('  code changed: running a fresh bridge');
  const child=spawn(process.execPath,process.argv.slice(1),{stdio:'inherit'});
  for(const sig of ['SIGTERM','SIGINT','SIGHUP'])process.on(sig,()=>child.kill(sig));
  child.on('exit',code=>process.exit(code??0));return true;
}
for(;;){
  if(renewIfChanged())break;
  let q;try{q=await api('/api/agent/questions/next');warned=false;}catch(e){if(!warned)console.error(`Editor unreachable: ${e.message}; retrying…`);warned=true;await new Promise(r=>setTimeout(r,3000));continue;}
  if(!q.id)continue;
  const started=Date.now(),seenParts=new Set();let sending=Promise.resolve(),message='';
  const drafting=q.status==='drafting',typed=drafting||!!q.revisions?.length;
  let stale=false,watch=null;
  // a draft's revision is answered to the end even when the user types on (the next one is the newest text); it stops when the draft
  // was asked or dropped meanwhile
  if(drafting){watch=setInterval(()=>api(`/api/agent/questions/rev?id=${q.id}`).then(r=>{if(r.status!=='drafting')stale=true;}).catch(()=>{}),120);}
  const live=typed?{state:drafts.get(q.id)||{},final:!drafting,pause:!!q.revisions?.at(-1)?.pause,stale:()=>stale,
    retract:keys=>api('/api/agent/responses/retract',{question_id:q.id,keys,rev:q.rev}).catch(e=>{if(e.status===409)stale=true;else throw e;}),
    // a part left in view, dimmed, that no longer answers what is asked (on: false, it answers again)
    dim:(keys,on=true)=>api('/api/agent/responses/stale',{question_id:q.id,keys,stale:on,rev:q.rev}).catch(e=>{if(e.status===409)stale=true;else throw e;}),
    writing:(keys,on=true)=>api('/api/agent/responses/writing',{question_id:q.id,keys,writing:on,rev:q.rev}).catch(e=>{if(e.status===409)stale=true;else throw e;}),
    // whether a part's theme is the user's focus now (the text's, which is not written again for it)
    focus:(keys,on)=>api('/api/agent/responses/focus',{question_id:q.id,keys,focus:on,rev:q.rev}).catch(e=>{if(e.status===409)stale=true;else throw e;})}:null;
  const trace=(tool,text)=>{console.log(`  ${tool}: ${text.slice(0,300)}`);sending=sending.then(()=>api('/api/agent/questions/trace',{id:q.id,step:{kind:tool.endsWith('error')?'error':'tool',tool,text,at:Date.now()-started}})).catch(()=>{});};
  console.log(`${drafting?'… ':'? '}#${q.id}${typed?` r${q.rev}`:''}: ${q.text}`);
  try{
    const ask=createJev({apiKey,model:process.env.TYPESAFE_MODEL||config.jevModel||'jev-latest',trace});
    const answerFn=(question,context,options)=>provider==='gemini'?geminiAnswer(question,context,{apiKey:geminiApiKey,model,effort,trace,...options}):lunaAnswer(question,context,{model,effort,trace,...options});
    const publish=async part=>{if(stale)throw Error('stale');
      try{await api('/api/agent/responses',typed?{...part,rev:q.rev}:part);}catch(e){if(e.status===409){stale=true;throw Error('stale');}throw e;}const kind=part.part+(part.weather?':weather':part.findmy?':findmy':'');if(!seenParts.has(kind)||part.stream?.status==='complete'){trace('show_'+part.part,part.stream?.status==='complete'?'Text stream complete':part.title||(part.weather?'Weather UI ready':part.findmy?'FindMy UI ready':part.animation?'Animation ready':'UI ready'));seenParts.add(kind);}};
    // the conversation's themes (modos/themes.mjs), kept by the editor; this question's run gives them back updated
    const book=(await api(`/api/agent/themes?id=${q.id}`).catch(()=>({})))?.themes||null;
    const result=await runModos({question:q,themes:book,trace,publish,answer:answerFn,
          decide:createDecisionModule(jevEngine(ask),{log:r=>trace('decision',JSON.stringify({engine:r.engine,stage:r.stage,elapsed_ms:r.elapsed_ms}))}).decide,
          context:()=>api(`/api/modos/context?question_id=${q.id}`),
          items:ids=>api(`/api/modos/items?question_id=${q.id}&ids=${encodeURIComponent(ids.join('|'))}`).then(r=>r.items),
          recordInfo:(key,interaction_id,source)=>api('/api/agent/questions/info',{id:q.id,key,interaction_id,source}),live});
    if(result.themes&&!stale)await api('/api/agent/themes',{question_id:q.id,themes:result.themes}).catch(e=>trace('modos_error','themes: '+e.message));
    message=result.message||result.title||'Response ready';
  }catch(e){message=e.message;if(!stale)trace('pipeline_error',message);}
  clearInterval(watch);
  if(live)drafts.set(q.id,live.state);
  await sending;
  if(drafting){console.log(`  ${stale?'stopped: the draft was asked or dropped':'revision shown'} (${Date.now()-started} ms)`);continue;}   // a draft is not done: the user is typing
  drafts.delete(q.id);
  await api('/api/agent/questions/done',{id:q.id,message,duration:(Date.now()-started)/1000}).catch(e=>console.error(e.message));
}
