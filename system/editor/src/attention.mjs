// How a MOD's drawn parts look by where the user's attention is (design doc 12.23): the theme a part shows is the focus (what is being
// said now) or background (modos/themes.mjs; the part's `theme.focus`). Each state has an effect, a representation of it; this module
// holds them (EFFECTS) and applies them to whatever a renderer drew, without the renderer knowing: right before an object is drawn (after
// its renderer has set it for this frame) its opacity and saturation are changed, and right after they are put back, so no renderer ever
// reads them and nothing compounds. A change of state eases over `ms`. New representations of attention (a smaller size, a step aside, a
// blur) are new effects here, explored without touching the renderers.
//   const attention=createAttention();  each frame, before drawing: attention.set(root, 'focus' | 'background', now)
//   attention.scaleOf(root) → its size this frame; attention.easing → whether a transition is under way (keep painting)
import * as THREE from 'three';

/** What each state does to what is drawn: opacity (×), saturation (1 as drawn, 0 grey), and scale (×; read by what places a part on
 *  the view stack: scaleOf). */
export const EFFECTS={
  focus:{opacity:1,saturation:1,scale:1},
  background:{opacity:.28,saturation:.12,scale:.7},
};

const LUMA=new THREE.Vector3(.2126,.7152,.0722);
// The saturation is applied at the end of the material's own shader (any built-in material, and a ShaderMaterial that ends the usual way).
function saturable(m){
  if(m.userData.attSat)return m.userData.attSat;
  const u={value:1};m.userData.attSat=u;
  const before=m.onBeforeCompile,key=m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile=(shader,r)=>{before?.call(m,shader,r);shader.uniforms.attSat=u;
    const end=['#include <dithering_fragment>','#include <colorspace_fragment>'].find(c=>shader.fragmentShader.includes(c));if(!end)return;
    shader.fragmentShader='uniform float attSat;\n'+shader.fragmentShader.replace(end,`${end}\n  gl_FragColor.rgb=mix(vec3(dot(gl_FragColor.rgb,vec3(${LUMA.x},${LUMA.y},${LUMA.z}))),gl_FragColor.rgb,attSat);`);};
  m.customProgramCacheKey=()=>(key?key():'')+'|attention';m.needsUpdate=true;
  return u;
}

export function createAttention({ms=450,effects=EFFECTS}={}){
  const roots=new Map();let easing=false;   // root → {k: 0 focus .. 1 background, eased, at}
  const mix=k=>{const a=effects.focus,b=effects.background,e=k*k*(3-2*k),l=x=>a[x]+(b[x]-a[x])*e;return {opacity:l('opacity'),saturation:l('saturation'),scale:l('scale')};};
  function hook(o,s){
    if(o.userData.attHooked)return;o.userData.attHooked=true;
    const before=o.onBeforeRender,after=o.onAfterRender;
    o.onBeforeRender=function(r,sc,cam,geo,m,group){before?.apply(this,arguments);const fx=s.fx;if(!m||fx.opacity>=.999&&fx.saturation>=.999){if(m?.userData.attSat)m.userData.attSat.value=1;return;}
      m.userData.attOpacity=m.opacity;m.opacity*=fx.opacity;if(m.uniforms?.opacity){m.userData.attUniform=m.uniforms.opacity.value;m.uniforms.opacity.value*=fx.opacity;}
      if(!m.transparent&&fx.opacity<.999){m.transparent=true;m.needsUpdate=true;}
      saturable(m).value=fx.saturation;};
    o.onAfterRender=function(r,sc,cam,geo,m){after?.apply(this,arguments);if(!m||m.userData.attOpacity===undefined)return;
      m.opacity=m.userData.attOpacity;delete m.userData.attOpacity;if(m.userData.attUniform!==undefined){m.uniforms.opacity.value=m.userData.attUniform;delete m.userData.attUniform;}};
  }
  return {
    /** root's state this frame; its objects (made since, too) take the effect as it eases there. */
    set(root,state='focus',now=performance.now()){
      if(!root)return;let s=roots.get(root);const target=state==='background'?1:0;
      if(!s){s={k:target,at:now,fx:mix(target)};roots.set(root,s);}
      const dt=Math.max(0,now-s.at);s.at=now;
      if(s.k!==target){s.k=target>s.k?Math.min(target,s.k+dt/ms):Math.max(target,s.k-dt/ms);easing=true;}
      s.fx=mix(s.k);
      root.traverse(o=>{if(o.isMesh||o.isLine||o.isPoints||o.isSprite)hook(o,s);});
    },
    /** root's size this frame (1 in focus): a part on the view stack is placed at it. */
    scaleOf(root){return roots.get(root)?.fx.scale??1;},
    get easing(){const e=easing;easing=false;return e;},
  };
}
