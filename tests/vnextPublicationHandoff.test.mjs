import test from 'node:test';
import assert from 'node:assert/strict';
import {handleVnextDaily} from '../supabase/functions/vnext-daily-research-v1/handler.ts';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',secret='isolated-publication-handoff-only';
function harness(status='COMPLETE',fail=false){
 const pending=[],staged=[];
 return {pending,staged,env:{cronSecret:secret,clock:()=>new Date().toISOString(),sleep:async()=>{},fetcher:()=>{throw Error('UNEXPECTED_NETWORK');},
  rpc:async(name,args)=>{assert.equal(name,'claim_vnext_daily_research_v1');assert.equal(args.p_run,id);return {status};},
  background:p=>pending.push(p),continueRun:async()=>{throw Error('UNEXPECTED_CONTINUATION');},
  stagePublication:async run=>{staged.push(run);if(fail)throw Error('TEMPORARY_UNAVAILABLE');}}};
}
const request=(headers={})=>new Request('https://example.test/worker',{method:'POST',headers:{'x-vnext-internal':secret,...headers},body:JSON.stringify({run_id:id})});
test('busy or unfinished research does not spend its pre-lock budget on publication intake',async()=>{
 for(const status of ['BUSY','QUEUED','EXPIRED']){const h=harness(status);await handleVnextDaily(request(),h.env);await Promise.all(h.pending);assert.deepEqual(h.staged,[]);}
});
test('existing checkpoint retries publication transport even after completed research without rerunning or changing predictions',async()=>{
 const h=harness();const r=await handleVnextDaily(request(),h.env);assert.equal(r.status,202);await Promise.all(h.pending);
 assert.deepEqual(h.staged,[id]);assert.equal((await r.json()).member_published,0);
});
test('publication transport failure does not change research response or create automatic approval',async()=>{
 const h=harness('COMPLETE',true),r=await handleVnextDaily(request(),h.env);await Promise.all(h.pending);
 assert.equal(r.status,202);assert.deepEqual(h.staged,[id]);assert.equal((await r.json()).member_published,0);
});
test('browser and unsigned requests cannot trigger publication transport',async()=>{
 for(const headers of [{origin:'https://example.test'},{'x-vnext-internal':'wrong'}]){
  const h=harness(),r=await handleVnextDaily(request(headers),h.env);assert([401,403].includes(r.status));assert.deepEqual(h.staged,[]);assert.deepEqual(h.pending,[]);
 }
});
