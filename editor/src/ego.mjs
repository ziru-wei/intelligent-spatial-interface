import * as THREE from 'three';

// Object mod (scripts/ego.py, scripts/jev-pipeline.mjs): the objects an answer is told by, highlighted while it shows. With a 3D model
// (a placed object, or furniture shown as its model) the effect Jev chose acts on the model: bounce (it hops, its original hidden in the
// video meanwhile) or color (a pulsing tint over it). Without one, its box is highlighted (fill and outline, like FindMy's). Overlays
// draw on top, like FindMy's highlight. The bubble with the text is placed by src/placement.mjs.
// getTarget(id) → {center, size, yaw, model?: the model's Object3D, root?: a placed object's root (hidden while it bounces)}.
export const EGO_COLORS={calm:'#67f3d0',attention:'#ffd166',warning:'#ff6b6b'};
// Bounce: three hops in the first 1.2 s of every 3 s, up to 15% of the object's height (3 to 12 cm).
export function bounceOffset(seconds,height){const t=seconds%3;if(t>1.2)return 0;return THREE.MathUtils.clamp(.15*height,.03,.12)*Math.abs(Math.sin(Math.PI*t/.4));}
export const tintOpacity=seconds=>.32+.18*Math.sin(seconds*Math.PI);

export function createEgo({getTarget}){
  const scene=new THREE.Scene(),group=new THREE.Group();group.name='ego-highlight';scene.add(group);
  let response=null,key='',start=0,items=[];
  const overlay=(color,opacity)=>new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthTest:false,depthWrite:false,toneMapped:false});
  function clear(){group.traverse(o=>{if(o.isMesh||o.isLineSegments){if(o.userData.own)o.geometry.dispose();[].concat(o.material).forEach(m=>m.dispose());}});group.clear();items=[];}
  function build(){
    clear();const {effect,objects}=response.ego,color=new THREE.Color(EGO_COLORS[effect.color]||EGO_COLORS.attention);
    for(const o of objects){const t=getTarget(o.id);if(!t)continue;const item={id:o.id,t,node:new THREE.Group()};group.add(item.node);
      if(t.model){
        // The model's meshes, sharing its geometry: tinted (color), or in their own materials drawn on top (bounce).
        t.model.updateWorldMatrix(true,true);const inv=t.model.matrixWorld.clone().invert();
        t.model.traverse(m=>{if(!m.isMesh||!m.visible&&m!==t.model)return;
          const mat=effect.type==='color'?overlay(color,.4):[].concat(m.material).map(x=>{const c=x.clone();c.depthTest=false;c.depthWrite=false;c.transparent=true;return c;});
          const copy=new THREE.Mesh(m.geometry,Array.isArray(mat)&&mat.length===1?mat[0]:mat);copy.matrixAutoUpdate=false;copy.matrix.multiplyMatrices(inv,m.matrixWorld);copy.renderOrder=5;item.node.add(copy);});
        item.model=true;
      }else{
        const fill=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),overlay(color,.14)),line=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),new THREE.LineBasicMaterial({color,transparent:true,opacity:.95,depthTest:false,toneMapped:false}));
        fill.userData.own=line.userData.own=true;fill.renderOrder=line.renderOrder=5;item.node.add(fill,line);
      }
      items.push(item);}
  }
  return {group,
    get active(){return !!response;},
    setResponse(r){const k=r?.ego?JSON.stringify([r.question_id,r.ego]):'';if(k===key)return;key=k;response=r?.ego?r:null;start=performance.now();if(response)build();else clear();},
    /** Before the recorded-camera render: placed objects that bounce are hidden (their copy hops instead); returns the roots to show again. */
    hideBouncing(){if(response?.ego.effect.type!=='bounce')return [];const out=[];for(const i of items){const r=i.t.root;if(i.model&&r?.visible){r.visible=false;out.push(r);}}return out;},
    render(renderer,camera,{bounce=true}={}){
      if(!response||!items.length){group.visible=false;return;}
      const s=(performance.now()-start)/1000,type=response.ego.effect.type;group.visible=true;
      for(const i of items){const t=getTarget(i.id);if(!t){i.node.visible=false;continue;}i.t=t;i.node.visible=true;
        if(i.model){t.model.updateWorldMatrix(true,false);i.node.matrixAutoUpdate=false;i.node.matrix.copy(t.model.matrixWorld);
          if(type==='bounce'){if(!bounce){i.node.visible=false;continue;}i.node.matrix.premultiply(new THREE.Matrix4().makeTranslation(0,bounceOffset(s,t.size[1]),0));}
          else i.node.traverse(m=>{if(m.isMesh)[].concat(m.material).forEach(x=>{x.opacity=tintOpacity(s);});});}
        else{i.node.matrixAutoUpdate=true;i.node.position.fromArray(t.center);i.node.scale.fromArray(t.size).multiplyScalar(1.015);i.node.rotation.set(0,THREE.MathUtils.degToRad(t.yaw||0),0);}}
      const auto=renderer.autoClear;renderer.autoClear=false;try{renderer.render(scene,camera);}finally{renderer.autoClear=auto;}
    },
    dispose:clear};
}
