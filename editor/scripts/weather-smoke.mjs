import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const capture=async(page,path)=>{if(process.env.WEATHER_CAPTURE)await page.screenshot({path});};
const base=process.env.TEST_URL||'http://127.0.0.1:8767',root=fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(root+'spaces/demo/scenarios/weather-smoke-'),path=dir.slice(root.length)+'/session.json',source=JSON.parse(readFileSync(root+'spaces/demo/scenarios/demo/session.json'));
for(const f of source.frames)for(const k of ['image','depth'])if(f[k])f[k]='/spaces/demo/scenarios/demo/'+f[k];
if(source.roomMesh)source.roomMesh='/spaces/demo/scenarios/demo/'+source.roomMesh;writeFileSync(dir+'/session.json',JSON.stringify(source));
const api=async(p,body)=>{const u=new URL(p,base);if(!body)u.searchParams.set('session',path);const r=await fetch(u,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:path,...body})}:{});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;};
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});const client=new Client({name:'weather-smoke',version:'1'});
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[root+'scripts/mcp.mjs'],env:{...process.env,SPATIAL_TAKE_URL:base,SPATIAL_TAKE_SESSION:path}}));
 const p=await b.newPage({viewport:{width:1440,height:1100}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/Shader|WebGLProgram/.test(m.text()))errors.push(m.text());});
 await p.goto(base+'/?session='+encodeURIComponent(path));await p.waitForFunction(()=>window.replay?.ready);
 await p.locator('#weather-mod').check();await p.evaluate(()=>window.replay.select(null));
 await p.evaluate(()=>{window.replay.weatherScene.setLayout({ceilings:[{id:'roof-a',room:'test',outline:[[-2,2.6,-3],[0,2.6,-3],[0,2.6,2],[-2,2.6,2]]},{id:'roof-b',room:'test',outline:[[0,2.6,-3],[2,2.6,-3],[2,2.6,2],[0,2.6,2]]}],openings:[{id:'window',category:'Window',label:'window/glass',center:[0,.85,-1.4],size:[1.4,1.15,.02],yaw:0}],objects:[{id:'desk',category:'desk',center:[0,-.1,-1],size:[2,.2,2]}]});});
 const next=api('/api/agent/questions/next');await p.waitForFunction(()=>!document.getElementById('ask-input').disabled);
 await p.locator('#ask-input').fill('What is the weather tonight?');await p.locator('#ask-input').press('Enter');const q=await next;assert.equal(q.weather_mod,true);
 const context=JSON.parse((await client.callTool({name:'get_user_context',arguments:{}})).content[0].text);assert.equal(context.interaction.weather_mod,true);
 const entry=context.weather.forecast.find(e=>e.day_offset===0&&e.period==='evening');assert.equal(entry.condition,'rain');
 const result=await client.callTool({name:'show_response',arguments:{question_id:q.id,title:'Tonight: rain showers',body:'Oct 7, evening. 7 °C.',weather:{forecast_ids:[entry.id]}}});assert.ok(!result.isError,JSON.stringify(result));
 await api('/api/agent/questions/done',{id:q.id,message:'Shown',duration:.1});
 await p.waitForFunction(()=>window.replay.weatherScene.target?.kind==='window',null,{timeout:15000});if(await p.locator('#play').getAttribute('aria-label')==='Pause')await p.locator('#play').click();console.log('Weather visible; paused recording before camera probes');
 assert.equal(await p.evaluate(()=>window.replay.weatherScene.group.getObjectByName('rain').isInstancedMesh),true);
 assert.ok(await p.evaluate(()=>window.replay.weatherScene.group.getObjectByName('rain').userData.collisionCount>0),'rain columns hit the environment');
 assert.ok(await p.evaluate(()=>!!window.replay.weatherScene.group.getObjectByName('splash-droplets')));
 const rainBefore=await p.evaluate(()=>Array.from(window.replay.weatherScene.group.getObjectByName('rain').instanceMatrix.array));
 await p.waitForTimeout(300);assert.notDeepEqual(await p.evaluate(()=>Array.from(window.replay.weatherScene.group.getObjectByName('rain').instanceMatrix.array)),rainBefore,'rain moves while recording is paused');
 await p.waitForTimeout(300);await capture(p,'/tmp/weather-window.png');
 await p.evaluate(()=>{const c=window.replay.camera;c.lookAt(0,3,-.3);c.updateMatrixWorld(true);});
 await p.waitForFunction(()=>window.replay.weatherScene.target?.kind==='ceiling',null,{timeout:15000});console.log('Ceiling selected');assert.equal(await p.evaluate(()=>window.replay.weatherScene.group.children.length),2,JSON.stringify(await p.evaluate(()=>({target:{id:window.replay.weatherScene.target?.id,room:window.replay.weatherScene.target?.room},surfaces:window.replay.weatherScene.surfaceTargets.filter(t=>t.kind==='ceiling').map(t=>({id:t.id,room:t.room})),patches:window.replay.weatherScene.group.children.map(t=>t.name)}))));
 await capture(p,'/tmp/weather-ceiling.png');
 await p.evaluate(()=>{const c=window.replay.camera;c.lookAt(0,0,-.7);c.updateMatrixWorld(true);});
 await p.waitForFunction(()=>window.replay.weatherScene.target?.kind==='horizontal',null,{timeout:15000});console.log('Horizontal selected');assert.ok(await p.evaluate(()=>!!window.replay.weatherScene.group.getObjectByName('impact-ripples')));
 await capture(p,'/tmp/weather-puddle.png');
 for(const condition of ['snow','clear','fog','cloudy','partly_cloudy','storm']){
  const e=context.weather.forecast.find(e=>e.condition===condition);
  await p.evaluate(e=>{const r=window.replay;for(const w of r.agent.widgets.values())if(w.userData.response.weather){w.userData.response.weather.forecast=[e];delete w.userData.response.weather.timeline;};r.weatherScene.refresh();},e);
  await p.waitForTimeout(90);
  if(condition==='snow'){assert.ok(await p.evaluate(()=>!!window.replay.weatherScene.group.getObjectByName('snowflakes')));await capture(p,'/tmp/weather-snow.png');}
  if(condition==='clear')await capture(p,'/tmp/weather-sunshine.png');
  if(condition==='fog'){assert.ok(await p.evaluate(()=>!!window.replay.weatherScene.group.getObjectByName('drifting-fog')));const fogBefore=await p.evaluate(()=>window.replay.weatherScene.group.getObjectByName('drifting-fog').position.toArray());await p.waitForTimeout(1300);assert.notDeepEqual(await p.evaluate(()=>window.replay.weatherScene.group.getObjectByName('drifting-fog').position.toArray()),fogBefore,'fog drifts through space');await capture(p,'/tmp/weather-fog.png');}
 }
 await p.evaluate(()=>{const r=window.replay;const before=r.weatherScene.group.children[0].position.toArray();r.twin.setView({mode:'orbit'});r.twin.view.position.set(2,2,2);r.twin.view.lookAt(0,0,-1);r.twin.render();window.weatherBefore=before;});
 assert.deepEqual(await p.evaluate(()=>window.replay.weatherScene.group.children[0].position.toArray()),await p.evaluate(()=>window.weatherBefore),'orbiting retains the world anchor');
 await p.locator('#weather-mod').uncheck();assert.equal(await p.evaluate(()=>window.replay.weatherScene.group.children.length),0);
 await p.locator('#weather-mod').check();await p.waitForFunction(()=>window.replay.weatherScene.group.children.length>0);
 await p.locator('#conv-new').click();await p.waitForFunction(()=>window.replay.weatherScene.group.children.length===0);
 assert.deepEqual(errors,[]);console.log('PASS: context → MCP weather IDs → saved forecast → window/ceiling/desk 3D, toggle and session cleanup');
}finally{await client.close();await b.close();rmSync(dir,{recursive:true,force:true});}
