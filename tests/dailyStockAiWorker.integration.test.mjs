import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {stockAiModelRevision} from '../supabase/functions/_shared/daily-stock-ai-runner.ts';

test('real Edge entrypoint reuses 72 completed jobs, stages privately and fails closed on token lookup errors',async()=>{
 const internal='test-only-internal-secret-0123456789',delivery='test-only-delivery-secret-0123456789',modelRevision=stockAiModelRevision('gpt-6-astra');
 const cutoff=new Date(Date.now()-3600000).toISOString(),seen=new Date(Date.parse(cutoff)-60000).toISOString();
 const packets=Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試',cutoff,evidence:[{id:'E',symbol:String(1000+i),kind:'NEWS',source:'https://www.twse.com.tw/',published_at:seen,available_at:seen,content:'測試資料'}]}));
 const completed={};
 for(const p of packets){
  const input_hash=await snapshotHash(p),key=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash,model_revision:modelRevision});
  completed[key]={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol:p.symbol,cutoff,input_hash,member_published:false,model_generated:true,
   sources:p.evidence.map(({content,...source})=>source),horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'測試判斷',evidence_ids:['E']},counter_evidence:[],confirmation:'等待新資料',invalidation:'新證據否定時重評',gaps:[]})),
   receipt:{response_id:'test-receipt-'+p.symbol,model:'test-model',input_tokens:100,output_tokens:100},publication_ready:false};
 }
 const batch={id:'a'.repeat(64),cutoff,packets},oldFetch=globalThis.fetch,oldDeno=globalThis.Deno;
 const calls=[];let worker,throwTokenLookup=false,stageFailure=false;
 const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(delivery))),v=>v.toString(16).padStart(2,'0')).join('');
 try{
  globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-role',CRON_SECRET:internal,OPENAI_API_KEY:'test-only-provider-key'})[name]},serve:handler=>{worker=handler;}};
  globalThis.fetch=async(url,init)=>{
   const path=new URL(String(url)).pathname,name=path.split('/').at(-1);calls.push(name);
   assert(!String(url).includes('api.openai.com'),'cached member-independent work must not call a provider');
   if(name==='runtime_job_tokens'){
    if(throwTokenLookup)throw Error('private lookup detail');
    return Response.json({token_hash:tokenHash,is_active:true});
   }
   assert(init.signal instanceof AbortSignal,'database calls retain bounded cancellation');
   const args=JSON.parse(init.body);
   if(name==='load_daily_stock_ai_batch_v1'){assert.equal(args.p_batch_id,batch.id);return Response.json(batch);}
   if(name==='load_daily_stock_ai_progress_v1'){
    assert.equal(args.p_batch_id,batch.id);assert.equal(args.p_model_revision,modelRevision);
    return Response.json({schema:'DAILY_AI_PROGRESS_V1',batch_id:batch.id,model_revision:modelRevision,completed});
   }
   if(name==='stage_daily_ai_research_edition_v1'){
    assert.deepEqual(new Set(args.p_job_keys),new Set(Object.keys(completed)));assert.equal(args.p_expires_at,new Date(Date.parse(cutoff)+72*3600000).toISOString());
    return stageFailure?Response.json({message:'private database detail'},{status:503}):Response.json({status:'STAGED_REVIEW_REQUIRED',edition_id:'b'.repeat(64),member_published:false});
   }
   assert.fail('unexpected database claim, continuation or publication: '+name);
  };
  await import('../supabase/functions/daily-stock-analysis-v1/index.ts');assert.equal(typeof worker,'function');
  const req=headers=>new Request('https://worker.example.invalid',{method:'POST',headers,body:JSON.stringify({batch_id:batch.id})});
  let response=await worker(req({'x-daily-delivery-token':delivery})),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.model_calls,0);assert.equal(body.counts.CACHED,72);assert.equal(body.edition_status,'STAGED_REVIEW_REQUIRED');assert.equal(body.member_published,false);
  assert(!JSON.stringify(body).includes(internal));assert(!JSON.stringify(body).includes(delivery));assert(!JSON.stringify(body).includes('test-only-provider-key'));
  assert.deepEqual(calls,['runtime_job_tokens','load_daily_stock_ai_batch_v1','load_daily_stock_ai_progress_v1','stage_daily_ai_research_edition_v1']);
  calls.length=0;stageFailure=true;
  response=await worker(req({'x-vnext-internal':internal}));body=await response.json();assert.equal(response.status,202);assert.equal(body.edition_status,'STAGING_PENDING');assert.equal(body.requires_stage_checkpoint,true);assert.equal(body.member_published,false);assert(!JSON.stringify(body).includes('private'));
  calls.length=0;throwTokenLookup=true;
  response=await worker(req({'x-daily-delivery-token':delivery}));assert.equal(response.status,401);assert.deepEqual(calls,['runtime_job_tokens']);
  calls.length=0;response=await worker(req({'origin':'https://member.example.invalid','x-vnext-internal':internal}));assert.equal(response.status,403);assert.deepEqual(calls,[]);
 }finally{globalThis.fetch=oldFetch;if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
});
