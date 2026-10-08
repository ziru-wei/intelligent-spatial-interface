// Decode SSE across arbitrary network/UTF-8 boundaries. Never surface thought steps.
export async function* sseEvents(body){
  if(!body)throw Error('Gemini returned an empty stream.');
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='',event='',data=[];
  const line=value=>{if(value.startsWith('event:'))event=value.slice(6).trim();else if(value.startsWith('data:'))data.push(value.slice(5).replace(/^ /,''));};
  const take=()=>{const payload=data.join('\n'),type=event;data=[];event='';if(!payload||payload==='[DONE]')return null;let parsed;try{parsed=JSON.parse(payload);}catch{throw Error('Gemini returned invalid streaming data.');}return {...parsed,event_type:parsed.event_type||type};};
  try{
    for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});if(buffer.length>262144)throw Error('Gemini streaming event is too large.');
      let end;while((end=buffer.indexOf('\n'))>=0){const value=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);if(value===''){const parsed=take();if(parsed)yield parsed;}else line(value);}
      if(done){if(buffer)line(buffer.replace(/\r$/,''));const parsed=take();if(parsed)yield parsed;break;}
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

// Read only top-level title/body strings from a JSON prefix. Escapes can span chunks;
// incomplete escape sequences and surrogate pairs are held back until complete.
function jsonString(source,start){
  let text='',i=start+1;
  for(;i<source.length;i++){
    const c=source[i];if(c==='"')return {text,end:i+1,complete:true};
    if(c==='\\'){
      const escape=source[++i];if(escape===undefined)break;
      if(escape==='u'){const hex=source.slice(i+1,i+5);if(hex.length<4)break;if(!/^[\da-f]{4}$/i.test(hex))throw Error('Invalid JSON escape.');text+=String.fromCharCode(parseInt(hex,16));i+=4;}
      else {const escapes={'"':'"','\\':'\\','/':'/',b:'\b',f:'\f',n:'\n',r:'\r',t:'\t'};if(!Object.hasOwn(escapes,escape))throw Error('Invalid JSON escape.');text+=escapes[escape];}
    }else {if(c<' ')throw Error('Invalid JSON string.');text+=c;}
  }
  return {text:text.replace(/[\uD800-\uDBFF]$/,''),end:source.length,complete:false};
}
export function partialAnswerText(source,{wholeWords=false}={}){
  const result={title:'',body:''};let depth=0;
  for(let i=0;i<source.length;){
    const c=source[i];if(c==='{'||c==='['){depth++;i++;continue;}if(c==='}'||c===']'){depth--;i++;continue;}
    if(c!=='"'){i++;continue;}
    const key=jsonString(source,i);i=key.end;if(!key.complete)break;
    let colon=i;while(/\s/.test(source[colon]||'')&&colon<source.length)colon++;
    if(depth!==1||source[colon]!==':')continue;
    let valueAt=colon+1;while(/\s/.test(source[valueAt]||'')&&valueAt<source.length)valueAt++;
    if(source[valueAt]!=='"')continue;
    const value=jsonString(source,valueAt);if(key.text==='title'||key.text==='body')result[key.text]=wholeWords&&!value.complete?value.text.replace(/\S+$/u,''):value.text;
    i=value.end;if(!value.complete)break;
  }
  return result;
}
