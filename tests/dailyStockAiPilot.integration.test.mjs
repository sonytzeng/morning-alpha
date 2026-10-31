import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {stockAiModelRevision} from '../supabase/functions/_shared/daily-stock-ai-runner.ts';

test('reviewed source correction continues one model per call and never loops on cache, busy, exhausted or database-rejected work',async()=>{
 const symbols=Array.from({length:72},(_,i)=>String(1000+i));symbols[20]='1504';symbols[50]='2330';
 const cutoff='2026-10-30T12:00:00Z',batch={id:'a'.repeat(64),cutoff,packets:symbols.map(symbol=>({symbol,company:'測試公司',cutoff,
  evidence:[{id:'E',symbol,kind:'NEWS',source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試來源'}]}))};
 const before=await snapshotHash(batch),saved={},claimed=[],models=[],candidates=[],dispatches=[],secret='test-only-internal-secret-0123456789';
 let busy=false,exhausted=false,loadFailure=false,staged=0;
 const oldFetch=globalThis.fetch,oldDeno=globalThis.Deno;let worker;
 try{
  globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-role',CRON_SECRET:secret,OPENAI_API_KEY:'test-only-provider-key'})[name]},serve:handler=>{worker=handler;}};
  globalThis.fetch=async(url,init)=>{
   const parsed=new URL(String(url)),name=parsed.pathname.split('/').at(-1),args=JSON.parse(init.body);
   if(parsed.hostname==='api.openai.com'){
    assert.equal(args.model,'gpt-6-astra');assert.equal(args.reasoning_effort,'low');assert.equal(args.response_format.json_schema.strict,true);
    const p=JSON.parse(args.messages[1].content);models.push(p.symbol);
    return Response.json({id:'test-receipt-'+p.symbol,model:'gpt-6-astra',usage:{prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify({symbol:p.symbol,
     horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'等待資料確認',evidence_ids:['E']},counter_evidence:[],confirmation:'等待下一次官方公告',invalidation:'新證據否定時重新評估',gaps:[]}))})}}]});
   }
   if(name==='load_daily_stock_ai_batch_v1')return loadFailure?Response.json({message:'private database failure'},{status:503}):Response.json(batch);
   if(name==='load_daily_stock_ai_progress_v1'){
    assert.equal(args.p_model_revision,stockAiModelRevision('gpt-6-astra'));assert(args.p_model_revision.endsWith(':prompt-7:reasoning-low'));
    return Response.json({schema:'DAILY_AI_PROGRESS_V1',batch_id:batch.id,model_revision:args.p_model_revision,completed:saved});
   }
   if(name==='daily_stock_ai_job_v1'){
    if(args.p_op==='CLAIM'){claimed.push(args.p_context.symbol);return Response.json(exhausted?{state:'EXHAUSTED'}:busy?{state:'BUSY'}:{state:'ACQUIRED',lease:'test-lease'});}
    assert.equal(args.p_op,'COMPLETE');saved[args.p_key]=args.p_result;return Response.json({state:'STORED'});
   }
   if(name==='retain_daily_ai_model_candidate_v1'){
    const original=batch.packets.find(p=>p.symbol===args.p_symbol);assert(original);assert.equal(args.p_cutoff,cutoff);
    assert.equal(args.p_input_hash,await snapshotHash(original));assert.equal(args.p_model_revision,stockAiModelRevision('gpt-6-astra'));
    assert.equal(args.p_candidate.symbol,original.symbol);assert.equal(args.p_receipt.response_id,'test-receipt-'+original.symbol);candidates.push(args);
    return Response.json({state:'RETAINED',member_published:false});
   }
   if(name==='dispatch_daily_stock_ai_batch_v1'){
    assert.equal(args.p_batch_id,batch.id);dispatches.push({batch_id:args.p_batch_id,model_count:models.length});
    return Response.json({state:'DISPATCHED',batch_id:batch.id,member_published:false});
   }
   if(name==='stage_daily_ai_research_edition_v1'){
    staged++;assert.equal(args.p_batch_id,batch.id);assert.equal(args.p_job_keys.length,72);
    return Response.json({status:'STAGED_REVIEW_REQUIRED',edition_id:'b'.repeat(64),member_published:false});
   }
   assert.fail('unexpected source/publication or unbounded continuation: '+name);
  };
  await import('../supabase/functions/daily-stock-analysis-v1/index.ts');
  const invoke=()=>worker(new Request('https://worker.example.invalid',{method:'POST',headers:{'x-vnext-internal':secret},body:JSON.stringify({batch_id:batch.id})}));
  let r=await invoke(),summary=await r.json();assert.equal(r.status,202);assert.equal(summary.model_calls,1);assert.equal(models.length,1);assert.equal(dispatches.length,1);
  r=await invoke();summary=await r.json();assert.equal(r.status,202);assert.equal(summary.model_calls,1);assert.equal(summary.counts.CACHED,1);assert.equal(dispatches.length,2);
  assert.deepEqual(claimed,['1504','2330']);assert.deepEqual(models,['1504','2330']);assert.deepEqual(candidates.map(c=>c.p_symbol),['1504','2330']);assert.equal(await snapshotHash(batch),before);assert.equal(Object.keys(saved).length,2);
  assert.deepEqual(dispatches.map(d=>d.model_count),[1,2]);
  busy=true;r=await invoke();summary=await r.json();assert.equal(r.status,202);assert.equal(summary.model_calls,0);assert.equal(summary.counts.CACHED,2);assert.equal(summary.counts.BUSY,70);
  assert.equal(models.length,2);assert.equal(candidates.length,2);assert.equal(dispatches.length,2);assert.equal(staged,0);
  busy=false;exhausted=true;r=await invoke();summary=await r.json();assert.equal(r.status,207);assert.equal(summary.model_calls,0);assert.equal(summary.counts.CACHED,2);assert.equal(summary.counts.FAILED,70);
  assert.equal(models.length,2);assert.equal(candidates.length,2);assert.equal(dispatches.length,2);assert.equal(staged,0);
  exhausted=false;loadFailure=true;r=await invoke();summary=await r.json();assert.equal(r.status,409);assert.equal(summary.error,'STOCK_ANALYSIS_REJECTED');
  assert.equal(models.length,2);assert.equal(candidates.length,2);assert.equal(dispatches.length,2);assert.equal(staged,0);loadFailure=false;
  for(const p of batch.packets){
   const input_hash=await snapshotHash(p),key=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash,model_revision:stockAiModelRevision('gpt-6-astra')});
   if(saved[key])continue;
   saved[key]={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol:p.symbol,cutoff,input_hash,model_generated:true,member_published:false,publication_ready:false,
    sources:p.evidence.map(({content,...source})=>source),receipt:{response_id:'test-cache-'+p.symbol,model:'gpt-6-astra',input_tokens:100,output_tokens:100},
    horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'等待資料確認',evidence_ids:['E']},counter_evidence:[],confirmation:'等待下一次官方公告',invalidation:'新證據否定時重新評估',gaps:[]}))};
  }
  r=await invoke();summary=await r.json();assert.equal(r.status,200);assert.equal(summary.model_calls,0);assert.equal(summary.counts.CACHED,72);assert.equal(summary.requires_next_checkpoint,false);
  assert.equal(models.length,2);assert.equal(candidates.length,2);assert.equal(dispatches.length,2);assert.equal(staged,1);assert.equal(await snapshotHash(batch),before);
 }finally{globalThis.fetch=oldFetch;if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
});
