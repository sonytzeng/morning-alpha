/** Isolated PostgreSQL 17 regression. No HTTP, model, Cron or production writes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const modulePath=process.env.MA_PGLITE_MODULE;
assert(modulePath?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(modulePath),db=new PGlite();await db.waitReady;
const sha=text=>createHash('sha256').update(text).digest('hex');
const here=new URL('.',import.meta.url),research=new URL('../../../research/',here);
const candidate=readFileSync(new URL('retained-sec-daily-v1.candidate.sql',here),'utf8');
const live=JSON.parse(readFileSync(new URL('live15-baseline/functions.json',here),'utf8'));
const facts=JSON.parse(/\$sec_facts\$(.*?)\$sec_facts\$/s.exec(candidate)[1]);
const documents=JSON.parse(/\$sec_documents\$(.*?)\$sec_documents\$/s.exec(candidate)[1]);
const seal='a4398990a8bf63580efae7afee918613783249573f78e1ca7a11fd70de0f6edb';
const factsHash='d0402e790286173f8cac9cb9b8cf216d4c3dc0db78dc83f3ac1c91878d141527';
const documentsHash='77fe7baac1e3208c5fb82c4c9c2613177307a6f583a70b7b5496a2338967f710';
const basis='RETAINED_ORIGINAL_RECEIPTS_NOT_REOBSERVED';
const cutoff='2026-11-01T09:00:00Z',nextCutoff='2026-11-02T09:00:00Z';
const day=time=>new Date(Date.parse(time)+8*3600000).toISOString().slice(0,10);
const proof=at=>({schema:'DAILY_AI_FINANCIAL_REFRESH_V1',observed_at:at,responses:[],additions:[],removals:[],company_names:[]});
const replay={schema:'DAILY_AI_SEC_RETAINED_REPLAY_V1',source_seal_sha256:seal,facts_sha256:factsHash,
 fact_ids:facts.map(f=>f.id).sort(),replay_basis:basis,source_refetched:false,source_admitted:false,member_publication_approved:false};
const symbols=['2330',...Array.from({length:71},(_,i)=>String(1000+i))];
const baseline=symbols.map((symbol,i)=>({symbol,company:'隔離測試公司'+symbol,cutoff:'2026-10-30T09:00:00Z',
 through:'2026-10-28',next_session:'2026-10-29',expected_sessions:['2026-10-28'],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},
 bars:[{id:'isolated-price-'+i,date:'2026-10-28',source:'https://www.twse.com.tw/isolated-price',published_at:null,
  first_seen_at:'2026-10-30T09:00:00Z',available_at:'2026-10-30T09:00:00Z',as_of:'2026-10-28T09:00:00Z',
  evidence_hash:'b'.repeat(64),open:10,high:12,low:9,close:11,volume:100,amount:1100}],
 facts:[{id:'isolated-revenue-'+i,kind:'REVENUE',period:'2026-09',basis:'MONTHLY',values:{yoy_percent:10},
  source:'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',published_at:null,first_seen_at:'2026-10-30T09:00:00Z',
  available_at:'2026-10-30T09:00:00Z',as_of:'2026-09-30T15:59:59Z',evidence_hash:'c'.repeat(64)}]}));
const enrich=base=>{const inputs=structuredClone(base);inputs.find(s=>s.symbol==='2330').facts.push(...structuredClone(facts));return inputs;};
const core=async(base,inputs,p,at=cutoff)=>(await db.query('select vnext_runtime.validate_daily_ai_financial_refresh_v5($1,$2,$3,$4::timestamptz,$5::date) result',[base,inputs,p,at,day(at)])).rows[0].result;
const validate=async(base,inputs,p,at=cutoff)=>(await db.query('select vnext_runtime.validate_daily_ai_financial_refresh_sec_v1($1,$2,$3,$4::timestamptz,$5::date) result',[base,inputs,p,at,day(at)])).rows[0].result;
const reader=async(sourceSeal=seal,at=cutoff)=>(await db.query('select public.load_daily_stock_ai_sec_replay_v1($1,$2::timestamptz) result',[sourceSeal,at])).rows[0].result;
const defHash=async(signature)=>(await db.query("select encode(sha256(convert_to(pg_get_functiondef(to_regprocedure($1)),'UTF8')),'hex') hash",[signature])).rows[0].hash;
let phase='bootstrap',checks=0;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema vnext_runtime;create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_runtime.runs(id uuid primary key,business_date date,checkpoint jsonb,source_revision text,updated_at timestamptz default now());
 create table vnext_runtime.source_revisions(id text primary key,receipt jsonb);create table vnext_runtime.run_sources(run_id uuid,source_id text);
 create table public.runtime_http_dispatches(trading_date date,job_name text,checkpoint text,dispatch_status text);
 create table public.news_events(id uuid primary key,title text,summary text,source_name text,provider text,source_url text,published_at timestamptz,created_at timestamptz,fingerprint text);
 create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default now());
 create schema net;create table net.requests(id bigint generated always as identity,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare n bigint;begin insert into net.requests(body) values(body) returning id into n;return n;end$$;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select current_setting('test.tier',true)$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select current_setting('test.tier',true)='owner'$$;
 create schema vnext_private;create function vnext_private.immutable_record() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_private.source_licenses(id text primary key,source text,document_url text,reviewed_at timestamptz,expires_at timestamptz,storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,redistribution_allowed boolean,attribution text);`);
 for(const name of ['daily-ai-jobs','daily-ai-batches','daily-ai-dispatch','daily-ai-handoff','daily-ai-member','daily-ai-use-review','daily-ai-intake','daily-ai-market-policy-v2','daily-ai-financial-refresh-v3','daily-ai-intake-performance-v4','daily-ai-intake-corrections-v5'])
  await db.exec(readFileSync(new URL(name+'.candidate.sql',research),'utf8'));
 phase='reconstruct exact captured live functions';
 for(const f of live){assert.equal(sha(f.definition),f.definition_sha256);await db.exec(f.definition);}
 const signatures={source:'public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)',
  core:'vnext_runtime.validate_daily_ai_financial_refresh_v5(jsonb,jsonb,jsonb,timestamptz,date)',projection:'vnext_runtime.project_daily_stock_ai_inputs_v1(jsonb)'};
 assert.equal(await defHash(signatures.source),'26169e11d79560f63909a4726aa41cb849782fc786819cef83d43e2ad33a6d4c');
 assert.equal(await defHash(signatures.core),'e6f4aa5a0f9f89fa42eaeff44fcde20c75620ec3937f9cdc477706415b87e318');
 assert.equal(await defHash(signatures.projection),'7b3da81170bfdae84fdac26fbf88844791f4e4d795b6e687499b7a655559a977');checks+=3;
 phase='live fingerprint drift rejects the whole migration';
 const originalSource=live.find(f=>f.schema_name==='public'&&f.proname==='daily_stock_ai_intake_v1').definition;
 await db.exec(originalSource.replace('begin\n','begin\n -- isolated fingerprint drift probe\n'));
 await assert.rejects(()=>db.exec(candidate),/SEC_REPLAY_LIVE_BASELINE_DRIFT/);await db.exec('rollback');
 assert.equal((await db.query("select to_regclass('vnext_private.verified_retained_sec_facts_v1') result")).rows[0].result,null);
 await db.exec(originalSource);checks++;
 phase='compile and apply intact guarded candidate in local PostgreSQL';
 await db.exec(candidate);
 assert.equal(await defHash(signatures.source),'d3c67c1395bda7414f2b070c5599542f44eb49777b95b5b2eb3f65501b679484');
 assert.equal(await defHash(signatures.core),'e6f4aa5a0f9f89fa42eaeff44fcde20c75620ec3937f9cdc477706415b87e318');
 assert.equal(await defHash(signatures.projection),'7b3da81170bfdae84fdac26fbf88844791f4e4d795b6e687499b7a655559a977');checks+=3;
 await assert.rejects(()=>db.exec(candidate),/SEC_REPLAY_ALREADY_PRESENT_OR_CONFLICT/);await db.exec('rollback');checks++;
 phase='reader permissions and exact retained registry';
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(()=>reader(),/permission denied/);checks++;
  await assert.rejects(()=>db.query('select * from vnext_private.verified_retained_sec_facts_v1'),/permission denied/);checks++;
  await assert.rejects(()=>validate(baseline,baseline,null),/permission denied/);checks++;await db.exec('reset role');
 }
 await db.exec('set role service_role');const loaded=await reader();
 assert.equal(loaded.schema,'DAILY_AI_SEC_RETAINED_REGISTRY_V1');assert.equal(loaded.source_seal_sha256,seal);
 assert.equal(loaded.facts_sha256,factsHash);assert.equal(loaded.source_documents_sha256,documentsHash);
 assert.deepEqual(loaded.facts,facts);assert.deepEqual(loaded.source_documents,documents);assert.equal(loaded.replay_basis,basis);
 assert.equal(loaded.source_admitted,false);assert.equal(loaded.member_publication_approved,false);checks++;
 await assert.rejects(()=>db.query('select facts_text from vnext_private.verified_retained_sec_facts_v1'),/permission denied/);checks++;
 await assert.rejects(()=>reader('f'.repeat(64)),/SEC_REPLAY_SCOPE/);checks++;
 await assert.rejects(()=>reader(seal,'2026-10-31T08:54:20Z'),/SEC_REPLAY_FUTURE_RECEIPT/);checks++;
 await db.exec('reset role');
 phase='registry immutability and fixed-seal checks';
 for(const sql of ['update vnext_private.verified_retained_sec_facts_v1 set facts_text=facts_text',
  'delete from vnext_private.verified_retained_sec_facts_v1','truncate vnext_private.verified_retained_sec_facts_v1']){
  await assert.rejects(()=>db.exec(sql),/SEC_REPLAY_REGISTRY_IMMUTABLE/);checks++;
 }
 await assert.rejects(()=>db.query(`insert into vnext_private.verified_retained_sec_facts_v1(source_seal_sha256,facts_sha256,facts_text,source_documents_sha256,source_documents_text)
  values($1,$2,$3,$4,$5)`,['f'.repeat(64),factsHash,JSON.stringify(facts),documentsHash,JSON.stringify(documents)]),/check constraint/);checks++;
 phase='first addition, original receipt preservation and next-day fallback';
 assert.deepEqual(await validate(baseline,baseline,null),await core(baseline,baseline,null));checks++;
 const withFacts=enrich(baseline),withProof={...proof(cutoff),sec_replay:structuredClone(replay)};
 assert.deepEqual(await validate(baseline,withFacts,withProof),withProof);checks++;
 await assert.rejects(()=>validate(baseline,withFacts,proof(cutoff)),/SEC_REPLAY_PROOF_REQUIRED/);checks++;
 const fallback=await validate(withFacts,withFacts,proof(nextCutoff),nextCutoff);
 assert.deepEqual(fallback,{...proof(nextCutoff),sec_replay:replay});
 assert.deepEqual(withFacts.find(s=>s.symbol==='2330').facts.filter(f=>f.id.startsWith('sec-quarter:')),facts);checks++;
 assert.deepEqual((await validate(withFacts,withFacts,null,nextCutoff)).sec_replay,replay);checks++;
 await assert.rejects(()=>validate(withFacts,baseline,proof(nextCutoff),nextCutoff),/SEC_REPLAY_FACTS_NOT_EXACT/);checks++;
 phase='SEC fact and replay proof negative cases';
 const badProofs=[['grant source',p=>p.sec_replay.source_admitted=true],['grant publication',p=>p.sec_replay.member_publication_approved=true],
  ['refetched claim',p=>p.sec_replay.source_refetched=true],['wrong hash',p=>p.sec_replay.facts_sha256='f'.repeat(64)],
  ['wrong seal',p=>p.sec_replay.source_seal_sha256='f'.repeat(64)],['duplicate fact ids',p=>p.sec_replay.fact_ids[1]=p.sec_replay.fact_ids[0]],
  ['unsorted ids',p=>p.sec_replay.fact_ids.reverse()],['unknown proof field',p=>p.sec_replay.trust_me=true],['null proof',p=>p.sec_replay=null]];
 for(const [label,change] of badProofs){const p=structuredClone(withProof);change(p);await assert.rejects(()=>validate(baseline,withFacts,p),/SEC_REPLAY_PROOF_NOT_EXACT/,label);checks++;}
 const badFacts=[['numeric tamper',f=>f[0].values.value=999],['source permission',f=>f[0].source_admitted=true],['publication permission',f=>f[0].member_publication_approved=true],
  ['raw hash',f=>f[0].source_sha256='f'.repeat(64)],['receipt relabel',f=>f[0].available_at=nextCutoff],['duplicate fact',f=>f.push(structuredClone(f[0]))],
  ['missing fact',f=>f.pop()],['ID masquerade with SEC URL',f=>f[0].id='official-open-api:fake'],['modified SEC URL',f=>f[0].source=f[0].source.replace('https:','http:')]];
 for(const [label,change] of badFacts){const inputs=structuredClone(withFacts),financial=inputs.find(s=>s.symbol==='2330');
  const original=financial.facts.filter(f=>f.id.startsWith('sec-quarter:'));change(original);financial.facts=financial.facts.filter(f=>!f.id.startsWith('sec-quarter:')).concat(original);
  await assert.rejects(()=>validate(baseline,inputs,withProof),/SEC_REPLAY_FACTS_NOT_EXACT/,label);checks++;
 }
 const cross=structuredClone(withFacts),tsmc=cross.find(s=>s.symbol==='2330');cross[1].facts.push(tsmc.facts.pop());
 await assert.rejects(()=>validate(baseline,cross,withProof),/SEC_REPLAY_FACTS_NOT_EXACT/);checks++;
 const wrongBaseline=structuredClone(withFacts);wrongBaseline[0].facts.find(f=>f.id.startsWith('sec-quarter:')).values.value=999;
 await assert.rejects(()=>validate(wrongBaseline,withFacts,proof(nextCutoff),nextCutoff),/SEC_REPLAY_FACTS_NOT_EXACT/);checks++;
 const changedRevenue=structuredClone(withFacts);changedRevenue[0].facts[0].values.yoy_percent=999;
 await assert.rejects(()=>validate(baseline,changedRevenue,withProof),/AI_INTAKE_FINANCIAL_RETAINED_BYTES/);checks++;
 phase='projection cannot silently discard a retained quarter';
 const competingBase=structuredClone(baseline),competing=structuredClone(facts[9]);competing.id='zz-retained-competing-eps';
 competing.source='https://openapi.twse.com.tw/isolated-other-approved-source';competingBase[0].facts.push(competing);
 const competingIncoming=enrich(competingBase);
 await assert.rejects(()=>validate(competingBase,competingIncoming,withProof),/SEC_REPLAY_PROJECTION_TRUNCATED/);checks++;
 phase='real public SOURCE call-site keeps the full replay proof and exact facts';
 const observed=new Date().toISOString();assert(Date.parse(observed)>Math.max(...facts.map(f=>Date.parse(f.available_at))),'SYSTEM_CLOCK_MUST_FOLLOW_RETAINED_RECEIPTS');
 const run='00000000-0000-0000-0000-000000000001',revision='a'.repeat(64),companies=baseline.map(i=>({symbol:i.symbol,company:i.company,exchange:'TWSE'}));
 await db.query('insert into vnext_runtime.runs values($1,$2,$3,$4,now())',[run,day(baseline[0].cutoff),{acquired:{inputs:baseline,evidence_cutoff:baseline[0].cutoff,snapshot_hash:revision}},revision]);
 await db.query('insert into vnext_runtime.source_revisions values($1,$2)',['directory',{task:{kind:'DIRECTORY'},status:'OK',payload:{rows:companies}}]);
 await db.query('insert into vnext_runtime.run_sources values($1,$2)',[run,'directory']);
 await db.exec('set role service_role');
 const queued=(await db.query('select public.enqueue_daily_stock_ai_intake_v1() result')).rows[0].result;
 const claim=(await db.query("select public.daily_stock_ai_intake_v1('CLAIM',$1) result",[queued.intake_id])).rows[0].result;
 assert.equal(claim.state,'ACQUIRED');
 const sourceProof={...proof(new Date().toISOString()),sec_replay:replay};
 const sourced=(await db.query("select public.daily_stock_ai_intake_v1('SOURCE',$1,$2,$3,$4,null,null,$5,$6,$7) result",
  [queued.intake_id,claim.lease,enrich(claim.inputs),[],{},[],sourceProof])).rows[0].result;
 assert.equal(sourced.state,'SOURCED');assert.equal(sourced.member_published,false);
 const sourcedFacts=sourced.inputs.find(i=>i.symbol==='2330').facts.filter(f=>f.id.startsWith('sec-quarter:'));
 assert.deepEqual([...sourcedFacts].sort((a,b)=>a.id.localeCompare(b.id)),[...facts].sort((a,b)=>a.id.localeCompare(b.id)));checks++;
 await db.exec('reset role');
 const stored=(await db.query('select financial_refresh,snapshot_hash from vnext_runtime.ai_stock_intakes where id=$1',[queued.intake_id])).rows[0];
 assert.deepEqual(stored.financial_refresh.sec_replay,replay);assert.match(stored.snapshot_hash,/^[a-f0-9]{64}$/);checks++;
 phase='next real CLAIM inherits sealed SEC facts and SOURCE survives loader failure';
 await db.exec('set role service_role');
 const corrected=(await db.query('select public.enqueue_corrected_daily_stock_ai_intake_v5($1,$2) result',
  ['SOURCE_POLICY_CORRECTION','00000000-0000-0000-0000-000000000022'])).rows[0].result;
 const nextClaim=(await db.query("select public.daily_stock_ai_intake_v1('CLAIM',$1) result",[corrected.intake_id])).rows[0].result;
 assert.equal(nextClaim.state,'ACQUIRED');assert.equal(nextClaim.source_kind,'ASOF_INTAKE');assert.equal(nextClaim.source_id,queued.intake_id);
 assert.equal(nextClaim.source_revision,stored.snapshot_hash);assert.equal(nextClaim.source_cutoff,sourced.cutoff);
 const inherited=nextClaim.inputs.find(i=>i.symbol==='2330').facts.filter(f=>f.id.startsWith('sec-quarter:'));
 assert.deepEqual([...inherited].sort((a,b)=>a.id.localeCompare(b.id)),[...facts].sort((a,b)=>a.id.localeCompare(b.id)));checks++;
 // Deliberately use CLAIM inputs without enrich(), and omit sec_replay as the
 // adapter would during a temporary registry-reader failure. SOURCE must retain
 // the exact prior receipts and independently regenerate the replay proof.
 const inheritedInputsBefore=JSON.stringify(nextClaim.inputs),ordinaryProof=proof(new Date().toISOString());
 const nextSourced=(await db.query("select public.daily_stock_ai_intake_v1('SOURCE',$1,$2,$3,$4,null,null,$5,$6,$7) result",
  [corrected.intake_id,nextClaim.lease,nextClaim.inputs,[],{},[],ordinaryProof])).rows[0].result;
 assert.equal(JSON.stringify(nextClaim.inputs),inheritedInputsBefore,'caller inputs not mutated');
 assert.equal(nextSourced.state,'SOURCED');assert.equal(nextSourced.member_published,false);
 const secondFacts=nextSourced.inputs.find(i=>i.symbol==='2330').facts.filter(f=>f.id.startsWith('sec-quarter:'));
 assert.deepEqual([...secondFacts].sort((a,b)=>a.id.localeCompare(b.id)),[...facts].sort((a,b)=>a.id.localeCompare(b.id)));checks++;
 await db.exec('reset role');
 const nextStored=(await db.query('select financial_refresh,snapshot_hash from vnext_runtime.ai_stock_intakes where id=$1',[corrected.intake_id])).rows[0];
 assert.deepEqual(nextStored.financial_refresh.sec_replay,replay);assert.match(nextStored.snapshot_hash,/^[a-f0-9]{64}$/);
 assert.notEqual(nextStored.snapshot_hash,stored.snapshot_hash,'later SOURCE has its own immutable snapshot');
 assert.equal((await db.query('select snapshot_hash from vnext_runtime.ai_stock_intakes where id=$1',[queued.intake_id])).rows[0].snapshot_hash,stored.snapshot_hash,'first snapshot retained');checks++;
 assert.equal((await db.query('select count(*) n from net.requests')).rows[0].n,0,'no external dispatch');checks++;
 console.log(JSON.stringify({result:'PASS',checks,postgres:(await db.query('show server_version')).rows[0].server_version,
  candidate_sha256:sha(candidate),production_connections:0,http_requests:0,model_calls:0}));
}catch(error){
 console.error(JSON.stringify({phase,error:String(error.message).slice(0,5000),code:error.code,where:error.where,
  site:error.stack?.split('\n').find(line=>line.includes('database.integration.mjs'))}));process.exitCode=1;
}finally{await db.close();}
