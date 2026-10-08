import test from 'node:test';
import assert from 'node:assert/strict';
import {sseEvents,partialAnswerText} from '../scripts/gemini-stream.mjs';
import {geminiAnswer} from '../scripts/gemini-answer.mjs';
const encode=value=>new TextEncoder().encode(value);
const event=data=>`data: ${JSON.stringify(data)}\n\n`;
const start=event({event_type:'step.start',index:1,step:{type:'model_output'}});
const delta=text=>event({event_type:'step.delta',index:1,delta:{type:'text',text}});
const complete=event({event_type:'interaction.completed',interaction:{status:'completed',usage:{total_output_tokens:30}}});
const answer={title:'Read tonight',body:'Continue your book.',anchor:{object:'Table 2',relation:'above'},referenced_item_ids:[]};
test('SSE preserves UTF-8, CRLF, comments and events split at arbitrary byte boundaries',async()=>{
 const bytes=encode(': keepalive\r\nevent: step.delta\r\ndata: {"delta":{"text":"书📖"}}\r\n\r\ndata: [DONE]\r\n\r\n');
 const body=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}}),events=[];
 for await(const value of sseEvents(body))events.push(value);
 assert.deepEqual(events,[{event_type:'step.delta',delta:{text:'书📖'}}]);
});
test('partial JSON strings decode escapes without exposing nested fields or incomplete Unicode',()=>{
 assert.deepEqual(partialAnswerText('{"anchor":{"body":"not answer"},"title":"Read \\"today\\"","body":"Line\\nnext'),{title:'Read "today"',body:'Line\nnext'});
 assert.equal(partialAnswerText('{"title":"\\uD83D').title,'');
 assert.equal(partialAnswerText('{"title":"\\uD83D\\uDC').title,'');
 assert.equal(partialAnswerText('{"title":"\\uD83D\\uDCDA').title,'📚');
 assert.equal(partialAnswerText('{"body":"Try this bo',{wholeWords:true}).body,'Try this ');
 assert.equal(partialAnswerText('{"body":"Try this book"}',{wholeWords:true}).body,'Try this book');
});
test('Gemini publishes readable text before completion, ignores thoughts, validates the final answer',async()=>{
 let controller,release,first;const ready=new Promise(r=>first=r),gate=new Promise(r=>release=r),partials=[],traces=[];
 const body=new ReadableStream({start(c){controller=c;c.enqueue(encode(event({event_type:'step.start',index:0,step:{type:'thought'}})+event({event_type:'step.delta',index:0,delta:{type:'text',text:'PRIVATE THOUGHT'}})+start+delta('{"title":"Read tonight","body":"Continue ')));}});
 const work=geminiAnswer({text:'Read?'},{},{apiKey:'fake-secret',trace:(...args)=>traces.push(args),fetchImpl:async(_,request)=>{assert.equal(JSON.parse(request.body).stream,true);return {ok:true,headers:new Headers({'content-type':'text/event-stream'}),body};},onPartial:async p=>{partials.push(p);first();await gate;}});
 await ready;assert.deepEqual(partials[0],{title:'Read tonight',body:'Continue '});assert.equal(traces.length,1);
 const remaining=JSON.stringify(answer).slice('{"title":"Read tonight","body":"Continue '.length);
 controller.enqueue(encode(delta(remaining)+complete));controller.close();release();
 assert.deepEqual(await work,answer);assert.ok(!JSON.stringify(partials).includes('PRIVATE'));assert.ok(!JSON.stringify(traces).includes('fake-secret'));
 assert.match(traces.at(-1)[1],/first_text_ms/);
});
test('interrupted, malformed and provider-error streams never become a completed answer',async()=>{
 for(const ending of ['',event({event_type:'error',error:{message:'secret remote details'}}),event({event_type:'interaction.completed',interaction:{status:'incomplete'}})]){
  const body=new ReadableStream({start(c){c.enqueue(encode(start+delta('{"title":"Read tonight"')+ending));c.close();}});
  await assert.rejects(geminiAnswer({text:'Hi'},{},{apiKey:'fake',fetchImpl:async()=>({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body})}),/complete/);
 }
});
