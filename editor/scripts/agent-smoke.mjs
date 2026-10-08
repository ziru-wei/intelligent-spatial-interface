// End-to-end check of the agent loop without Codex: the editor asks at a paused frame, this script plays the bridge (takes the question)
// and Codex (an MCP client launching scripts/mcp.mjs over stdio, as Codex does). Also sessions, timeline markers, replay and deletion.
// Needs `npm start` and Google Chrome.
import {chromium} from 'playwright';import {rmSync} from 'node:fs';
// Start from the demo's default composition (the editor autosaves components per scenario).
const resetDemo=()=>{for(const f of ['spaces/demo/scenarios/demo/composition.json','spaces/demo/scenarios/demo/assets'])rmSync(new URL('../'+f,import.meta.url),{recursive:true,force:true});};resetDemo();import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const base=process.env.TEST_URL||'http://127.0.0.1:8766',session='./spaces/demo/scenarios/demo/session.json';
const api=async(path,body)=>{const u=new URL(path,base);if(!body)u.searchParams.set('session',session);const r=await fetch(u,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,...body})}:{});return r.json();};
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
const client=new Client({name:'agent-smoke',version:'0'});
const widget=p=>p.evaluate(()=>{const w=[...window.replay.agent.widgets.values()][0];return w&&{visible:w.visible,frame:w.userData.response.frame,question:w.userData.response.question,rating:w.userData.rating,style:w.userData.style,glass:w.userData.glass.visible,color:w.userData.text.material.color.toArray()};});
try{
  const p=await b.newPage({viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/?session='+encodeURIComponent(session));await p.waitForFunction(()=>window.replay?.ready&&window.replay.agent?.conversation);
  await p.evaluate(()=>{const r=window.replay;for(const i of r.components.instances)r.components.set(i.spec.id,{visible:false});});
  await p.locator('[data-tab=agent]').click();   // the side panel's Agent tab   // nothing in front of the responses
  // A new session starts with an empty timeline.
  const before=await p.evaluate(()=>window.replay.agent.conversation);
  await p.locator('#conv-new').click();await p.waitForFunction(b=>window.replay.agent.conversation!==b,before);
  const conv=await p.evaluate(()=>window.replay.agent.conversation);
  assert.equal(await p.locator('#markers .marker').count(),0);
  assert.match(await p.locator('#conv').inputValue(),/^\d{8}-\d{6}/);assert.match(await p.locator('#conv option:checked').textContent(),/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/,'Named after its creation time');

  // The bridge long-polls; while it does, the editor shows the agent as connected.
  const next=api('/api/agent/questions/next');
  await p.waitForFunction(()=>!document.getElementById('ask-input').disabled,null,{timeout:5000});
  // Asking at a paused frame holds the video there (0×) while the agent works; afterwards it stays paused.
  await p.evaluate(()=>window.replay.setFrame(30));await p.locator('#ask-input').fill('How many clothes do I need to wash?');await p.locator('#ask-input').press('Enter');
  const q=await next,asked=Date.now();assert.equal(q.frame,30);assert.equal(q.conversation,conv);assert.deepEqual(q.live,{read_s:5});
  await p.waitForFunction(()=>document.getElementById('speed').textContent==='0×'&&document.getElementById('ask-status').textContent==='Agent thinking',null,{timeout:3000});
  // The bridge streams the agent's steps: under the question box, and on the surface where the answer will appear.
  await api('/api/agent/questions/trace',{id:q.id,step:{kind:'reasoning',text:'Checking the laundry basket',at:1200}});
  await api('/api/agent/questions/trace',{id:q.id,step:{kind:'tool',tool:'get_user_context',text:'',at:2500}});
  await p.waitForFunction(()=>/∴ Checking the laundry basket\n?· get_user_context[\s\S]*thinking…/.test(document.getElementById('trace').innerText),null,{timeout:5000});
  assert.equal(await p.evaluate(()=>window.replay.agent.thoughts.size),0);
  // The question is a caption at the bottom of the video while it is held.
  assert.equal(await p.evaluate(()=>window.replay.agent.caption),'How many clothes do I need to wash?');
  await p.waitForFunction(()=>document.querySelector('#markers .marker')?.dataset.status==='running',null,{timeout:5000});

  await client.connect(new StdioClientTransport({command:process.execPath,args:['scripts/mcp.mjs'],env:{...process.env,SPATIAL_TAKE_URL:base,SPATIAL_TAKE_SESSION:session}}));
  const ctx=JSON.parse((await client.callTool({name:'get_user_context',arguments:{}})).content[0].text);
  assert.equal(ctx.question.id,q.id);assert.equal(ctx.user.pose.frame,30,'Context describes the moment of the question');
  await new Promise(r=>setTimeout(r,Math.max(0,3200-(Date.now()-asked)))); // the agent thinks for at least 3.2 s, past both steps
  assert.match((await client.callTool({name:'show_response',arguments:{question_id:q.id,title:'14 items to wash',items:['3 white T-shirts','2 dark jeans'],anchor:{object:'laundry-basket',relation:'above'}}})).content[0].text,/at 2\.00 s/);
  await api('/api/agent/questions/trace',{id:q.id,step:{kind:'message',text:'I showed 14 items to wash above the laundry basket.',at:9000}});
  const done=await api('/api/agent/questions/done',{id:q.id,message:'shown',duration:12.34});assert.equal(done.status,'answered');assert.equal(done.duration,12.3);assert.equal(done.trace.length,3);
  assert.equal((await client.callTool({name:'show_response',arguments:{title:'x',items:Array(9).fill('y')}})).isError,true,'Schema limits are enforced');
  await p.waitForFunction(()=>window.replay.agent.widgets.size===1&&document.querySelector('#markers .marker')?.dataset.status==='answered',null,{timeout:5000});
  const latency=done.latency;assert.ok(latency>0,'Measured latency');
  // Answer shown, 5 s of reading at 0×, then the hold ends; the video was paused, so it stays paused on the question's frame.
  await p.waitForFunction(()=>/^Reading… \d s$/.test(document.getElementById('ask-status').textContent),null,{timeout:5000});
  assert.equal(await p.locator('#speed').textContent(),'0×');
  await p.waitForFunction(()=>document.getElementById('play').getAttribute('aria-label')==='Play',null,{timeout:9000});
  assert.equal(await p.locator('#time').textContent(),'2.00 s','Held on the question frame');assert.equal(await p.locator('#speed').textContent(),'1×');
  // On the hold clock h: thinking streams step by step at each step's real time; the answer replaces it at h = latency.
  const stateAt=(h,t=2)=>p.evaluate(([h,t,id,lat])=>{const a=window.replay.agent;a.update(t);a.setHold(h==null?null:{id,h,shownAt:lat});const th=[...a.thoughts.values()][0],an=[...a.widgets.values()][0];
    const s={thought:th?.visible?th.userData.key.split(':')[0]:null,answer:an.visible};a.setHold(null);return s;},[h,t,q.id,latency]);
  assert.deepEqual(await stateAt(.05),{thought:null,answer:false},'Just asked: "thinking…"');
  assert.deepEqual(await stateAt(1.3),{thought:null,answer:false},'First step at 1.2 s real');
  assert.deepEqual(await stateAt(2.6),{thought:null,answer:false},'Second step at 2.5 s real');
  assert.deepEqual(await stateAt(latency+.01),{thought:null,answer:true},'Answer after the real latency');
  await p.evaluate(()=>window.replay.setFrame(30));
  const w=await widget(p);assert.equal(w.frame,30);assert.ok(w.rating&&w.style);assert.equal(w.glass,!!w.style.glass,'Glass only when no glowing colour is legible');assert.deepEqual(w.color.map(v=>+v.toFixed(4)),w.style.text.map(v=>+v.toFixed(4)));
  // Timeline marker: hover shows question and answer; click goes back to the question's frame and replays the hold.
  await p.evaluate(()=>window.replay.setFrame(70));
  await p.locator('#markers .marker').hover();assert.match(await p.locator('#tooltip').textContent(),/How many clothes do I need to wash\? → 14 items to wash · 2\.00 s/);
  await p.locator('#markers .marker').click();
  await p.waitForFunction(()=>document.getElementById('play').getAttribute('aria-label')==='Pause'&&document.getElementById('speed').textContent==='0×',null,{timeout:3000});
  // The caption follows at the next paint.
  await p.waitForFunction(()=>window.replay.agent.caption==='How many clothes do I need to wash?',null,{timeout:3000});
  // The stored trace (with its duration) under the question box during the hold.
  await p.waitForFunction(()=>/→ I showed 14 items[\s\S]*12\.3 s/.test(document.getElementById('trace').innerText),null,{timeout:3000});
  await p.locator('#play').click();
  await p.evaluate(()=>window.replay.setFrame(10));assert.equal(await p.evaluate(()=>window.replay.agent.caption),null);assert.equal(await p.locator('#trace').innerText(),'');
  // Hide after 5 s: outside a hold the answer is only on its own frame (it was read during the hold); the marker stays.
  await p.locator('#agent-autohide').check();
  assert.equal((await stateAt(null,2.03)).answer,true);assert.equal((await stateAt(null,2.2)).answer,false);assert.equal(await p.locator('#markers .marker').count(),1,'Marker stays');
  await p.locator('#agent-autohide').uncheck();

  // Rename in place, export, import as a new session.
  await p.locator('#conv-rename').click();await p.locator('#conv-name').fill('Laundry evening');await p.locator('#conv-name').press('Enter');
  await p.waitForFunction(()=>/^Laundry evening/.test(document.querySelector('#conv option:checked').textContent));
  const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#conv-export').click()]);
  const exported=JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(),'utf8'));
  assert.equal(exported.name,'Laundry evening');assert.equal(exported.questions.length,1);assert.equal(exported.responses[0].question_id,exported.questions[0].id);
  await p.locator('#conv-import').setInputFiles({name:'session.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await p.waitForFunction(c=>window.replay.agent.conversation!==c,conv);
  await p.waitForFunction(()=>window.replay.agent.widgets.size===1&&document.querySelectorAll('#markers .marker').length===1,null,{timeout:5000});
  // Switching sessions swaps the timeline.
  await p.locator('#conv').selectOption(conv);await p.waitForFunction(c=>window.replay.agent.conversation===c,conv);
  // Delete in place: × on the marker removes the question and its answer.
  await p.waitForFunction(()=>document.querySelectorAll('#markers .marker').length===1);
  await p.locator('#markers .marker').hover();await p.locator('#markers .marker .del').click();
  await p.waitForFunction(()=>document.querySelectorAll('#markers .marker').length===0&&window.replay.agent.widgets.size===0,null,{timeout:5000});
  // Asking during playback: the video holds at 0× while the agent answers, shows the answer after the measured latency, holds 5 s for
  // reading, then plays on at 1×. With Hide after 5 s the answer has left the view once the video moves on. Replay holds again.
  await p.locator('#agent-autohide').check();
  const next2=api('/api/agent/questions/next');await p.waitForFunction(()=>!document.getElementById('ask-input').disabled);
  await p.evaluate(()=>window.replay.setFrame(0));await p.locator('#play').click();await p.waitForTimeout(300);
  await p.locator('#ask-input').fill('What do I need from the grocery store?');await p.locator('#ask-input').press('Enter');
  const q2=await next2;assert.deepEqual(q2.live,{read_s:5});
  await p.waitForFunction(()=>document.getElementById('speed').textContent==='0×',null,{timeout:3000});assert.equal(await p.locator('#play').getAttribute('aria-label'),'Pause','Holding, not paused');
  const heldAt=await p.locator('#time').textContent();
  await p.waitForTimeout(1200); // the agent "thinks" for a while
  assert.equal(await p.locator('#time').textContent(),heldAt,'Video frozen while the agent works');
  await client.callTool({name:'show_response',arguments:{question_id:q2.id,title:'Milk, pasta, coffee',items:['Milk','Pasta','Coffee beans']}});
  await api('/api/agent/questions/done',{id:q2.id,message:'shown',duration:1.3});
  const stored=(await api('/api/agent/status?conversation='+encodeURIComponent(conv))).questions.find(q=>q.id===q2.id);
  assert.ok(stored.latency>=1.1&&stored.latency<3,'Measured latency: '+stored.latency);
  await p.waitForFunction(()=>/Reading/.test(document.getElementById('ask-status').textContent),null,{timeout:5000});
  assert.equal(await p.locator('#speed').textContent(),'0×','Still held while reading');assert.equal(await p.locator('#time').textContent(),heldAt);
  await p.waitForFunction(()=>document.getElementById('speed').textContent==='1×',null,{timeout:8000});
  await p.waitForFunction(t=>Number(document.getElementById('timeline').value)>t+.1,stored.t,{timeout:3000});
  await p.waitForFunction(()=>{const w=[...window.replay.agent.widgets.values()].find(w=>w.userData.response.title==='Milk, pasta, coffee');return w&&!w.visible;},null,{timeout:3000});
  if(await p.locator('#play').getAttribute('aria-label')==='Pause')await p.locator('#play').click();
  // Replay from the marker holds at the question again.
  await p.locator('#markers .marker').hover();await p.locator('#markers .marker').click();
  await p.waitForFunction(()=>document.getElementById('speed').textContent==='0×',null,{timeout:3000});
  await p.locator('#play').click();assert.equal(await p.locator('#speed').textContent(),'1×','Pausing ends the hold');
  // Deleting the question removes its marker and its answer.
  await p.locator('#markers .marker').hover();await p.locator('#markers .marker .del').click();
  await p.waitForFunction(()=>!document.querySelector('#markers .marker')&&window.replay.agent.widgets.size===0,null,{timeout:5000});
  await p.locator('#agent-autohide').uncheck();
  // Speed button cycles 1× → 0.5× → 0.25×.
  await p.locator('#speed').click();assert.equal(await p.locator('#speed').textContent(),'0.5×');await p.locator('#speed').click();assert.equal(await p.locator('#speed').textContent(),'0.25×');
  resetDemo();assert.deepEqual(errors,[]);console.log('PASS: new empty session (named by time), ask at a paused frame, bridge queue, MCP tools with the question\'s pose, glowing text at that frame, background rating, marker hover/click/replay, hide after reading keeps the marker, paused ask stays paused, rename in place, export, import, switch, delete on the timeline, thinking streams on the surface while held at 0×, ask while playing → hold → answer after latency → 5 s reading → 1×, replay holds again, delete, speed');
}finally{await client.close().catch(()=>{});await b.close();}
