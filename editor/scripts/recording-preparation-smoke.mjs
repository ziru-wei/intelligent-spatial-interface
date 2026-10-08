import {mkdtemp,readFile,writeFile,copyFile,mkdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
const folder=await mkdtemp('spaces/demo/scenarios/hand-preparation-test-');
try{
 const source=JSON.parse(await readFile('spaces/demo/scenarios/demo/session.json','utf8'));await mkdir(folder+'/frames');
 const frames=[];
 for(let i=0;i<2;i++){const f=source.frames[i];await copyFile('spaces/demo/scenarios/demo/'+f.image,folder+`/frames/${i}.jpg`);frames.push({...f,image:`frames/${i}.jpg`});}
 await writeFile(folder+'/session.json',JSON.stringify({...source,frames}));
 const output=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/prepare-recording-hands.mjs','./'+folder+'/session.json']);let out='',error='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('exit',code=>code?reject(Error(error)):resolve(out));});
 const result=JSON.parse(output.trim().split('\n').at(-1));assert.equal(result.ok,true);assert.equal(result.total,2);assert.equal(result.cached,2);
 console.log('PASS: recording preparation computes and persists previously uncached frames through the real local worker.');
}finally{await rm(folder,{recursive:true,force:true});}
