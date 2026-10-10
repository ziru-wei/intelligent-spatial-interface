import * as THREE from 'three';

// Object mod (scripts/ego.py, scripts/jev-pipeline.mjs): the objects an answer is told by, highlighted while it shows. With a 3D model
// (a placed object, or furniture shown as its model) the effect Jev chose acts on the model, drawn as a translucent copy in the model's
// own materials, lit like the scene (lighting: {environment, lights}), that nothing in the room hides (a placed object's original is
// hidden in the video meanwhile; furniture models are not in the video otherwise): bounce (it hops), grow (it swells and shrinks back)
// or color (it stays put under a pulsing tint). Without a model, its box is highlighted (fill and outline, like FindMy's). setRemoved(ids) drops single objects' effects
// (touched by a hand, src/app.mjs). The bubble with the text is placed by src/placement.mjs.
// getTarget(id) → {center, size, yaw, model?: the model's Object3D, root?: a placed object's root (hidden while its copy moves)}.
export const EGO_COLORS={calm:'#67f3d0',attention:'#ffd166',warning:'#ff6b6b'};
// Bounce: three hops in the first 1.2 s of every 3 s, up to 15% of the object's height (3 to 12 cm).
export function bounceOffset(seconds,height){const t=seconds%3;if(t>1.2)return 0;return THREE.MathUtils.clamp(.15*height,.03,.12)*Math.abs(Math.sin(Math.PI*t/.4));}
// Grow: once every 3 s, up to 1.3 times its size and back over 1.2 s.
export function growScale(seconds){const t=seconds%3;return t>1.2?1:1+.3*Math.sin(Math.PI*t/1.2)**2;}
export const GHOST_OPACITY=.7;
const MOVING=new Set(['bounce','grow']);   // in the 3D view, where the originals stay, these copies are left out
export const tintOpacity=seconds=>.32+.18*Math.sin(seconds*Math.PI);

export function createEgo({getTarget,lighting={}}){
  const scene=new THREE.Scene(),group=new THREE.Group();group.name='ego-highlight';scene.add(group);
  scene.environment=lighting.environment||null;for(const l of lighting.lights||[])scene.add(l);
  // Depth of the model copies only (the room's depth is cleared first), so each copy shows its front surface, through everything else.
  const depthOnly=new THREE.MeshBasicMaterial({colorWrite:false});
  let response=null,key='',start=0,items=[],removed=new Set();
  const overlay=(color,opacity)=>new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthTest:false,depthWrite:false,toneMapped:false});
  function clear(){group.traverse(o=>{if(o.isMesh||o.isLineSegments){if(o.userData.own)o.geometry.dispose();[].concat(o.material).forEach(m=>m.dispose());}});group.clear();items=[];}
  // A model's own material, drawn translucent over the room: depth-tested only against the copies themselves (see depthOnly).
  const ghost=m=>{const c=m.clone();Object.assign(c,{transparent:true,opacity:GHOST_OPACITY*(m.transparent?m.opacity:1),depthTest:true,depthWrite:false,depthFunc:THREE.LessEqualDepth});return c;};
  function build(){
    clear();const {effect,objects}=response.ego,color=new THREE.Color(EGO_COLORS[effect.color]||EGO_COLORS.attention);
    for(const o of objects){const t=getTarget(o.id);if(!t)continue;const item={id:o.id,t,node:new THREE.Group()};group.add(item.node);
      if(t.model){
        // The model's meshes, sharing its geometry: in their own materials (the ghost), and for color a tint over them.
        t.model.updateWorldMatrix(true,true);const inv=t.model.matrixWorld.clone().invert();item.ghosts=[];item.tints=[];
        t.model.traverse(m=>{if(!m.isMesh||!m.visible)return;
          const add=(material,order,list)=>{const copy=new THREE.Mesh(m.geometry,material);copy.matrixAutoUpdate=false;copy.matrix.multiplyMatrices(inv,m.matrixWorld);copy.renderOrder=order;item.node.add(copy);list.push(copy);};
          const own=[].concat(m.material).map(ghost);add(own.length===1?own[0]:own,5,item.ghosts);
          if(effect.type==='color')add(Object.assign(overlay(color,.4),{depthTest:true,depthFunc:THREE.LessEqualDepth}),6,item.tints);});
        // The model's bounds in its own frame: the centre it grows about.
        const box=new THREE.Box3();for(const c of item.node.children){c.geometry.computeBoundingBox();box.union(c.geometry.boundingBox.clone().applyMatrix4(c.matrix));}
        item.pivot=box.isEmpty()?new THREE.Vector3():box.getCenter(new THREE.Vector3());item.model=true;
      }else{
        const fill=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),overlay(color,.14)),line=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),new THREE.LineBasicMaterial({color,transparent:true,opacity:.95,depthTest:false,toneMapped:false}));
        fill.userData.own=line.userData.own=true;fill.renderOrder=line.renderOrder=5;item.node.add(fill,line);
      }
      items.push(item);}
  }
  const shown=()=>items.filter(i=>!removed.has(i.id));
  return {group,
    get active(){return !!response&&shown().length>0;},
    setResponse(r){const k=r?.ego?JSON.stringify([r.question_id,r.ego]):'';if(k===key)return;key=k;response=r?.ego?r:null;start=performance.now();if(response)build();else clear();},
    /** The objects whose effect is gone (a hand touched them); the others keep theirs. */
    setRemoved(ids){removed=new Set(ids);},
    /** Before the recorded-camera render: placed objects drawn as copies are hidden; returns the roots to show again. */
    hideOriginals(){if(!response)return [];const out=[];for(const i of shown()){const r=i.t.root;if(i.model&&r?.visible){r.visible=false;out.push(r);}}return out;},
    /** copies: false in the 3D view, where the scene keeps its originals: moving copies are left out, color shows the tint only. */
    render(renderer,camera,{copies=true}={}){
      if(!response||!items.length){group.visible=false;return;}
      const s=(performance.now()-start)/1000,type=response.ego.effect.type;group.visible=true;
      for(const i of items){const t=!removed.has(i.id)&&getTarget(i.id);if(!t){i.node.visible=false;continue;}i.t=t;i.node.visible=true;
        if(i.model){t.model.updateWorldMatrix(true,false);i.node.matrixAutoUpdate=false;i.node.matrix.copy(t.model.matrixWorld);
          for(const g of i.ghosts)g.visible=copies;
          if(MOVING.has(type)){if(!copies){i.node.visible=false;continue;}
            if(type==='bounce')i.node.matrix.premultiply(new THREE.Matrix4().makeTranslation(0,bounceOffset(s,t.size[1]),0));
            else{const k=growScale(s),p=i.pivot;i.node.matrix.multiply(new THREE.Matrix4().makeTranslation(p.x,p.y,p.z).scale(new THREE.Vector3(k,k,k)).multiply(new THREE.Matrix4().makeTranslation(-p.x,-p.y,-p.z)));}}
          else for(const m of i.tints)m.material.opacity=tintOpacity(s);}
        else{i.node.matrixAutoUpdate=true;i.node.position.fromArray(t.center);i.node.scale.fromArray(t.size).multiplyScalar(1.015);i.node.rotation.set(0,THREE.MathUtils.degToRad(t.yaw||0),0);}}
      const models=items.filter(i=>i.model&&i.node.visible),boxes=items.filter(i=>!i.model&&i.node.visible);
      const auto=renderer.autoClear;renderer.autoClear=false;
      try{
        if(models.length){
          // Over the room: its depth is cleared (later passes clear theirs too); the copies' own depth first, then their colour.
          for(const i of boxes)i.node.visible=false;
          renderer.clearDepth();scene.overrideMaterial=depthOnly;renderer.render(scene,camera);scene.overrideMaterial=null;
          for(const i of boxes)i.node.visible=true;
        }
        renderer.render(scene,camera);
      }finally{scene.overrideMaterial=null;renderer.autoClear=auto;}
    },
    dispose(){clear();depthOnly.dispose();}};
}
