// Bounded manual existing-official-source probe. No Supabase/worker writes.
import {directoryPlan,fetchSource,acquisitionPlan,classifyCompanies} from '../src/features/vnext/dailyAdapter.ts';
const now=()=>new Date().toISOString(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date());
const receipts=[],summary=[];
for(const task of await directoryPlan(date)){
 try{const r=await fetchSource(task,fetch,now,AbortSignal.timeout(12000));receipts.push(r);summary.push({kind:task.kind,source:task.url,first_seen_at:r.first_seen_at,available_at:r.available_at,published_at:r.published_at,raw_hash:r.raw_hash,payload_hash:r.payload_hash,rows:r.payload.rows.length,status:'PASS'});}
 catch(e){summary.push({kind:task.kind,source:task.url,status:'UNAVAILABLE',reason:e instanceof Error?e.message:'SOURCE_FAILED'});}
}
let classified=0;
try{const companies=classifyCompanies(receipts);classified=companies.length;
 const tasks=await acquisitionPlan(date,companies),task=tasks.filter(t=>t.kind==='PRICE'&&t.symbols[0]==='2330').at(-1);
 if(task)try{const r=await fetchSource(task,fetch,now,AbortSignal.timeout(12000));summary.push({kind:task.kind,source:task.url,first_seen_at:r.first_seen_at,available_at:r.available_at,published_at:null,payload_hash:r.payload_hash,rows:r.payload.rows.length,through:r.payload.rows.at(-1)?.date,status:'PASS'});}catch(e){summary.push({kind:task.kind,status:'UNAVAILABLE',reason:e instanceof Error?e.message:'SOURCE_FAILED'});}
}catch(e){summary.push({kind:'UNIVERSE_CLASSIFICATION',status:'UNAVAILABLE',reason:e instanceof Error?e.message:'UNKNOWN'});}
console.log(JSON.stringify({scope:'BOUNDED_REAL_OFFICIAL_READ_NOT_NATURAL_FORWARD',date,classified,summary,production_writes:0,forward_sample:0,outcome_sample:0,member_published:0}));
