import test from 'node:test';
import assert from 'node:assert/strict';
import {fill,placeholders,sentenceName} from '../modos/prompts.mjs';
import {PROMPTS} from '../modos/request.mjs';
import {typeCall,groundCall} from '../modos/themes.mjs';

test('a prompt is its words with what is filled in at run time',()=>{
  assert.equal(fill('Does {sentence} use {theme}?',{sentence:'it'}),'Does it use {theme}?');
  assert.equal(fill('{a}',{a:'{b}',b:'x'}),'{b}');                                            // a value filled in is not read again
  assert.deepEqual(placeholders('{b} {a} {b}'),['a','b']);
  assert.equal(sentenceName(PROMPTS,['one'],0),'user_question');
  assert.equal(sentenceName(PROMPTS,['a b','c d'],1,true),'this sentence of user_question: "c d" (said right after: "a b") (still being said: it may stop mid-sentence; judge what its words already show)');
});

test('the decisions are asked in the words of modos/prompts.json',()=>{
  const P=structuredClone(PROMPTS);
  try{
    PROMPTS.request_type.none='Is {sentence} nothing at all?';PROMPTS.continuation.more='more of it';
    assert.equal(typeCall(['what now'],[0]).request_type_none_s0.instructions,'Is user_question nothing at all?');
    const view={places:[],nameOf:x=>x,entities:new Map()},q=groundCall(view,['what now'],[0],[{id:1,sentences:[{text:'the weather',know:true}],mods:{}}],[],{0:{info:true}});
    assert.equal(q.continuation_s0.options.more,'more of it');
  }finally{Object.assign(PROMPTS,P);}
});
