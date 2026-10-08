import * as THREE from 'three';

/** Recorded-view hand foreground pass. Call after spatial virtual content,
 * before fixed screen text and the question HUD that must remain above hands.
 * The mask and RGB must belong to the same frame. Never reuse in another camera.
 * Perception stays renderer-independent; only this adapter knows about Three.js.
 */
export function createHandCompositor(){
 const scene=new THREE.Scene(),camera=new THREE.Camera();
 const empty=new THREE.DataTexture(new Uint8Array([0]),1,1,THREE.RedFormat);empty.needsUpdate=true;
 const uniforms={rgb:{value:null},mask:{value:empty},protectAll:{value:0}};
 const material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,transparent:true,uniforms,
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  // DataTexture uses top-left input. Explicit UV flip avoids WebGL's typed-array flipY ambiguity.
  fragmentShader:`uniform sampler2D rgb,mask;uniform float protectAll;varying vec2 vUv;
   void main(){float alpha=protectAll>.5?1.:smoothstep(.08,.92,texture2D(mask,vec2(vUv.x,1.-vUv.y)).r);if(alpha<=0.)discard;
    gl_FragColor=vec4(texture2D(rgb,vUv).rgb,alpha);
    #include <colorspace_fragment>
   }`});
 const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);quad.frustumCulled=false;scene.add(quad);
 const cache=new Map();
 return {
  render(renderer,rgb,result){
   if(!rgb)return;
   const ready=result?.status==='ready';if(ready&&result.landmarks?.length===0)return;let texture=ready?cache.get(result):empty;
   if(ready&&!texture){texture=new THREE.DataTexture(result.mask,result.width,result.height,THREE.RedFormat,THREE.UnsignedByteType);texture.unpackAlignment=1;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;cache.set(result,texture);
    while(cache.size>8){const key=cache.keys().next().value;cache.get(key).dispose();cache.delete(key);}}
   uniforms.rgb.value=rgb;uniforms.mask.value=texture;uniforms.protectAll.value=ready?0:1;
   const auto=renderer.autoClear;renderer.autoClear=false;
   try{renderer.render(scene,camera);}finally{renderer.autoClear=auto;}
  },
  dispose(){for(const texture of cache.values())texture.dispose();cache.clear();empty.dispose();quad.geometry.dispose();material.dispose();}
 };
}
