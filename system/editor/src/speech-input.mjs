// Speech to text for the ask box (design doc 12.8): the microphone, streamed to Doubao's recognition through the editor's relay
// (scripts/asr-relay.mjs; its keys stay there). Audio goes as 16 kHz mono 16-bit PCM in packets of about 200 ms; the text comes back
// as it grows: the whole text so far, and its sentences, each final once the speaker paused (`definite`).
//   const s=createSpeech({onText({text, utterances, final}), onError(message)}); await s.start(); … await s.stop() → the final text
export const RATE=16000,PACKET=RATE/5;   // 200 ms

// The worklet hands the microphone's samples over as they come (128 at a time).
const WORKLET=`registerProcessor('modos-mic',class extends AudioWorkletProcessor{process(inputs){const c=inputs[0]?.[0];if(c)this.port.postMessage(c.slice(0));return true;}});`;

/** Float samples (-1..1) as 16-bit PCM, little-endian. */
export function pcm16(samples){
  const out=new DataView(new ArrayBuffer(samples.length*2));
  for(let i=0;i<samples.length;i++){const v=Math.max(-1,Math.min(1,samples[i]));out.setInt16(i*2,v<0?v*0x8000:v*0x7fff,true);}
  return out.buffer;
}

export function createSpeech({onText=()=>{},onError=()=>{}}={}){
  let relay=null,id=null,events=null,stream=null,ctx=null,node=null,buf=[],sent=Promise.resolve(),last={text:''},finished=null;
  const post=(path,body)=>fetch(relay+path,{method:'POST',...(body?{body,headers:{'Content-Type':'application/octet-stream'}}:{})}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;});
  function flush(lastPacket=false){
    const n=buf.reduce((a,b)=>a+b.length,0);if(!n&&!lastPacket)return;
    const all=new Float32Array(n);let o=0;for(const b of buf){all.set(b,o);o+=b.length;}buf=[];
    const body=pcm16(all);sent=sent.then(()=>post(`/asr/audio?id=${id}&last=${lastPacket?1:0}`,body)).catch(e=>onError(e.message));
  }
  return {
    get active(){return !!id;},
    async start(){
      const r=await fetch(new URL('/api/asr/relay',location.href),{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);
      relay=d.url;
      try{stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});}
      catch(e){throw Error(e.name==='NotAllowedError'?'the microphone is blocked here: allow it for this page (the address bar\'s site settings), or open the editor itself':e.name==='NotFoundError'?'no microphone found':e.message);}
      ({id}=await post('/asr/open'));last={text:''};
      finished=new Promise(done=>{events=new EventSource(`${relay}/asr/events?id=${id}`);
        events.onmessage=e=>{const m=JSON.parse(e.data);if(m.error){onError(m.error);return;}last=m;onText(m);if(m.final){events.close();done(m.text);}};
        events.onerror=()=>{events.close();done(last.text);};});
      ctx=new AudioContext({sampleRate:RATE});   // the browser resamples the microphone to 16 kHz
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET],{type:'text/javascript'})));
      node=new AudioWorkletNode(ctx,'modos-mic');ctx.createMediaStreamSource(stream).connect(node);
      node.port.onmessage=e=>{buf.push(e.data);if(buf.reduce((a,b)=>a+b.length,0)>=PACKET)flush();};
    },
    /** Ends the audio; resolves with the final text (or what came, if the service does not answer within 4 s). */
    async stop(){
      if(!id)return '';
      node?.disconnect();for(const t of stream?.getTracks()||[])t.stop();await ctx?.close().catch(()=>{});
      flush(true);await sent;
      const text=await Promise.race([finished,new Promise(r=>setTimeout(()=>r(last.text),4000))]);
      events?.close();id=null;node=ctx=stream=events=null;return text||'';
    },
  };
}
