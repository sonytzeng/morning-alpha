// Isolated PostgreSQL COMPLETE regression using unchanged real retained files.
// The raw pre-SOURCE base and financial HTTP proof are absent from the view.
// They are explicitly substituted below ONLY to construct an already SOURCED
// local row. This test does not claim to reproduce/approve SOURCE acquisition.
// No original fixture, application, production row, Cron or model is modified.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonical,snapshotHash} from '../research/daily-ai-seed.ts';

const modulePath=process.env.MA_PGLITE_MODULE,snapshotPath=process.env.MA_DAILY_AI_SOURCE_FIXTURE,seedPath=process.env.MA_DAILY_AI_SEED_FIXTURE;
assert(modulePath?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');assert(snapshotPath?.startsWith('/')&&seedPath?.startsWith('/'),'ABSOLUTE_ACTUAL_SOURCE_AND_SEED_FIXTURES_REQUIRED');
const sha=value=>createHash('sha256').update(value).digest('hex');
const sourceText=readFileSync(snapshotPath,'utf8'),seedText=readFileSync(seedPath,'utf8'),source=JSON.parse(sourceText),seed=JSON.parse(seedText);
const sourceSha=sha(sourceText),seedSha=sha(seedText),packets=Object.values(seed.packet_texts).map(text=>JSON.parse(text));
assert.equal(source.schema,'DAILY_AI_INTAKE_SOURCE_V1');assert.equal(source.state,'SOURCED');assert.equal(source.inputs.length,72);assert.equal(packets.length,72);
assert.equal(packets.reduce((count,p)=>count+p.evidence.length,0),5238);assert.equal(seedSha,await snapshotHash(seed));assert.equal(seed.source_intake.snapshot_hash,source.snapshot_hash);
const timings={},timed=async(label,work)=>{const start=performance.now();try{return await work();}finally{timings[label]=Math.round((performance.now()-start)*1000)/1000;}};
const {PGlite}=await import(modulePath),db=new PGlite();await db.waitReady;
try{
 await timed('bootstrap_ms',async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema vnext_runtime;create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_runtime.runs(id uuid primary key,business_date date,checkpoint jsonb,source_revision text,updated_at timestamptz default now());
 create table vnext_runtime.source_revisions(id text primary key,receipt jsonb);create table vnext_runtime.run_sources(run_id uuid,source_id text);
 create table public.runtime_http_dispatches(trading_date date,job_name text,checkpoint text,dispatch_status text);
 create table public.news_events(id uuid primary key,title text,summary text,source_name text,provider text,source_url text,published_at timestamptz,created_at timestamptz,fingerprint text);
 create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default now());
 create schema net;create table net.requests(id bigint generated always as identity,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare n bigint;begin insert into net.requests(body) values(body) returning id into n;return n;end$$;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('00000000-0000-0000-0000-000000000002');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select current_setting('test.tier',true)$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select current_setting('test.tier',true)='owner'$$;
 create schema vnext_private;create function vnext_private.immutable_record() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_private.source_licenses(id text primary key,source text,document_url text,reviewed_at timestamptz,expires_at timestamptz,storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,redistribution_allowed boolean,attribution text);`);
  for(const name of ['daily-ai-jobs','daily-ai-batches','daily-ai-dispatch','daily-ai-handoff','daily-ai-member','daily-ai-use-review','daily-ai-intake','daily-ai-market-policy-v2','daily-ai-financial-refresh-v3','daily-ai-intake-performance-v4']){
   await db.exec(readFileSync(new URL('../research/'+name+'.candidate.sql',import.meta.url),'utf8'));
  }
 });
 // Explicit stand-ins: base_inputs are the already retained current projection;
 // the full raw financial proof is unavailable, so a zero-response structural
 // proof is substituted. Opaque snapshot_hash and all actual input/seed bytes
 // remain original. Only COMPLETE, its seal and evidence binding are exercised.
 const proofStandIn={schema:'DAILY_AI_FINANCIAL_REFRESH_V1',observed_at:source.cutoff,responses:[],additions:[],removals:[]};
 const baseStandIn=source.inputs;
 await timed('insert_actual_sourced_row_ms',()=>db.query(`insert into vnext_runtime.ai_stock_intakes(
 id,business_date,requested_at,state,attempts,lease,lease_until,source_kind,source_id,source_revision,source_cutoff,source_business_date,
 base_inputs,companies,source_issues,inputs,news,market,cutoff,cutoff_text,snapshot_hash,intake_gaps,gaps_by_symbol,financial_refresh)
 values($1,$2,$3,'SOURCED',1,$4,clock_timestamp()+interval '1 hour',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::text::timestamptz,$16::text,$17,$18,$19,$20)`,
  [source.intake_id,source.business_date,source.requested_at,source.lease,source.source_kind,source.source_id,source.source_revision,source.source_cutoff,source.source_business_date,
   baseStandIn,source.companies,source.source_issues,source.inputs,source.news,source.market,source.cutoff,source.snapshot_hash,source.intake_gaps,source.gaps_by_symbol,proofStandIn]));
 const complete=async(batchId,lease=source.lease)=>(await db.query('select public.daily_stock_ai_intake_v1($1,$2,$3,null,null,$4,null,null,null,null) result',
  ['COMPLETE',source.intake_id,lease,batchId])).rows[0].result;
 const validate=async(candidate)=>(await db.query('select vnext_runtime.validate_daily_ai_intake_batch_evidence_v4($1,$2,$3,$4,$5,$6) valid',
  [source.inputs,source.news,source.market,source.intake_gaps,source.gaps_by_symbol,candidate])).rows[0].valid;
 assert.equal(await timed('actual_private_evidence_gate_ms',()=>validate(packets)),true);
 console.log(JSON.stringify({phase:'actual_evidence_gate',evidence:5238,milliseconds:timings.actual_private_evidence_gate_ms}));
 // Parsing JSON content may normalize harmless key order/whitespace. Original
 // source metadata, selected observation IDs and numeric values stay exact.
 const equivalent=structuredClone(packets),firstCompany=equivalent[0].evidence.find(e=>e.kind==='PRICE');
 firstCompany.content=JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(firstCompany.content)).reverse()),null,2);assert.equal(await validate(equivalent),true);
 const mutatePrivate=async(label,change)=>{
  const candidate=structuredClone(packets);change(candidate);assert.equal(await timed('reject_'+label+'_ms',()=>validate(candidate)),false,label);
 };
 await mutatePrivate('metadata',p=>{p[0].evidence.find(e=>e.kind==='PRICE').source='https://example.invalid/changed-source';});
 await mutatePrivate('metadata_extra',p=>{p[0].evidence.find(e=>e.kind==='PRICE').unproven_metadata='extra';});
 await mutatePrivate('content',p=>{const e=p[0].evidence.find(e=>e.kind==='PRICE'),v=JSON.parse(e.content);v.close+=1;e.content=JSON.stringify(v);});
 await mutatePrivate('financial_content',p=>{const e=p[0].evidence.find(e=>e.kind==='FINANCIAL'),v=JSON.parse(e.content);v.values={...v.values,fabricated_value:999};e.content=JSON.stringify(v);});
 await mutatePrivate('evidence_id',p=>{p[0].evidence.find(e=>e.kind==='PRICE').id+='-changed';});
 await mutatePrivate('evidence_count',p=>{p[0].evidence.splice(p[0].evidence.findIndex(e=>e.kind==='PRICE'),1);});
 await mutatePrivate('duplicate_evidence',p=>{p[0].evidence.push(structuredClone(p[0].evidence.find(e=>e.kind==='PRICE')));});
 await mutatePrivate('packet_count',p=>{p.pop();});
 await mutatePrivate('packet_identity',p=>{p[1]=structuredClone(p[0]);});
 await mutatePrivate('unknown_kind',p=>{p[0].evidence.find(e=>e.kind==='PRICE').kind='UNVERIFIED';});
 assert(source.intake_gaps.length>0);await mutatePrivate('required_gap',p=>{p[0].data_gaps=p[0].data_gaps.filter(g=>g!==source.intake_gaps[0]);});
 const symbolWithGap=Object.keys(source.gaps_by_symbol).find(s=>source.gaps_by_symbol[s].length>0);assert(symbolWithGap);
 await mutatePrivate('symbol_gap',p=>{const item=p.find(x=>x.symbol===symbolWithGap);item.data_gaps=item.data_gaps.filter(g=>g!==source.gaps_by_symbol[symbolWithGap][0]);});
 assert(source.news.length>0);await mutatePrivate('news',p=>{const e=p.flatMap(x=>x.evidence).find(e=>e.kind==='NEWS');e.content+=' ';});
 assert(source.market.length>0);await mutatePrivate('market',p=>{const e=p[0].evidence.find(e=>e.kind==='MARKET');e.source='https://example.invalid/changed-market';});
 await mutatePrivate('market_count',p=>{p[0].evidence=p[0].evidence.filter(e=>e.kind!=='MARKET');});
 const store=async(body,text=canonical(body))=>{
  const hash=sha(text);await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[text,hash]);return hash;
 };
 const originalBatch=await timed('actual_batch_store_ms',()=>store(seed,seedText));assert.equal(originalBatch,seedSha);
 // Ensure the public RPC retains its original provenance/error boundaries and
 // actually delegates the full evidence check before updating the sealed row.
 let changed=structuredClone(seed);changed.source_intake.snapshot_hash='f'.repeat(64);let changedBatch=await store(changed);
 await db.exec('set role service_role');await assert.rejects(()=>complete(changedBatch),/AI_INTAKE_BATCH_CONFLICT/);await db.exec('reset role');
 changed=structuredClone(seed);let symbol=Object.keys(changed.packet_texts)[0],packet=JSON.parse(changed.packet_texts[symbol]);
 packet.data_gaps=packet.data_gaps.filter(g=>g!==source.intake_gaps[0]);changed.packet_texts[symbol]=canonical(packet);changed.packet_hashes[symbol]=await snapshotHash(packet);changedBatch=await store(changed);
 await db.exec('set role service_role');await assert.rejects(()=>complete(changedBatch),/AI_INTAKE_GAPS_OMITTED/);await db.exec('reset role');
 changed=structuredClone(seed);packet=JSON.parse(changed.packet_texts[symbol]);packet.evidence.find(e=>e.kind==='PRICE').source='https://example.invalid/changed-source';
 changed.packet_texts[symbol]=canonical(packet);changed.packet_hashes[symbol]=await snapshotHash(packet);changedBatch=await store(changed);
 await db.exec('set role service_role');await assert.rejects(()=>complete(changedBatch),/AI_INTAKE_EVIDENCE_CONFLICT/);
 await assert.rejects(()=>complete(originalBatch,'00000000-0000-0000-0000-000000000099'),/AI_INTAKE_LEASE/);
 const workMem=(await db.query('show work_mem')).rows[0].work_mem;
 const completed=await timed('actual_full_complete_ms',()=>complete(originalBatch));assert.equal(completed.state,'COMPLETE');assert.equal(completed.batch_id,originalBatch);assert.equal(completed.member_published,false);
 assert.equal((await db.query('show work_mem')).rows[0].work_mem,workMem,'work_mem must stay function-local');
 assert.equal((await complete(originalBatch)).state,'CACHED');await assert.rejects(()=>complete(changedBatch),/AI_INTAKE_BATCH_CONFLICT/);
 await db.exec('reset role');await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_intakes set snapshot_hash=$2 where id=$1',[source.intake_id,'f'.repeat(64)]),/AI_INTAKE_IMMUTABLE/);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(()=>complete(originalBatch),/permission denied/);await db.exec('reset role');
 }
 assert.equal(sha(readFileSync(snapshotPath)),sourceSha);assert.equal(sha(readFileSync(seedPath)),seedSha);
 console.log(JSON.stringify({status:'PASS',fixture_scope:'ACTUAL_INPUTS_AND_SEED_WITH_SYNTHETIC_PRE_SOURCE_BASE_AND_RAW_PROOF_STAND_INS',
  source_sha256:sourceSha,seed_sha256:seedSha,source_bytes:Buffer.byteLength(sourceText),seed_bytes:Buffer.byteLength(seedText),
  companies:72,evidence:5238,private_tamper_cases:15,model_calls:0,production_writes:0,cron_changed:false,timings}));
}catch(error){
 console.error(JSON.stringify({status:'FAIL',error:String(error.message).slice(0,3000),code:error.code,where:error.where,
  site:error.stack?.split('\n').find(line=>line.includes('dailyAiIntakePerformanceV4Database.integration.mjs')),timings}));process.exitCode=1;
}finally{await db.close();}
