// Isolated editor session: verify UI can be used before language arrives.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const server=spawn('.venv/bin/python',['scripts/server.py','8886'],{stdio:'ignore',cwd:fileURLToPath(new URL('../',import.meta.url))}),base='http://127.0.0.1:8886',session='./spaces/demo/scenarios/demo/session.json';
const api=async(route,body)=>{const u=new URL(route,base);u.searchParams.set('session',session);const r=await fetch(u,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,...body})}:{});const result=await r.json();if(!r.ok)throw Error(JSON.stringify(result));return result;};
let browser,cid;
try{
 for(let i=0;i<40;i++){try{await api('/api/spaces');break;}catch{}await new Promise(r=>setTimeout(r,100));}
 cid=(await api('/api/agent/conversations',{name:'Playing effects test'})).id;
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
 const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 console.log('Opening editor');
 await p.goto(base+'/?session='+encodeURIComponent(session));await p.waitForFunction(()=>window.replay?.agent?.conversation);
 await p.locator('#conv').selectOption(cid);await p.waitForFunction(cid=>window.replay.agent.conversation===cid,cid);
 console.log('Editor loaded');
 await p.locator('#weather-mod').check({force:true});
 await p.locator('#weather-resume-on-response').selectOption('on');
 const pending=api('/api/agent/questions/next');await p.waitForFunction(()=>!document.getElementById('ask-input').disabled);
 await p.locator('#ask-input').fill('What is the weather this afternoon?');await p.locator('#ask-input').press('Enter');const q=await pending;console.log('Question queued');
 await api('/api/agent/questions/trace',{id:q.id,step:{kind:'tool',tool:'context',text:'Read selected groups',at:0}});
 await api('/api/agent/questions/trace',{id:q.id,step:{kind:'tool',tool:'mod',text:'UI selected',at:800}});
 const context=await api('/api/agent/context?groups=weather');const row=context.weather.forecast[1];
 const ui=await api('/api/agent/responses',{question_id:q.id,part:'ui',weather:{forecast_ids:[row.id],preview:{component:'weather-timeline'}}});
 await p.waitForFunction(id=>window.replay.agent.widgets.get(id)?.visible,ui.id);console.log('UI visible');
 await p.waitForFunction(()=>!window.replay.agent.hold&&Number(document.getElementById('timeline').value)>0.1);
 assert.equal(await p.evaluate(()=>window.replay.agent.questions.at(-1).status),'running');
 await p.evaluate(()=>{
  const r=window.replay,render=r.handCompositor.render.bind(r.handCompositor);
  window.effectFrames=[];
  r.handCompositor.render=(renderer,rgb,result)=>{
   if(document.getElementById('play').getAttribute('aria-label')==='Pause')window.effectFrames.push({key:result?.key,status:result?.status,effect:r.weatherScene.group.visible,rgb:rgb.image.src,sameFrame:rgb.image.src===new URL(r.session.frames[Number(result.key.split('#').at(-1))].image,result.key.split('#')[0]).href});
   return render(renderer,rgb,result);
  };
  const request=r.handPerception.request.bind(r.handPerception);
  r.handPerception.request=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,100));return request(...args);};
 });
 await p.waitForFunction(()=>new Set(window.effectFrames.filter(f=>f.effect).map(f=>f.key)).size>=3,null,{timeout:60000});
 const frames=await p.evaluate(()=>window.effectFrames);
 assert.ok(frames.every(f=>f.sameFrame),'Displayed RGB and mask must have the same recording frame');
 assert.ok(frames.every(f=>f.status==='ready'),'Playing effects must never be erased by a pending mask');
 assert.ok(new Set(frames.filter(f=>f.effect).map(f=>f.key)).size>=3,'Effects stay visible over multiple advancing recording frames');
 if(await p.locator('#play').getAttribute('aria-label')==='Pause')await p.locator('#play').click();
 const seek=await p.evaluate(async()=>{const r=window.replay;await r.setFrame(1);await new Promise(resolve=>setTimeout(resolve,350));return r.handData.key;});
 assert.ok(seek.endsWith('#1'),'Old playback work cannot overwrite an explicit seek: '+seek);
 console.log('PASS: effects remain composited during playback with deliberately delayed hand inference; RGB/masks match and seeks invalidate old work.');

 await p.evaluate(id=>{const r=window.replay;window.testUI=r.agent.widgets.get(id);r.weatherScene.playback.seek(1);r.weatherScene.playback.toggle();},ui.id);
 const index=await p.evaluate(()=>window.replay.weatherScene.playback.state.index);
 const text=await api('/api/agent/responses',{question_id:q.id,part:'text',layout_slot:1,title:'Afternoon forecast',body:'This text arrived after the controls.'});
 await p.waitForFunction(id=>[...window.replay.agent.widgets.values()].some(w=>w.visible&&w.userData.response.component_ids?.includes(id)),text.id);
 const state=await p.evaluate(uiId=>({containers:window.replay.agent.widgets.size,components:window.replay.agent.widgets.get(uiId).userData.response.component_ids,index:window.replay.weatherScene.playback.state.index,playing:window.replay.weatherScene.playback.state.playing,parts:[...window.replay.agent.widgets.values()].filter(w=>w.visible).map(w=>w.userData.response.part)}),ui.id);
 assert.equal(state.containers,1);assert.deepEqual(state.components,[ui.id,text.id]);assert.equal(state.index,index);assert.equal(state.playing,false);assert.deepEqual(state.parts,['presentation']);assert.deepEqual(errors,[]);
 const slider=await p.evaluate(()=>{const controls=window.replay.weatherSurfacePreview?.mesh?.userData.controls3D;return controls?{type:controls.thumb.geometry.type,x:controls.thumb.position.x,timeX:controls.time.position.x,y:controls.thumb.position.y,timeY:controls.time.position.y}:null;});
 if(slider){assert.equal(slider.type,'BoxGeometry');assert.equal(slider.x,slider.timeX);assert.ok(slider.timeY<slider.y);}
 await api('/api/agent/questions/done',{id:q.id,message:'Done'});
 await p.waitForFunction(()=>window.replay.agent.questions.at(-1)?.status==='answered');
 assert.equal(await p.evaluate(()=>window.replay.agent.thoughts.size),0);
 await p.locator('#markers .marker').last().click();
 await p.waitForFunction(()=>document.getElementById('trace').textContent.includes('Read selected groups'));
 await p.waitForFunction(()=>document.getElementById('trace').textContent.includes('UI selected'));
 await p.waitForFunction(()=>!window.replay.agent.hold&&Number(document.getElementById('timeline').value)>0.1);
 await p.screenshot({path:'/tmp/resume-response.png'});
 console.log('PASS: weather override resumes paused video on first UI while answer is still running; delayed text joins same container.');
}finally{if(cid)await api('/api/agent/conversations/delete',{conversation:cid}).catch(()=>{});await browser?.close();server.kill();}
