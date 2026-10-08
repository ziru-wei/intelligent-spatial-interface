import {answerSchema,answerInstruction,answerInput,parseAnswer} from './answer-contract.mjs';
import {GEMINI_MODEL} from './answer-settings.mjs';
import {sseEvents,partialAnswerText} from './gemini-stream.mjs';
const endpoint='https://generativelanguage.googleapis.com/v1beta/interactions';
// Direct REST: no CLI startup, tools, hosted session history or automatic retries.
export async function geminiAnswer(question,context,{apiKey=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY,model=GEMINI_MODEL,effort='minimal',fetchImpl=fetch,trace=()=>{},onPartial=async()=>{}}={}){
  if(typeof apiKey!=='string'||!apiKey.trim())throw Error('Set geminiApiKey in agent-config.local.json or run scripts/gemini-setup.mjs.');
  const started=Date.now();trace('gemini_answer',`Started · ${model} · ${effort}`);
  let response;
  try{
    response=await fetchImpl(endpoint,{method:'POST',headers:{'x-goog-api-key':apiKey.trim(),'Content-Type':'application/json'},
      body:JSON.stringify({model,input:answerInput(question,context),system_instruction:answerInstruction,store:false,stream:true,
        generation_config:{thinking_level:effort,max_output_tokens:1024},response_format:{type:'text',mime_type:'application/json',schema:answerSchema}}),signal:AbortSignal.timeout(20000)});
  }catch(e){throw Error(e.name==='TimeoutError'||e.name==='AbortError'?'Gemini timed out after 20 seconds.':'Gemini request failed; check the connection.');}
  if(!response.ok){
    const help=response.status===429?'Project quota reached; check AI Studio Rate limits.':response.status===401||response.status===403?'Check the Gemini key and project access.':response.status===404?'Model unavailable for this project; check AI Studio.':'Request failed.';
    throw Error(`Gemini HTTP ${response.status}. ${help}`);
  }
  let data,text='',firstTextMs=null,lastPublished='',lastAt=-Infinity;
  if(response.headers?.get('content-type')?.includes('text/event-stream')){
    let outputIndex=null,completed=false;
    try{
      for await(const event of sseEvents(response.body)){
        if(event.event_type==='step.start'&&event.step?.type==='model_output'){outputIndex=event.index;text='';}
        if(event.event_type==='step.delta'&&event.index===outputIndex&&event.delta?.type==='text'){
          text+=event.delta.text||'';if(text.length>65536)throw Error('Gemini answer is too large.');
          const partial=partialAnswerText(text,{wholeWords:true}),key=JSON.stringify(partial),now=Date.now();
          if((partial.title||partial.body)&&key!==lastPublished&&now-lastAt>=100){await onPartial(partial);lastPublished=key;lastAt=now;firstTextMs??=now-started;}
        }
        if(event.event_type==='error')throw Error('Gemini streaming request failed.');
        if(event.event_type==='interaction.completed'){data=event.interaction;completed=true;}
      }
      if(!completed)throw Error('Gemini stream ended before completion.');
    }catch(e){throw Error(e.name==='TimeoutError'||e.name==='AbortError'?'Gemini timed out after 20 seconds.':'Gemini stream did not complete; retry the question.');}
  }else{
    // Also accept a complete response from a compatible proxy; the browser never receives raw JSON.
    try{data=await response.json();}catch{throw Error('Gemini returned an invalid API response.');}
    const output=data.steps?.filter(step=>step.type==='model_output').at(-1);
    text=(output?.content||[]).filter(part=>part.type==='text').map(part=>part.text).join('');
  }
  if(data?.status!=='completed')throw Error('Gemini did not complete the answer; output may be truncated.');
  const result=parseAnswer(text,context);
  const usage=Object.fromEntries(Object.entries(data.usage||{}).filter(([key,value])=>['total_input_tokens','total_output_tokens','total_thought_tokens','total_tokens'].includes(key)&&Number.isFinite(value)));
  trace('gemini_answer',JSON.stringify({elapsed_ms:Date.now()-started,first_text_ms:firstTextMs,streaming:firstTextMs!=null,model,usage}));
  return result;
}
