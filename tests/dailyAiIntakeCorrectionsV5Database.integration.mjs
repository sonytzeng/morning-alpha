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
  await db.exec('set role service_role');const sourced=await rpc('SOURCE',second.intake_id,{lease:claim.lease,inputs:updated.inputs,gaps:updated.additionalGaps,symbol_gaps:updated.gapsBySymbol,market:[],financial_refresh:updated.proof});assert.equal(sourced.state,'SOURCED');
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
  console.log('PASS: isolated V5 queue/correction idempotency, official/private proof validation, immutable source receipts, GNews exclusion, five-source financial values/name correction, and real parser→seed→STORE→COMPLETE. No network, model, Cron or production writes.');
 }
}catch(error){
 console.error(JSON.stringify({phase,error:String(error.message).slice(0,5000),code:error.code,where:error.where,site:error.stack?.split('\n').find(line=>line.includes('dailyAiIntakeCorrectionsV5Database.integration.mjs'))}));process.exitCode=1;
}finally{await db.close();}
