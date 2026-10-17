import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {observeNode,resourceSnapshot} from '../scripts/releases/observe-ci-node.mjs';

test('CI observer preserves exact success/failure and never logs args or environment',async()=>{
 for(const code of [0,7]){
  const lines=[];
  const result=await observeNode(['-e','/* PRIVATE_ARGUMENT_SENTINEL */ process.exit('+code+')'],{intervalMs:10,log:x=>lines.push(x)});
  assert.equal(result,code);assert.equal(lines.at(-1).exit_code,code);
  assert.equal(lines[0].event,'started');assert.equal(lines.at(-1).event,'finished');
  assert.doesNotMatch(JSON.stringify(lines),/PRIVATE_ARGUMENT_SENTINEL|process\.exit|NODE_OPTIONS/);
 }
});
test('CI observer unavailable Linux metrics remain null, never fake zero or raw files',()=>{
 const no=()=>{throw Error('NOT_AVAILABLE');};const missing=resourceSnapshot(123,no,no);
 assert.equal(missing.child_rss_kib,null);assert.equal(missing.cgroup_oom,null);assert.equal(missing.disk_available_bytes,null);
 const exact=resourceSnapshot(123,path=>path.endsWith('/status')?'Name:\tprivate\nVmRSS:\t456 kB\n':'oom 2\noom_kill 1\n',()=>({bavail:3,bsize:4096}));
 assert.equal(exact.child_rss_kib,456);assert.equal(exact.cgroup_oom,2);assert.equal(exact.cgroup_oom_kill,1);assert.equal(exact.disk_available_bytes,12288);
 assert.doesNotMatch(JSON.stringify(exact),/private|\/proc|memory\.events/);
});
test('CI observer measures the Node test worker descendants, not just the small test parent',()=>{
 const files=new Map([['/proc/123/status','VmRSS:\t100 kB\n'],['/proc/124/status','VmRSS:\t900 kB\n'],['/proc/123/task/123/children','124'],['/proc/124/task/124/children','123']]);
 const value=resourceSnapshot(123,p=>files.get(p)??'',()=>({bavail:1,bsize:4096}));
 assert.equal(value.child_rss_kib,100);assert.equal(value.owned_tree_rss_kib,1000);assert.equal(value.largest_owned_rss_kib,900);assert.equal(value.owned_processes_measured,2);
});
test('CI observer does not turn child SIGTERM into success',async()=>{
 assert.equal(await observeNode(['-e',"process.kill(process.pid,'SIGTERM')"],{log:()=>{}}),143);
});
test('CI observer forwards cancellation to its own child without swallowing it',async()=>{
 const path=fileURLToPath(new URL('../scripts/releases/observe-ci-node.mjs',import.meta.url));
 const p=spawn(process.execPath,[path,'-e','setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe']});
 let output='',cancelled=false;
 p.stdout.on('data',chunk=>{output+=chunk;if(!cancelled&&output.includes('"event":"started"')){cancelled=true;p.kill('SIGTERM');}});
 const code=await new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',resolve);});
 assert.equal(code,143);assert.match(output,/"event":"cancellation"/);assert.match(output,/"cancellation_signal":"SIGTERM"/);
});
