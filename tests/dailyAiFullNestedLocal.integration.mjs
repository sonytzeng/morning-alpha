// Isolated PostgreSQL regression. No network, model, Cron or production writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonical} from '../research/entry-opportunity.ts';
import {collectDailyAiOfficialNews,DAILY_AI_OFFICIAL_NEWS_URLS as NEWS} from '../research/daily-ai-official-news.ts';
import {refreshDailyAiFinancials,DAILY_AI_FINANCIAL_URLS as FINANCE} from '../research/daily-ai-financial-refresh.ts';
import {buildDailyAiSeed} from '../research/daily-ai-seed.ts';
import {parseDailyAiSourceSnapshot} from '../supabase/functions/daily-stock-analysis-v1/intake.ts';

const modulePath=process.env.MA_PGLITE_MODULE;assert(modulePath?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(modulePath),db=new PGlite();await db.waitReady;
const sha=text=>createHash('sha256').update(text).digest('hex'),signal=()=>new AbortController().signal;
const taipeiDay=time=>new Date(Date.parse(time)+8*3600000).toISOString().slice(0,10);
const roc=day=>String(Number(day.slice(0,4))-1911).padStart(3,'0')+day.slice(5,7)+day.slice(8,10);
const observed=new Date().toISOString(),day=taipeiDay(observed),priorDay=new Date(Date.parse(observed)-86400000).toISOString().slice(0,10);
const sourceCutoff=new Date(Date.parse(observed)-2*86400000).toISOString();
const symbols=['2330','2454','3363',...Array.from({length:69},(_,i)=>String(1000+i))];
const baseline=symbols.map((symbol,i)=>({symbol,company:symbol==='3363'?symbol:'隔離測試公司'+symbol,cutoff:sourceCutoff,
 through:'2026-10-28',next_session:'2026-10-29',expected_sessions:['2026-10-28'],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},
 bars:[{id:'retained-price-'+i,date:'2026-10-28',source:'https://www.twse.com.tw/test-price',published_at:null,first_seen_at:sourceCutoff,available_at:sourceCutoff,as_of:'2026-10-28T09:00:00Z',evidence_hash:'b'.repeat(64),session_scope:'SYNTHETIC_OFFICIAL_DAY',open:10,high:12,low:9,close:11,volume:100,amount:1100}],
 facts:[{id:'retained-revenue-'+i,kind:'REVENUE',period:'2026-09',basis:'MONTHLY',values:{yoy_percent:10},source:'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',published_at:null,first_seen_at:sourceCutoff,available_at:sourceCutoff,as_of:'2026-09-30T15:59:59Z',evidence_hash:'c'.repeat(64)},
 ...(i===0?[{id:'restricted-company-eps',kind:'EPS',period:'2026-Q2',basis:'CUMULATIVE',values:{value:99},source:'https://investor.tsmc.com/old-report',published_at:null,first_seen_at:sourceCutoff,available_at:sourceCutoff,as_of:sourceCutoff,evidence_hash:'d'.repeat(64)}]:[])]}));
// SYNTHETIC dual receipt fixture: source values match; first_seen differs.
const institutionals=baseline.flatMap((s,i)=>['2026-10-29','2026-10-30'].map((period,j)=>({id:`INSTITUTIONAL-SYNTHETIC-${s.symbol}-${period}`,symbol:s.symbol,kind:'INSTITUTIONAL',period,basis:'SHARES',values:{net_shares:i+j+10,foreign_net_shares:i+5,trust_net_shares:j+3,dealer_net_shares:2},source:'https://openapi.twse.com.tw/test-institutional',published_at:null,first_seen_at:'2026-11-01T14:00:00Z',available_at:'2026-11-01T14:00:00Z',as_of:'2026-10-30T05:30:00Z',evidence_hash:sha('SYNTHETIC:'+s.symbol+period),unit:'SHARES',not_currency:true,source_admitted:false,member_publication_approved:false})));
for(const s of baseline) s.facts.push(...institutionals.filter(f=>f.symbol===s.symbol).map(f=>{let x=structuredClone(f);delete x.unit;delete x.not_currency;delete x.source_admitted;delete x.member_publication_approved;x.first_seen_at='2026-11-01T15:00:00Z';x.available_at=x.first_seen_at;return x}));
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const registryText=JSON.stringify(stable(institutionals));
const run='00000000-0000-0000-0000-000000000001',revision='a'.repeat(64);
const rpc=async(op,id,args={})=>(await db.query('select public.daily_stock_ai_intake_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',
 [op,id,args.lease??null,args.inputs??null,args.gaps??null,args.batch_id??null,args.code??null,args.symbol_gaps??null,args.market??null,args.financial_refresh??null])).rows[0].result;
const enqueue=async()=>(await db.query('select public.enqueue_daily_stock_ai_intake_v1() result')).rows[0].result;
const correct=async(key,reason='SOURCE_POLICY_CORRECTION')=>(await db.query('select public.enqueue_corrected_daily_stock_ai_intake_v5($1,$2) result',[reason,key])).rows[0].result;
const importNews=async proof=>(await db.query('select public.import_daily_stock_ai_official_news_v1($1) result',[proof])).rows[0].result;
const importOwn=async proof=>(await db.query('select public.import_daily_stock_ai_own_news_v5($1) result',[proof])).rows[0].result;
const freeze=async()=>(await db.query('select vnext_runtime.freeze_daily_stock_ai_verified_news_v5($1) result',[baseline])).rows[0].result;
const names={
 [NEWS.TWSE]:'twse-major-announcements.json',[NEWS.TPEX]:'tpex-major-announcements.json',[NEWS.FED]:'fed-press-all.xml',
};
const syntheticNewsBodies={
 [NEWS.TWSE]:JSON.stringify([{'出表日期':roc(day),'發言日期':roc(day),'發言時間':'70003','公司代號':'2454','公司名稱':'隔離測試公司2454','主旨 ':'董事會通過已實現財務報告','說明':'已實現EPS17.50元；下一季展望為預測。','符合條款':'第31款','事實發生日':roc(day)}]),
 [NEWS.TPEX]:JSON.stringify([{'Date':roc(day),'發言日期':roc(day),'發言時間':'133249','SecuritiesCompanyCode':'3363','CompanyName':'隔離測試公司3363','主旨':'董事會決議','說明':'已公告決議事項。','符合條款':'第31款','事實發生日':roc(day)}]),
 [NEWS.FED]:'\ufeff<?xml version="1.0"?><rss version="2.0"><channel><item><title>Board&#39;s &amp;lt; decision</title><link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/orders20261030a.htm]]></link><description><![CDATA[literal &amp; text]]></description><pubDate><![CDATA['+new Date(Date.parse(observed)-3600000).toUTCString()+']]></pubDate></item></channel></rss>',
};
const collectNews=async bodies=>collectDailyAiOfficialNews({inputs:baseline,businessDate:day,clock:()=>observed,signal:signal(),fetcher:async source=>{
 assert(Object.values(NEWS).includes(source),'only fixed official news feeds');return new Response(bodies[source]);
}});
let phase='bootstrap';
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema vnext_runtime;create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_runtime.runs(id uuid primary key,business_date date,checkpoint jsonb,source_revision text,updated_at timestamptz default now());
 create table vnext_runtime.source_revisions(id text primary key,receipt jsonb);create table vnext_runtime.run_sources(run_id uuid,source_id text);
 create table public.runtime_http_dispatches(trading_date date,job_name text,checkpoint text,dispatch_status text);
 create table public.news_events(id uuid primary key,title text,summary text,source_name text,provider text,source_url text,published_at timestamptz,created_at timestamptz,fingerprint text);
 create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default now());
 insert into vault.decrypted_secrets(name,decrypted_secret) values('morning_alpha_daily_delivery_token','isolated-correction-delivery-token-000000');
 create schema net;create table net.requests(id bigint generated always as identity,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare n bigint;begin insert into net.requests(body) values(body) returning id into n;return n;end$$;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('00000000-0000-0000-0000-000000000002');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select current_setting('test.tier',true)$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select current_setting('test.tier',true)='owner'$$;
 create schema vnext_private;create function vnext_private.immutable_record() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_private.source_licenses(id text primary key,source text,document_url text,reviewed_at timestamptz,expires_at timestamptz,storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,redistribution_allowed boolean,attribution text);`);
 for(const name of ['daily-ai-jobs','daily-ai-batches','daily-ai-dispatch','daily-ai-handoff','daily-ai-member','daily-ai-use-review','daily-ai-intake','daily-ai-market-policy-v2','daily-ai-financial-refresh-v3','daily-ai-intake-performance-v4'])
  await db.exec(readFileSync(new URL('../research/'+name+'.candidate.sql',import.meta.url),'utf8'));
 const v5=readFileSync(new URL('../research/daily-ai-intake-corrections-v5.candidate.sql',import.meta.url),'utf8');
 assert(/\bcommit\s*;\s*$/i.test(v5),'V5_FINAL_COMMIT_REQUIRED');await db.exec(v5);
 // Reconstruct live production validator definitions locally; registry content is synthetic.
 await db.exec(`create table vnext_private.verified_institutional_facts_20261029_30_v1(source_seal_sha256 text,facts_sha256 text,registry_cutoff timestamptz,facts_text text,ingestion_verified boolean,source_admitted boolean,member_publication_approved boolean);
 create table vnext_private.verified_issuer16_facts_v1(like vnext_private.verified_institutional_facts_20261029_30_v1);
 create table vnext_private.verified_portal_margin_facts_v1(source_seal_sha256 text,facts_sha256 text,registry_cutoff timestamptz,facts_text text,required_native_margins_sha256 text,required_native_margins_text text,ingestion_verified boolean,source_admitted boolean,member_publication_approved boolean);
 create table vnext_private.verified_issuer_ir_facts_v1(source_seal_sha256 text,facts_sha256 text,facts_text text,ingestion_verified boolean,source_admitted boolean,member_publication_approved boolean);
 create table vnext_private.verified_umc_ir_facts_v1(like vnext_private.verified_issuer_ir_facts_v1);
 create table vnext_private.verified_retained_sec_facts_v1(source_seal_sha256 text,facts_sha256 text,facts_text text,source_documents_sha256 text,source_documents_text text,replay_basis text,source_admitted boolean,member_publication_approved boolean);
 create table vnext_private.verified_documented_reviews_v2(source_seal_sha256 text,facts_sha256 text,facts_text text,source_review_sha256 text,review_receipt_sha256 text,review_valid_until text,review_price_basis_text text,source_admitted boolean,member_publication_approved boolean);`);
 await db.query('insert into vnext_private.verified_institutional_facts_20261029_30_v1 values ($1,$2,$3,$4,true,false,false)', ['322a73e452f1f5c25561925d87cb37500f1f6bacb832d84cfd1f8a822e8ef3c8',sha(registryText),'2026-11-01T14:30:00Z',registryText]);
 await db.query('insert into vnext_private.verified_issuer16_facts_v1(source_seal_sha256,facts_text) values ($1,$2)', ['968c404b486b359339ae55710d089970c9da78c163d4af856a8dae269705e0c1','[]']);
 await db.query('insert into vnext_private.verified_portal_margin_facts_v1(source_seal_sha256,facts_text) values ($1,$2)', ['91a78be5aca00b4d224439f755f9e9b0f0e7c144ac00585e27ff948a91e2fba8','[]']);
 await db.exec('set check_function_bodies=off');
 const validatorHashes={"0_daily_ai_financial_body_v3.sql":"7e25018f0c7ad8d2435a56c086d76277e7c45789ead3e3b0b768a6d376b41610","10_documented_review_phase_v2.sql":"7ff227b6130f019ad4ac5b0ff70b76b695df58a59b0a4aa7c01822adf01f3158","11_is_documented_review_v2.sql":"5f8dab7b9de7ced783779ec558c76e01020b4da5d2f84249746d1e94394ad9c9","12_is_issuer_ir_direct_fact_v1.sql":"25845c46f34b6dc3bc86b91b9f33ef4c9002b607c3bb2e50decd479559346128","13_is_retained_sec_quarter_identity_v1.sql":"83e4811a2af7eccdb10ca522b51e0a7a3b94fec22107b12df59e4e553959d999","14_is_umc_ir_direct_fact_v1.sql":"738e78ed73d84f6349c258e3efdafaa396763f848a080b96a60a8f28763f0ba4","15_project_daily_stock_ai_inputs_reviews_v2.sql":"6ca2fea04f29f4de1d379d70c55d7295832f1565345947629a82f24f37331e05","16_project_daily_stock_ai_inputs_v1.sql":"7b3da81170bfdae84fdac26fbf88844791f4e4d795b6e687499b7a655559a977","17_validate_daily_ai_financial_refresh_institutional_v1.sql":"c6aa315d3d957dfea4126af5b126255ce1b9a9eb3826f475e4f7c3e084808d59","18_validate_daily_ai_financial_refresh_issuer16_v1.sql":"714542532b0750de136417c6189d279d9957ca6d558203c859473c91eba149f5","19_validate_daily_ai_financial_refresh_issuer_ir_v1.sql":"2a8a82bb89ed879b7a6a8bd7f274c4c6fe6f084c89f020a6c91d6f7c52c81fe0","1_daily_ai_financial_body_v5.sql":"d5ecd0b38168ed7fd3a0d182e0b199731a8736fbc7f62bc8b845568f292522c5","20_validate_daily_ai_financial_refresh_portal_margin_v1.sql":"7f13eff1de29ebf0c6ff01eb7e0c5cddc578d66957b0e2551b59c7d441122300","21_validate_daily_ai_financial_refresh_reviews_v2.sql":"a0567eb45678c58a4ad883ca53b8071dba4510fe658eea49c3beb7bb48cbc9e8","22_validate_daily_ai_financial_refresh_sec_v1.sql":"0d6cde2b2d48fd5976434bdd8a2859db0483b7b500b9d0eb45c083d37e438711","23_validate_daily_ai_financial_refresh_umc_ir_v1.sql":"74557a23b4889792f8ee58eea9bee64ac0b26ee54c7813e77cfa8f1834648f8d","24_validate_daily_ai_financial_refresh_v3.sql":"0b6496439a0dc9b370bf371fe5aa2f2cc37d4e718819b38c68d81d6be29792ce","25_validate_daily_ai_financial_refresh_v5.sql":"e6f4aa5a0f9f89fa42eaeff44fcde20c75620ec3937f9cdc477706415b87e318","27_daily_stock_ai_intake.sql":"cd662b8fbad10449d0eda20addcf4f402df5e6645639bce3586d3a2635b020c0","2_daily_ai_financial_company_v5.sql":"9d642b1fccf6671bf023ecca7025b2abd857a79c79e58877425adf567154a726","3_daily_ai_financial_field_v3.sql":"48e6a2737c4f6d633d4808c118aadfd63000dec0b50f05d40a2f24c08387a644","4_daily_ai_financial_latest_v3.sql":"794da20e2eb1363459a0d30ef513ae9ea93cf826f41283c86e6be0d2cec5950d","5_daily_ai_financial_latest_v5.sql":"3dd464b5d5d27b0222e948c77fb719a90e05a1a5f7aaab51cb8836050f492595","6_daily_ai_financial_number_v3.sql":"9f36c2ab756e9b87185e52c59723324fe5c761cb74ea59451a0d75250402930a","7_daily_ai_financial_report_v3.sql":"2976e44939a95a5ad4ff5624b10466b8fb8072b5d6322964d629867c829fc917","8_daily_ai_financial_restricted_v3.sql":"c8af5e581c9e91897fcfd57cffc757521edfca81787cea9fd51838c9b8510667","9_daily_ai_financial_valuation_report_v5.sql":"1a371f627b4d3c36e03e5ce65513f7d4271c944e36fb34541d2abf8f2882dbf9"};
 const {readdirSync}=await import('node:fs'); const liveDir=process.env.MA_VALIDATOR_DEFS_DIR;
 assert(liveDir?.startsWith('/'),'LOCAL_VALIDATOR_DIRECTORY_REQUIRED');
 const validatorFiles=readdirSync(liveDir).filter(x=>x.endsWith('.sql')).sort((a,b)=>Number(a.split('_')[0])-Number(b.split('_')[0]));
 assert.deepEqual([...validatorFiles].sort(),Object.keys(validatorHashes).sort(),'VALIDATOR_INVENTORY_DRIFT');
 for(const f of validatorFiles){const text=readFileSync(liveDir+'/'+f,'utf8');assert.equal(sha(text),validatorHashes[f],'VALIDATOR_SOURCE_DRIFT:'+f);await db.exec(text);}
 await db.exec('set check_function_bodies=on');
 await db.exec('revoke all on function vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(jsonb,jsonb,jsonb,timestamptz,date) from public,anon,authenticated,service_role');
 const sourceChecks=[];
 for (const f of readdirSync(liveDir).filter(x=>x.endsWith('.sql')).sort((a,b)=>Number(a.split('_')[0])-Number(b.split('_')[0]))) {
   const name=f.replace(/^\d+_/,'').replace(/\.sql$/,'');
   const schema=name==='daily_stock_ai_intake'?'public':'vnext_runtime';
   const actualName=name==='daily_stock_ai_intake'?'daily_stock_ai_intake_v1':name;
   const got=(await db.query('select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[schema,actualName])).rows;
   assert.equal(got.length,1,`EXACT_FUNCTION_INVENTORY:${f}`);
   const expected=sha(readFileSync(liveDir+'/'+f,'utf8')),actual=sha(got[0].d);
   assert.equal(actual,expected,`EXACT_LIVE_FUNCTION_BYTES:${f}`);
   sourceChecks.push({name:schema+'.'+actualName,sha256:actual});
 }
 console.log('EXACT_LIVE_SQL_DEFINITIONS_MATCH',JSON.stringify(sourceChecks));

 phase='queue authorization and revision identity';
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(enqueue,/permission denied/);
  await assert.rejects(()=>correct('00000000-0000-0000-0000-000000000011'),/permission denied/);
  await assert.rejects(()=>importNews({}),/permission denied/);await assert.rejects(()=>importOwn({}),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');
 await assert.rejects(()=>correct('00000000-0000-0000-0000-000000000011'),/AI_INTAKE_CORRECTION_BASE_REQUIRED/);
 await assert.rejects(()=>correct('00000000-0000-0000-0000-000000000011','arbitrary reason'),/AI_INTAKE_CORRECTION_SCOPE/);
 const first=await enqueue();assert.equal(first.revision,1);assert.equal(first.policy_reason,null);assert.equal(first.member_published,false);
 const key2='00000000-0000-0000-0000-000000000012',second=await correct(key2);assert.equal(second.revision,2);assert.equal(second.replayed,false);assert.equal(second.policy_reason,'SOURCE_POLICY_CORRECTION');
 const replay=await correct(key2);assert.equal(replay.intake_id,second.intake_id);assert.equal(replay.revision,2);assert.equal(replay.replayed,true);
 const third=await correct('00000000-0000-0000-0000-000000000013');assert.equal(third.revision,3);assert.notEqual(third.intake_id,second.intake_id);
 assert.equal((await enqueue()).intake_id,third.intake_id,'ordinary enqueue returns latest revision without creating another');
 await assert.rejects(()=>correct('00000000-0000-0000-0000-000000000014'),/AI_INTAKE_REVISION_LIMIT/);
 assert.equal((await correct(key2)).intake_id,second.intake_id,'idempotent replay survives daily limit');
 await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_intakes'),/permission denied/);
 await db.exec('reset role');assert.equal((await db.query('select count(*) n from vnext_runtime.ai_stock_intakes')).rows[0].n,3);
 await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_intakes set revision=2 where id=$1',[first.intake_id]),/AI_INTAKE_REVISION_IMMUTABLE/);
 await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_intakes set correction_request_key=$1 where id=$2',['00000000-0000-0000-0000-000000000099',second.intake_id]),/AI_INTAKE_REVISION_IMMUTABLE/);

 phase='official news immutable proof admission';
 const news=await collectNews(syntheticNewsBodies);assert.equal(news.complete,true);assert.equal(news.news.length,3);assert.equal(news.proof.responses.length,3);
 const rssFields=(await db.query(`select vnext_runtime.daily_ai_rss_text_v5($1::xml,'title') title,
  vnext_runtime.daily_ai_rss_text_v5($1::xml,'description') description`,['<item><title>Board&#39;s &amp;lt; decision</title><description><![CDATA[literal &amp; text]]></description></item>'])).rows[0];
 assert.equal(rssFields.title,"Board's &lt; decision");assert.equal(rssFields.description,'literal &amp; text','XPath extracts child fields and decodes serialization once');
 await db.exec('set role service_role');const imported=await importNews(news.proof);assert.equal(imported.state,'STORED');assert.equal(imported.records,3);assert.equal(imported.member_published,false);assert.match(imported.capture_id,/^[a-f0-9]{64}$/);
 assert.deepEqual(await importNews(news.proof),imported,'same proof is idempotent');
 await assert.rejects(()=>db.query('select proof from vnext_private.ai_news_captures_v5'),/permission denied/);await db.exec('reset role');
 const beforeCount=(await db.query('select count(*) n from vnext_private.ai_news_captures_v5')).rows[0].n;
 const newsTamper=[
  ['null observation time',p=>p.observed_at=null],
  ['null window start',p=>p.window_start=null],
  ['null business date',p=>p.business_date=null],
  ['raw hash',p=>p.responses[0].source_sha256='f'.repeat(64)],
  ['raw bytes',p=>p.responses[0].source_bytes++],
  ['raw body',p=>p.responses[0].response_text+=' '],
  ['row membership',p=>{const row=JSON.parse(p.additions[0].row_text);row['主旨 ']='forged';p.additions[0].row_text=canonical(row);}],
  ['partial source row with recomputed ID',p=>{const a=p.additions.find(a=>a.evidence.symbol==='2454'),row=JSON.parse(a.row_text);delete row['符合條款'];a.row_text=canonical(row);a.evidence.id='official-news:TWSE_MOPS_OPEN_DATA:'+sha(a.row_text);}],
  ['content hash',p=>p.additions[0].evidence.evidence_hash='f'.repeat(64)],
  ['forged content with new hash',p=>{const e=p.additions[0].evidence,c=JSON.parse(e.content);c.title='fabricated';e.content=canonical(c);e.evidence_hash=sha(e.content);}],
  ['receipt relabel',p=>p.additions[0].evidence.available_at=sourceCutoff],
  ['false MOPS publication',p=>{const e=p.additions.find(a=>a.evidence.symbol==='2454').evidence;e.published_at=observed;e.time_basis='PUBLISHED';}],
  ['GNews source substitution',p=>p.responses[0].source='https://gnews.io/api/v4/search'],
  ['duplicate response',p=>p.responses[1]=structuredClone(p.responses[0])],
  ['duplicate evidence',p=>p.additions.push(structuredClone(p.additions[0]))],
  ['unbounded source error',p=>{p.responses[0]={source:NEWS.TWSE,state:'UNAVAILABLE',received_at:null,source_sha256:null,source_bytes:null,response_text:null,error:'private provider body'};p.additions=p.additions.filter(a=>a.evidence.symbol!=='2454');}],
 ];
 for(const [label,change] of newsTamper){const proof=structuredClone(news.proof);change(proof);await db.exec('set role service_role');
  await assert.rejects(()=>importNews(proof),/AI_OFFICIAL_NEWS_/,label);await db.exec('reset role');
 }
 assert.equal((await db.query('select count(*) n from vnext_private.ai_news_captures_v5')).rows[0].n,beforeCount,'failed proof cannot leave a partial capture');
 await assert.rejects(()=>db.query('update vnext_private.ai_news_captures_v5 set proof=proof'),/IMMUTABLE/);
 await assert.rejects(()=>db.query('delete from vnext_private.ai_verified_news_v5'),/IMMUTABLE/);
 await db.query('insert into public.news_events values($1,$2,$3,$4,$5,$6,$7,$7,$8)',[
  '00000000-0000-0000-0000-000000000061','forbidden legacy GNews article','must never enter V5 snapshot','GNews','gnews','https://www.udn.com/forbidden-gnews-article',observed,'forbidden-legacy-gnews']);
 const frozen=await freeze();assert.equal(frozen.news.length,3);assert(!JSON.stringify(frozen).includes('forbidden-gnews'));
 for(const evidence of news.news)assert.deepEqual(frozen.news.find(n=>n.id===evidence.id),evidence,'freeze preserves source content/hash/publication and original receipt exactly');

 phase='optional retained primary evidence fixtures';
 if(process.env.MA_OFFICIAL_NEWS_PRIMARY_DIR){
  const dir=process.env.MA_OFFICIAL_NEWS_PRIMARY_DIR;assert(dir.startsWith('/'));
  const bodies=Object.fromEntries(Object.entries(names).map(([url,name])=>[url,readFileSync(dir+'/'+name,'utf8')]));
  const actual=await collectNews(bodies);assert(actual.news.length>0);await db.exec('set role service_role');
  assert.equal((await importNews(actual.proof)).records,actual.news.length);await db.exec('reset role');
  const document=readFileSync(dir+'/own-retained-fact-verification-20261031.json','utf8'),capture=readFileSync(dir+'/own-fact-webtool-verification-capture.json','utf8');
  const proof={schema:'DAILY_AI_RETAINED_OWN_NEWS_PROOF_V5',verification_document_text:document,verification_document_sha256:sha(document),capture_document_text:capture,capture_document_sha256:sha(capture)};
  await db.exec('set role service_role');const own=await importOwn(proof);assert.equal(own.records,4);assert.equal((await importOwn(proof)).capture_id,own.capture_id);
  for(const key of ['verification_document_sha256','capture_document_sha256']){const bad=structuredClone(proof);bad[key]='f'.repeat(64);await assert.rejects(()=>importOwn(bad),/AI_OWN_NEWS_HASH/);}
  await db.exec('reset role');const retained=(await freeze()).news.filter(e=>e.id.startsWith('retained-own-news:'));assert.equal(retained.length,3,'one issuer outside the synthetic72 universe is correctly excluded');
  for(const e of retained){const c=JSON.parse(e.content);assert.equal(e.evidence_hash,sha(e.content));assert.equal(c.scope,'RETAINED_BACKGROUND_NOT_FRESH_SOURCE_CAPTURE');assert.equal(e.available_at,c.original_available_at);assert.equal(e.published_at,c.original_published_at);assert.equal(c.original_content_hash,sha(c.original_content_text));assert.deepEqual(JSON.parse(c.original_content_text),c.original_content);}
 }
 {
  phase='complete official finance and SOURCE contract';
  await db.query('insert into vnext_runtime.runs values($1,$2,$3,$4,now())',[run,taipeiDay(sourceCutoff),{acquired:{inputs:baseline,evidence_cutoff:sourceCutoff,snapshot_hash:revision}},revision]);
  const companies=baseline.map(i=>({symbol:i.symbol,company:i.company,exchange:i.symbol==='3363'?'TPEX':'TWSE'}));
  await db.query('insert into vnext_runtime.source_revisions values($1,$2)',['directory',{task:{kind:'DIRECTORY'},status:'OK',payload:{rows:companies}}]);
  await db.query('insert into vnext_runtime.run_sources values($1,$2)',[run,'directory']);
  await db.exec('set role service_role');const claim=await rpc('CLAIM',second.intake_id);assert.equal(claim.state,'ACQUIRED');assert.equal(claim.inputs.length,72);await db.exec('reset role');
  const financialBodies={
   [FINANCE.TWSE_EPS]:[{'公司代號':'2330','公司名稱':'隔離測試公司2330','年度':'115','季別':'2','出表日期':roc(day),'基本每股盈餘(元)':'49.33'}],
   [FINANCE.TWSE_INCOME]:[{'公司代號':'2330','公司名稱':'隔離測試公司2330','年度':'115','季別':'2','出表日期':roc(day),'營業收入':'100','營業毛利（毛損）淨額':'40','營業利益（損失）':'30','本期淨利（淨損）':'20'}],
   [FINANCE.TPEX_EPS]:[{'SecuritiesCompanyCode':'3363','CompanyName':'隔離測試公司3363','Year':'115','季別':'2','Date':roc(day),'基本每股盈餘':'1.23'}],
   [FINANCE.TWSE_VALUATION]:[{Date:priorDay.replaceAll('-',''),Code:'2330',Name:'隔離測試公司2330',ClosePrice:'2370.00',DividendYield:'0.93',DividendYear:'114',PEratio:'27.47',PBratio:'9.55',FiscalYearQuarter:'2026Q2'}],
   [FINANCE.TPEX_VALUATION]:[{Date:roc(priorDay),SecuritiesCompanyCode:'3363',CompanyName:'隔離測試公司3363',PriceEarningRatio:'151.15',DividendPerShare:'4.00',YieldRatio:'0.17',PriceBookRatio:'40.92'}],
  };
  const updated=await refreshDailyAiFinancials({inputs:claim.inputs,businessDate:day,clock:()=>new Date().toISOString(),signal:signal(),fetcher:async url=>{assert(Object.values(FINANCE).includes(url));return Response.json(financialBodies[url]);}});
  assert.equal(updated.proof.responses.length,5);assert.equal(updated.proof.company_names.length,1);assert.equal(updated.inputs.find(i=>i.symbol==='3363').company,'隔離測試公司3363');
  assert.equal(updated.inputs.find(i=>i.symbol==='2330').facts.find(f=>f.kind==='VALUATION_AS_REPORTED').values.pe_ratio,27.47);
  assert(!JSON.stringify(updated.inputs).includes('investor.tsmc.com'));
  const validateFinancial=async(inputs,proof)=>(await db.query('select vnext_runtime.validate_daily_ai_financial_refresh_v5($1,$2,$3,clock_timestamp(),$4::date) result',[claim.inputs,inputs,proof,day])).rows[0].result;
  assert.deepEqual(await validateFinancial(updated.inputs,updated.proof),updated.proof);
  const financialTamper=[
   ['valuation raw hash',(inputs,proof)=>{proof.responses.find(r=>r.source===FINANCE.TWSE_VALUATION).source_sha256='f'.repeat(64);}],
   ['valuation row membership',(inputs,proof)=>{const addition=proof.additions.find(a=>a.fact_id.includes('VALUATION_AS_REPORTED'));const row=JSON.parse(addition.row_text);row.PEratio='999';addition.row_text=canonical(row);}],
   ['valuation body linkage',(inputs,proof)=>{const addition=proof.additions.find(a=>a.fact_id.includes('VALUATION_AS_REPORTED'));const body=JSON.parse(addition.body_text);body.values.pe_ratio=999;addition.body_text=canonical(body);}],
   ['unaudited company correction',(inputs,proof)=>{proof.company_names=[];}],
   ['forged company row',(inputs,proof)=>{const row=JSON.parse(proof.company_names[0].row_text);row.CompanyName='fabricated';proof.company_names[0].row_text=canonical(row);}],
   ['company correction on known company',(inputs,proof)=>{inputs.find(i=>i.symbol==='2454').company='fabricated';}],
   ['missing valuation audit',(inputs,proof)=>{proof.additions=proof.additions.filter(a=>!a.fact_id.includes('VALUATION_AS_REPORTED'));}],
   ['changed retained unrestricted revenue',(inputs)=>{inputs.find(i=>i.symbol==='2330').facts.find(f=>f.kind==='REVENUE').values.yoy_percent=999;}],
   ['restricted issuer fact reintroduced',(inputs)=>{inputs.find(i=>i.symbol==='2330').facts.push(claim.inputs.find(i=>i.symbol==='2330').facts.find(f=>f.id==='restricted-company-eps'));}],
  ];
  for(const [label,change] of financialTamper){const inputs=structuredClone(updated.inputs),proof=structuredClone(updated.proof);change(inputs,proof);await assert.rejects(()=>validateFinancial(inputs,proof),/AI_INTAKE_FINANCIAL_/,label);}
  await db.exec('set role service_role');
  const sourceArgs={lease:claim.lease,inputs:updated.inputs,gaps:updated.additionalGaps,symbol_gaps:updated.gapsBySymbol,market:[],financial_refresh:updated.proof};
  await assert.rejects(()=>rpc('SOURCE',second.intake_id,sourceArgs),/INSTITUTIONAL_FACT_DRIFT/,'Live 17 SQL reproduction must fail prior candidate');
  await db.exec('reset role');
  const compatibilitySql=readFileSync(new URL('../research/institutional-existing-capture.candidate.sql',import.meta.url),'utf8');
  const compatibilitySignature='vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(jsonb,jsonb,jsonb,timestamptz,date)';
  // Identical function text with changed permissions must not pass deployment admission.
  await db.exec(`grant execute on function ${compatibilitySignature} to authenticated`);
  await assert.rejects(()=>db.exec(compatibilitySql),/INSTITUTIONAL_VALIDATOR_BASELINE_DRIFT/,'ACL-only drift is rejected');
  await db.exec(`rollback;revoke execute on function ${compatibilitySignature} from authenticated`);
  await db.exec(`alter function ${compatibilitySignature} owner to anon`);
  await assert.rejects(()=>db.exec(compatibilitySql),/INSTITUTIONAL_VALIDATOR_BASELINE_DRIFT/,'owner-only drift is rejected');
  await db.exec(`rollback;alter function ${compatibilitySignature} owner to postgres`);
  await db.exec(`alter function ${compatibilitySignature} set statement_timeout='1s'`);
  await assert.rejects(()=>db.exec(compatibilitySql),/INSTITUTIONAL_VALIDATOR_BASELINE_DRIFT/,'config drift is rejected');
  await db.exec(`rollback;alter function ${compatibilitySignature} reset statement_timeout`);
  await db.exec(compatibilitySql);
  await assert.rejects(()=>db.exec(compatibilitySql),/INSTITUTIONAL_VALIDATOR_BASELINE_DRIFT/,'repeat deployment is rejected');
  await db.exec('rollback');
  const candidateDefinition=(await db.query("select pg_get_functiondef('vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(jsonb,jsonb,jsonb,timestamptz,date)'::regprocedure) d")).rows[0].d;
  console.log('CANDIDATE_FUNCTION_SHA256',sha(candidateDefinition));
  await db.exec('set role service_role');
  for (const [name,mutate] of [
   ['changed shares', f=>{f.values.net_shares+=1}],
   ['changed evidence hash',f=>{f.evidence_hash='f'.repeat(64)}],
   ['future available time',f=>{f.available_at='2099-01-01T00:00:00Z'}],
   ['forged admitted flag',f=>{f.source_admitted=true}],
   ['forged time',f=>{f.first_seen_at='2026-10-30T00:00:00Z'}],
   ['unknown extra field',f=>{f.forged='x'}],
  ]){const bad=structuredClone(sourceArgs);mutate(bad.inputs[0].facts.find(f=>f.id.startsWith('INSTITUTIONAL-SYNTHETIC-')));await assert.rejects(()=>rpc('SOURCE',second.intake_id,bad),/INSTITUTIONAL_EXISTING_CAPTURE_DRIFT/,name);}
  {const bad=structuredClone(sourceArgs);const facts=bad.inputs[0].facts;facts.splice(facts.findIndex(f=>f.id.startsWith('INSTITUTIONAL-SYNTHETIC-')),1);await assert.rejects(()=>rpc('SOURCE',second.intake_id,bad),/INSTITUTIONAL_EXISTING_CAPTURE_DRIFT/,'missing fact');}
  await db.exec('reset role');
  assert.equal((await db.query('select state from vnext_runtime.ai_stock_intakes where id=$1',[second.intake_id])).rows[0].state,'RUNNING','failed SOURCE leaves no partial commit');
  await db.exec('update vnext_private.verified_institutional_facts_20261029_30_v1 set source_admitted=true');
  await db.exec('set role service_role');await assert.rejects(()=>rpc('SOURCE',second.intake_id,sourceArgs),/INSTITUTIONAL_EXISTING_CAPTURE_DRIFT/,'registry flags cannot be bypassed');await db.exec('reset role');
  await db.exec('update vnext_private.verified_institutional_facts_20261029_30_v1 set source_admitted=false');
  await db.exec('set role service_role');
  const sourced=await rpc('SOURCE',second.intake_id,sourceArgs);assert.equal(sourced.state,'SOURCED');
  const sourceFacts=sourced.inputs.flatMap(i=>i.facts).filter(f=>String(f.id).startsWith('INSTITUTIONAL-SYNTHETIC-'));
  assert.equal(sourceFacts.length,144);assert(sourceFacts.every(f=>f.first_seen_at==='2026-11-01T15:00:00Z'&&f.available_at===f.first_seen_at));
  console.log('CANDIDATE_SOURCE_NESTED_144_PRESERVED_PASS');
  assert.equal(sourced.inputs.find(i=>i.symbol==='3363').company,'隔離測試公司3363');assert(!JSON.stringify(sourced).includes('forbidden-gnews'));assert(!JSON.stringify(sourced).includes('response_text'));
  const parsed=await parseDailyAiSourceSnapshot(sourced,sourced.cutoff,signal(),'INTAKE'),seed=await buildDailyAiSeed({...parsed,cutoff:sourced.cutoff});
  assert(!seed.payload_text.includes('forbidden-gnews'));assert(!seed.payload_text.includes('investor.tsmc.com'));assert(seed.payload_text.includes('VALUATION_AS_REPORTED'));assert(seed.payload_text.includes('official-news:'));
  await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[seed.payload_text,seed.metadata.payload_hash]);
  const complete=await rpc('COMPLETE',second.intake_id,{lease:claim.lease,batch_id:seed.metadata.payload_hash});assert.equal(complete.state,'COMPLETE');assert.equal(complete.batch_id,seed.metadata.payload_hash);
  assert.equal((await rpc('CLAIM',second.intake_id)).batch_id,seed.metadata.payload_hash);
  const nextRevision=await rpc('CLAIM',third.intake_id);assert.equal(nextRevision.state,'ACQUIRED');assert.equal(nextRevision.source_kind,'ASOF_INTAKE');assert.equal(nextRevision.source_id,second.intake_id);
  assert.equal(nextRevision.source_revision,sourced.snapshot_hash);assert.equal(nextRevision.source_cutoff,sourced.cutoff);
  assert.equal(nextRevision.inputs.find(i=>i.symbol==='3363').company,'隔離測試公司3363','same-day correction starts from latest sealed official company identity');
  await db.exec('reset role');
  phase='guarded rollback';
  const rollback=readFileSync(new URL('../research/institutional-existing-capture.rollback.candidate.sql',import.meta.url),'utf8');
  await db.exec(rollback);
  const restored=(await db.query("select pg_get_functiondef('vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(jsonb,jsonb,jsonb,timestamptz,date)'::regprocedure) d")).rows[0].d;
  assert.equal(sha(restored),'c6aa315d3d957dfea4126af5b126255ce1b9a9eb3826f475e4f7c3e084808d59','ROLLBACK_RESTORES_EXACT_SOURCE');
  await assert.rejects(()=>db.exec(rollback),/ROLLBACK_BASELINE_DRIFT/,'cannot apply twice or restore over a changed function');
  await db.exec('rollback');
  console.log('GUARDED_ROLLBACK_PGLITE_PASS');
  console.log('PASS: isolated V5 queue/correction idempotency, official/private proof validation, immutable source receipts, GNews exclusion, five-source financial values/name correction, and real parser→seed→STORE→COMPLETE. No network, model, Cron or production writes.');
 }
}catch(error){
 console.error(JSON.stringify({phase,error:String(error.message).slice(0,5000),code:error.code,where:error.where,site:error.stack?.split('\n').find(line=>line.includes('dailyAiIntakeCorrectionsV5Database.integration.mjs'))}));process.exitCode=1;
}finally{await db.close();}
