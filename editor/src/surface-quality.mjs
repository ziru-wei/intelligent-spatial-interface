import * as THREE from 'three';
// Original RGB, not the composited weather/text. A small cached image is enough
// to distinguish printed pages / object boundaries from clear supporting areas.
const featureCache=new WeakMap();
function textureFeatures(image){
 if(featureCache.has(image))return featureCache.get(image);
 const {width:w,height:h,data}=image,luma=new Float32Array(w*h),integral=new Float64Array((w+1)*(h+1));
 for(let i=0;i<w*h;i++)luma[i]=(data[i*4]*.2126+data[i*4+1]*.7152+data[i*4+2]*.0722)/255;
 const at=(x,y)=>luma[Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x))];
 for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){
  const v=at(x,y),fine=Math.max(Math.abs(v-at(x+1,y)),Math.abs(v-at(x,y+1))),coarse=Math.abs(4*v-at(x-3,y)-at(x+3,y)-at(x,y-3)-at(x,y+3))/4;
  row+=Math.min(1,(fine+coarse)/.09);integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+row;
 }}
 const sample=(x,y)=>{const x0=Math.max(0,x-3),x1=Math.min(w,x+4),y0=Math.max(0,y-3),y1=Math.min(h,y+4);return (integral[y1*(w+1)+x1]-integral[y0*(w+1)+x1]-integral[y1*(w+1)+x0]+integral[y0*(w+1)+x0])/Math.max(1,(x1-x0)*(y1-y0));};
 featureCache.set(image,sample);return sample;
}
export function surfaceQuality(pose,aspect,camera,image,depth){
 const scores=[],residuals=[],p=new THREE.Vector3();
 const feature=textureFeatures(image);
 for(let y=0;y<10;y++)for(let x=0;x<18;x++){
  p.set(((x+.5)/18-.5)*pose.width, (.5-(y+.5)/10)*pose.width*aspect,0).applyQuaternion(pose.quaternion).add(pose.position);
  const distance=-p.clone().applyMatrix4(camera.matrixWorldInverse).z;p.project(camera);if(distance<=0||Math.abs(p.x)>1||Math.abs(p.y)>1)continue;
  const u=(p.x+1)/2,v=(1-p.y)/2,ix=Math.floor(u*image.width),iy=Math.floor(v*image.height);
  scores.push(feature(ix,iy));
  if(depth){const d=depth.data[Math.min(depth.height-1,Math.floor(v*depth.height))*depth.width+Math.min(depth.width-1,Math.floor(u*depth.width))];if(d>0)residuals.push(distance-d);}
 }
 if(!scores.length)return {clutter:1,roughness:1,cost:6};
 scores.sort((a,b)=>b-a);const busy=scores.slice(0,Math.ceil(scores.length*.6));
 const clutter=busy.reduce((a,b)=>a+b,0)/busy.length;
 residuals.sort((a,b)=>a-b);const spread=residuals.length?residuals[Math.floor(residuals.length*.85)]-residuals[Math.floor(residuals.length*.15)]:0;
 const roughness=Math.min(1,spread/.10);
 // A uniformly raised book can be smooth and low texture, yet still occupy the
 // supporting desk. Variation alone misses it: score positive depth residual too.
 const occupied=residuals.length?residuals.reduce((sum,r)=>sum+Math.max(0,Math.min(1,(r-.03)/.06)),0)/residuals.length:0;
 return {clutter,roughness,occupied,cost:4*clutter+2*roughness+4*occupied};
}
