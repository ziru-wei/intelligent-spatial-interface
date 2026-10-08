import {spawn} from 'node:child_process';
import {answerInstruction,answerInput,parseAnswer} from './answer-contract.mjs';
import readline from 'node:readline';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const schema=fileURLToPath(new URL('./luna-answer.schema.json',import.meta.url));
export async function lunaAnswer(question,context,{model='gpt-6-luna',effort='low',trace=()=>{}}={}){
  // Fresh, isolated turn prevents prior full-context turns or spatial AGENTS.md from leaking into this branch.
  const cwd=await mkdtemp(path.join(tmpdir(),'spatial-luna-'));
  const prompt=answerInstruction+'\n'+answerInput(question,context);
  trace('luna_answer','Started');
  try{return await new Promise((resolve,reject)=>{
    const args=['exec','--json','--ephemeral','--ignore-user-config','--skip-git-repo-check','-s','read-only','-m',model,'-c',`model_reasoning_effort=${JSON.stringify(effort)}`,'--output-schema',schema,'-'];
    const env={...process.env};for(const key of ['TYPESAFE_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY'])delete env[key];
    const child=spawn('codex',args,{cwd,env,stdio:['pipe','pipe','pipe']});let last='',failure='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},120000);
    child.stdin.on('error',()=>{});child.stdin.end(prompt);
    child.stderr.on('data',()=>{});
    readline.createInterface({input:child.stdout}).on('line',line=>{
      let e;try{e=JSON.parse(line);}catch{return;}
      if(e.type==='item.completed'&&e.item?.type==='agent_message')last=e.item.text;
      if(e.type==='turn.failed'||e.type==='error')failure=e.error?.message||e.message||'Codex failed';
    });
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{
      clearTimeout(timer);
      if(timedOut||code!==0||failure)return reject(Error(timedOut?'Luna timed out':failure||`Luna exited with ${code}`));
      try{const result=parseAnswer(last,context);trace('luna_answer','Completed');resolve(result);}catch(e){reject(e);}
    });
  });}finally{await rm(cwd,{recursive:true,force:true});}
}
