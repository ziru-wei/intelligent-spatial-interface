import test from 'node:test';
import assert from 'node:assert/strict';
import {runPipeline,infoQuestions,infoRoute} from '../scripts/jev-pipeline.mjs';
const n=value=>({type:'noul',noul:value});
const catalog={time:{date:'2026-10-07'},context_groups:{storage:{description:'inventory'}},user:{name:'Alex',pose:{frame:1}}};
const selection={box_id:'custom_1',key:'wifi',score:.8,cues:{gaze:1,point:0,touch:0}};

function harness({cat,info={key:'wifi',text:'Network attic-5G'},jev={}}){
  const calls={jev:[],reads:[],answers:[],recorded:[],parts:[]};
  return {calls,run:()=>runPipeline({question:{id:4,text:'what is the password?'},
    readContext:async groups=>{calls.reads.push(groups);return cat;},
    readInfo:async key=>{assert.equal(key,info.key);return info;},
    recordInfo:async(...a)=>calls.recorded.push(a),
    ask:async(stage,state,questions)=>{calls.jev.push([stage,Object.keys(questions)]);return Object.fromEntries(Object.keys(questions).map(k=>[k,n(jev[k]??0)]));},
    answer:async(question,context,options)=>{calls.answers.push({context,options});return {title:'Password on the fridge',body:'',anchor:{object:'wifi',relation:'on'},referenced_item_ids:[],interaction_id:'int-'+calls.answers.length};},
    publish:async p=>calls.parts.push(p)})};
}

test('score-only selection answers from the info context without Jev or user context',async()=>{
  const h=harness({cat:{...catalog,selection:{...selection,mode:'score'}}});const r=await h.run();
  assert.equal(h.calls.jev.length,0);assert.deepEqual(h.calls.reads,[[]]);
  const {context,options}=h.calls.answers[0];
  assert.deepEqual(context.info,{key:'wifi',text:'Network attic-5G'});assert.equal(context.user,undefined);assert.equal(context.context_groups,undefined);
  assert.equal(options.store,true);assert.ok(!options.previousInteractionId);
  assert.deepEqual(h.calls.recorded,[['wifi','int-1','selection']]);assert.deepEqual(r.info,{key:'wifi',source:'selection'});
  assert.equal(h.calls.parts.at(-1).part,'text');
});

test('Jev mode asks about the selection in the context-read call; an unrelated question keeps the user context',async()=>{
  const h=harness({cat:{...catalog,selection:{...selection,mode:'jev'}},jev:{info_selected:.2,storage:.1}});await h.run();
  assert.deepEqual(h.calls.jev.map(([s])=>s).filter(s=>s==='jev_call_context_read').length,1);
  assert.ok(h.calls.jev[0][1].includes('info_selected'));
  assert.equal(h.calls.answers[0].context.info,undefined);assert.equal(h.calls.recorded.length,0);
});

test('a follow-up about the previous item continues its interaction and sends no info again',async()=>{
  const h=harness({cat:{...catalog,active_info:{key:'wifi',question_id:3,interaction_id:'int-prev'}},jev:{info_followup:.9}});await h.run();
  const {context,options}=h.calls.answers[0];
  assert.equal(options.previousInteractionId,'int-prev');assert.equal(context.info.text,undefined);assert.ok(context.info.continued);
  assert.deepEqual(h.calls.recorded,[['wifi','int-1','follow-up']]);
});

test('a follow-up whose interaction is gone sends the info again',async()=>{
  const h=harness({cat:{...catalog,active_info:{key:'wifi',question_id:3,interaction_id:'gone'}},jev:{info_followup:.9}});
  let first=true;const run=runPipeline({question:{id:4,text:'and it?'},readContext:async()=>h.calls.reads.push(1)&&{...catalog,active_info:{key:'wifi',question_id:3,interaction_id:'gone'}},
    readInfo:async()=>({key:'wifi',file:{name:'router.pdf',mime_type:'application/pdf',data:'JVBERg=='}}),recordInfo:async()=>{},
    ask:async(s,st,q)=>Object.fromEntries(Object.keys(q).map(k=>[k,n(k==='info_followup'?.9:0)])),
    answer:async(question,context,options)=>{if(first){first=false;assert.equal(options.previousInteractionId,'gone');throw Error('Gemini HTTP 404.');}
      assert.equal(options.previousInteractionId,null);assert.deepEqual(context.info.file,{name:'router.pdf',mime_type:'application/pdf',attached:true});
      assert.deepEqual(options.files,[{name:'router.pdf',mime_type:'application/pdf',data:'JVBERg=='}]);return {title:'Admin page',body:'',anchor:{object:'wifi',relation:'on'},referenced_item_ids:[]};},
    publish:async()=>{}});
  assert.equal((await run).title,'Admin page');
});

test('without readInfo the pipeline asks no info questions',()=>{
  assert.deepEqual(infoQuestions(catalog),{});
  assert.equal(infoRoute({...catalog,selection:{...selection,mode:'jev'}},{info_selected:n(.4)}),null);
  assert.deepEqual(infoRoute({...catalog,selection:{...selection,mode:'jev'},active_info:{key:'wifi',interaction_id:'x'}},{info_selected:n(.7)}),{key:'wifi',source:'selection',previous:'x'});
});

test('a zone selection is judged by Jev with a question about the area',()=>{
  const q=infoQuestions({selection:{box_id:'zone:kitchen',key:'kitchen rules',mode:'jev'}});
  assert.match(q.info_selected.instructions,/standing in an area/);
});
