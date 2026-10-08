import {emitKeypressEvents} from 'node:readline';

// Read a secret from the terminal without echoing it, adding it to shell history,
// or persisting it. Existing config/environment credentials take precedence.
export function promptApiKey({input=process.stdin,output=process.stderr,label='TypeSafe',envName='TYPESAFE_API_KEY',configField='apiKey',persist=false}={}) {
  if(!input.isTTY||typeof input.setRawMode!=='function') {
    return Promise.reject(Error(`No ${label} API key and no interactive terminal. Set ${envName} or ${configField} in agent-config.local.json.`));
  }
  return new Promise((resolve,reject)=>{
    const wasRaw=Boolean(input.isRaw),wasPaused=input.isPaused();let value='';
    const cleanup=()=>{
      input.removeListener('keypress',onKey);input.removeListener('end',onEnd);input.removeListener('error',onError);
      input.setRawMode(wasRaw);if(wasPaused)input.pause();output.write('\n');
    };
    const cancel=()=>{cleanup();const error=Error('API key entry cancelled.');error.code='CANCELLED';reject(error);};
    const onEnd=()=>cancel();
    const onError=error=>{cleanup();reject(error);};
    const onKey=(text,key={})=>{
      if(key.ctrl&&(key.name==='c'||key.name==='d'))return cancel();
      if(key.name==='return'||key.name==='enter'){
        const result=value.trim();
        if(!result){output.write(`\nAPI key cannot be empty. ${label} API key (hidden): `);return;}
        cleanup();resolve(result);return;
      }
      if(key.name==='backspace'){value=Array.from(value).slice(0,-1).join('');return;}
      if(key.ctrl&&key.name==='u'){value='';return;}
      if(!key.ctrl&&!key.meta&&text&&!/[\x00-\x1f\x7f]/.test(text))value+=text;
    };
    emitKeypressEvents(input);
    input.on('keypress',onKey);input.once('end',onEnd);input.once('error',onError);
    output.write(`No API key configured. Input is hidden and ${persist?'will be saved to your local git-ignored config':'used only for this run'}.\n${label} API key (hidden): `);
    input.setRawMode(true);input.resume();
  });
}

export async function resolveApiKey({envKey=process.env.TYPESAFE_API_KEY,configKey,prompt=promptApiKey}={}) {
  for(const candidate of [envKey,configKey])if(typeof candidate==='string'&&candidate.trim())return candidate.trim();
  return prompt();
}

export async function resolveGeminiApiKey({envKey=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY,configKey,prompt=()=>promptApiKey({label:'Gemini',envName:'GEMINI_API_KEY',configField:'geminiApiKey'})}={}) {
  for(const candidate of [envKey,configKey])if(typeof candidate==='string'&&candidate.trim())return candidate.trim();
  return prompt();
}
