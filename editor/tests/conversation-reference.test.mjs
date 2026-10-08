import test from 'node:test';
import assert from 'node:assert/strict';
import {jev_read_request,jev_findmy_UI_dec,runPipeline} from '../scripts/jev-pipeline.mjs';
import {referenceCandidates,validatedReferenceIds} from '../scripts/reference-entities.mjs';
const book={item_id:'to-the-lighthouse',label:'To the Lighthouse',context_groups:['personal','storage']};
const conversation={recent_turns:[{question_id:1,user_question:'What should I read tonight?',assistant:[{title:'Continue To the Lighthouse',body:'Around page 68.'}],referenced_entities:[book]}],referents:[book]};
const catalog={context_groups:{personal:{description:'Reading'},storage:{description:'Items'},weather:{description:'Weather'}},conversation};
const c=(value,probability=1,confidence=1)=>({type:'choice',choice:value,probabilities:{[value]:probability},confidence});
const n=noul=>({type:'noul',noul});
test('reference judgment shares retrieval call and repairs storage group omissions',async()=>{
 const result=await jev_read_request(async(stage,state,questions)=>{
  assert.equal(stage,'jev_call_context_read');assert.equal(state.conversation,conversation);
  assert.deepEqual(questions.conversation_reference.criteria.ref_0,book);
  return {personal:n(1),storage:n(.1),weather:n(0),conversation_reference:c('ref_0')};
 },'OK, where is it?',catalog);
 assert.deepEqual(result.groups,['personal','storage']);assert.equal(result.reference.referent.item_id,book.item_id);
});
test('resolved reading follow-up reaches FindMy with the same book ID',async()=>{
 const reads=[],parts=[];
 await runPipeline({question:{id:2,text:'OK, where is it?',text_response:{default:true,findmy:false}},readContext:async groups=>{reads.push(groups);return groups.length?{findmy_catalog:[{...book,available:true}],interaction:{findmy_mod:true},stored_items:[{id:book.item_id,label:book.label}]}:catalog;},
 ask:async(stage,state)=>{
  if(stage==='jev_call_context_read')return {personal:n(0),storage:n(0),weather:n(0),conversation_reference:c('ref_0')};
  if(stage==='jev_call_mod'){assert.equal(state.context.reference_resolution.referent.item_id,book.item_id);return {mod:c('findmy')};}
  assert.equal(state.reference_resolution.referent.item_id,book.item_id);return {target:{choice:'item_0'}};
 },answer:async()=>{throw Error('Successful FindMy has text disabled');},publish:async p=>parts.push(p)});
 assert.deepEqual(reads,[[],['personal','storage']]);assert.equal(parts[0].findmy.item_id,book.item_id);
});
test('resolved pronoun cannot select a different mapped item',async()=>{
 const result=await jev_findmy_UI_dec(async(_,state,questions)=>{
  assert.equal(questions.target.criteria.item_0.item_id,book.item_id);
  assert.equal(questions.target.criteria.item_1,undefined);
  return {target:c('item_0')};
 },'Where is it?',{reference_resolution:{status:'resolved',referent:book},findmy_catalog:[{item_id:'brush',label:'Brush',available:true},{...book,available:true}]});
 assert.equal(result.item_id,book.item_id);
});
test('ambiguous or weak pronouns ask clarification before any mod or Luna',async()=>{
 for(const reference of [c('unresolved'),c('ref_0',.6,.2)]){
  const parts=[];let calls=0;
  await runPipeline({question:{id:3,text:'Where is it?'},readContext:async groups=>{assert.deepEqual(groups,[]);return catalog;},ask:async()=>{calls++;return {personal:n(0),storage:n(1),weather:n(0),conversation_reference:reference};},answer:async()=>{throw Error('Must clarify');},publish:async p=>parts.push(p)});
  assert.equal(calls,1);assert.equal(parts[0].title,'Which item do you mean?');assert.equal(parts[0].findmy,undefined);
 }
});
test('new explicit question does not inherit the old book as its subject',async()=>{
 const result=await jev_read_request(async()=>({personal:n(0),storage:n(0),weather:n(1),conversation_reference:c('standalone')}),'Will it rain tomorrow?',catalog);
 assert.deepEqual(result.groups,['weather']);assert.deepEqual(result.reference,{status:'standalone'});
});
test('missing session history can resolve a standalone question or ask about a missing antecedent',async()=>{
 const empty={...catalog,conversation:{recent_turns:[],referents:[]}};
 const result=await jev_read_request(async(_,state,questions)=>{assert.equal(questions.conversation_reference.criteria.ref_0,undefined);return {personal:n(0),storage:n(1),weather:n(0),conversation_reference:c('unresolved')};},'Where is it?',empty);
 assert.equal(result.reference.status,'unresolved');
});
test('only known IDs from items actually referenced are recorded',()=>{
 const context={preferences:{reading:{current_book:{title:book.label,stored_item_id:book.item_id}}}};
 assert.equal(referenceCandidates(context)[0].item_id,book.item_id);
 assert.deepEqual(validatedReferenceIds({referenced_item_ids:[book.item_id,'invented',book.item_id]},context),[book.item_id]);
 assert.deepEqual(validatedReferenceIds({title:'Good night'},context),[]);
});
