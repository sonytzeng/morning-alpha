// Local PostgreSQL only: Vault and pg_net are synthetic, with no actual HTTP.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const module=process.env.MA_PGLITE_MODULE;assert(module?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(module),db=new PGlite();await db.waitReady;
const token='isolated-handoff-token-not-production';
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create schema vnext_runtime;create schema vault;create schema net;
  create table vnext_runtime.runs(id uuid primary key,business_date date,source_revision text,checkpoint jsonb not null default '{}');
  create table public.news_events(id uuid primary key default gen_random_uuid(),title text,summary text,source_name text,provider text,source_url text,published_at timestamptz,created_at timestamptz,fingerprint text,freshness_status text);
  create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
  create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default clock_timestamp());
  create table net.mock_control(fail boolean);insert into net.mock_control values(false);
  create table net.mock_requests(id bigserial,url text,headers jsonb,body jsonb,timeout_milliseconds integer);
  create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint
   language plpgsql as $$declare request bigint;begin
    if (select fail from net.mock_control) then raise exception 'MOCK_NET_FAILURE';end if;
    insert into net.mock_requests values(default,url,headers,body,timeout_milliseconds) returning id into request;return request;
   end$$;
  revoke all on schema vnext_runtime,vault,net from public,anon,authenticated,service_role;
  revoke all on all tables in schema vnext_runtime,vault,net from public,anon,authenticated,service_role;`);
 await db.exec(readFileSync(new URL('../research/daily-ai-handoff.candidate.sql',import.meta.url),'utf8'));
 const addNews=async(title,publication,received='-10 minutes',url='https://example.com/article',summary='原始供應商摘要')=>db.query(
  "insert into public.news_events(title,summary,source_name,provider,source_url,published_at,created_at,fingerprint,freshness_status) values($1,$2,'Source','provider',$3,clock_timestamp()+$4::interval,clock_timestamp()+$5::interval,repeat('f',64),'fresh')",
  [title,summary,url,publication,received]);
 for(let i=0;i<15;i++)await addNews('1000 公司新聞 '+i,`-${i+1} minutes`);
 for(let i=0;i<6;i++)await addNews('全球市場新聞 '+i,`-${i+1} minutes`);
 await addNews('STALE_FRESH_LABEL','-72 hours');await addNews('FUTURE_PUBLICATION','1 hour');
 await addNews('FUTURE_RECEIPT','-1 minute','1 hour');await addNews('UNSAFE_SOURCE','-1 minute','-10 minutes','https://example.com/article?token=fixture');
 const load=async cutoff=>(await db.query('select public.load_daily_stock_ai_handoff_v1($1) r',[cutoff])).rows[0].r;
 const dispatch=async cutoff=>(await db.query('select public.dispatch_daily_stock_ai_handoff_v1($1) r',[cutoff])).rows[0].r;
 const make=(cutoff,revision='a'.repeat(64))=>({snapshot_hash:revision,evidence_cutoff:cutoff,entry:null,
  source_issues:[{kind:'FINANCIAL_YTD',key:'b'.repeat(64),reason:'FINANCIAL_RESPONSE_PERIOD_UNPROVEN'}],
  inputs:Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'隔離測試',cutoff,through:'2026-10-28',next_session:'2026-10-29',expected_sessions:['2026-10-28'],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},facts:[],bars:[{id:'bar-'+i,date:'2026-10-28',source:'https://www.twse.com.tw/',published_at:null,first_seen_at:'2026-10-28T23:00:00Z',available_at:'2026-10-28T23:00:00Z',as_of:'2026-10-28T05:30:00Z',evidence_hash:'c'.repeat(64),open:10,high:12,low:9,close:11,volume:100,amount:1100,session_scope:'REGULAR'}]}))});
 const create=async(id)=>db.query("insert into vnext_runtime.runs(id,business_date) values($1,'2026-10-29')",[id]);
 const pin=async(id,acquired)=>db.query('update vnext_runtime.runs set checkpoint=$2,source_revision=$3 where id=$1',[id,{acquired},acquired.snapshot_hash]);
 const sourceCutoff='2026-10-28T23:17:14.682Z',run='11111111-1111-4111-8111-111111111111',acquired=make(sourceCutoff);
 await create(run);
 // A partial/duplicate universe must not trigger model intake, and the old
 // checkpoint write itself still commits without any intake dependency.
 const partial=make(sourceCutoff);partial.inputs.pop();await pin(run,partial);
 assert.equal((await db.query('select count(*)::int n from vnext_runtime.ai_stock_handoffs')).rows[0].n,0);
 // A partial acquired object can become complete directly. No manual reset.
 await pin(run,acquired); // No Vault token: durable handoff, safe pending state.
 const cutoff=(await db.query('select cutoff_text from vnext_runtime.ai_stock_handoffs where source_run_id=$1',[run])).rows[0].cutoff_text;
 assert(Date.parse(cutoff)>Date.parse(sourceCutoff));
 assert.deepEqual((await db.query('select checkpoint from vnext_runtime.runs where id=$1',[run])).rows[0].checkpoint,{acquired});
 let delivery=(await db.query('select * from vnext_runtime.ai_stock_handoff_delivery')).rows[0];
 assert.equal(delivery.attempts,0);assert.equal(delivery.last_code,'CREDENTIAL_UNAVAILABLE');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(()=>load(cutoff),/permission denied/);await assert.rejects(()=>dispatch(cutoff),/permission denied/);
  await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_handoffs'),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');
 await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_handoffs'),/permission denied/);
 await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_handoff_delivery'),/permission denied/);
 for(const invalid of [null,'infinity','2099-01-01T00:00:00Z']){await assert.rejects(()=>load(invalid),/AI_HANDOFF_SCOPE/);await assert.rejects(()=>dispatch(invalid),/AI_HANDOFF_SCOPE/);}
 assert.equal(await load('2026-10-28T23:18:00Z'),null);await assert.rejects(()=>dispatch('2026-10-28T23:18:00Z'),/AI_HANDOFF_MISSING/);
 const loaded=await load(cutoff);assert.equal(loaded.schema,'DAILY_AI_SOURCE_HANDOFF_V1');assert.equal(loaded.cutoff,cutoff);assert.equal(loaded.source_run_id,run);
 assert.equal(loaded.source_cutoff,sourceCutoff);assert.equal(loaded.source_business_date,'2026-10-29');
 assert.equal(loaded.business_date,new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10));
 assert.equal(loaded.source_revision,acquired.snapshot_hash);assert.deepEqual(loaded.inputs,acquired.inputs);assert.deepEqual(loaded.source_issues,acquired.source_issues);
 assert.equal(loaded.inputs[0].bars[0].published_at,null);assert.equal(loaded.inputs[0].through,'2026-10-28');
 assert.equal(loaded.news.length,16);assert.equal(loaded.news.filter(n=>n.symbol==='1000').length,12);assert.equal(loaded.news.filter(n=>n.symbol===null).length,4);
 assert(loaded.news.every(n=>n.symbol===null||n.symbol==='1000'));assert.equal(new Set(loaded.news.map(n=>n.id)).size,16);
 for(const n of loaded.news){const content=JSON.parse(n.content);assert.equal(content.coverage,'HEADLINE_AND_PROVIDER_EXCERPT');assert.equal(content.provider_excerpt,'原始供應商摘要');
  assert.equal(n.evidence_hash,createHash('sha256').update(n.content).digest('hex'));assert.equal(n.available_at,cutoff);assert.equal(n.first_seen_at,cutoff);assert.equal(n.as_of,cutoff);
  assert(Date.parse(n.published_at)<=Date.parse(cutoff));assert(Date.parse(content.first_ingested_at)<=Date.parse(cutoff));assert.equal(n.time_basis,'PUBLISHED');
 }
 assert(!JSON.stringify(loaded.news).match(/STALE_FRESH_LABEL|FUTURE_PUBLICATION|FUTURE_RECEIPT|UNSAFE_SOURCE/));
 assert.equal(loaded.projection,'DAILY_AI_RETAINED_INPUT_PROJECTION_V1');assert(loaded.intake_gaps.includes('RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED'));
 assert.deepEqual(loaded.market,[]);assert.equal(loaded.intake_gaps.length,6);assert(loaded.intake_gaps.includes('NEWS_COMPANY_ASSOCIATION_REQUIRES_VERIFICATION'));assert.equal(loaded.member_published,false);
 assert(!Object.hasOwn(loaded,'lease'));assert(!JSON.stringify(loaded).includes(token));
 assert.equal((await dispatch(cutoff)).state,'HANDOFF_CREDENTIAL_UNAVAILABLE');
 await db.exec('reset role');
 await db.exec("update public.news_events set summary='修改後內容'");
 assert.deepEqual((await load(cutoff)).news,loaded.news); // retry bytes frozen
 await db.query("insert into vault.decrypted_secrets(name,decrypted_secret) values('morning_alpha_daily_delivery_token',$1)",[token]);
 await db.exec('set role service_role');assert.equal((await dispatch(cutoff)).state,'HANDOFF_DISPATCHED');await db.exec('reset role');
 const request=(await db.query('select * from net.mock_requests')).rows[0];
 assert.equal(request.headers['x-daily-delivery-token'],token);assert.deepEqual(request.body,{cutoff});assert.equal(request.timeout_milliseconds,60000);
 assert.equal(request.url,'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1');
 // A compact stage update is not a new acquisition; do not enqueue again.
 await db.query('update vnext_runtime.runs set checkpoint=$2 where id=$1',[run,{acquired,completed:['ACQUISITION']}]);
 assert.equal((await db.query('select count(*)::int n from net.mock_requests')).rows[0].n,1);
 // A different source run gets its own truthful new receipt, even if original
 // acquired cutoffs coincide. Neither original source timestamp is rewritten.
 const duplicate='22222222-2222-4222-8222-222222222222';await create(duplicate);await pin(duplicate,make(sourceCutoff,'d'.repeat(64)));
 assert.equal((await db.query('select count(*)::int n from vnext_runtime.ai_stock_handoffs')).rows[0].n,2);
 assert.equal((await db.query('select checkpoint from vnext_runtime.runs where id=$1',[duplicate])).rows[0].checkpoint.acquired.snapshot_hash,'d'.repeat(64));
 // A pg_net failure cannot erase the acquired pin or immutable handoff.
 const brokenRun='33333333-3333-4333-8333-333333333333';
 await create(brokenRun);await db.exec('update net.mock_control set fail=true');await pin(brokenRun,make('2026-10-28T23:18:14.682Z','e'.repeat(64)));
 const brokenCutoff=(await db.query('select cutoff_text from vnext_runtime.ai_stock_handoffs where source_run_id=$1',[brokenRun])).rows[0].cutoff_text;
 const broken=(await db.query('select d.* from vnext_runtime.ai_stock_handoff_delivery d join vnext_runtime.ai_stock_handoffs h on h.id=d.handoff_id where h.source_run_id=$1',[brokenRun])).rows[0];
 assert.equal(broken.attempts,1);assert.equal(broken.last_code,'ENQUEUE_FAILED');
 assert.equal((await load(brokenCutoff)).inputs.length,72);
 await db.exec('update net.mock_control set fail=false');await db.exec('set role service_role');
 assert.equal((await dispatch(brokenCutoff)).state,'HANDOFF_DISPATCHED');assert.equal((await dispatch(brokenCutoff)).state,'HANDOFF_DISPATCHED');
 assert.equal((await dispatch(brokenCutoff)).state,'HANDOFF_DISPATCH_BUDGET_EXHAUSTED');await db.exec('reset role');
 // Projection retains original selected values/trace metadata while bounding
 // the Edge payload. It does not rewrite the immutable full source inputs.
 const projectionInput=structuredClone(acquired.inputs),dates=Array.from({length:34},(_,i)=>new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10));
 for(const input of projectionInput){input.expected_sessions=dates;input.bars=dates.map((date,i)=>({...input.bars[0],id:'history-'+i,date,close:i+10}));
  input.facts=['REVENUE','INSTITUTIONAL','EPS','MARGIN','CAPEX','DEMAND','MOAT','VALUATION','OTHER'].flatMap(kind=>Array.from({length:42},(_,i)=>({id:kind+'-'+String(i).padStart(2,'0'),kind,period:'P'+String(i).padStart(2,'0'),basis:'ORIGINAL',values:{value:i},source:'https://example.com/',published_at:null,first_seen_at:sourceCutoff,available_at:sourceCutoff,as_of:sourceCutoff,evidence_hash:'d'.repeat(64)})));}
 const projected=(await db.query('select vnext_runtime.project_daily_stock_ai_inputs_v1($1) r',[projectionInput])).rows[0].r;
 assert.equal(projected.length,72);assert.deepEqual(projected[0].expected_sessions,dates.slice(-25));assert.deepEqual(projected[0].bars,projectionInput[0].bars.slice(-25));
 const limits={REVENUE:36,INSTITUTIONAL:10,EPS:4,MARGIN:4,CAPEX:4,DEMAND:1,MOAT:1,VALUATION:1,OTHER:2};
 for(const [kind,limit] of Object.entries(limits))assert.deepEqual(projected[0].facts.filter(f=>f.kind===kind),projectionInput[0].facts.filter(f=>f.kind===kind).slice(-limit));
 assert.deepEqual((await db.query('select inputs from vnext_runtime.ai_stock_handoffs where source_run_id=$1',[run])).rows[0].inputs,acquired.inputs);
 await assert.rejects(()=>db.query('select vnext_runtime.project_daily_stock_ai_inputs_v1($1)',[projectionInput.slice(1)]),/AI_HANDOFF_PROJECTION_SCOPE/);
 const oversized=structuredClone(acquired.inputs);for(const input of oversized)input.oversized='x'.repeat(112000);
 await assert.rejects(()=>db.query('select vnext_runtime.project_daily_stock_ai_inputs_v1($1)',[oversized]),/AI_HANDOFF_PROJECTION_SIZE/);
 // Many articles can explicitly mention every company. A total receipt-byte
 // budget still caps frozen source content, independent of per-company caps.
 const allSymbols=acquired.inputs.map(i=>i.symbol).join(' ');
 for(let i=0;i<12;i++)await addNews(allSymbols+' '+i,`-${i+1} seconds`,'-10 minutes','https://example.com/article','Z'.repeat(6000));
 const boundedNews=(await db.query('select vnext_runtime.freeze_daily_stock_ai_news_v1($1) r',[acquired.inputs])).rows[0].r;
 assert(boundedNews.news.length<868&&boundedNews.news.length>100);
 assert.equal((await db.query("select octet_length(($1::jsonb->'news')::text) n",[boundedNews])).rows[0].n<=1500000,true);
 assert(boundedNews.news.every(n=>Date.parse(boundedNews.cutoff)-Date.parse(n.published_at)<=48*3600000));
 await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_handoffs set business_date=business_date'),/IMMUTABLE/);
 await assert.rejects(()=>db.query('delete from vnext_runtime.ai_stock_handoffs'),/IMMUTABLE/);
 const rls=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid in('vnext_runtime.ai_stock_handoffs'::regclass,'vnext_runtime.ai_stock_handoff_delivery'::regclass)")).rows;
 assert.equal(rls.length,2);assert(rls.every(r=>r.relrowsecurity&&r.relforcerowsecurity));
 console.log('PASS: partial-to-complete acquired handoff; immutable full original inputs/source cutoff/unknown publication; declared last25bar/boundedfacts projection with unchanged selected traces and8MBcap; truthful new AS_OF headline/provider-excerpt receipts/hashes with per-company/global/1.5MBcaps; stale/future/late/unsafe news excluded and retry bytes frozen; RPC/raw isolation; CHECKPOINT survives missing credentials/net failure; no compact-update duplicates; bounded retry. Isolated fixtures only.');
}finally{await db.close();}
