/** Read-only CI diagnostics. No retry, timeout extension, argument/env logging,
 * test selection, or success translation. Only the owned child group is signalled. */
import {spawn} from 'node:child_process';
import {readFileSync,statfsSync} from 'node:fs';
import {constants,freemem,totalmem,loadavg} from 'node:os';
import {pathToFileURL} from 'node:url';

export function resourceSnapshot(pid,read=readFileSync,stat=statfsSync){
 const text=path=>{try{return read(path,'utf8');}catch{return '';}};
 const status=Number.isSafeInteger(pid)&&pid>0?text('/proc/'+pid+'/status'):'';
 const rss=status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
 const queue=Number.isSafeInteger(pid)&&pid>0?[pid]:[],seen=new Set();let sum=0,largest=0,measured=0;
 while(queue.length&&seen.size<32){
  const current=queue.shift();if(seen.has(current))continue;seen.add(current);
  const value=text('/proc/'+current+'/status').match(/^VmRSS:\s+(\d+)\s+kB$/m);
  if(value){const kib=Number(value[1]);sum+=kib;largest=Math.max(largest,kib);measured++;}
  const children=text('/proc/'+current+'/task/'+current+'/children').trim();
  if(/^\d+(\s+\d+)*$/.test(children))for(const id of children.split(/\s+/).map(Number))if(Number.isSafeInteger(id)&&id>0&&!seen.has(id)&&queue.length+seen.size<32)queue.push(id);
 }
 const events=text('/sys/fs/cgroup/memory.events');
 const event=key=>{const m=events.match(new RegExp('^'+key+' (\\d+)$','m'));return m?Number(m[1]):null;};
 let disk=null;try{const s=stat(process.cwd());disk=s.bavail*s.bsize;}catch{/* unavailable is not zero */}
 return {available_memory_bytes:freemem(),total_memory_bytes:totalmem(),load_1m:loadavg()[0],disk_available_bytes:disk,child_rss_kib:rss?Number(rss[1]):null,owned_tree_rss_kib:measured?sum:null,largest_owned_rss_kib:measured?largest:null,owned_processes_measured:measured,cgroup_oom:event('oom'),cgroup_oom_kill:event('oom_kill')};
}

export async function observeNode(args,{intervalMs=20000,killGraceMs=5000,log=line=>process.stdout.write(JSON.stringify(line)+'\n')}={}){
 if(!Array.isArray(args)||!args.length||args.some(a=>typeof a!=='string'))throw Error('CI_NODE_ARGUMENTS_REQUIRED');
 const started=Date.now(),group=process.platform!=='win32';
 const child=spawn(process.execPath,args,{stdio:'inherit',shell:false,detached:group});
 let receivedSignal=null,escalation;
 const emit=(event,extra={})=>log({scope:'CI_OWNED_NODE_DIAGNOSTIC',event,at:new Date().toISOString(),elapsed_ms:Date.now()-started,...resourceSnapshot(child.pid),...extra});
 const signalChild=signal=>{
  if(!child.pid)return;
  try{if(group)process.kill(-child.pid,signal);else child.kill(signal);}catch(error){if(error.code!=='ESRCH')emit('signal_unavailable',{code:error.code});}
 };
 const handlers=new Map(['SIGTERM','SIGINT'].map(signal=>[signal,()=>{
  if(receivedSignal)return;
  receivedSignal=signal;emit('cancellation',{signal});signalChild(signal);
  escalation=setTimeout(()=>signalChild('SIGKILL'),killGraceMs);escalation.unref();
 }]));
 for(const [signal,handler]of handlers)process.on(signal,handler);
 const timer=setInterval(()=>emit('running'),intervalMs);timer.unref();
 emit('started');
 return new Promise(resolve=>{
  child.on('error',error=>emit('spawn_error',{code:error.code??'UNKNOWN'}));
  child.on('close',(code,signal)=>{
   clearInterval(timer);clearTimeout(escalation);
   for(const [name,handler]of handlers)process.removeListener(name,handler);
   const effectiveSignal=receivedSignal??signal;
   const exitCode=effectiveSignal?128+(constants.signals[effectiveSignal]??1):(code??1);
   emit('finished',{child_code:code,child_signal:signal,cancellation_signal:receivedSignal,exit_code:exitCode});resolve(exitCode);
  });
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exitCode=await observeNode(process.argv.slice(2));}
 catch{console.error('CI_NODE_OBSERVER_CONFIGURATION_ERROR');process.exitCode=64;}
}
