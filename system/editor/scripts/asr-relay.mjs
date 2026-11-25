#!/usr/bin/env node
// Speech to text for the ask box (design doc 12.8): a relay between the editor and Doubao's streaming speech recognition (Volcano
// Engine, wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async). The editor cannot set the keys a WebSocket needs, and the keys stay
// here: read from agent-config.local.json (`doubaoAsr`), never sent to the browser. One recognition per microphone press:
//   POST /asr/open?split=silence|meaning&fillers=kept|removed   → {id}; opens the recognition (its full client request sent), split and
//                                       fillers as the Input tab's Speech says (src/ui-settings.mjs speechOptions)
//   POST /asr/audio?id=&last=0|1        body: 16 kHz mono 16-bit PCM, about 200 ms a packet; last=1 ends the audio
//   GET  /asr/events?id=                server-sent events: {text, utterances: [{text, definite}], final} as the text grows; {error}
// Started by the editor's server (POST /api/asr/relay), on 127.0.0.1 only. No dependencies (Node's own WebSocket, zlib).
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const arg=(n,f)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:f;};
const PORT=Number(arg('port',8767)),CONFIG=arg('config',fileURLToPath(new URL('../agent-config.local.json',import.meta.url)));
// Two passes (bigmodel_async, enable_nonstream): words stream as they are said, and each sentence, once said, is recognized again by
// the non-streaming model, more accurately, and only then is final (definite). A sentence ends after END_WINDOW_MS of silence: long
// enough that a hesitation ("um", a breath) does not cut it (measured: at 800 ms a one-second pause made "Um." a sentence of its own).
// No language is set: Doubao's `language` did not keep the text English (Chinese speech still came out Chinese, with 1.0 and 2.0).
const URL_DEFAULT='wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',END_WINDOW_MS=1200;

/** The keys: {apiKey} (new console) or {appKey, accessKey} (old console), with resourceId (e.g. volc.bigasr.sauc.duration); optional url,
 *  endWindowMs (the silence that ends a sentence). */
function settings(){
  let c={};try{c=JSON.parse(readFileSync(CONFIG,'utf8')).doubaoAsr||{};}catch{}
  if(!(c.apiKey||(c.appKey&&c.accessKey)))throw Error('Speech to text needs doubaoAsr keys in agent-config.local.json (apiKey, or appKey and accessKey).');
  return {url:c.url||URL_DEFAULT,resourceId:c.resourceId||'volc.bigasr.sauc.duration',apiKey:c.apiKey,appKey:c.appKey,accessKey:c.accessKey,endWindowMs:Number(c.endWindowMs)||END_WINDOW_MS};
}

import {FULL,AUDIO,frame,parse,requestFor} from './doubao-asr.mjs';

const sessions=new Map();   // id → {ws, listeners: Set(res), last, done}
function emit(s,data){s.last=data;for(const res of s.listeners)res.write(`data: ${JSON.stringify(data)}\n\n`);}
// opts (from /asr/open): split 'silence' (a sentence ends after endWindowMs of silence: end_window_size) or 'meaning' (Doubao's semantic
// segmentation: no end_window_size); fillers 'kept' or 'removed' (enable_ddc, Doubao's smoothing). Nothing else of the request changes.
function open(opts={}){
  const cfg=settings(),id=randomUUID(),headers={'X-Api-Resource-Id':cfg.resourceId,'X-Api-Request-Id':randomUUID(),'X-Api-Connect-Id':id,'X-Api-Sequence':'-1',
    ...(cfg.apiKey?{'X-Api-Key':cfg.apiKey}:{'X-Api-App-Key':cfg.appKey,'X-Api-Access-Key':cfg.accessKey})};
  const ws=new WebSocket(cfg.url,{headers});ws.binaryType='arraybuffer';
  const s={ws,listeners:new Set(),last:null,done:false,queue:[],open:false};sessions.set(id,s);
  ws.onopen=()=>{s.open=true;
    const request=requestFor(opts,cfg.endWindowMs);
    console.log(`modos-speech: recognition ${id}: ${JSON.stringify(request)}`);   // what it was asked with (no keys)
    ws.send(frame(FULL,0,Buffer.from(JSON.stringify({user:{uid:'modos-editor'},audio:{format:'pcm',codec:'raw',rate:16000,bits:16,channel:1},request})),{json:true}));
    for(const b of s.queue)ws.send(b);s.queue=[];};
  ws.onmessage=e=>{let m;try{m=parse(Buffer.from(e.data));}catch(err){emit(s,{error:err.message});return;}
    if(m.error){emit(s,{error:m.error});return;}
    const r=m.json?.result||{};emit(s,{text:r.text||'',utterances:(r.utterances||[]).map(u=>({text:u.text,definite:!!u.definite})),final:m.last});
    if(m.last){s.done=true;ws.close();}};
  ws.onerror=()=>emit(s,{error:'Could not reach the speech service (check doubaoAsr in agent-config.local.json).'});
  ws.onclose=()=>{s.done=true;for(const res of s.listeners)res.end();setTimeout(()=>sessions.delete(id),30000);};
  return id;
}
function audio(s,pcm,last){const b=frame(AUDIO,last?0b0010:0,pcm);if(s.open)s.ws.send(b);else s.queue.push(b);}

// Only the editor's own pages (localhost) may use it.
const allowed=o=>!o||/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o);
process.title='modos-speech';   // its name (the editor is modos-system, the agent bridge modos-agent)
http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x'),origin=req.headers.origin;
  if(!allowed(origin)){res.writeHead(403).end();return;}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST','Access-Control-Allow-Headers':'Content-Type'}).end();return;}
  res.setHeader('Server','modos-speech');
  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.method==='GET'&&u.pathname==='/')return reply(200,{name:'modos-speech',about:'speech to text for the ModOS editor (modos-system)'});
  try{
    if(req.method==='POST'&&u.pathname==='/asr/open')return reply(200,{id:open({split:u.searchParams.get('split'),fillers:u.searchParams.get('fillers')})});
    const s=sessions.get(u.searchParams.get('id'));if(!s)return reply(404,{error:'No such recognition.'});
    if(req.method==='POST'&&u.pathname==='/asr/audio'){const parts=[];req.on('data',d=>parts.push(d));req.on('end',()=>{audio(s,Buffer.concat(parts),u.searchParams.get('last')==='1');reply(200,{ok:true});});return;}
    if(req.method==='GET'&&u.pathname==='/asr/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store',Connection:'keep-alive'});
      s.listeners.add(res);if(s.last)res.write(`data: ${JSON.stringify(s.last)}\n\n`);if(s.done)res.end();req.on('close',()=>s.listeners.delete(res));return;}
    reply(404,{error:'Not found'});
  }catch(e){reply(400,{error:e.message});}
}).listen(PORT,'127.0.0.1',()=>console.log(`modos-speech: speech to text relay on http://127.0.0.1:${PORT}`));
