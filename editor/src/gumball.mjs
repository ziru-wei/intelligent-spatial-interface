import * as THREE from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';

// One local frame, with arrows, rotation arcs and scale boxes available together.
// TransformControls supplies the transform math; one pointer owner prevents overlapping
// pick volumes from starting multiple operations (or orbiting) on the same drag.
export class Gumball extends THREE.EventDispatcher {
  constructor(camera,canvas){
    super();this.canvas=canvas;this.root=new THREE.Group();this.controls=[];this.active=null;this._enabled=true;
    for(const mode of ['translate','rotate','scale']){
      const c=new TransformControls(camera);c.setMode(mode);c.setSpace('local');c.setSize(mode==='rotate'?.8:mode==='scale'?1.45:1);
      const visual=c._gizmo.gizmo[mode],picker=c._gizmo.picker[mode];
      // Reserve the centre for uniform scaling; no free-rotation sphere or duplicate planes.
      for(const group of [visual,picker])for(const child of [...group.children]){
        if(mode==='rotate'&&!['X','Y','Z'].includes(child.name)||mode==='translate'&&child.name==='XYZ'||mode==='scale'&&!['X','Y','Z','XYZ'].includes(child.name))group.remove(child);
      }
      if(mode==='scale'){
        // Keep only box handles. Pick their boxes, not the default full-axis cones.
        for(const child of [...visual.children])if(child.geometry.type!=='BoxGeometry')visual.remove(child);
        picker.clear();for(const child of visual.children){const hit=child.clone();hit.geometry=child.geometry.clone();picker.add(hit);}
      }
      this.controls.push(c);this.root.add(c.getHelper());
      for(const type of ['change','objectChange','mouseDown','mouseUp','dragging-changed'])c.addEventListener(type,e=>this.dispatchEvent({type,mode,...('value'in e?{value:e.value}:{})}));
    }
    const pointer=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*2-1,y:1-(e.clientY-r.top)/r.height*2,button:e.button};};
    const pick=e=>{
      if(!this.enabled||!this.object)return null;
      this.root.updateMatrixWorld(true);const p=pointer(e),ray=new THREE.Raycaster();ray.setFromCamera(p,this.camera);
      let best=null;
      for(const c of this.controls){const hit=ray.intersectObject(c._gizmo.picker[c.mode],true).find(h=>h.object.visible);if(hit&&(!best||hit.distance<best.hit.distance))best={c,hit};}
      for(const c of this.controls)c.axis=best?.c===c?best.hit.object.name:null;
      return best?.c;
    };
    canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0||this.active)return;const c=pick(e);if(!c)return;
      e.stopImmediatePropagation();this.active=c;this.pointerId=e.pointerId;this.suppressClick=true;
      canvas.setPointerCapture(e.pointerId);this.root.updateMatrixWorld(true);c.pointerDown(pointer(e));
    },true);
    canvas.addEventListener('pointermove',e=>{
      if(this.active){if(e.pointerId!==this.pointerId)return;e.stopImmediatePropagation();this.active.pointerMove({...pointer(e),button:-1});}
      else pick(e);
    },true);
    const finish=e=>{if(!this.active||e.pointerId!==this.pointerId)return;e.stopImmediatePropagation();this.finish();};
    canvas.addEventListener('pointerup',finish,true);canvas.addEventListener('pointercancel',finish,true);canvas.addEventListener('lostpointercapture',finish,true);
    canvas.addEventListener('click',e=>{if(this.suppressClick){this.suppressClick=false;e.stopImmediatePropagation();}},true);
    // A later ordinary click must never be swallowed after a cancelled drag.
    canvas.addEventListener('pointerdown',()=>{if(!this.active)this.suppressClick=false;});
  }
  finish(){const c=this.active;if(!c)return;this.active=null;c.pointerUp({button:0});if(this.canvas.hasPointerCapture(this.pointerId))this.canvas.releasePointerCapture(this.pointerId);}
  get object(){return this.controls[0].object;}
  get axis(){return this.active?.axis||this.controls.find(c=>c.axis)?.axis||null;}
  get dragging(){return !!this.active;}
  get camera(){return this.controls[0].camera;}
  set camera(value){for(const c of this.controls)c.camera=value;}
  get enabled(){return this._enabled;}
  set enabled(value){if(!value)this.finish();this._enabled=value;for(const c of this.controls)c.enabled=value;}
  getHelper(){return this.root;}
  attach(object){for(const c of this.controls)c.attach(object);return this;}
  detach(){this.finish();for(const c of this.controls)c.detach();return this;}
}
