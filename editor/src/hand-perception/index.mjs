/** Renderer-independent, frame-keyed hand data. All consumers share a service.
 * request(key, image) -> {key,status,mask,width,height,landmarks,worldLandmarks,handedness,source}
 * mask: Uint8Array, top-left origin, 255=hand / 0=background.
 * A key identifies immutable source pixels (session URL + frame index).
 */
export function createHandPerception({cacheSize=24,timeoutMs=60000,workerFactory=()=>new Worker(new URL('./worker.js',import.meta.url))}={}){
 let worker=null,nextId=0,disposed=false;
 const cache=new Map(),pending=new Map(),listeners=new Set();
 const notify=value=>{for(const listener of listeners){try{listener(value);}catch(e){console.error('Hand data subscriber:',e);}}};
 function finish(key,id,value){
  const job=pending.get(key);if(!job||job.id!==id)return;
  clearTimeout(job.timer);pending.delete(key);cache.set(key,value);
  while(cache.size>Math.max(1,cacheSize))cache.delete(cache.keys().next().value);
  job.resolve(value);notify(value);
 }
 function failAll(error){
  worker?.terminate();worker=null;
  for(const [key,job] of pending)finish(key,job.id,{key,status:'error',error});
 }
 function start(){
  if(worker)return worker;
  worker=workerFactory();
  worker.onmessage=({data})=>finish(data.key,data.id,data);
  worker.onerror=e=>failAll(e.message||'Hand worker failed');
  return worker;
 }
 return {
  get:key=>cache.get(key)??(pending.has(key)?{key,status:'processing'}:undefined),
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  request(key,image){
   if(disposed)return Promise.reject(Error('Hand perception disposed'));
   if(cache.has(key))return Promise.resolve(cache.get(key));
   if(pending.has(key))return pending.get(key).promise;
   const id=++nextId;let resolve;
   const promise=new Promise(r=>resolve=r);
   pending.set(key,{id,promise,resolve,timer:setTimeout(()=>failAll('Hand processing timed out; reload to retry'),timeoutMs)});
   notify({key,status:'processing'});
   try{
    const target=start();
    createImageBitmap(image).then(bitmap=>{
     if(disposed||pending.get(key)?.id!==id){bitmap.close();return;}
     try{target.postMessage({id,key,bitmap},[bitmap]);}catch(e){bitmap.close();finish(key,id,{key,status:'error',error:e.message});}
    }).catch(e=>finish(key,id,{key,status:'error',error:e.message}));
   }catch(e){finish(key,id,{key,status:'error',error:e.message});}
   return promise;
  },
  dispose(){
   disposed=true;worker?.terminate();worker=null;
   for(const [key,job] of pending){clearTimeout(job.timer);job.resolve({key,status:'cancelled'});}
   pending.clear();cache.clear();listeners.clear();
  }
 };
}
