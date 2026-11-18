#!/usr/bin/env node
// One bridge coordinates Jev context routing and independent UI / language branches.
import {readFileSync} from 'node:fs';
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
  const data=await r.json();if(!r.ok)throw Error(data.error||r.statusText);return data;
}
console.log(`Spatial Take · ModOS · Jev + ${provider} ${model} (${effort}) · one bridge, two parallel branches\n${session} · ${url}`);
// The first call to the language model on a new connection is several seconds slower than later ones: warm it up at start, so the
// first question is answered as fast as the rest.
if(provider==='gemini'){const t=Date.now();geminiAnswer('Reply OK.',{},{apiKey:geminiApiKey,model,effort}).then(()=>console.log(`  warm: language model ready (${Date.now()-t} ms)`),e=>console.log('  warm: '+e.message));}
let warned=false;
for(;;){
  let q;try{q=await api('/api/agent/questions/next');warned=false;}catch(e){if(!warned)console.error(`Editor unreachable: ${e.message}; retrying…`);warned=true;await new Promise(r=>setTimeout(r,3000));continue;}
  if(!q.id)continue;
  const started=Date.now(),seenParts=new Set();let sending=Promise.resolve(),message='';
  const trace=(tool,text)=>{console.log(`  ${tool}: ${text.slice(0,300)}`);sending=sending.then(()=>api('/api/agent/questions/trace',{id:q.id,step:{kind:tool.endsWith('error')?'error':'tool',tool,text,at:Date.now()-started}})).catch(()=>{});};
  console.log(`? #${q.id}: ${q.text}`);
  try{
    const ask=createJev({apiKey,model:process.env.TYPESAFE_MODEL||config.jevModel||'jev-latest',trace});
    const answerFn=(question,context,options)=>provider==='gemini'?geminiAnswer(question,context,{apiKey:geminiApiKey,model,effort,trace,...options}):lunaAnswer(question,context,{model,effort,trace,...options});
    const publish=async part=>{await api('/api/agent/responses',part);const kind=part.part+(part.weather?':weather':part.findmy?':findmy':'');if(!seenParts.has(kind)||part.stream?.status==='complete'){trace('show_'+part.part,part.stream?.status==='complete'?'Text stream complete':part.title||(part.weather?'Weather UI ready':part.findmy?'FindMy UI ready':part.animation?'Animation ready':'UI ready'));seenParts.add(kind);}};
    const result=await runModos({question:q,trace,publish,answer:answerFn,
          decide:createDecisionModule(jevEngine(ask),{log:r=>trace('decision',JSON.stringify({engine:r.engine,stage:r.stage,elapsed_ms:r.elapsed_ms}))}).decide,
          context:()=>api(`/api/modos/context?question_id=${q.id}`),
          items:ids=>api(`/api/modos/items?question_id=${q.id}&ids=${encodeURIComponent(ids.join('|'))}`).then(r=>r.items),
          recordInfo:(key,interaction_id,source)=>api('/api/agent/questions/info',{id:q.id,key,interaction_id,source})});
    message=result.message||result.title||'Response ready';
  }catch(e){message=e.message;trace('pipeline_error',message);}
  await sending;
  await api('/api/agent/questions/done',{id:q.id,message,duration:(Date.now()-started)/1000}).catch(e=>console.error(e.message));
}
