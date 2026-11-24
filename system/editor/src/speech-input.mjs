// Speech to text for the ask box (design doc 12.8): the microphone, streamed to Doubao's recognition through the editor's relay
// (scripts/asr-relay.mjs; its keys stay there). Audio goes as 16 kHz mono 16-bit PCM in packets of about 200 ms; the text comes back
// as it grows: the whole text so far, and its sentences, each final once the speaker paused (`definite`).
//   const s=createSpeech({onText({text, utterances, final}), onError(message)}); await s.start(); … await s.stop() → the final text
//   s.recording → {wav: Blob, started: epoch ms} of what was heard (kept with the question, in the space only)
//   s.release() closes the microphone, which stays open between questions with a short pre-roll
//   await s.start({from: url, onEnded}) recognizes a recording instead of the microphone, played aloud as it goes (a replay heard again)
export const RATE=16000,PACKET=RATE/5;   // 200 ms

// The worklet hands the microphone's samples over as they come (128 at a time).
const WORKLET=`registerProcessor('modos-mic',class extends AudioWorkletProcessor{process(inputs){const c=inputs[0]?.[0];if(c)this.port.postMessage(c.slice(0));return true;}});`;

/** 16-bit PCM (an ArrayBuffer) as a WAV file. */
export function wavOf(pcm){
  const h=new DataView(new ArrayBuffer(44)),str=(o,t)=>{for(let i=0;i<t.length;i++)h.setUint8(o+i,t.charCodeAt(i));};
  str(0,'RIFF');h.setUint32(4,36+pcm.byteLength,true);str(8,'WAVE');str(12,'fmt ');h.setUint32(16,16,true);h.setUint16(20,1,true);h.setUint16(22,1,true);
  h.setUint32(24,RATE,true);h.setUint32(28,RATE*2,true);h.setUint16(32,2,true);h.setUint16(34,16,true);str(36,'data');h.setUint32(40,pcm.byteLength,true);
  return new Blob([h.buffer,pcm],{type:'audio/wav'});
}
/** Float samples (-1..1) as 16-bit PCM, little-endian. */
export function pcm16(samples){
  const out=new DataView(new ArrayBuffer(samples.length*2));
  for(let i=0;i<samples.length;i++){const v=Math.max(-1,Math.min(1,samples[i]));out.setInt16(i*2,v<0?v*0x8000:v*0x7fff,true);}
  return out.buffer;
}

export function createSpeech({onText=()=>{},onError=()=>{}}={}){
  // The microphone, once opened, stays open (until released: the page hidden) and keeps the last PREROLL seconds, so a question begins
  // where the user began, a little before the key went down, and no time is lost opening it again. What is heard while listening waits
  // in a buffer until the recognition is open (`opened`).
  const PREROLL=.6;
  // source: what is being heard, the microphone or a recording played (a Rerun): the microphone stays open meanwhile and keeps only
  // its pre-roll; its samples never join a recording's (both at once would be one stream of the two interleaved, twice as long)
  let relay=null,id=null,events=null,mic=null,play=null,buf=[],ring=[],sent=Promise.resolve(),opened=null,last={text:''},finished=null,heard=[],started=0,running=false,listening=false,source='mic';
  const relayURL=async()=>{if(relay)return relay;const r=await fetch(new URL('/api/asr/relay',location.href),{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return relay=d.url;};
  const post=(path,body)=>fetch(relay+path,{method:'POST',...(body?{body,headers:{'Content-Type':'application/octet-stream'}}:{})}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;});
  function flush(lastPacket=false){
    const n=buf.reduce((a,b)=>a+b.length,0);if(!n&&!lastPacket)return;
    const all=new Float32Array(n);let o=0;for(const b of buf){all.set(b,o);o+=b.length;}buf=[];
    const body=pcm16(all);sent=sent.then(()=>opened).then(()=>id&&post(`/asr/audio?id=${id}&last=${lastPacket?1:0}`,body)).catch(e=>onError(e.message));
  }
  const hear=(c,from)=>{if(listening&&from===source){buf.push(c);heard.push(c);if(buf.reduce((a,b)=>a+b.length,0)>=PACKET)flush();}
    else if(from==='mic'){ring.push(c);let n=ring.reduce((a,b)=>a+b.length,0);while(ring.length&&n-ring[0].length>=PREROLL*RATE){n-=ring[0].length;ring.shift();}}};
  // an audio graph: a 16 kHz context (the browser resamples) and the worklet that hands the samples over
  async function graph(from){const ctx=new AudioContext({sampleRate:RATE});await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET],{type:'text/javascript'})));
    const node=new AudioWorkletNode(ctx,'modos-mic');node.port.onmessage=e=>hear(e.data,from);return {ctx,node};}
  async function openMic(){
    if(mic)return mic;
    try{const [stream,g]=await Promise.all([navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}}),graph('mic')]);
      g.ctx.createMediaStreamSource(stream).connect(g.node);return mic={stream,...g};}
    catch(e){throw Error(e.name==='NotAllowedError'?'the microphone is blocked here: allow it for this page (the address bar\'s site settings), or open the editor itself':e.name==='NotFoundError'?'no microphone found':e.message);}
  }
  // the recognition: relay, session, events (in parallel with the microphone; nothing heard is lost meanwhile)
  async function open(){
    await relayURL();({id}=await post('/asr/open'));last={text:''};
    finished=new Promise(done=>{events=new EventSource(`${relay}/asr/events?id=${id}`);
      events.onmessage=e=>{const m=JSON.parse(e.data);if(m.error){onError(m.error);return;}last=m;onText(m);if(m.final){events.close();done(m.text);}};
      events.onerror=()=>{events.close();done(last.text);};});
  }
  return {
    get active(){return running;},
    /** Ready the relay ahead (its URL), so the first press does not wait for it. */
    warm(){return relayURL().catch(()=>{});},
    /** Open the microphone ahead (its pre-roll then covers the first question too); quietly does nothing if it cannot. */
    prime(){return openMic().catch(()=>{});},
    /** Close the microphone (it stays open between questions otherwise). */
    release(){if(running||!mic)return;for(const t of mic.stream.getTracks())t.stop();mic.ctx.close().catch(()=>{});mic=null;ring=[];},
    /** What was heard since start (the microphone or the recording), as a WAV, and when it began. */
    get recording(){const n=heard.reduce((a,b)=>a+b.length,0);if(!n)return null;const all=new Float32Array(n);let o=0;for(const b of heard){all.set(b,o);o+=b.length;}
      return {wav:wavOf(pcm16(all)),started};},
    async start({from=null,onEnded=()=>{}}={}){
      running=true;heard=[];buf=[];id=null;sent=Promise.resolve();
      opened=open();opened.catch(e=>onError(e.message));
      if(from){   // a recording heard again (played aloud as it goes)
        source='play';play=await graph('play');const data=await (await fetch(from)).arrayBuffer(),src=play.ctx.createBufferSource();src.buffer=await play.ctx.decodeAudioData(data);
        src.connect(play.node);src.connect(play.ctx.destination);src.onended=()=>onEnded();play.src=src;started=Date.now();listening=true;src.start();}
      else{source='mic';const before=!!mic;await openMic();
        // what was heard just before (the pre-roll) is the question's beginning
        const pre=before?ring.splice(0):[],n=pre.reduce((a,b)=>a+b.length,0);buf.push(...pre);heard.push(...pre);started=Date.now()-n/RATE*1000;listening=true;}
      await opened;
    },
    /** Ends the audio (the microphone stays open); resolves with the final text (or what came, if the service does not answer within 4 s). */
    async stop(){
      if(!running)return '';running=false;listening=false;
      if(play){try{play.src.stop();}catch{}play.node.disconnect();await play.ctx.close().catch(()=>{});play=null;}
      await opened?.catch(()=>{});flush(true);await sent;
      const text=id?await Promise.race([finished,new Promise(r=>setTimeout(()=>r(last.text),4000))]):'';
      events?.close();id=null;events=null;return text||'';
    },
  };
}
