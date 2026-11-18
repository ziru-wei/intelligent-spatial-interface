#!/usr/bin/env node
import {readFile,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {resolveGeminiApiKey,promptApiKey} from './api-key.mjs';
import {GEMINI_MODEL,answerSettings} from './answer-settings.mjs';
import {geminiAnswer} from './gemini-answer.mjs';
const defaultPath=fileURLToPath(new URL('../agent-config.local.json',import.meta.url));
export async function configureGemini({configPath=defaultPath,model=GEMINI_MODEL,envKey=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY,replaceKey=false,prompt=()=>promptApiKey({label:'Gemini',envName:'GEMINI_API_KEY',configField:'geminiApiKey',persist:true})}={}){
  let config={};
  try{config=JSON.parse(await readFile(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Cannot read local agent config; check that it contains valid JSON.');}
  if(!config||Array.isArray(config)||typeof config!=='object')throw Error('Local agent config must be a JSON object.');
  const settings=answerSettings({}, {provider:'gemini',model,effort:'minimal'});
  const key=await resolveGeminiApiKey({envKey:replaceKey?'':envKey,configKey:replaceKey?'':config.geminiApiKey,prompt});
  const handle=await open(configPath,'w',0o600);
  try{
    await handle.chmod(0o600);
    await handle.writeFile(JSON.stringify({...config,geminiApiKey:key,answerProvider:settings.provider,answerModel:settings.model,answerEffort:settings.effort},null,2)+'\n');
  }finally{await handle.close();}
  return {...settings,apiKey:key};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i>0?process.argv[i+1]:fallback;};
  try{
    const configPath=arg('config',defaultPath);
    const settings=await configureGemini({configPath,model:arg('model',GEMINI_MODEL),replaceKey:process.argv.includes('--replace-key')});
    console.log(`Saved Gemini setup to ${configPath} (permissions 600).\n${settings.model} · minimal thinking · Jev key preserved.`);
    const started=Date.now();
    await geminiAnswer({text:'Say Ready.'},{time:{date:new Date().toISOString().slice(0,10)}},settings);
    console.log(`Gemini connection verified in ${Date.now()-started} ms. Restart editor, refresh, and rerun Copy command.`);
  }catch(e){console.error(e.message);process.exitCode=e.code==='CANCELLED'?130:1;}
}
