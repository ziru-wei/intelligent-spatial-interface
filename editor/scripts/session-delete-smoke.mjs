import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 let sessions=[{id:'20261007-100000',name:'Keep',created:1,questions:0},{id:'20261007-100001',name:'Delete',created:2,questions:0}],deleted=[];
 await p.route('**/api/agent/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={ok:true};
  if(path==='/api/agent/command')data={command:'test'};
  if(path==='/api/agent/conversations')data=sessions;
  if(path==='/api/agent/status')data={connected:false,questions:[],responses:[]};
  if(path==='/api/agent/conversations/delete'){
   const id=req.postDataJSON().conversation;deleted.push(id);sessions=sessions.filter(c=>c.id!==id);
   if(!sessions.length)sessions=[{id:'20261007-100002',name:'Empty',created:3,questions:0}];
   data={ok:true,conversation:sessions.at(-1).id};
  }
  await route.fulfill({json:data});
 });
 await p.route('**/api/composition',r=>r.fulfill({json:{revision:1}}));
 await p.goto('http://127.0.0.1:8766');await p.waitForFunction(()=>window.replay?.ready);
 assert.equal(await p.locator('#conv-new + #conv-delete').count(),1);
 await p.locator('#conv-delete').click();await p.waitForFunction(()=>window.replay.agent.conversation==='20261007-100000');
 assert.deepEqual(deleted,['20261007-100001']);assert.equal(await p.locator('#conv option').count(),1);
 await p.locator('#conv-delete').click();await p.waitForFunction(()=>window.replay.agent.conversation==='20261007-100002');
 assert.equal(await p.locator('#conv option:checked').textContent(),'Empty');
 assert.equal(await p.locator('#markers .marker').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS: Delete beside New, deletes current session, selects remaining session, last session replaced with empty one');
}finally{await browser.close();}
