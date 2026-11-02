// CURRENT ZERO-PAID POLICY. Historical protocol success is never current permission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyseStockWithProvider} from '../supabase/functions/_shared/daily-stock-ai.ts';
import {STOCK_AI_PAID_CALLS_ENABLED} from '../supabase/functions/_shared/daily-stock-ai-cost-policy.ts';
import {INSTITUTIONAL_SYMBOLS} from '../research/institutional-registry.constants.ts';
import {STOCK_AI_PRE_HARDSTOP_REVISION,stockAiHistoricalManifest,verifyStockAiHistoricalManifestBytes,
 verifyStockAiHistoricalGit,verifyStockAiHistoricalSource,readStockAiHistoricalSource,stockAiHistoricalPath,
 importStockAiHistoricalModule,STOCK_AI_ORIGINAL_SOURCE_WORKER_REVISION,stockAiOriginalSourceManifest,
 verifyStockAiOriginalSourceManifestBytes,verifyStockAiOriginalSourceGit,verifyStockAiOriginalSource,readStockAiOriginalSource,
 importStockAiOriginalSourceWorkerModule} from './helpers/stockAiHistoricalProtocol.mjs';

test('HISTORICAL SOURCE INTEGRITY: fixed52 plus original40 Git closures reject body, mode, blob, manifest and scope tampering',async()=>{
 verifyStockAiHistoricalGit();verifyStockAiOriginalSourceGit();assert.equal(stockAiHistoricalManifest.files.length,52);assert.equal(stockAiOriginalSourceManifest.files.length,40);
 assert.equal(stockAiHistoricalManifest.current_policy_admission,false);
 assert(Object.isFrozen(stockAiHistoricalManifest));assert(Object.isFrozen(stockAiHistoricalManifest.files));
 for(const row of stockAiHistoricalManifest.files){
  const bytes=readStockAiHistoricalSource(row.path);assert(Object.isFrozen(row));
  assert.deepEqual(verifyStockAiHistoricalSource(row.path,bytes,row.mode,row.git_blob),bytes);
  const corrupt=Buffer.from(bytes);corrupt[0]^=1;
  assert.throws(()=>verifyStockAiHistoricalSource(row.path,corrupt,row.mode,row.git_blob),/STOCK_AI_HISTORY_SOURCE_HASH/);
  assert.throws(()=>verifyStockAiHistoricalSource(row.path,bytes,'100755',row.git_blob),/STOCK_AI_HISTORY_SOURCE_MODE/);
  assert.throws(()=>verifyStockAiHistoricalSource(row.path,bytes,row.mode,'0'.repeat(40)),/STOCK_AI_HISTORY_SOURCE_BLOB/);
  const copy=readStockAiHistoricalSource(row.path);copy.fill(0);assert.deepEqual(readStockAiHistoricalSource(row.path),bytes);
 }
 for(const row of stockAiOriginalSourceManifest.files){
  const bytes=readStockAiOriginalSource(row.path);assert.deepEqual(verifyStockAiOriginalSource(row.path,bytes,row.mode,row.git_blob),bytes);
  const corrupt=Buffer.from(bytes);corrupt[0]^=1;assert.throws(()=>verifyStockAiOriginalSource(row.path,corrupt,row.mode,row.git_blob),/STOCK_AI_HISTORY_SOURCE_HASH/);
  assert.throws(()=>verifyStockAiOriginalSource(row.path,bytes,'100755',row.git_blob),/STOCK_AI_HISTORY_SOURCE_MODE/);
 }
 const manifest=readFileSync(new URL('./fixtures/daily-stock-ai-pre-hardstop-source-manifest.json',import.meta.url));
 assert.throws(()=>verifyStockAiHistoricalManifestBytes(Buffer.concat([manifest,Buffer.from('\n')])),/STOCK_AI_HISTORY_MANIFEST_HASH/);
 const originalManifest=readFileSync(new URL('./fixtures/daily-stock-ai-source-worker-83-source-manifest.json',import.meta.url));
 assert.throws(()=>verifyStockAiOriginalSourceManifestBytes(Buffer.concat([originalManifest,Buffer.from('\n')])),/STOCK_AI_HISTORY_MANIFEST_HASH/);
 assert.throws(()=>readStockAiHistoricalSource('supabase/functions/_shared/daily-stock-ai-cost-policy.ts'),/STOCK_AI_HISTORY_UNKNOWN_PATH/);
 assert.throws(()=>stockAiHistoricalPath('stock-ai-pre-hardstop://HEAD/research/daily-ai-analysis.ts'),/STOCK_AI_HISTORY_REVISION/);
 assert.throws(()=>stockAiHistoricalPath('stock-ai-pre-hardstop://'+STOCK_AI_PRE_HARDSTOP_REVISION+'/research/daily-ai-analysis.ts?current=true'),/STOCK_AI_HISTORY_URL_SCOPE/);
 await assert.rejects(importStockAiHistoricalModule('supabase/functions/_shared/daily-stock-ai-cost-policy.ts'),/STOCK_AI_HISTORY_ENTRYPOINT/);
 await assert.rejects(importStockAiHistoricalModule('supabase/functions/_shared/daily-stock-ai.ts','HEAD'),/STOCK_AI_HISTORY_NO_CUSTOM_REVISION_OR_READER/);
 await assert.rejects(importStockAiOriginalSourceWorkerModule('supabase/functions/_shared/daily-stock-ai.ts'),/STOCK_AI_HISTORY_ENTRYPOINT/);
 const hook=await import('./helpers/stockAiHistoricalLoaderHook.mjs');
 const parentURL='stock-ai-pre-hardstop://'+STOCK_AI_PRE_HARDSTOP_REVISION+'/supabase/functions/_shared/daily-stock-ai.ts';
 for(const specifier of ['https://api.openai.com/module.mjs','file:///tmp/current-source.ts','npm:unreviewed','node:fs']){
  let fallback=0;await assert.rejects(hook.resolve(specifier,{parentURL},()=>{fallback++;assert.fail('nonlocal historical import cannot fall through');}),/STOCK_AI_HISTORY_NONLOCAL_IMPORT/);assert.equal(fallback,0);
 }
 await assert.rejects(hook.resolve('stock-ai-pre-hardstop://'+STOCK_AI_ORIGINAL_SOURCE_WORKER_REVISION+'/supabase/functions/_shared/daily-stock-ai.ts',{},()=>assert.fail('wrong SOURCE entrypoint')),/STOCK_AI_HISTORY_ENTRYPOINT/);
 await assert.rejects(hook.resolve('stock-ai-pre-hardstop://'+STOCK_AI_ORIGINAL_SOURCE_WORKER_REVISION+'/src/features/vnext/contracts.ts',{parentURL},()=>assert.fail('cross-revision fallback')),/STOCK_AI_HISTORY_CROSS_REVISION_IMPORT/);
});

test('CURRENT ZERO-PAID provider stays separate from historical modules and refuses config before every port',async()=>{
 const historical=await importStockAiHistoricalModule('supabase/functions/_shared/daily-stock-ai.ts');
 assert.notEqual(historical.analyseStockWithProvider,analyseStockWithProvider);assert.equal(STOCK_AI_PAID_CALLS_ENABLED,false);
 const touched=[];
 await assert.rejects(analyseStockWithProvider(null,{
  get apiKey(){touched.push('apiKey');throw Error('actual credential must remain unread');},
  get model(){touched.push('model');throw Error('actual model must remain unread');},
  get onCandidate(){touched.push('candidate');throw Error('no retention/member port');},
  fetcher:async()=>{touched.push('provider');assert.fail('no current provider call');},
 }),{message:'STOCK_AI_PAID_MODEL_DISABLED'});
 assert.deepEqual(touched,[]);
});

test('CURRENT ZERO-PAID actual entrypoint blocks legacy paid families before credentials, DB, dispatch, stage or member work',async t=>{
 const oldFetch=globalThis.fetch,oldDeno=globalThis.Deno,secret='current-boundary-test-only-internal-secret-0000';
 const intake='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',batch='b'.repeat(64),review='c'.repeat(64);
 const envReads=[],calls=[];let worker,sourceAllowed=false,freshSource=null,providerCalls=0,dispatchCalls=0,memberCalls=0;
 try{
  globalThis.Deno={env:{get:name=>{envReads.push(name);if(name==='OPENAI_API_KEY')throw Error('current paid API key cannot be read');
   return ({SUPABASE_URL:'https://current-policy.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-role',CRON_SECRET:secret})[name];}},serve:handler=>{worker=handler;}};
  globalThis.fetch=async(input,init)=>{
   const url=new URL(String(input instanceof Request?input.url:input)),name=url.pathname.split('/').at(-1);calls.push(name);
   if(url.hostname==='api.openai.com'){providerCalls++;assert.fail('no current provider request');}
   if(/dispatch|continue/i.test(name)){dispatchCalls++;assert.fail('no current analysis dispatch');}
   if(/stage|publish|member|retain_daily_ai_model_candidate/i.test(name)){memberCalls++;assert.fail('no current stage/member/model retention');}
   assert.equal(sourceAllowed,true,'paid selectors must stop before any DB/source request');
   if(freshSource&&url.hostname!=='current-policy.example.invalid'){
    assert(['www.twse.com.tw','openapi.twse.com.tw','www.tpex.org.tw','www.federalreserve.gov','home.treasury.gov','openapi.taifex.com.tw','www.taifex.com.tw'].includes(url.hostname));
    assert.equal(init.method,'GET');assert(init.signal instanceof AbortSignal);freshSource.publicRequests++;
    return new Response('synthetic official acquisition unavailable',{status:503});
   }
   assert.equal(url.hostname,'current-policy.example.invalid');assert.equal(name,'daily_stock_ai_intake_v1');
   const args=JSON.parse(init.body);assert.equal(args.p_op,'CLAIM');assert.equal(args.p_intake_id,intake);
   return Response.json({state:'CACHED',intake_id:intake,batch_id:batch,member_published:false});
  };
  await import('../supabase/functions/daily-stock-analysis-v1/index.ts');assert.equal(typeof worker,'function');
  const request=selector=>new Request('https://current-worker.example.invalid',{method:'POST',headers:{'x-vnext-internal':secret},body:JSON.stringify(selector)});
  const cases=[
   ['CitationRepair',{batch_id:batch,repair_symbol:'2330',review_document_hash:review}],
   ['Intake',{cutoff:'2026-10-31T00:00:00Z'}],
   ['Pilot',{batch_id:batch}],
   ['Worker cached/staging',{batch_id:batch}],
   ['RateLimitRecovery',{batch_id:batch,recovery_symbol:'2330',review_document_hash:review}],
   ['SourceWorker mixed repair',{intake_id:intake,repair_symbol:'2330'}],
   ['SourceWorker mixed recovery',{intake_id:intake,recovery_symbol:'2330'}],
   ['caller paid opt-in',{intake_id:intake,allow_paid:true}],
  ];
  for(const [name,selector] of cases)await t.test(name,async()=>{
   const before=calls.length,response=await worker(request(selector));assert.equal(response.status,409);
   assert.deepEqual(await response.json(),{state:'PAUSED',error:'STOCK_AI_PAID_MODEL_DISABLED',model_calls:0,
    automatic_continuation:false,requires_next_checkpoint:false,member_published:false});
   assert.equal(calls.length,before);assert.equal(envReads.includes('OPENAI_API_KEY'),false);
   assert.equal(providerCalls,0);assert.equal(dispatchCalls,0);assert.equal(memberCalls,0);
  });
  await t.test('SourceWorker exact cached intake keeps the free checkpoint without acquisition or paid dispatch',async()=>{
   sourceAllowed=true;const before=calls.length,response=await worker(request({intake_id:intake}));assert.equal(response.status,202);
   assert.deepEqual(await response.json(),{state:'SOURCE_PREPARED',intake_id:intake,batch_id:batch,analysis_dispatched:false,model_calls:0,member_published:false});
   assert.deepEqual(calls.slice(before),['daily_stock_ai_intake_v1']);assert.equal(envReads.includes('OPENAI_API_KEY'),false);
   assert.equal(providerCalls,0);assert.equal(dispatchCalls,0);assert.equal(memberCalls,0);
  });
  await t.test('SourceWorker fresh current SOURCE retains documented-review proof and frozen receipts with paid gate false',async()=>{
   const NativeDate=globalThis.Date,now='2026-10-31T03:00:01.000Z',prior='2026-10-29T12:00:00Z';
   const lease='dddddddd-dddd-dddd-dddd-dddddddddddd',sourceId='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
   const inputs=INSTITUTIONAL_SYMBOLS.map((symbol,i)=>({symbol,company:'目前來源測試'+i,cutoff:prior,through:'2026-10-29',next_session:'2026-10-30',
    v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},expected_sessions:['2026-10-29'],facts:[],bars:[{id:'retained-'+i,source:'https://www.twse.com.tw/',published_at:null,
     first_seen_at:prior,available_at:prior,as_of:'2026-10-29T05:30:00Z',evidence_hash:'a'.repeat(64),date:'2026-10-29',open:10,high:12,low:9,close:11,volume:1000,amount:11000,session_scope:'TWSE_OFFICIAL_DAY_INCLUDING_BLOCK'}]}));
   const baseGaps=['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','FINANCIAL_RETAINED_OBSERVATIONS_MAY_BE_STALE','INSTITUTIONAL_FLOW_NOT_REFRESHED','CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY'];
   const acquired={schema:'DAILY_AI_INTAKE_SOURCE_V1',state:'ACQUIRED',intake_id:intake,lease,business_date:'2026-10-31',requested_at:'2026-10-31T02:00:00Z',
    projection:'DAILY_AI_RETAINED_INPUT_PROJECTION_V1',inputs,companies:inputs.map(i=>({symbol:i.symbol,company:i.company,exchange:'TWSE'})),
    source_kind:'VNEXT_ACQUIRED',source_id:sourceId,source_revision:'f'.repeat(64),source_cutoff:prior,source_business_date:'2026-10-29',source_issues:[],intake_gaps:baseGaps,news:[],market:[],member_published:false};
   freshSource={publicRequests:0,proof:null,frozen:null,batch:null};
   const cachedFetch=globalThis.fetch;
   try{
    globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return NativeDate.parse(now);}};
    globalThis.fetch=async(input,init)=>{
     const url=new URL(String(input instanceof Request?input.url:input)),name=url.pathname.split('/').at(-1);
     if(url.hostname!=='current-policy.example.invalid')return cachedFetch(input,init);
     calls.push(name);assert(init.signal instanceof AbortSignal);const args=JSON.parse(init.body);
     if(/^load_daily_stock_ai_.*(?:replay_v1|reviews_v2)$/.test(name))return Response.json({message:'synthetic retained registry unavailable'},{status:400});
     if(name==='import_daily_stock_ai_official_news_v1'){assert.equal(args.p_proof.responses.length,3);return Response.json({state:'STORED',capture_id:'9'.repeat(64),records:0,member_published:false});}
     if(name==='daily_stock_ai_intake_v1'){
      if(args.p_op==='CLAIM')return Response.json(freshSource.frozen??acquired);
      if(args.p_op==='SOURCE'){
       const proof=args.p_financial_refresh;assert.deepEqual(Object.keys(proof).sort(),['schema','observed_at','responses','additions','removals','company_names','documented_review_replay'].sort());
       assert.equal(proof.schema,'DAILY_AI_FINANCIAL_REFRESH_V1');assert.equal(proof.observed_at,now);assert.equal(proof.responses.length,5);
       assert(proof.responses.every(r=>r.state==='UNAVAILABLE'));assert.deepEqual(proof.additions,[]);assert.deepEqual(proof.removals,[]);
       assert.equal(proof.documented_review_replay.schema,'DOCUMENTED_REVIEW_REPLAY_V2');assert.equal(proof.documented_review_replay.state,'REGISTRY_UNAVAILABLE_NOT_APPLIED');
       assert.equal(proof.documented_review_replay.source_admitted,false);assert.equal(proof.documented_review_replay.member_publication_approved,false);
       assert.equal(args.p_inputs.length,72);assert(args.p_gaps.includes('SEC_RETAINED_SOURCE_REPLAY_UNAVAILABLE'));assert(args.p_gaps.includes('NEWS_REFRESH_UNAVAILABLE'));
       freshSource.proof=structuredClone(proof);freshSource.frozen={...acquired,state:'SOURCED',cutoff:now,snapshot_hash:'8'.repeat(64),inputs:args.p_inputs,
        intake_gaps:[...new Set([...baseGaps,...args.p_gaps,'NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE','NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS',
         'NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES','MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE','NEWS_NONE_AVAILABLE_WITHIN_48H'])],gaps_by_symbol:args.p_symbol_gaps,news:[],market:args.p_market,financial_refresh:proof};
       return Response.json(freshSource.frozen);
      }
      assert.equal(args.p_op,'COMPLETE');assert.equal(args.p_batch_id,freshSource.batch);return Response.json({state:'COMPLETE',intake_id:intake,batch_id:freshSource.batch,member_published:false});
     }
     if(name==='store_daily_stock_ai_batch_v1'){
      const payload=JSON.parse(args.p_text);assert.equal(payload.cutoff,now);assert.equal(Object.keys(payload.packet_texts).length,72);
      for(const text of Object.values(payload.packet_texts)){const packet=JSON.parse(text);assert.equal(packet.cutoff,now);assert(packet.data_gaps.includes('NEWS_REFRESH_UNAVAILABLE'));}
      freshSource.batch=args.p_hash;return Response.json({state:'STORED',batch_id:args.p_hash,packets:72,member_published:false});
     }
     assert.fail('current free SOURCE cannot dispatch/model/stage/member work: '+name);
    };
    const response=await worker(request({intake_id:intake})),body=await response.json();assert.equal(response.status,202,JSON.stringify(body));
    assert.equal(body.state,'SOURCE_PREPARED');assert.equal(body.analysis_dispatched,false);assert.equal(body.model_calls,0);assert.equal(body.member_published,false);
    assert(freshSource.publicRequests>0);assert(freshSource.proof);assert.equal(body.batch_id,freshSource.batch);assert.equal(envReads.includes('OPENAI_API_KEY'),false);
    assert.equal(providerCalls,0);assert.equal(dispatchCalls,0);assert.equal(memberCalls,0);assert.equal(STOCK_AI_PAID_CALLS_ENABLED,false);
    assert(!calls.some(name=>/dispatch|stage|publish|retain_daily_ai_model_candidate/.test(name)));
   }finally{globalThis.Date=NativeDate;globalThis.fetch=cachedFetch;freshSource=null;}
  });
 }finally{globalThis.fetch=oldFetch;if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
});
