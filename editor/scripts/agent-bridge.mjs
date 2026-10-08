#!/usr/bin/env node
// One bridge coordinates Jev context routing and independent UI / language branches.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createJev,runPipeline} from './jev-pipeline.mjs';
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
console.log(`Spatial Take · Jev + ${provider} ${model} (${effort}) · one bridge, two parallel branches\n${session} · ${url}`);
let warned=false;
for(;;){
  let q;try{q=await api('/api/agent/questions/next');warned=false;}catch(e){if(!warned)console.error(`Editor unreachable: ${e.message}; retrying…`);warned=true;await new Promise(r=>setTimeout(r,3000));continue;}
  if(!q.id)continue;
  const started=Date.now(),seenParts=new Set();let sending=Promise.resolve(),message='';
  const trace=(tool,text)=>{console.log(`  ${tool}: ${text.slice(0,300)}`);sending=sending.then(()=>api('/api/agent/questions/trace',{id:q.id,step:{kind:tool.endsWith('error')?'error':'tool',tool,text,at:Date.now()-started}})).catch(()=>{});};
  console.log(`? #${q.id}: ${q.text}`);
  try{
    const ask=createJev({apiKey,model:process.env.TYPESAFE_MODEL||config.jevModel||'jev-latest',trace});
    const result=await runPipeline({question:q,ask,trace,publish:async part=>{await api('/api/agent/responses',part);if(!seenParts.has(part.part)||part.stream?.status==='complete'){trace('show_'+part.part,part.stream?.status==='complete'?'Text stream complete':part.title||'Mod UI ready');seenParts.add(part.part);}},readContext:groups=>api(`/api/agent/context?question_id=${q.id}&${groups.length?'groups='+encodeURIComponent(groups.join(',')):'catalog=1'}`),answer:(question,context,options)=>provider==='gemini'?geminiAnswer(question,context,{apiKey:geminiApiKey,model,effort,trace,...options}):lunaAnswer(question,context,{model,effort,trace})});
    message=result.message||result.title||'Response ready';
  }catch(e){message=e.message;trace('pipeline_error',message);}
  await sending;
  await api('/api/agent/questions/done',{id:q.id,message,duration:(Date.now()-started)/1000}).catch(e=>console.error(e.message));
}
