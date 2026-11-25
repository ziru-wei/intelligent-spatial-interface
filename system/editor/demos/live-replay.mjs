#!/usr/bin/env node
// Answer while typing, measured (design doc 12), replay-text: types a question into a recording again, revision by revision, through the editor
// server and its bridge, and reports when each part shows and goes. A tool around the editor, not part of ModOS.
//   node demos/live-replay.mjs atlas_rec_1 --text "where is my umbrella"     typed at RATE ms a letter, revisions as the editor sends them
//   node demos/live-replay.mjs atlas_rec_1 --from <conversation>:<question>  a draft typed earlier, its revisions at their own times,
//                                                                            typed again in its own conversation: asked (--enter) and
//                                                                            answered, it joins that question's replay history as
//                                                                            its newest version; not asked, it is dropped
//   --source <recording>  where the --from conversation is (default: the recording typed into; another recording: typed in a new conversation)
// Logged: + a part shows, − it goes, ~ another part in its place, ↻ the text written again in its place, ◐ dimmed (it no longer answers
// what is asked), ● it answers again.
//   --at <s>  the recording's moment (default: the source question's, else 1 s); --enter  ask it at the end; --keep  keep a new conversation
// Needs the system (npm start) and agent-config.local.json (the server starts the scene's bridge).
import {createBreaks} from '../src/live-input.mjs';

const args=process.argv.slice(2),flag=k=>{const i=args.indexOf(k);return i<0?null:args.splice(i,2)[1];},has=k=>{const i=args.indexOf(k);if(i<0)return false;args.splice(i,1);return true;};
const server=flag('--server')||'http://127.0.0.1:8766',text=flag('--text'),from=flag('--from'),source=flag('--source'),atFlag=flag('--at'),enter=has('--enter'),keepIt=has('--keep');
const RATE=Number(flag('--rate')||110);
const recording=args[0];if(!recording||(!text&&!from)){console.error('usage: live-replay.mjs <recording> (--text "…" | --from conv:qid) [--at s] [--enter] [--keep]');process.exit(1);}
const session=`./spaces/atlas/scenarios/${recording}/session.json`,sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(p,body){
  const u=new URL(p,server);if(!body)u.searchParams.set('session',session);
  const r=await fetch(u,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,...body})}:{});
  const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;
}
const sm=await (await fetch(new URL(session,new URL('/system/editor/',server)))).json();   // the session as the editor reads it
const frameAt=t=>{let i=0;for(let k=0;k<sm.frames.length;k++)if(sm.frames[k].t<=t)i=k;return i;};

// what to type: revisions {at (s), text, pause}
let revisions,at=Number(atFlag??1);
if(from){const [cid,qid]=from.split(':'),u=new URL('/api/agent/conversations/export',server);u.searchParams.set('session',source?`./spaces/atlas/scenarios/${source}/session.json`:session);u.searchParams.set('conversation',cid);
  const c=await (await fetch(u)).json();if(!c.questions)throw Error(c.error||'No such conversation.');const q=c.questions.find(x=>String(x.id)===qid);
  if(!q?.revisions)throw Error('That question was not typed live.');revisions=q.revisions.filter(r=>!r.final);if(atFlag==null)at=q.t;}
await api('/api/agent/bridge',{});
// a question typed again goes in its own conversation (in place, once answered); fresh text, in a new one
const inPlace=from&&(!source||source===recording),old=inPlace?Number(from.split(':')[1]):null;
const conv=inPlace?{id:from.split(':')[0]}:await api('/api/agent/conversations',{});
// typed again from the space as it was when the question was asked (its state; else the initial state); the live state back after
if(inPlace)await api('/api/agent/questions/start-replay',{conversation:conv.id,of:old});
const t0=Date.now(),log=[],now=()=>((Date.now()-t0)/1000).toFixed(2);
let id=null,chain=Promise.resolve(),done=false;
const send=(txt,pause)=>{log.push([now(),`${pause?'⏸':'·'} "${txt}"`]);chain=chain.then(()=>api('/api/agent/drafts',{conversation:conv.id,id,frame:frameAt(at),t:at,text:txt,pause})).then(q=>{id=q.id;});};

// watch the question's parts: shown (+) and withdrawn (−)
const watch=(async()=>{let seen=new Map(),lastScores=null;
  while(!done){await sleep(100);if(id==null)continue;
    const s=await api(`/api/agent/status?conversation=${conv.id}`).catch(()=>null);if(!s)continue;
    const mine=s.responses.filter(r=>r.question_id===id),cur=new Map(mine.map(r=>[r.key||r.part,r]));
    // the MOD scores of each revision the bridge answered (its trace: view_mods), those of .2 or more
    const step=s.questions.find(x=>x.id===id)?.trace?.find(x=>x.tool==='view_mods');
    if(step&&step.text!==lastScores){lastScores=step.text;const v=JSON.parse(step.text);log.push([now(),`  scores ${v.options.filter(([,x])=>x==='auto'||x>=.2).map(([n,x])=>`${n} ${x}`).join(', ')||'none ≥ .2'}`]);}
    for(const [k,r] of cur){const was=seen.get(k);if(!was)log.push([now(),`+ ${k}${r.findmy?` ${r.findmy.status}${r.findmy.label?' '+r.findmy.label:''}`:r.weather?` ${r.weather.forecast?.map(e=>e.date).filter((x,i,a)=>a.indexOf(x)===i).join(',')}`:r.highlight?` ${r.highlight.targets?.map(t=>t.label).join(',')}`:r.title?` "${r.title}"`:''}`]);
      else if(was.id!==r.id)log.push([now(),`~ ${k}${r.findmy?` ${r.findmy.status} ${r.findmy.label||''}`:r.weather?` ${r.weather.forecast?.map(e=>e.date).filter((x,i,a)=>a.indexOf(x)===i).join(',')}`:r.title?` "${r.title}"`:''}`]);}
    for(const [k,r] of cur){const was=seen.get(k);if(was&&was.id===r.id&&r.part==='text'&&r.updated_at!==was.updated_at)log.push([now(),`↻ ${k} written again in its place`]);}
    for(const [k,r] of cur){const was=seen.get(k);if(was&&!!r.stale_at!==!!was.stale_at)log.push([now(),`${r.stale_at?'◐':'●'} ${k} ${r.stale_at?'dimmed':'answers again'}`]);}
    for(const [k,r] of cur){const was=seen.get(k);if(r.part==='text'&&r.title&&was&&was.title!==r.title&&r.stream?.status==='complete')log.push([now(),`  ${k} "${r.title}"`]);}
    for(const k of seen.keys())if(!cur.has(k))log.push([now(),`− ${k}`]);
    seen=cur;}})();

if(revisions){for(const r of revisions){await sleep(Math.max(0,r.at*1000-(Date.now()-t0)));send(r.text,!!r.pause);}}
else{const breaks=createBreaks({onRevision:send});for(let i=1;i<=text.length;i++){breaks.feed(text.slice(0,i));await sleep(RATE);}}
await sleep(6000);await chain;
if(enter){log.push([now(),'⏎ asked']);await api('/api/agent/drafts/ask',{conversation:conv.id,id,text:revisions?revisions.at(-1).text:text});await sleep(8000);}
done=true;await watch;
for(const [t,e] of log)console.log(`${t.padStart(6)} s  ${e}`);
if(inPlace){
  let q=null;for(const until=Date.now()+60000;enter&&Date.now()<until;await sleep(1000)){q=(await api(`/api/agent/status?conversation=${conv.id}`)).questions.find(x=>x.id===id);if(['answered','failed'].includes(q?.status))break;}
  if(q?.status==='answered'){await api('/api/agent/questions/replay',{conversation:conv.id,of:old,new:id,how:'replay-text'});console.log(`question ${id} is a new version of ${old} (its replay history)`);}
  else{await api('/api/agent/drafts/cancel',{conversation:conv.id,id}).catch(()=>api('/api/agent/questions/delete',{conversation:conv.id,id}).catch(()=>{}));await api('/api/agent/questions/end-replay',{});console.log(enter?`not answered: question ${old} stays`:'not asked: dropped');}
}else if(!keepIt)await api('/api/agent/conversations/delete',{conversation:conv.id}).catch(()=>{});
