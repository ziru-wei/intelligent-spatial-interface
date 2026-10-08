// One running job and one replaceable waiting frame. Never build a playback backlog.
export function createLatestFrameJob(run,onResult=()=>{}){
 let active=null,waiting=null;
 async function drain(job){
  active=job;
  try{const result=await run(job.key);onResult(job.key,result);job.resolve(result);}
  catch(error){job.reject(error);}
  finally{active=null;const next=waiting;waiting=null;if(next)void drain(next);}
 }
 return {request(key){
  if(active?.key===key)return active.promise;
  if(waiting?.key===key)return waiting.promise;
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  const job={key,promise,resolve,reject};
  if(active){waiting?.resolve(null);waiting=job;}else void drain(job);
  return promise;
 }};
}
