import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {stockAiCitationRepairRevision,stockAiAllFactsCitationRepairRevision,stockAiCitationRepairOriginalRevision} from '../supabase/functions/_shared/daily-stock-ai-runner.ts';

test('same Edge route repairs only the reviewed stock with fixed prompt8 and never continues or stages',async()=>{
 const symbols=Array.from({length:72},(_,i)=>String(1000+i));symbols[0]='2379';symbols[71]='2357';
 const cutoff='2026-10-31T07:17:02.217051Z',batch={id:'a'.repeat(64),cutoff,packets:symbols.map(symbol=>({symbol,company:'測試公司'+symbol,cutoff,evidence:
  ['2026-10-29','2026-10-30'].map(date=>({id:symbol+':PRICE:'+date,symbol,kind:'PRICE',source:'https://www.twse.com.tw/',published_at:date+'T07:00:00Z',
   available_at:date+'T07:01:00Z',content:JSON.stringify({date,open:10,high:12,low:9,close:11,volume:100,amount:1100})}))}))};
 const before=await snapshotHash(batch),review='c'.repeat(64),secret='test-only-citation-repair-secret-0123456789',saved={},claims=[],models=[],candidates=[],operations=[];
 const originalStates=Object.fromEntries(symbols.map(s=>[s,{state:'COMPLETE',model_revision:stockAiCitationRepairOriginalRevision}])),originalBefore=structuredClone(originalStates);
 let requested='2379',claimMode='ACQUIRED',badFence=false,badPrior=false,revision=stockAiCitationRepairRevision,currentReview=review,worker;
 const oldFetch=globalThis.fetch,oldDeno=globalThis.Deno;
 const identity=async(symbol,revision)=>{const packet=batch.packets.find(p=>p.symbol===symbol),input_hash=await snapshotHash(packet);
  return {input_hash,key:await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash,model_revision:revision})};};
 try{
  globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-role',CRON_SECRET:secret,OPENAI_API_KEY:'test-only-provider-key'})[name]},serve:handler=>{worker=handler;}};
  globalThis.fetch=async(url,init)=>{
   const parsed=new URL(String(url)),name=parsed.pathname.split('/').at(-1),args=JSON.parse(init.body);
   if(parsed.hostname==='api.openai.com'){
    const p=JSON.parse(args.messages[1].content);models.push(p.symbol);assert.equal(p.symbol,requested);assert.equal(args.model,'gpt-6-astra');assert.equal(args.reasoning_effort,'low');
    assert.equal(args.response_format.json_schema.strict,true);assert.equal(args.max_completion_tokens,6000);
    assert(args.messages[0].content.includes('本次為跨日引用修復'));assert(args.messages[0].content.includes('該條 claim.evidence_ids 必須同時引用'));
    assert(args.messages[0].content.includes('不能借用其他理由或反面證據的引用'));assert(args.messages[0].content.includes('AS_REPORTED只代表來源原報值'));
    assert.equal(args.messages[0].content.includes('本次另為每條主張完整引用的第二次修復'),revision===stockAiAllFactsCitationRepairRevision);
    if(revision===stockAiAllFactsCitationRepairRevision){assert(args.messages[0].content.includes('包括EPS正負、跨月轉折及反證'));assert(args.messages[0].content.includes('不能用營業利益率或其他比率代替'));}
    assert(args.messages[0].content.includes('不得用中文數字提供任何價格'));
    assert.deepEqual(args.response_format.json_schema.schema.$defs.evidence_id.enum,p.evidence.map(e=>e.id));
    const answer={symbol:p.symbol,horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:horizon==='SHORT'?'WAIT':'INSUFFICIENT',
     reason:{text:'等待後續資料確認。',evidence_ids:[p.evidence[1].id]},
     counter_evidence:horizon==='SHORT'?[{text:'2026-10-30開盤較2026-10-29收盤偏低，仍需留意賣壓。',evidence_ids:p.evidence.map(e=>e.id)}]:[],
     confirmation:'等待新公告確認',invalidation:'新證據否定判斷時重新評估',gaps:horizon==='SHORT'?[]:['缺乏本期間需要的營運證據']}))};
    return Response.json({id:'test-paid-repair-'+p.symbol+(revision===stockAiAllFactsCitationRepairRevision?'-9':'-8'),model:'gpt-6-astra',usage:{prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]});
   }
   assert.equal(parsed.hostname,'database.example.invalid');operations.push(name);
   if(name==='load_daily_stock_ai_batch_v1'){assert.equal(args.p_batch_id,batch.id);return Response.json(batch);}
   if(name==='load_daily_stock_ai_citation_repair_v1'){
    assert.equal(args.p_symbol,requested);assert.equal(args.p_review_document_hash,currentReview);
    const base=await identity(requested,stockAiCitationRepairOriginalRevision),repair=await identity(requested,revision),prior=await identity(requested,stockAiCitationRepairRevision);
    return Response.json({state:'READY',batch_id:batch.id,symbol:requested,input_hash:repair.input_hash,cutoff,original_job_key:base.key,job_key:repair.key,
     review_document_hash:badFence?'d'.repeat(64):currentReview,model_revision:revision,dispatch_request_id:123,member_published:false,
     ...(revision===stockAiAllFactsCitationRepairRevision?{prior_job_key:prior.key,prior_model_revision:stockAiCitationRepairRevision,prior_input_hash:badPrior?'f'.repeat(64):prior.input_hash,prior_cutoff:cutoff}:{})});
   }
   if(name==='daily_stock_ai_job_v1'){
    const repair=await identity(requested,revision);assert.equal(args.p_key,repair.key,'original or prior completed jobs must never be rewritten');
    if(args.p_op==='CLAIM'){
     claims.push(args.p_context.symbol);assert.equal(args.p_context.symbol,requested);assert.equal(args.p_context.input_hash,repair.input_hash);assert.equal(args.p_context.model_revision,revision);
     const expectedText={version:'DAILY_AI_BATCH_1',input_hash:repair.input_hash,model_revision:revision};assert.deepEqual(JSON.parse(args.p_identity_text),expectedText);
     if(claimMode==='BUSY'||claimMode==='EXHAUSTED')return Response.json({state:claimMode});
     return Response.json(saved[repair.key]?{state:'CACHED',result:saved[repair.key]}:{state:'ACQUIRED',lease:'test-repair-lease'});
    }
    assert.equal(args.p_op,'COMPLETE');assert(candidates.some(c=>c.p_symbol===requested));assert.equal(args.p_result.input_hash,repair.input_hash);assert.equal(args.p_result.publication_ready,false);
    assert.equal(args.p_result.horizons[0].counter_evidence[0].evidence_ids.length,2);saved[repair.key]=args.p_result;return Response.json({state:'STORED'});
   }
   if(name==='retain_daily_ai_model_candidate_v1'){
    const repair=await identity(requested,revision);assert.equal(args.p_model_revision,revision);assert.equal(args.p_symbol,requested);assert.equal(args.p_input_hash,repair.input_hash);
    assert.equal(args.p_cutoff,cutoff);assert.equal(args.p_candidate.symbol,requested);assert.equal(args.p_receipt.response_id,'test-paid-repair-'+requested+(revision===stockAiAllFactsCitationRepairRevision?'-9':'-8'));candidates.push(args);
    return Response.json({state:'RETAINED',member_published:false});
   }
   assert.fail('repair must not dispatch, stage, publish, refresh sources or run another route: '+name);
  };
  await import('../supabase/functions/daily-stock-analysis-v1/index.ts');
  const invoke=async(symbol=requested,extra={})=>{
   requested=symbol;const r=await worker(new Request('https://worker.example.invalid',{method:'POST',headers:{'x-vnext-internal':secret},body:JSON.stringify({batch_id:batch.id,repair_symbol:symbol,review_document_hash:currentReview,...extra})}));return {response:r,body:await r.json()};
  };
  let r=await invoke();assert.equal(r.response.status,200);assert.equal(r.body.state,'COMPLETE');assert.equal(r.body.symbol,'2379');assert.equal(r.body.model_calls,1);assert.equal(r.body.model_revision,stockAiCitationRepairRevision);
  assert.equal(r.body.job_key,(await identity('2379',stockAiCitationRepairRevision)).key);assert.equal(r.body.review_document_hash,review);assert.equal(r.body.member_published,false);assert.equal(models.length,1);
  r=await invoke();assert.equal(r.response.status,200);assert.equal(r.body.state,'CACHED');assert.equal(r.body.model_calls,0);assert.equal(models.length,1);
  claimMode='BUSY';r=await invoke('2357');assert.equal(r.response.status,202);assert.equal(r.body.state,'BUSY');assert.equal(r.body.model_calls,0);assert.equal(models.length,1);
  claimMode='EXHAUSTED';r=await invoke('2357');assert.equal(r.response.status,409);assert.equal(r.body.state,'EXHAUSTED');assert.equal(r.body.model_calls,0);assert.equal(models.length,1);
  claimMode='ACQUIRED';r=await invoke('2357');assert.equal(r.response.status,200);assert.equal(r.body.state,'COMPLETE');assert.equal(r.body.model_calls,1);assert.deepEqual(models,['2379','2357']);
  assert.deepEqual(claims,['2379','2379','2357','2357','2357']);assert.deepEqual(candidates.map(c=>c.p_symbol),['2379','2357']);
  const beforeRejected=claims.length;badFence=true;r=await invoke('2379');assert.equal(r.response.status,409);assert.equal(r.body.model_calls,0);badFence=false;
  for(const extra of [{model:'other-model'},{repairInstructions:'caller-controlled'},{raw_packets:[]},{extra:true}]){
   r=await invoke('2379',extra);assert.equal(r.response.status,422);assert.equal(r.body.model_calls,0);
  }
  r=await invoke('9999');assert.equal(r.response.status,409);assert.equal(r.body.model_calls,0);assert.equal(claims.length,beforeRejected);assert.equal(models.length,2);
  const unauthorized=await worker(new Request('https://worker.example.invalid',{method:'POST',body:JSON.stringify({batch_id:batch.id,repair_symbol:'2379',review_document_hash:review})}));assert.equal(unauthorized.status,401);
  const origin=await worker(new Request('https://worker.example.invalid',{method:'POST',headers:{'x-vnext-internal':secret,Origin:'https://member.example.invalid'},body:JSON.stringify({batch_id:batch.id,repair_symbol:'2379',review_document_hash:review})}));assert.equal(origin.status,403);
  assert.equal(models.length,2);assert.equal(await snapshotHash(batch),before);assert.deepEqual(originalStates,originalBefore);
  const prior8=structuredClone(saved[(await identity('2357',stockAiCitationRepairRevision)).key]);revision=stockAiAllFactsCitationRepairRevision;currentReview='e'.repeat(64);
  r=await invoke('2357');assert.equal(r.response.status,200);assert.equal(r.body.model_revision,stockAiAllFactsCitationRepairRevision);assert.equal(r.body.model_calls,1);
  assert.equal(r.body.prior_job_key,(await identity('2357',stockAiCitationRepairRevision)).key);assert.equal(r.body.prior_model_revision,stockAiCitationRepairRevision);assert.equal(r.body.prior_cutoff,cutoff);
  assert.equal(r.body.job_key,(await identity('2357',stockAiAllFactsCitationRepairRevision)).key);assert.deepEqual(models,['2379','2357','2357']);
  r=await invoke('2357');assert.equal(r.body.state,'CACHED');assert.equal(r.body.model_calls,0);assert.equal(models.length,3);
  const beforeBadPrior=claims.length;badPrior=true;r=await invoke('2357');assert.equal(r.response.status,409);assert.equal(r.body.model_calls,0);badPrior=false;assert.equal(claims.length,beforeBadPrior);
  r=await invoke('2357',{model_revision:stockAiCitationRepairRevision});assert.equal(r.response.status,422);assert.equal(models.length,3);
  assert.deepEqual(saved[(await identity('2357',stockAiCitationRepairRevision)).key],prior8);assert.deepEqual(candidates.map(c=>c.p_model_revision),[stockAiCitationRepairRevision,stockAiCitationRepairRevision,stockAiAllFactsCitationRepairRevision]);
  assert.equal(await snapshotHash(batch),before);assert.deepEqual(originalStates,originalBefore);
  assert(!operations.some(name=>name.includes('dispatch')||name.includes('stage')||name.includes('publish')));
 }finally{globalThis.fetch=oldFetch;if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
});
