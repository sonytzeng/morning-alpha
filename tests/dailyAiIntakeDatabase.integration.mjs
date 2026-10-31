// Isolated database only. Synthetic identities, provider data and credentials.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildDailyAiSeed} from '../research/build-daily-ai-seed.mjs';
import {canonical,snapshotHash} from '../research/daily-ai-seed.ts';
import {stockAiModelRevision} from '../supabase/functions/_shared/daily-stock-ai-runner.ts';
import {parseDailyAiOwner} from '../src/features/vnext/dailyAiOwner.ts';
import {collectDailyAiGlobalMarket,dailyAiExpectedTaiwanNight} from '../research/daily-ai-global-market.ts';
import {latestCompletedUsSession,previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import {parseDailyAiSourceSnapshot} from '../supabase/functions/daily-stock-analysis-v1/intake.ts';
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();await db.waitReady;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema vnext_runtime;create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_runtime.runs(id uuid primary key,business_date date,checkpoint jsonb,source_revision text,updated_at timestamptz default now());
 create table vnext_runtime.source_revisions(id text primary key,receipt jsonb);
 create table vnext_runtime.run_sources(run_id uuid,source_id text);
 create table public.runtime_http_dispatches(trading_date date,job_name text,checkpoint text,dispatch_status text);
 create table public.news_events(id uuid primary key,title text,summary text,source_name text,provider text,source_url text,published_at timestamptz,created_at timestamptz,fingerprint text);
 create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default now());
 insert into vault.decrypted_secrets(name,decrypted_secret) values('morning_alpha_daily_delivery_token','synthetic-test-delivery-token-000000');
 create schema net;create table net.requests(id bigint generated always as identity,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare n bigint;begin insert into net.requests(body) values(body) returning id into n;return n;end$$;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('00000000-0000-0000-0000-000000000002');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select current_setting('test.tier',true)$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select current_setting('test.tier',true)='owner'$$;
 create schema vnext_private;create function vnext_private.immutable_record() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_private.source_licenses(id text primary key,source text,document_url text,reviewed_at timestamptz,expires_at timestamptz,storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,redistribution_allowed boolean,attribution text);
 create schema cron;create table cron.job(jobname text,schedule text,command text);insert into cron.job values('existing-job','0 0 * * *','select true;');
 create function cron.schedule(p_jobname text,p_schedule text,p_command text) returns bigint language plpgsql as $$begin insert into cron.job values(p_jobname,p_schedule,p_command);return 1;end$$;`);
 // All new application SQL in exact release order. Only platform extension,
 // existing-table and authentication ports are synthetic; no staging stub.
 for(const name of ['daily-ai-jobs','daily-ai-batches','daily-ai-dispatch','daily-ai-handoff','daily-ai-member','daily-ai-use-review','daily-ai-intake','daily-ai-intake-cron']){
  const sql=readFileSync(new URL('../research/'+name+'.candidate.sql',import.meta.url),'utf8');
  if(name==='daily-ai-intake')assert(sql.includes("target_revision constant text:='"+stockAiModelRevision('gpt-4o-mini')+"'"),'Watchdog and worker model identity must match');
  await db.exec(sql);
 }
 const run='00000000-0000-0000-0000-000000000001',revision='a'.repeat(64),inputs=[],companies=[],sourceCutoff='2026-10-29T00:00:00Z';
 const trace=(symbol,date)=>({id:'bar-'+symbol+'-'+date,date,source:'https://www.twse.com.tw/test-price',published_at:null,first_seen_at:sourceCutoff,available_at:sourceCutoff,as_of:date+'T13:30:00+08:00',evidence_hash:'b'.repeat(64),session_scope:'OFFICIAL_STOCK_DAY',open:10,high:12,low:9,close:11,volume:100,amount:1100});
 for(let i=0;i<72;i++){
  const symbol=String(1000+i),company='測試公司'+i;companies.push({symbol,company,exchange:i<60?'TWSE':'TPEX'});
  inputs.push({symbol,company,cutoff:sourceCutoff,through:'2026-10-28',next_session:'2026-10-29',expected_sessions:['2026-10-27','2026-10-28'],bars:[trace(symbol,'2026-10-27'),trace(symbol,'2026-10-28')],
   facts:[{id:'revenue-'+symbol,kind:'REVENUE',period:'2026-09',source:'https://www.twse.com.tw/test-financial',published_at:null,first_seen_at:sourceCutoff,available_at:sourceCutoff,as_of:'2026-09-30T13:30:00+08:00',evidence_hash:'c'.repeat(64),values:{revenue:100},basis:'ORIGINAL'}],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}});
 }
 await db.query('insert into vnext_runtime.runs values($1,$2,$3,$4,now())',[run,'2026-10-29',{acquired:{inputs,evidence_cutoff:sourceCutoff,snapshot_hash:revision}},revision]);
 await db.query('insert into vnext_runtime.source_revisions values($1,$2)',['directory',{task:{kind:'DIRECTORY'},status:'OK',payload:{rows:companies}}]);await db.query('insert into vnext_runtime.run_sources values($1,$2)',[run,'directory']);
 const call=async(op,id,args={})=>(await db.query('select public.daily_stock_ai_intake_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[op,id,args.lease??null,args.inputs??null,args.gaps??null,args.batch_id??null,args.code??null,args.symbol_gaps??null,args.market??null])).rows[0].result;
 const enqueue=async()=>(await db.query('select public.enqueue_daily_stock_ai_intake_v1() result')).rows[0].result;
 await db.exec('set role anon');await assert.rejects(enqueue,/permission denied/);await db.exec('reset role;set role authenticated');await assert.rejects(enqueue,/permission denied/);
 await db.exec('reset role;set role service_role');const queued=await enqueue(),id=queued.intake_id;assert.equal(queued.member_published,false);assert.equal((await enqueue()).intake_id,id);
 await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_intakes'),/permission denied/);
 const claimed=await call('CLAIM',id);assert.equal(claimed.state,'ACQUIRED');assert.equal(claimed.inputs.length,72);assert.equal(claimed.companies.length,72);assert.equal(claimed.source_kind,'VNEXT_ACQUIRED');assert.equal(claimed.source_revision,revision);assert.equal(claimed.projection,'DAILY_AI_RETAINED_INPUT_PROJECTION_V1');
 assert.equal((await call('CLAIM',id)).state,'BUSY');await assert.rejects(()=>call('SOURCE',id,{lease:'00000000-0000-0000-0000-000000000099',inputs:claimed.inputs}),/AI_INTAKE_LEASE/);
 const refreshed=structuredClone(claimed.inputs),received=new Date().toISOString(),symbolGaps={};
 for(const input of refreshed){input.through='2026-10-30';input.expected_sessions.push('2026-10-29','2026-10-30');input.bars.push(...['2026-10-29','2026-10-30'].map(date=>({...trace(input.symbol,date),available_at:received,first_seen_at:received,evidence_hash:'d'.repeat(64)})));symbolGaps[input.symbol]=['PRICE_REFRESH_SYNTHETIC_ISOLATED_TEST'];}
 let bad=structuredClone(refreshed);bad[0].facts[0].first_seen_at=received;await assert.rejects(()=>call('SOURCE',id,{lease:claimed.lease,inputs:bad}),/AI_INTAKE_RETAINED_BYTES/);
 bad=structuredClone(refreshed);bad[0].bars[0].close=99;await assert.rejects(()=>call('SOURCE',id,{lease:claimed.lease,inputs:bad}),/AI_INTAKE_RETAINED_BYTES/);
 bad=structuredClone(refreshed);bad[0].bars.at(-1).available_at='2099-01-01T00:00:00Z';await assert.rejects(()=>call('SOURCE',id,{lease:claimed.lease,inputs:bad}),/AI_INTAKE_FUTURE_RECEIPT/);
 // The collector is real, while these HTTP fixtures contain synthetic values.
 // Calendar/session dates come from the actual covered calendar, not today-as-US.
 const usDate=latestCompletedUsSession(Date.now()),usPrior=previousMarketTradingDate('US',usDate),night=dailyAiExpectedTaiwanNight(new Date().toISOString());
 const marketCapture=await collectDailyAiGlobalMarket({businessDate:queued.business_date,clock:()=>new Date().toISOString(),signal:new AbortController().signal,fetcher:async source=>{
  if(String(source).includes('taifex'))return Response.json([{Contract:'TX',TradingSession:'盤後',Date:night.trading_date.replaceAll('-',''),'ContractMonth(Week)':night.trading_date.slice(0,7).replace('-',''),Last:'20000',Change:'100','%':'0.50%'}]);
  const symbol=decodeURIComponent(new URL(source).pathname.split('/').at(-1));const times=[usPrior,usDate].map(d=>Date.parse(d+'T13:30:00Z')/1000);
  return Response.json({chart:{error:null,result:[{meta:{symbol,instrumentType:'INDEX',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1d',regularMarketTime:times[1]},timestamp:times,indicators:{quote:[{close:[100,101]}]}}]}});
 }});
 assert.equal(marketCapture.market.length,4);assert.equal(JSON.parse(marketCapture.market[0].content).session_date,usDate);
 const nightFact=JSON.parse(marketCapture.market.find(e=>JSON.parse(e.content).native_symbol==='TX').content);assert.equal(nightFact.trading_date,night.trading_date);assert.equal(nightFact.session_date,night.session_date);
 const htmlMarket=structuredClone(marketCapture.market);htmlMarket.find(e=>JSON.parse(e.content).native_symbol==='TX').source='https://www.taifex.com.tw/cht/3/futDailyMarketReport?queryType=2&marketCode=1&queryDate='+night.trading_date.replaceAll('-','%2F')+'&commodity_id=TX';
 await db.exec('reset role');assert.equal((await db.query('select vnext_runtime.validate_daily_ai_market_v1($1,clock_timestamp(),$2) valid',[htmlMarket,queued.business_date])).rows[0].valid,true);htmlMarket.find(e=>JSON.parse(e.content).native_symbol==='TX').source+='&extra=1';assert.equal((await db.query('select vnext_runtime.validate_daily_ai_market_v1($1,clock_timestamp(),$2) valid',[htmlMarket,queued.business_date])).rows[0].valid,false);await db.exec('set role service_role');
 const sealMarket=async e=>{e.evidence_hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(e.content))),b=>b.toString(16).padStart(2,'0')).join('');return e;};
 let badMarket=structuredClone(marketCapture.market);badMarket[0].available_at='2099-01-01T00:00:00Z';await assert.rejects(()=>call('SOURCE',id,{lease:claimed.lease,inputs:refreshed,market:badMarket}),/AI_INTAKE_MARKET/);
 badMarket=structuredClone(marketCapture.market);badMarket[0].source='https://example.com/other-market';await assert.rejects(()=>call('SOURCE',id,{lease:claimed.lease,inputs:refreshed,market:badMarket}),/AI_INTAKE_MARKET/);
 badMarket=structuredClone(marketCapture.market);const futureFact=JSON.parse(badMarket[0].content);futureFact.session_date='2099-01-01';badMarket[0].content=JSON.stringify(futureFact);await sealMarket(badMarket[0]);await assert.rejects(()=>call('SOURCE',id,{lease:claimed.lease,inputs:refreshed,market:badMarket}),/AI_INTAKE_MARKET/);
 badMarket=structuredClone(marketCapture.market);badMarket[0].evidence_hash='f'.repeat(64);await assert.rejects(()=>call('SOURCE',id,{lease:claimed.lease,inputs:refreshed,market:badMarket}),/AI_INTAKE_MARKET/);
 badMarket=structuredClone(marketCapture.market);badMarket[0].published_at=badMarket[0].available_at;await assert.rejects(()=>call('SOURCE',id,{lease:claimed.lease,inputs:refreshed,market:badMarket}),/AI_INTAKE_MARKET/);
 await db.exec('reset role');await db.query("insert into public.news_events values(gen_random_uuid(),'測試公司0 原始標題','供應商原始摘要','測試來源','TEST','https://example.com/test-news',now()-interval '1 hour',now()-interval '30 minutes',$1)",['e'.repeat(64)]);await db.exec('set role service_role');
 const sourced=await call('SOURCE',id,{lease:claimed.lease,inputs:refreshed,gaps:['PRICE_REFRESH_SOURCE_SCOPE_DISCLOSED',...marketCapture.additionalGaps],symbol_gaps:symbolGaps,market:marketCapture.market});assert.equal(sourced.state,'SOURCED');assert.equal(sourced.member_published,false);assert(sourced.news.length>0);assert.equal(sourced.gaps_by_symbol['1000'][0],'PRICE_REFRESH_SYNTHETIC_ISOLATED_TEST');assert.deepEqual(sourced.market,marketCapture.market);assert(!sourced.intake_gaps.includes('MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE'));
 assert(sourced.inputs.every(i=>i.cutoff===sourced.cutoff));assert.deepEqual(sourced.inputs[0].facts,claimed.inputs[0].facts);assert.equal(sourced.news[0].available_at,sourced.cutoff);assert(Date.parse(sourced.cutoff)>=Date.parse(received));assert.equal(sourced.source_cutoff,sourceCutoff);
 assert(sourced.intake_gaps.includes('NEWS_COMPANY_ASSOCIATION_REQUIRES_VERIFICATION'));
 await db.exec('reset role');await db.query("update public.news_events set title='新標題不可以改寫已凍結輸入'");await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_intakes set cutoff=now() where id=$1',[id]),/AI_INTAKE_IMMUTABLE/);await db.exec('set role service_role');
 const replay=await call('CLAIM',id);assert.equal(replay.state,'SOURCED');assert.equal(replay.cutoff,sourced.cutoff);assert.deepEqual(replay.news,sourced.news);assert.deepEqual(replay.market,sourced.market);
 const sourceIntake={intake_id:id,snapshot_hash:sourced.snapshot_hash,source_kind:sourced.source_kind,source_id:sourced.source_id,source_revision:sourced.source_revision,source_cutoff:sourced.source_cutoff,source_business_date:sourced.source_business_date,projection:sourced.projection};
 const parsedSource=await parseDailyAiSourceSnapshot(sourced,sourced.cutoff,new AbortController().signal,'INTAKE');assert.equal(parsedSource.market.length,4);
 const seed=await buildDailyAiSeed({...parsedSource,cutoff:sourced.cutoff,sourceIntake});
 const storeBody=async body=>{const text=canonical(body),hash=await snapshotHash(body);await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[text,hash]);return hash;};
 let wrong=structuredClone(seed.body);wrong.source_intake.snapshot_hash='f'.repeat(64);await assert.rejects(()=>storeBody(wrong).then(batch_id=>call('COMPLETE',id,{lease:claimed.lease,batch_id})),/AI_INTAKE_BATCH_CONFLICT/);
 wrong=structuredClone(seed.body);let wrongPacket=JSON.parse(wrong.packet_texts['1000']);wrongPacket.data_gaps=wrongPacket.data_gaps.filter(g=>g!=='PRICE_REFRESH_SYNTHETIC_ISOLATED_TEST');wrong.packet_texts['1000']=canonical(wrongPacket);wrong.packet_hashes['1000']=await snapshotHash(wrongPacket);await assert.rejects(()=>storeBody(wrong).then(batch_id=>call('COMPLETE',id,{lease:claimed.lease,batch_id})),/AI_INTAKE_GAPS_OMITTED/);
 wrong=structuredClone(seed.body);wrongPacket=JSON.parse(wrong.packet_texts['1000']);const price=wrongPacket.evidence.find(e=>e.kind==='PRICE');const numbers=JSON.parse(price.content);numbers.close=99;price.content=JSON.stringify(numbers);wrong.packet_texts['1000']=canonical(wrongPacket);wrong.packet_hashes['1000']=await snapshotHash(wrongPacket);await assert.rejects(()=>storeBody(wrong).then(batch_id=>call('COMPLETE',id,{lease:claimed.lease,batch_id})),/AI_INTAKE_EVIDENCE_CONFLICT/);
 wrong=structuredClone(seed.body);wrongPacket=JSON.parse(wrong.packet_texts['1000']);const financial=wrongPacket.evidence.find(e=>e.kind==='FINANCIAL');const values=JSON.parse(financial.content);values.values.revenue=999;financial.content=JSON.stringify(values);wrong.packet_texts['1000']=canonical(wrongPacket);wrong.packet_hashes['1000']=await snapshotHash(wrongPacket);await assert.rejects(()=>storeBody(wrong).then(batch_id=>call('COMPLETE',id,{lease:claimed.lease,batch_id})),/AI_INTAKE_EVIDENCE_CONFLICT/);
 wrong=structuredClone(seed.body);wrongPacket=JSON.parse(wrong.packet_texts['1000']);wrongPacket.evidence.find(e=>e.kind==='NEWS').content='Different current headline cannot replace frozen evidence';wrong.packet_texts['1000']=canonical(wrongPacket);wrong.packet_hashes['1000']=await snapshotHash(wrongPacket);await assert.rejects(()=>storeBody(wrong).then(batch_id=>call('COMPLETE',id,{lease:claimed.lease,batch_id})),/AI_INTAKE_EVIDENCE_CONFLICT/);
 wrong=structuredClone(seed.body);wrongPacket=JSON.parse(wrong.packet_texts['1000']);wrongPacket.evidence=wrongPacket.evidence.filter((e,i)=>i!==wrongPacket.evidence.findIndex(x=>x.kind==='PRICE'));wrong.packet_texts['1000']=canonical(wrongPacket);wrong.packet_hashes['1000']=await snapshotHash(wrongPacket);await assert.rejects(()=>storeBody(wrong).then(batch_id=>call('COMPLETE',id,{lease:claimed.lease,batch_id})),/AI_INTAKE_EVIDENCE_CONFLICT/);
 wrong=structuredClone(seed.body);wrongPacket=JSON.parse(wrong.packet_texts['1000']);wrongPacket.evidence.find(e=>e.kind==='MARKET').source='https://example.com/changed-global-source';wrong.packet_texts['1000']=canonical(wrongPacket);wrong.packet_hashes['1000']=await snapshotHash(wrongPacket);await assert.rejects(()=>storeBody(wrong).then(batch_id=>call('COMPLETE',id,{lease:claimed.lease,batch_id})),/AI_INTAKE_EVIDENCE_CONFLICT/);
 await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[seed.payload_text,seed.metadata.payload_hash]);
 await assert.rejects(()=>call('COMPLETE',id,{lease:claimed.lease,batch_id:'f'.repeat(64)}),/no rows/);
 const completed=await call('COMPLETE',id,{lease:claimed.lease,batch_id:seed.metadata.payload_hash});assert.equal(completed.state,'COMPLETE');assert.equal((await call('CLAIM',id)).batch_id,completed.batch_id);assert.equal((await enqueue()).intake_id,id);
 // SOURCE can commit and lose its worker before dispatch. The daily resumer
 // starts the exact retained batch, then suppresses fresh duplicate transport.
 const resume=async()=>(await db.query('select public.resume_daily_stock_ai_intake_v1($1) result',[id])).rows[0].result;
 assert.equal((await resume()).state,'COOLDOWN');await db.exec('reset role');await db.query("update vnext_runtime.ai_stock_dispatches set created_at=now()-interval '6 minutes' where batch_id=$1",[completed.batch_id]);await db.exec('set role service_role');assert.equal((await resume()).state,'DISPATCHED');
 await db.exec('reset role');const modelRevision=stockAiModelRevision('gpt-4o-mini');
 for(const [symbol,inputHash] of Object.entries(seed.body.packet_hashes)){
  const key=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:inputHash,model_revision:modelRevision});
  await db.query("insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result) values($1,$2,$3,$4,$5,'FAILED',3,gen_random_uuid(),now()-interval '1 minute',null)",[key,inputHash,modelRevision,symbol,sourced.cutoff]);
 }
 await db.exec('set role service_role');assert.equal((await resume()).state,'EXHAUSTED');await db.exec('reset role');
 const firstKey=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:seed.body.packet_hashes['1000'],model_revision:modelRevision});
 await db.query("update vnext_runtime.ai_stock_jobs set state='RUNNING',attempts=1,lease_until=now()+interval '1 minute' where id=$1",[firstKey]);await db.exec('set role service_role');assert.equal((await resume()).state,'BUSY');await db.exec('reset role');
 await db.query("update vnext_runtime.ai_stock_jobs set lease_until=now()-interval '1 minute' where id=$1",[firstKey]);await db.query("update vnext_runtime.ai_stock_dispatches set created_at=now()-interval '6 minutes' where batch_id=$1",[completed.batch_id]);await db.exec('set role service_role');assert.equal((await resume()).state,'DISPATCHED');await db.exec('reset role');
 // Complete synthetic model outputs against the exact retained packets; the
 // watchdog now invokes the real full-integrity SQL stage, never a mock.
 for(const [symbol,packetText] of Object.entries(seed.body.packet_texts)){
  const packet=JSON.parse(packetText),result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol,cutoff:packet.cutoff,input_hash:seed.body.packet_hashes[symbol],model_generated:true,member_published:false,publication_ready:false,
   receipt:{response_id:'isolated-synthetic-'+symbol,model:'synthetic-isolated',input_tokens:0,output_tokens:0},sources:packet.evidence.map(({content,...source})=>source),
   horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'隔離測試推論，並非實際模型推薦',evidence_ids:[packet.evidence[0].id]},counter_evidence:[{text:'隔離測試反面證據',evidence_ids:[packet.evidence[0].id]}],confirmation:'等待核對',invalidation:'核對不符即重評',gaps:packet.data_gaps}))};
  await db.query("update vnext_runtime.ai_stock_jobs set state='COMPLETE',result=$1 where symbol=$2",[result,symbol]);
 }
 await db.exec('set role service_role');assert.equal((await resume()).state,'EDITION_STAGED');await db.exec('reset role');const staged=(await db.query('select cardinality(job_keys) jobs,jsonb_array_length(payload->\'cards\') cards from vnext_private.ai_research_editions where batch_id=$1',[completed.batch_id])).rows[0];assert.equal(staged.jobs,72);assert.equal(staged.cards,216);const beforeRequests=(await db.query('select count(*) n from net.requests')).rows[0].n;
 await db.exec('set role service_role');assert.equal((await resume()).state,'EDITION_STAGED');await db.query('select public.tick_daily_stock_ai_intake_v1()');await db.exec('reset role');assert.equal((await db.query('select count(*) n from net.requests')).rows[0].n,beforeRequests);
 await db.exec("select set_config('test.uid','00000000-0000-0000-0000-000000000002',false),set_config('test.tier','owner',false);set role authenticated");const owner=(await db.query('select public.get_daily_ai_owner_research_v1() result')).rows[0].result;assert.equal(parseDailyAiOwner(owner).cards.length,216);assert.equal(owner.publish_ready,false);assert.equal((await db.query('select public.get_daily_ai_member_research_v1() result')).rows[0].result.cards.length,0);await db.exec('reset role');
 const scheduled=(await db.query('select * from cron.job order by jobname')).rows;assert.equal(scheduled.length,2);assert.deepEqual(scheduled[0],{jobname:'existing-job',schedule:'0 0 * * *',command:'select true;'});assert.equal(scheduled[1].jobname,'ma-ai-asof-watchdog-v1');assert.equal(scheduled[1].schedule,'*/5 * * * *');assert.equal(scheduled[1].command,'select public.tick_daily_stock_ai_intake_v1();');
 await db.exec('reset role');await assert.rejects(()=>db.query('delete from vnext_runtime.ai_stock_intakes where id=$1',[id]),/AI_INTAKE_IMMUTABLE/);
 // A FAILED legacy refresh still creates an independent daily queue when no
 // COMMITTED market checkpoint and no current-day VNext run exist.
 await db.exec('alter table vnext_runtime.ai_stock_intakes disable trigger ai_stock_intake_seal');await db.query("update vnext_runtime.ai_stock_intakes set business_date=business_date-1,requested_at=requested_at-interval '1 day' where id=$1",[id]);await db.exec('alter table vnext_runtime.ai_stock_intakes enable trigger ai_stock_intake_seal');
 await db.exec("insert into public.runtime_http_dispatches values((now() at time zone 'Asia/Taipei')::date,'daily_delivery','daily_refresh','FAILED')");
 await db.exec('set role service_role');const next=await enqueue();assert.notEqual(next.intake_id,id);const nextClaim=await call('CLAIM',next.intake_id);assert.equal(nextClaim.source_kind,'ASOF_INTAKE');assert.equal(nextClaim.source_id,id);assert.deepEqual(nextClaim.inputs[0].facts,sourced.inputs[0].facts);
 for(let attempt=0;attempt<3;attempt++){
  const current=attempt===0?nextClaim:await call('CLAIM',next.intake_id);assert.equal(current.state,'ACQUIRED');await call('FAIL',next.intake_id,{lease:current.lease,code:'AI_INTAKE_TEST_SOURCE_UNAVAILABLE'});
 }
 assert.equal((await call('CLAIM',next.intake_id)).state,'EXHAUSTED');
 console.log('PASS: independent daily queue/failed-refresh hook, no Forward or paid-provider dependency, actual base/directory source, once/day identity, leases/attempt cap, unchanged original facts/bars, post-fetch news cutoff, frozen retries, symbol-specific gaps, canonical batch binding, advanced next base and raw-access denial. Isolated synthetic data only.');
}catch(error){console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;}finally{await db.close();}
