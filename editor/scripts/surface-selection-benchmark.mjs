// Static-candidate ablation, not a historical end-to-end baseline.
// Read-only: mocks agent endpoints; samples the same frames and content in each recording.
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const p=await browser.newPage({viewport:{width:1400,height:1000}});
await p.route('**/api/agent/**',route=>{const path=new URL(route.request().url()).pathname;let json={ok:true};if(path.endsWith('/command'))json={command:'test'};if(path.endsWith('/conversations'))json=[{id:'bench',name:'Bench',created:1}];if(path.endsWith('/status'))json={connected:false,questions:[],responses:[]};return route.fulfill({json});});
for(const name of ['reco_reading','reco_brush','reco_go-to-bed']){
 await p.goto('http://127.0.0.1:8766/?session=./spaces/home/scenarios/'+name+'/session.json');await p.waitForFunction(()=>window.replay?.ready,null,{timeout:90000});
 const result=await p.evaluate(async()=>{
 const r=replay;r.agent.stop();const THREE=await import('three'),{surfaceQuality}=await import('/src/surface-quality.mjs'),{staticTextPlacement}=await import('/src/text-surfaces.mjs'),{readableSurfaceBasis}=await import('/src/placement.mjs');
 const oldBasis=(n,q)=>{const up=new THREE.Vector3(0,1,0).applyQuaternion(q);up.addScaledVector(n,-up.dot(n)).normalize();return {up,right:up.clone().cross(n).normalize()};};
 const rows=[];
 for(const fraction of [.2,.45,.7,.9]){
  const frame=Math.floor((r.session.frames.length-1)*fraction);await r.setFrame(frame);
  const image=new Image();image.src=new URL(r.session.frames[frame].image,r.handData.key.split('#')[0]);await image.decode();const canvas=new OffscreenCanvas(384,Math.round(384*image.height/image.width)),c=canvas.getContext('2d');c.drawImage(image,0,0,canvas.width,canvas.height);const pixels=c.getImageData(0,0,canvas.width,canvas.height),depth=(await r.depthMap(frame)).image;
  const quality=(pose,aspect)=>surfaceQuality(pose,aspect,r.camera,pixels,depth);
  const ctx={frameCamera:()=>r.camera,viewport:()=>({width:document.getElementById('stage').clientWidth,height:document.getElementById('stage').clientHeight}),getStaticSurfaces:()=>r.weatherScene.surfaceTargets,visible:(i,points,o)=>r.visibleIn(i,points,{...o,text:true})};
  const response={frame,aspect:.55,textMetrics:{xHeightRatio:.027,box:{x0:.06,x1:.94,y0:.1,y1:.9}}};
  const row={frame};for(const [key,basis,withQuality] of [['centreOnly',oldBasis,false],['new',readableSurfaceBasis,true]]){
   const pose=await staticTextPlacement(response,{...ctx,...(withQuality?{getSurfaceQuality:async()=>quality}:{})},basis);
   if(!pose){row[key]=null;continue;}const right=new THREE.Vector3(1,0,0).applyQuaternion(pose.quaternion),a=pose.position.clone().addScaledVector(right,-pose.width/2).project(r.camera),b=pose.position.clone().addScaledVector(right,pose.width/2).project(r.camera);row[key]={surface:pose.surfaceId,cost:+quality(pose,.55).cost.toFixed(3),angle:+(Math.atan2((b.y-a.y)*ctx.viewport().height,(b.x-a.x)*ctx.viewport().width)*180/Math.PI).toFixed(3)};
  }rows.push(row);
 }return rows;
 });console.log(JSON.stringify({recording:name,rows:result}));
}
}finally{await browser.close();}
