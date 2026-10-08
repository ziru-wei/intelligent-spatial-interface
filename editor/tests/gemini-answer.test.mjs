import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {geminiAnswer} from '../scripts/gemini-answer.mjs';
import {configureGemini} from '../scripts/gemini-setup.mjs';
import {answerSettings,GEMINI_MODEL} from '../scripts/answer-settings.mjs';
import {resolveGeminiApiKey,promptApiKey} from '../scripts/api-key.mjs';
import {PassThrough} from 'node:stream';
const context={time:{date:'2026-10-07'},preferences:{reading:{current_book:{title:'To the Lighthouse',stored_item_id:'to-the-lighthouse'}}},conversation:{recent_turns:[{user_question:'What should I read?'}]},reference_resolution:{status:'resolved',referent:{item_id:'to-the-lighthouse'}}};
const text={title:'Continue To the Lighthouse',body:'Pick up around page 68.',anchor:{object:'Table 2',relation:'above'},referenced_item_ids:['to-the-lighthouse','invented']};
const completed=output=>({ok:true,json:async()=>({status:'completed',steps:[{type:'thought',summary:'Do not display this.'},{type:'model_output',content:[{type:'text',text:JSON.stringify(output)}]}],usage:{total_input_tokens:1500,total_output_tokens:60}})});
test('Gemini uses direct stateless minimal JSON, carries referent memory, and never logs a key',async()=>{
 const traces=[];
 const result=await geminiAnswer({text:'Where is it?'},context,{apiKey:'fake-gemini-secret',trace:(...args)=>traces.push(args),fetchImpl:async(url,request)=>{
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');assert.ok(!url.includes('secret'));
  assert.equal(request.headers['x-goog-api-key'],'fake-gemini-secret');
  const body=JSON.parse(request.body);assert.equal(body.model,GEMINI_MODEL);assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(body.previous_interaction_id,undefined);
  assert.equal(body.generation_config.thinking_level,'minimal');assert.equal(body.generation_config.max_output_tokens,1024);
  assert.equal(body.response_format.mime_type,'application/json');assert.ok(body.response_format.schema.required.includes('referenced_item_ids'));
  const input=JSON.parse(body.input);assert.deepEqual(input.context.conversation,context.conversation);assert.equal(input.reference_candidates[0].item_id,'to-the-lighthouse');assert.ok(!request.body.includes('fake-gemini-secret'));
  assert.ok(request.signal instanceof AbortSignal);return completed(text);
 }});
 assert.deepEqual(result.referenced_item_ids,['to-the-lighthouse']);assert.equal(result.body,text.body);
 assert.ok(!JSON.stringify(traces).includes('fake-gemini-secret'));assert.ok(JSON.stringify(traces).includes('elapsed_ms'));
});
test('Gemini exposes quota and access failures without retries or raw remote errors',async()=>{
 for(const status of [429,403,404]){
  let calls=0;
  await assert.rejects(geminiAnswer({text:'Hi'},context,{apiKey:'fake',fetchImpl:async()=>{calls++;return {ok:false,status,json:async()=>({error:{message:'should-not-be-logged'}})};}}),new RegExp('Gemini HTTP '+status));
  assert.equal(calls,1);
 }
});
test('incomplete or malformed answers fail instead of displaying thought text or truncated JSON',async()=>{
 for(const response of [{ok:true,json:async()=>({status:'incomplete',steps:[]})},completed({...text,anchor:{object:'Table 2',relation:'invalid'}}),{ok:true,json:async()=>({status:'completed',steps:[{type:'thought',content:[{type:'text',text:JSON.stringify(text)}]}]})}]){
  await assert.rejects(geminiAnswer({text:'Hi'},context,{apiKey:'fake',fetchImpl:async()=>response}));
 }
 await assert.rejects(geminiAnswer({text:'Hi'},context,{apiKey:' ',fetchImpl:async()=>{throw Error('Must not request');}}),/geminiApiKey/);
});
test('Gemini defaults replace legacy Luna settings, while explicit provider and model stay selectable',()=>{
 assert.deepEqual(answerSettings({answerModel:'gpt-6-luna',answerEffort:'low'}),{provider:'gemini',model:GEMINI_MODEL,effort:'minimal'});
 assert.deepEqual(answerSettings({answerProvider:'gemini',answerModel:'gemini-3.1-flash-lite',answerEffort:'minimal'}),{provider:'gemini',model:'gemini-3.1-flash-lite',effort:'minimal'});
 assert.deepEqual(answerSettings({}, {provider:'luna'}),{provider:'luna',model:'gpt-6-luna',effort:'low'});
 assert.throws(()=>answerSettings({}, {provider:'gemini',model:'gpt-6-luna'}),/does not match/);
});
test('Gemini key resolver and hidden prompt are distinct from TypeSafe and explain persistence',async()=>{
 assert.equal(await resolveGeminiApiKey({envKey:' gemini-env ',configKey:'saved',prompt:async()=>{throw Error('No prompt');}}),'gemini-env');
 assert.equal(await resolveGeminiApiKey({envKey:'',configKey:'saved'}),'saved');
 const input=new PassThrough(),output=new PassThrough();let transcript='';input.isTTY=true;input.setRawMode=()=>{};output.on('data',data=>transcript+=data);
 const result=promptApiKey({input,output,label:'Gemini',envName:'GEMINI_API_KEY',configField:'geminiApiKey',persist:true});
 input.write('fake-secret\r');assert.equal(await result,'fake-secret');assert.match(transcript,/Gemini API key/);assert.match(transcript,/saved/);assert.ok(!transcript.includes('fake-secret'));
});
test('setup persists Gemini key with private permissions, preserves Jev, and reloads without prompting',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'gemini-setup-test-')),configPath=path.join(dir,'agent-config.local.json');
 try{
  await writeFile(configPath,JSON.stringify({apiKey:'fake-jev-key',answerModel:'gpt-6-luna',other:'keep'}),{mode:0o644});
  const configured=await configureGemini({configPath,envKey:'',prompt:async()=>'fake-gemini-key'});
  assert.equal(configured.model,GEMINI_MODEL);
  const config=JSON.parse(await readFile(configPath,'utf8'));assert.equal(config.apiKey,'fake-jev-key');assert.equal(config.geminiApiKey,'fake-gemini-key');assert.equal(config.other,'keep');assert.equal(config.answerProvider,'gemini');
  assert.equal((await stat(configPath)).mode&0o777,0o600);
  assert.equal((await configureGemini({configPath,envKey:'',prompt:async()=>{throw Error('Must reuse saved key');}})).apiKey,'fake-gemini-key');
  const before=await readFile(configPath,'utf8');await assert.rejects(configureGemini({configPath,envKey:'',replaceKey:true,prompt:async()=>{throw Error('Cancelled');}}),/Cancelled/);assert.equal(await readFile(configPath,'utf8'),before);
 }finally{await rm(dir,{recursive:true,force:true});}
});
