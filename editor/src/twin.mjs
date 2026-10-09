import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Gumball} from './gumball.mjs';

// View modes: follow (the recorded camera, default), orbit, walk (first person on the scanned floor), and orthographic plan/elevations
// with a section plane that removes the room between the viewer and the cut. Y is up, so the two horizontal section axes are X and Z.
const SECTION={plan:{axis:'y',label:'Cut height Y'},'elevation-x':{axis:'x',label:'Section X'},'elevation-z':{axis:'z',label:'Section Z'}};

export function createTwin({canvas,scene,camera,anchor,onMove,getRoom}){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,stencil:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.localClippingEnabled=true;
  const view=new THREE.PerspectiveCamera(50,1,.01,100);view.position.set(4,3.5,5);
  const follow=new THREE.PerspectiveCamera(50,1,.02,100),walker=new THREE.PerspectiveCamera(65,1,.02,100),ortho=new THREE.OrthographicCamera(-1,1,1,-1,.01,200);
  const orbit=new OrbitControls(view,canvas);orbit.target.set(0,1,0);
  const helper=new THREE.Group();scene.add(helper);
  const grid=new THREE.GridHelper(12,24,0x5a5a5a,0x2a2a2a);helper.add(grid);
  const trajectory=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xdddddd}));helper.add(trajectory);
  const debugCamera=camera.clone();debugCamera.matrixAutoUpdate=false;const frustum=new THREE.CameraHelper(debugCamera);helper.add(frustum);
  const gizmo=new Gumball(view,canvas);if(anchor)gizmo.attach(anchor);helper.add(gizmo.getHelper());
  // The gizmo moves the selected component (null: none).
  function attach(o){if(o)gizmo.attach(o);else gizmo.detach();render();}
  gizmo.addEventListener('dragging-changed',e=>orbit.enabled=!e.value&&mode!=='follow'&&mode!=='walk');
  // Moved, turned or scaled: the whole object (position, rotation, scale) goes back to the editor; hover highlights redraw.
  gizmo.addEventListener('objectChange',()=>gizmo.object&&onMove(gizmo.object));gizmo.addEventListener('change',()=>render());
  orbit.addEventListener('change',()=>render());
  // Trackpad: two-finger scrolling pans (the content follows the fingers); a pinch (ctrl + wheel) and a mouse wheel still zoom.
  const panBy=(dx,dy)=>{const cam=active(),h=canvas.clientHeight||1,w=canvas.clientWidth||1;let sx,sy;
    if(cam.isPerspectiveCamera){const k=2*cam.position.distanceTo(orbit.target)*Math.tan(THREE.MathUtils.degToRad(cam.fov/2))/h;sx=dx*k;sy=dy*k;}
    else{sx=dx*(cam.right-cam.left)/cam.zoom/w;sy=dy*(cam.top-cam.bottom)/cam.zoom/h;}
    cam.updateMatrixWorld();const offset=new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld,0).multiplyScalar(sx).addScaledVector(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld,1),-sy);
    cam.position.add(offset);orbit.target.add(offset);orbit.update();render();};
  const trackpadScroll=e=>!e.ctrlKey&&e.deltaMode===0&&(e.deltaX!==0||!Number.isInteger(e.deltaY)||Math.abs(e.deltaY)<40);
  canvas.addEventListener('wheel',e=>{if(!orbit.enabled||gizmo.dragging||!trackpadScroll(e))return;e.preventDefault();e.stopImmediatePropagation();panBy(e.deltaX,e.deltaY);},{capture:true,passive:false});
  let loaded=false,mode='follow',cut=0,flip=false,cutObjects=false,cuttable=()=>[];
  const viewCenter=new THREE.Vector3(),clip=new THREE.Plane(),renderHooks=[];let hidden=null;   // objects left out of this view (setHidden)
  const videoTexture=new THREE.CanvasTexture(document.getElementById('stage'));videoTexture.colorSpace=THREE.SRGBColorSpace;
  const videoPanel=new THREE.Mesh(new THREE.PlaneGeometry(1.6,1),new THREE.MeshBasicMaterial({map:videoTexture,side:THREE.DoubleSide,toneMapped:false}));
  videoPanel.name='Recorded video preview';videoPanel.visible=false;helper.add(videoPanel);
  const debugOptions={trajectory:true,frustum:true,video:false,roomColors:true,spaceScan:true,recordingMesh:true,lidar:false,semantic:true};
  // Layers only this view shows: the frame's LiDAR depth as points, and the scene layout's labelled boxes (src/layout-editor.mjs).
  const lidar=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0x8fd3ff,size:.012,sizeAttenuation:true,transparent:true,opacity:.85}));
  lidar.frustumCulled=false;helper.add(lidar);
  const semantic=new THREE.Group();helper.add(semantic);
  // A scan not yet aligned to this recording: shown here only, to pick points on when aligning by hand.
  const alignScan=new THREE.Group();helper.add(alignScan);
  function setAlignScan(g){alignScan.clear();if(g){g.traverse(o=>{if(o.isMesh)o.material=new THREE.MeshBasicMaterial({vertexColors:!!o.geometry.attributes.color,side:THREE.DoubleSide});});alignScan.add(g);}render();}
  function setLidar(positions){lidar.geometry.dispose();lidar.geometry=new THREE.BufferGeometry();if(positions)lidar.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));render();}
  function setDebug(options){Object.assign(debugOptions,options);render();}
  function active(){return mode==='orbit'?view:mode==='follow'?follow:mode==='walk'?walker:ortho;}
  function bounds(){const room=getRoom(),box=new THREE.Box3();if(room)box.setFromObject(room);if(box.isEmpty())box.setFromBufferAttribute(trajectory.geometry.attributes.position).expandByScalar(1.5);return box;}
  // Floor height: 5th percentile of room vertex heights; the bounding-box minimum is dominated by LiDAR noise below the floor.
  function floorY(fallback){
    const ys=[],v=new THREE.Vector3();getRoom()?.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i+=4)ys.push(v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).y);}});
    return ys.length?ys.sort((a,b)=>a-b)[Math.floor(ys.length*.05)]:fallback;
  }
  // Room drawn with its own material in this view: vertex colors (fused mesh) or a wireframe, plus the section plane.
  function roomMaterial(mesh){
    // Colours: a fused mesh's vertex colours or a scanning app's texture (kept by the editor in userData.scanMap).
    const map=mesh.userData.scanMap||null,colors=(!!mesh.geometry.attributes.color||!!map)&&debugOptions.roomColors;
    const m=mesh.userData.twinMaterial||=new THREE.MeshBasicMaterial();
    // Scan normals face the scanned side, so front faces show the room interior from outside (walls nearest the viewer drop out).
    m.color.set(colors?0xffffff:0x888888);m.map=colors?map:null;
    Object.assign(m,{vertexColors:colors&&!map&&!!mesh.geometry.attributes.color,wireframe:!colors,transparent:!colors,opacity:colors?1:.45,depthWrite:colors,side:colors?THREE.FrontSide:THREE.DoubleSide,clippingPlanes:SECTION[mode]?[clip]:[]});
    m.needsUpdate=true;return m;
  }
  function resetView(){
    if(mode==='orbit'){orbit.target.copy(viewCenter);view.position.copy(viewCenter).add(new THREE.Vector3(3,2.5,4));}
    else if(mode==='walk')enterWalk(camera);
    else if(SECTION[mode]){
      const box=bounds(),c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3()),d=Math.max(s.x,s.y,s.z)+5,sign=flip?-1:1;
      ortho.up.set(0,1,0);ortho.zoom=1;
      if(mode==='plan'){ortho.position.set(c.x,box.max.y+d,c.z);ortho.up.set(0,0,-1);ortho.userData.extent=[s.x,s.z];}
      else if(mode==='elevation-x'){ortho.position.set(c.x+sign*(s.x/2+d),c.y,c.z);ortho.userData.extent=[s.z,s.y];}
      else{ortho.position.set(c.x,c.y,c.z+sign*(s.z/2+d));ortho.userData.extent=[s.x,s.y];}
      ortho.far=2*d+Math.max(s.x,s.y,s.z);orbit.target.copy(c);ortho.lookAt(c);
    }
    orbit.update();render();
  }
  function setView(options){
    const next=options.mode??mode,changed=next!==mode,previous=active();mode=next;
    // Orbit picks up exactly where the follow or walk view was (same pose and field of view), orbiting a point 2 m ahead.
    if(changed&&mode==='orbit'&&(previous===follow||previous===walker)){
      view.position.copy(previous.position);view.fov=previous.fov;view.updateProjectionMatrix();
      orbit.target.copy(previous.position).add(new THREE.Vector3(0,0,-2).applyQuaternion(previous.quaternion));
    }
    if(changed&&mode==='walk')enterWalk(previous);
    if('flip' in options)flip=options.flip;
    if('cutObjects' in options)cutObjects=!!options.cutObjects;
    const section=SECTION[mode];let range=null;
    if(section){
      // Flat rooms (a single plane) would give an empty slider range; keep at least ±1 m.
      const box=bounds(),a=section.axis,flat=box.max[a]-box.min[a]<.5,min=box.min[a]-(flat?1:0),max=box.max[a]+(flat?1:0);
      // Default cut: 1.2 m above the floor for plans (architectural convention), the middle for elevations.
      if(changed)cut=a==='y'?Math.min(max,floorY(min)+1.2):(min+max)/2;
      if('cut' in options)cut=options.cut;
      // Keep the side away from the viewer: below the cut for plans, behind the section plane for elevations.
      const n=new THREE.Vector3();n[a]=a==='y'||!flip?-1:1;clip.normal.copy(n);clip.constant=-n[a]*cut;
      range={label:section.label,min,max,value:cut};
    }
    orbit.object=active();gizmo.camera=active();orbit.enableRotate=mode==='orbit';orbit.enabled=mode!=='follow'&&mode!=='walk';
    if(changed&&mode==='orbit'&&(previous===follow||previous===walker)){orbit.update();render();}
    else if(changed||'flip' in options)resetView();else render();
    return range&&{...range,cutObjects};
  }
  // Walk: a 10 cm grid of the scanned floor. Walkable cells have room vertices at floor height and none between 0.25 m and 1.7 m above it
  // (walls, furniture), shrunk by a 0.2 m body radius. Without a room mesh, anywhere within 1 m of the recorded path.
  const walk={grid:null,room:undefined,yaw:0,pitch:0,keys:new Set(),last:0};
  function walkGrid(){
    const room=getRoom();if(walk.grid&&walk.room===room)return walk.grid;walk.room=room;
    const cell=.1,box=bounds(),floor=floorY(box.min.y),nx=Math.ceil((box.max.x-box.min.x)/cell)+1,nz=Math.ceil((box.max.z-box.min.z)/cell)+1;
    const at=(x,z)=>{const i=Math.floor((x-box.min.x)/cell),k=Math.floor((z-box.min.z)/cell);return i<0||k<0||i>=nx||k>=nz?-1:k*nx+i;};
    const ok=new Uint8Array(nx*nz);
    if(!room){const path=new THREE.Box3().setFromBufferAttribute(trajectory.geometry.attributes.position).expandByScalar(1);for(let k=0;k<nz;k++)for(let i=0;i<nx;i++){const x=box.min.x+(i+.5)*cell,z=box.min.z+(k+.5)*cell;ok[k*nx+i]=x>=path.min.x&&x<=path.max.x&&z>=path.min.z&&z<=path.max.z?1:0;}}
    else{
      const floorCells=new Uint8Array(nx*nz),blocked=new Uint8Array(nx*nz),v=new THREE.Vector3();
      room.updateMatrixWorld(true);room.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let j=0;j<p.count;j++){v.fromBufferAttribute(p,j).applyMatrix4(o.matrixWorld);const c=at(v.x,v.z);if(c<0)continue;const h=v.y-floor;if(Math.abs(h)<.12)floorCells[c]=1;else if(h>.25&&h<1.7)blocked[c]=1;}});
      for(let k=0;k<nz;k++)for(let i=0;i<nx;i++){
        let floorNear=false,blockedNear=false;
        for(let dk=-2;dk<=2&&!blockedNear;dk++)for(let di=-2;di<=2;di++){const ii=i+di,kk=k+dk;if(ii<0||kk<0||ii>=nx||kk>=nz)continue;const c=kk*nx+ii;if(blocked[c]&&di*di+dk*dk<=4){blockedNear=true;break;}if(Math.abs(di)<=1&&Math.abs(dk)<=1&&floorCells[c])floorNear=true;}
        ok[k*nx+i]=floorNear&&!blockedNear?1:0;
      }
    }
    // Eye height: the average height the phone was held at while recording.
    const pos=trajectory.geometry.attributes.position;let eye=0;for(let j=0;j<pos.count;j++)eye+=pos.getY(j);eye/=Math.max(1,pos.count);
    return walk.grid={walkable:(x,z)=>{const c=at(x,z);return c>=0&&ok[c]===1;},eye,cell,box,ok,nx,nz};
  }
  function enterWalk(from){
    const g=walkGrid(),p=from.position.clone(),f=new THREE.Vector3(0,0,-1).applyQuaternion(from.quaternion);
    walk.yaw=Math.atan2(-f.x,-f.z);walk.pitch=THREE.MathUtils.clamp(Math.asin(f.y),-.6,.6);
    // Start where the previous camera stood, or at the nearest walkable cell.
    if(!g.walkable(p.x,p.z)){let best=null,bd=Infinity;for(let k=0;k<g.nz;k++)for(let i=0;i<g.nx;i++)if(g.ok[k*g.nx+i]){const x=g.box.min.x+(i+.5)*g.cell,z=g.box.min.z+(k+.5)*g.cell,d=(x-p.x)**2+(z-p.z)**2;if(d<bd){bd=d;best=[x,z];}}if(best){p.x=best[0];p.z=best[1];}}
    walker.position.set(p.x,g.eye,p.z);walker.fov=65;applyLook();
  }
  function applyLook(){walker.quaternion.setFromEuler(new THREE.Euler(walk.pitch,walk.yaw,0,'YXZ'));}
  function walkStep(now){
    if(mode!=='walk'||!walk.keys.size){walk.last=0;return;}
    const dt=walk.last?Math.min(.05,(now-walk.last)/1000):0;walk.last=now;
    const g=walkGrid(),speed=walk.keys.has('shift')?2.4:1.2,fwd=(walk.keys.has('w')?1:0)-(walk.keys.has('s')?1:0),side=(walk.keys.has('d')?1:0)-(walk.keys.has('a')?1:0);
    const dx=(-Math.sin(walk.yaw)*fwd+Math.cos(walk.yaw)*side)*speed*dt,dz=(-Math.cos(walk.yaw)*fwd-Math.sin(walk.yaw)*side)*speed*dt,p=walker.position;
    // Slide along walls: try the full step, then each axis alone.
    if(g.walkable(p.x+dx,p.z+dz)){p.x+=dx;p.z+=dz;}else if(g.walkable(p.x+dx,p.z))p.x+=dx;else if(g.walkable(p.x,p.z+dz))p.z+=dz;
    render();requestAnimationFrame(walkStep);
  }
  const typing=e=>e.target.matches?.('input[type=text],input[type=number],select,textarea');
  addEventListener('keydown',e=>{if(mode!=='walk'||typing(e)||e.metaKey||e.ctrlKey||e.altKey)return;const k=e.key.toLowerCase();if(!['w','a','s','d','shift'].includes(k))return;e.preventDefault();const idle=!walk.keys.size;walk.keys.add(k);if(idle)requestAnimationFrame(walkStep);});
  addEventListener('keyup',e=>walk.keys.delete(e.key.toLowerCase()));addEventListener('blur',()=>walk.keys.clear());
  // Drag to look around (not when grabbing the object's arrows).
  let look=null;
  canvas.addEventListener('pointerdown',e=>{if(mode==='walk'&&!gizmo.axis){look=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);}});
  canvas.addEventListener('pointermove',e=>{if(!look)return;walk.yaw-=(e.clientX-look[0])*.005;walk.pitch=THREE.MathUtils.clamp(walk.pitch-(e.clientY-look[1])*.005,-1.2,1.2);look=[e.clientX,e.clientY];applyLook();render();});
  canvas.addEventListener('pointerup',()=>look=null);
  let overlay=null,presentation=null;
  let renderWidth=0,renderHeight=0;
  function render(){
    if(!loaded)return;
    const w=canvas.clientWidth||640,h=canvas.clientHeight||400,aspect=w/h;
    if(w!==renderWidth||h!==renderHeight){renderWidth=w;renderHeight=h;renderer.setSize(w,h,false);view.aspect=aspect;view.updateProjectionMatrix();}
    if(mode==='follow'){
      // Recorded pose; vertical field of view from the calibrated focal length (P[1][1] = 2fy/h).
      follow.position.setFromMatrixPosition(camera.matrixWorld);follow.quaternion.setFromRotationMatrix(camera.matrixWorld);
      follow.fov=THREE.MathUtils.radToDeg(2*Math.atan(1/camera.projectionMatrix.elements[5]));follow.aspect=aspect;follow.updateProjectionMatrix();
    }
    if(mode==='walk'){walker.aspect=aspect;walker.updateProjectionMatrix();}
    if(SECTION[mode]){const [ew,eh]=ortho.userData.extent||[4,4],half=Math.max(ew/aspect,eh)/2*1.1;Object.assign(ortho,{left:-half*aspect,right:half*aspect,top:half,bottom:-half});ortho.updateProjectionMatrix();}
    helper.visible=true;
    trajectory.visible=debugOptions.trajectory;frustum.visible=debugOptions.frustum&&mode!=='follow';grid.visible=mode!=='follow'&&mode!=='walk';
    lidar.visible=debugOptions.lidar;semantic.visible=debugOptions.semantic;
    // Space scan / recording mesh toggles apply to this view only; the video keeps both as occluders.
    const parts=getRoom()?.userData.parts||{};if(parts.space)parts.space.visible=debugOptions.spaceScan;if(parts.recording)parts.recording.visible=debugOptions.recordingMesh;
    videoPanel.visible=debugOptions.video&&mode==='orbit';
    if(videoPanel.visible)videoTexture.needsUpdate=true;
    debugCamera.matrixWorld.copy(camera.matrixWorld);debugCamera.projectionMatrix.copy(camera.projectionMatrix);
    debugCamera.projectionMatrix.elements[10]=-(2+.02)/(2-.02);debugCamera.projectionMatrix.elements[14]=-2*2*.02/(2-.02);
    debugCamera.projectionMatrixInverse.copy(debugCamera.projectionMatrix).invert();frustum.update();
    const bg=scene.background;scene.background=new THREE.Color(0x141414);
    const swapped=[];getRoom()?.traverse(o=>{if(o.isMesh){swapped.push([o,o.material]);o.material=roomMaterial(o);}});
    // Layers that follow the view (e.g. clipped by the section plane): src/layout-structure.mjs.
    for(const hook of renderHooks)hook({mode,clip:SECTION[mode]?clip:null,camera:active()});
    const overlayVisible=overlay?.group.visible;if(overlay)overlay.group.visible=false;
    const textGroup=presentation?.group,controls=presentation?.controls,controlsVisible=controls?.visible;if(textGroup)textGroup.visible=false;if(controls)controls.visible=false;
    const hide=(hidden?.()||[]).filter(o=>o.visible);for(const o of hide)o.visible=false;
    // Section views may cut objects and furniture too (Cut objects): their materials take the plane for this render only.
    const clipped=new Map();
    if(SECTION[mode]&&cutObjects)for(const root of cuttable())root?.traverse(o=>{for(const m of [].concat(o.material||[]))if(!clipped.has(m)){clipped.set(m,m.clippingPlanes);m.clippingPlanes=[...(m.clippingPlanes||[]),clip];}});
    renderer.render(scene,active());for(const [m,planes] of clipped)m.clippingPlanes=planes;for(const o of hide)o.visible=true;if(overlay){overlay.group.visible=overlayVisible;overlay.render(renderer,active());}
    if(controls)controls.visible=controlsVisible;presentation?.render(renderer,active());
    for(const [o,m] of swapped)o.material=m;
    if(parts.space)parts.space.visible=true;if(parts.recording)parts.recording.visible=true;
    scene.background=bg;helper.visible=false;
  }
  function setSession(session){
    trajectory.geometry.dispose();trajectory.geometry=new THREE.BufferGeometry().setFromPoints(session.frames.map(f=>new THREE.Vector3(...f.position)));
    const box=new THREE.Box3().setFromPoints(session.frames.map(f=>new THREE.Vector3(...f.position)));const center=box.getCenter(viewCenter);videoPanel.position.copy(center).add(new THREE.Vector3(0,1,-2));
    videoPanel.scale.y=1.6*session.intrinsics.height/session.intrinsics.width;
    loaded=true;resetView();
  }
  helper.visible=false;
  /** Orbit view around a point, from far enough to see a sphere of the given radius (keeps the current viewing direction). */
  function focusOn(point,radius=1.5){if(mode!=='orbit')setView({mode:'orbit'});const dir=view.position.clone().sub(orbit.target);if(dir.lengthSq()<1e-6)dir.set(1,.8,1);
    dir.normalize().multiplyScalar(radius/Math.tan(THREE.MathUtils.degToRad(view.fov/2))*1.1);orbit.target.copy(point);view.position.copy(point).add(dir);orbit.update();render();}
  /** Orbit view framing a box (an object or a piece of furniture): from the south-east (+x, +z; the plan view's top is north, -z),
   *  looking down at 45°, from just far enough that its bounding sphere fits the view. */
  function frame(box){if(!box||box.isEmpty())return;if(mode!=='orbit')setView({mode:'orbit'});
    const c=box.getCenter(new THREE.Vector3()),r=Math.max(.2,box.getSize(new THREE.Vector3()).length()/2),half=THREE.MathUtils.degToRad(view.fov/2);
    const fit=Math.min(half,Math.atan(Math.tan(half)*(view.aspect||1)));
    orbit.target.copy(c);view.position.copy(c).addScaledVector(new THREE.Vector3(1,Math.SQRT2,1).normalize(),r/Math.sin(fit)*1.1);orbit.update();render();}
  return {focusOn,frame,panBy,setCuttable:fn=>{cuttable=fn;},setHidden:fn=>{hidden=fn;},setPresentation:value=>{presentation=value;},setOverlay:value=>{overlay=value;},onRender:hook=>renderHooks.push(hook),attach,render,setSession,setDebug,setView,resetView,walkGrid,setLidar,setAlignScan,lidar,semantic,walker,walkKeys:walk.keys,videoPanel,trajectory,frustum,renderer,view,helper,gizmo,clip,get mode(){return mode;},get camera(){return active();}};
}
