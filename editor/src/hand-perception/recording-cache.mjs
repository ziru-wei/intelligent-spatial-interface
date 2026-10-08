// Durable recording-local cache; the server versions it by detector pipeline + source images.
export function encodeMask(mask){
 const runs=[];let value=0,length=0;
 for(const byte of mask){const next=byte?255:0;if(next===value)length++;else{runs.push(length);length=1;value=next;}}
 runs.push(length);return runs;
}
export function decodeRecord(record,key){
 const mask=new Uint8Array(record.width*record.height);let offset=0,value=0;
 for(const length of record.runs||[]){if(!Number.isInteger(length)||length<0||offset+length>mask.length)throw Error('Invalid cached hand mask');if(value)mask.fill(255,offset,offset+length);offset+=length;value=255-value;}
 if(record.landmarks?.length&&offset!==mask.length)throw Error('Incomplete cached hand mask');
 return {...record,key,status:'ready',source:'recording-cache',mask,landmarks:record.landmarks||[],worldLandmarks:record.worldLandmarks||[],handedness:record.handedness||[]};
}
export function createRecordingHandCache({session,fetcher=fetch,onChange=()=>{}}){
 let info=null,error=null;const memory=new Map(),loads=new Map();
 const url=frame=>{const u=new URL('/api/hands',session);u.searchParams.set('session',new URL(session).pathname);if(frame!=null){u.searchParams.set('frame',frame);u.searchParams.set('token',info.token);}return u;};
 const json=async(u,options)=>{const r=await fetcher(u,options),data=await r.json();if(!r.ok)throw Error(data?.error||'Hand cache unavailable');return data;};
 const remember=(i,result)=>{memory.set(i,result);while(memory.size>64)memory.delete(memory.keys().next().value);return result;};
 const ready=json(url()).then(data=>{info=data;onChange();}).catch(e=>{error=e.message;onChange();});
 return {
  ready,
  get status(){const entries=Object.values(info?.entries||{});return {total:info?.total||0,cached:entries.length,empty:entries.filter(e=>e.empty).length,error};},
  has:i=>!!info?.entries[String(i)],
  async read(i,key){
   await ready;if(!info?.entries[String(i)])return null;
   if(memory.has(i))return {...memory.get(i),key};
   if(!loads.has(i))loads.set(i,(async()=>{
    const entry=info.entries[String(i)];
    const record=entry.empty?{width:entry.width,height:entry.height,landmarks:[],runs:[]}:await json(url(i));
    if(!record)return null;
    return remember(i,decodeRecord(record,key));
   })().finally(()=>loads.delete(i)));
   try{return await loads.get(i);}catch(e){error=e.message;delete info.entries[String(i)];onChange();return null;}
  },
  async write(i,result){
   await ready;if(!info||result?.status!=='ready')return;
   const {width,height,landmarks,worldLandmarks,handedness}=result;
   const data={width,height,landmarks,worldLandmarks,handedness,runs:landmarks.length?encodeMask(result.mask):[]};
   try{const entry=await json(url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:new URL(session).pathname,token:info.token,frame:i,data})});info.entries[String(i)]=entry;remember(i,result);error=null;onChange();}
   catch(e){error=e.message;onChange();}
  }
 };
}
