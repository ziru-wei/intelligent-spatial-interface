// Exports a space of the web editor (editor/spaces/<space>) as the Vision Pro app's resources:
//   SpaceData/<space>/semantic.json                       the layout (zones, walls, furniture, openings), as the editor keeps it
//   SpaceData/<space>/surfaces.json                       the surfaces answer text may go on, built by the editor's own code
//                                                              (editor/src/layout-surfaces.mjs buildTextTargets), so both agree
//   semantic.json infoObjects                              the scene objects carrying info in the live session (below): boxes
//                                                              {id: comp:<id>, label, center, size, yaw (degrees), info}
// and makes the space's live session (editor/spaces/<space>/scenarios/vision-live/session.json, live: true), which the agent bridge
// answers for (scripts/server.py: questions carry the headset's pose instead of a recorded frame; the editor does not list it).
// The scan's colours are baked separately (bake_surface_colors.py), from the surfaces written here.
//
//   node visionos/tools/export-space.mjs [space=atlas]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildTextTargets,frontOnly} from '../../editor/src/layout-surfaces.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),editor=path.resolve(here,'../../editor'),space=process.argv[2]||'atlas';
const spaceDir=path.join(editor,'spaces',space),manifest=JSON.parse(fs.readFileSync(path.join(spaceDir,'space.json'),'utf8'));
const semantic=JSON.parse(fs.readFileSync(path.join(spaceDir,manifest.scan?.semantic||'scan/semantic.json'),'utf8'));
const out=path.resolve(here,'../SpaceData',space);fs.mkdirSync(out,{recursive:true});

const v=p=>[+p.x.toFixed(5),+p.y.toFixed(5),+p.z.toFixed(5)];
// Every surface, ceilings too (weather may go there; text never does: src/text-surfaces.mjs). Triangles: the surface's outline
// (holes cut out) in its own plane, metres from its origin along right and up.
const surfaces=buildTextTargets(semantic).map(t=>({
  id:t.id,kind:t.kind,surface:t.surface||null,room:t.room||null,objectId:t.objectId||null,label:t.label||null,opening:!!t.opening,
  frontOnly:frontOnly(t),origin:v(t.origin),normal:v(t.n),right:v(t.right),up:v(t.up),width:+t.width.toFixed(5),height:+t.height.toFixed(5),
  triangles:t.triangles.flatMap(p=>[+p.x.toFixed(5),+p.y.toFixed(5)])}));
// The live session the headset asks in (kept if it exists: its conversations live next to it).
const liveDir=path.join(spaceDir,'scenarios','vision-live'),live=path.join(liveDir,'session.json');
if(!fs.existsSync(live)){fs.mkdirSync(liveDir,{recursive:true});
  fs.writeFileSync(live,JSON.stringify({version:1,live:true,label:'Vision Pro (live)',frames:[{t:0,position:[0,0,0],quaternion:[0,0,0,1]}]},null,2));}
// Its scene objects: made once from the space's library objects that carry info (the candy...), where they were placed (their
// component.json pose and size); edited in the editor after that like any scene's. The server takes comp:<id> selections from it
// (scripts/info_context.py targets with the session).
const library=path.join(spaceDir,'components'),composition=path.join(liveDir,'composition.json');
const readJSON=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return null;}};
if(!fs.existsSync(composition)){
  const placed=(fs.existsSync(library)?fs.readdirSync(library):[]).map(name=>[name,readJSON(path.join(library,name,'component.json'))])
    .filter(([,c])=>c?.info&&c.pose?.position&&c.kind==='box')
    .map(([name,c],i)=>({id:`v${i+1}`,component:name,name:c.name||name,position:c.pose.position,rotation:c.pose.rotation||[0,0,0],yaw:0,scale:c.defaultScale||[.2,.2,.2],
      visible:true,mount:'floor',params:{},scope:c.scope||'recording',category:c.category||'opportunistic'}));
  fs.writeFileSync(composition,JSON.stringify({version:2,revision:1,components:placed},null,1));}
semantic.infoObjects=(readJSON(composition)?.components||[]).flatMap(c=>{
  const info=readJSON(path.join(library,String(c.component),'component.json'))?.info;
  return info&&c.position&&c.scale?[{id:'comp:'+c.id,label:c.name||c.component,center:c.position,size:c.scale,yaw:c.yaw||0,info}]:[];});
fs.writeFileSync(path.join(out,'semantic.json'),JSON.stringify(semantic));
fs.writeFileSync(path.join(out,'surfaces.json'),JSON.stringify({space,scan:manifest.scan?.label||manifest.scan?.id||null,surfaces}));
console.log(`${space}: ${surfaces.length} surfaces, ${semantic.infoObjects.length} info objects → ${path.relative(process.cwd(),out)}; live session ${path.relative(process.cwd(),live)}`);
