// Exhaustive CI execution partition, not a reduced acceptance suite.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const PUBLIC_SHARDS=4;
const root=fileURLToPath(new URL('../../',import.meta.url));
export function publicTestInventory(){
 const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts['test:public'],'node --test tests/*.test.mjs','the supported full suite must remain independently defined');
 const files=readdirSync(new URL('../../tests/',import.meta.url),{withFileTypes:true})
  .filter(entry=>entry.isFile()&&!entry.name.startsWith('.')&&entry.name.endsWith('.test.mjs')).map(entry=>'tests/'+entry.name).sort();
 assert.ok(files.length>=PUBLIC_SHARDS);return files;
}
export function verifyPublicPartitions(all,parts){
 assert.equal(parts.length,PUBLIC_SHARDS);
 assert.equal(new Set(all).size,all.length);
 assert.ok(all.every(path=>/^tests\/[A-Za-z0-9_.-]+\.test\.mjs$/.test(path)));
 assert.ok(parts.every(part=>part.length>0));
 const flat=parts.flat();assert.equal(new Set(flat).size,flat.length,'no duplicated test file');
 assert.deepEqual([...flat].sort(),[...all].sort(),'every supported file executes exactly once');
}
export function publicPartitions(all){
 const parts=Array.from({length:PUBLIC_SHARDS},(_,index)=>all.filter((_,position)=>position%PUBLIC_SHARDS===index));
 verifyPublicPartitions(all,parts);return parts;
}
export function publicShardArgs(all,index){
 assert.ok(Number.isInteger(index)&&index>=0&&index<PUBLIC_SHARDS,'valid explicit shard');
 return ['--test','--test-concurrency=1','--test-reporter=tap',...publicPartitions(all)[index]];
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const all=publicTestInventory(),index=Number(process.env.MA_PUBLIC_REGRESSION_SHARD);
 assert.match(process.env.MA_PUBLIC_REGRESSION_SHARD||'',/^[0-3]$/);
 const args=publicShardArgs(all,index);
 console.log(JSON.stringify({scope:'FULL_PUBLIC_SUITE_PARTITION',shard:index,total_files:all.length,selected_files:args.length-3,concurrency:1,test_filtering:false}));
 const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit'}),started=Date.now();
 const resource=()=>{
  const result={scope:'CI_RUNNER_RESOURCE_SAMPLE',shard:index,elapsed_seconds:Math.round((Date.now()-started)/1000)};
  for(const [name,path] of [['memory_current','/sys/fs/cgroup/memory.current'],['memory_limit','/sys/fs/cgroup/memory.max'],['memory_events','/sys/fs/cgroup/memory.events']]){
   try{result[name]=readFileSync(path,'utf8').trim();}catch{result[name]='NOT_AVAILABLE';}
  }
  console.log(JSON.stringify(result));
 };
 resource();const monitor=setInterval(resource,30000);
 child.once('error',error=>{clearInterval(monitor);console.error(error.message);process.exitCode=1;});
 child.once('exit',(code,signal)=>{clearInterval(monitor);resource();console.log(JSON.stringify({scope:'FULL_PUBLIC_SHARD_TERMINAL',shard:index,exit_code:code,signal,all_selected_files_required:true}));process.exitCode=code===0&&signal===null?0:1;});
}
