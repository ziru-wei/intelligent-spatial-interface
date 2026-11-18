import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {buildWeatherTargets,selectWeatherTarget,forecastAt,SURFACE_LIFT,GLASS_INSET} from '../src/weather-scene.mjs';
const targets=buildWeatherTargets({ceilings:[{id:'roof',room:'room',outline:[[-2,2,-2],[2,2,-2],[2,2,2],[-2,2,2]]}],openings:[{id:'frame',label:'window',category:'Window',center:[0,0,-2],size:[1.4,1.4,.02]},{id:'glass',label:'window/glass',parent:'frame',category:'Window',center:[0,0,-2],size:[1,1,.02]}],objects:[{id:'desk',category:'desk',center:[0,-1,0],size:[2,.2,2]}]});
const camera=direction=>{const c=new THREE.PerspectiveCamera(50,1,.01,100);c.lookAt(...direction);c.updateMatrixWorld(true);return c;};
test('parameterized glass excludes its parent frame and insets every edge',()=>{
 assert.deepEqual(targets.filter(t=>t.kind==='window').map(t=>t.id),['glass']);assert.equal(targets[1].width,1-2*GLASS_INSET);assert.equal(targets[1].height,1-2*GLASS_INSET);
 assert.equal(selectWeatherTarget(camera([0,0,-1]),targets,null).source,'parametric-layout');assert.ok(SURFACE_LIFT>=.03&&SURFACE_LIFT<.1);
});
test('ceiling and tabletop retain their layout coordinates',()=>{
 const roof=selectWeatherTarget(camera([0,1,0]),targets,null);assert.equal(roof.id,'roof');assert.equal(roof.origin.y,2);assert.equal(roof.n.y,-1);
 assert.equal(selectWeatherTarget(camera([0,-1,0]),targets,null).id,'desk:top');
});
test('concave ceiling respects polygon rather than bounding rectangle',()=>{
 const t=buildWeatherTargets({ceilings:[{id:'L',outline:[[-2,2,-2],[2,2,-2],[2,2,0],[0,2,0],[0,2,2],[-2,2,2]]}]});
 assert.equal(selectWeatherTarget(camera([1,2,1]),t,null),null);assert.equal(selectWeatherTarget(camera([-1,2,1]),t,null).id,'L');
});
test('scan hits never define or redirect an effect surface',()=>{
 const hit={point:new THREE.Vector3(0,0,-.5),distance:.5,normal:new THREE.Vector3(0,0,1)};
 assert.equal(selectWeatherTarget(camera([0,0,-1]),targets,hit).id,'glass');
 assert.equal(selectWeatherTarget(camera([0,0,-1]),[],hit),null);
});
test('all six rotated box faces are available, nearest box takes priority over glass',()=>{
 const box=buildWeatherTargets({objects:[{id:'cabinet',center:[0,0,-1],size:[1,1,.4],yaw:30}]});
 assert.equal(box.length,6);const t=selectWeatherTarget(camera([0,0,-1]),[...targets,...box]);
 assert.equal(t.objectId,'cabinet');assert.equal(t.kind,'vertical');assert.equal(t.partial,true);assert.equal(t.source,'parametric-layout');
 assert.ok(Math.abs(t.n.x-.5)<1e-6);assert.ok(t.width<=1&&t.height<=1);
});
test('parametric wall holes remain empty and floors keep their plane',()=>{
 const outer=[[-2,-2,-2],[2,-2,-2],[2,2,-2],[-2,2,-2]],hole=[[-.4,-.4,-2],[.4,-.4,-2],[.4,.4,-2],[-.4,.4,-2]];
 const walls=buildWeatherTargets({walls:[{id:'wall',region:[[outer,hole]],yaw:0}],rooms:[{id:'room',floorY:-1,polygon:[[[[-2,-2],[2,-2],[2,2],[-2,2]]]]}]});
 assert.equal(selectWeatherTarget(camera([0,0,-1]),walls),null);
 const wall=selectWeatherTarget(camera([1,0,-2]),walls);assert.equal(wall.surface,'wall');assert.equal(wall.origin.z,-2);assert.equal(wall.partial,true);
 const floor=selectWeatherTarget(camera([0,-1,0]),walls);assert.equal(floor.surface,'floor');assert.equal(floor.origin.y,-1);
});
test('weather ranges cycle periods without changing the source data',()=>{const f=[{id:'morning'},{id:'afternoon'},{id:'evening'}];assert.equal(forecastAt(f,0).id,'morning');assert.equal(forecastAt(f,9).id,'afternoon');assert.equal(forecastAt(f,24).id,'morning');});
test('peripheral glass is selected without a centre-ray hit',()=>{
 const layout=buildWeatherTargets({openings:[{id:'side-window',label:'window/glass',center:[.52,0,-2],size:[.4,1,.02]}],walls:[{id:'wall',outline:[[-2,-2,-2],[2,-2,-2],[2,2,-2],[-2,2,-2]]}]});
 assert.equal(selectWeatherTarget(camera([0,0,-1]),layout).id,'side-window');
 const block=buildWeatherTargets({objects:[{id:'foreground',center:[0,0,-.7],size:[2,2,.2]}]});
 assert.equal(selectWeatherTarget(camera([0,0,-1]),[...layout,...block]).objectId,'foreground');
});
test('a slight upward gaze activates ceiling visible in the upper view',()=>{
 const layout=buildWeatherTargets({ceilings:[{id:'ceiling',outline:[[-2,.5,-3],[2,.5,-3],[2,.5,-1],[-2,.5,-1]]}],walls:[{id:'wall',outline:[[-2,-2,-3],[2,-2,-3],[2,2,-3],[-2,2,-3]]}]});
 assert.equal(selectWeatherTarget(camera([0,.1,-1]),layout).kind,'ceiling');
 assert.notEqual(selectWeatherTarget(camera([0,-.2,-1]),layout).kind,'ceiling');
});
