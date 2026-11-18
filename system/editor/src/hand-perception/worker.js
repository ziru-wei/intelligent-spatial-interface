// Shared vision worker: no Three.js, FindMy, placement, or scene dependencies.
importScripts('./segmentation.js');
self.exports={};
importScripts('../../node_modules/@mediapipe/tasks-vision/vision_bundle.cjs');
const {HandLandmarker,FilesetResolver}=self.exports;
let ready,cvReady;
async function initialize(){
 const files=await FilesetResolver.forVisionTasks(new URL('../../node_modules/@mediapipe/tasks-vision/wasm',self.location).href);
 const detector=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('../../assets/models/hand_landmarker.task',self.location).href,delegate:'CPU'},runningMode:'IMAGE',numHands:2,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6});
 return detector;
}
self.onmessage=async({data:{id,key,bitmap}})=>{
 try{
  const detector=await(ready??=initialize());
  const started=performance.now(),scale=Math.min(1,384/Math.max(bitmap.width,bitmap.height));
  const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  const result=detector.detect(canvas);let mask;
  if(result.landmarks.length){
   cvReady??=(async()=>{importScripts('../../node_modules/@techstark/opencv-js/dist/opencv.js');return await self.cv;})();
   const fullScale=Math.min(1,768/Math.max(bitmap.width,bitmap.height));
   canvas.width=Math.max(1,Math.round(bitmap.width*fullScale));canvas.height=Math.max(1,Math.round(bitmap.height*fullScale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
   mask=segmentHands(await cvReady,canvas,result.landmarks);
  }else mask=new Uint8Array(canvas.width*canvas.height);
  self.postMessage({id,key,status:'ready',source:'mediapipe-grabcut-clean-v2',width:canvas.width,height:canvas.height,mask,landmarks:result.landmarks,worldLandmarks:result.worldLandmarks,handedness:result.handedness,elapsed_ms:performance.now()-started},[mask.buffer]);
 }catch(error){self.postMessage({id,key,status:'error',error:String(error.message||error)});}
 finally{bitmap.close();}
};
