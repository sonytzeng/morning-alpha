// Synthetic official API shapes; live coverage is reported separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OFFICIAL_ACTUAL_SOURCES as sources,normalizeOfficialActuals,acquireOfficialActuals,officialActualCoverage} from '../supabase/functions/_shared/recommendation-official-actuals.ts';
import {buildRecommendationProof,RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {evidenceRows,IDENTITY} from './fixtures/decision-evidence-rows.mjs';
const now='2026-10-07T03:00:00.000Z';
function row(s,symbol=s.exchange==='TWSE'?'2330':'6488'){
 return s.exchange==='TWSE'?{'公司代號':symbol,'公司名稱':'Synthetic company','出表日期':'1151007','產業別':'24','資料年月':'11509','年度':'115','季別':'2','營業收入-當月營收':'1,234','營業收入':'4,321','基本每股盈餘(元)':'2.50','電子郵件信箱':'PRIVATE_CONTACT'}:
  {SecuritiesCompanyCode:symbol,CompanyName:'Synthetic company',Date:'1151006',SecuritiesIndustryCode:'24','公司代號':symbol,'公司名稱':'Synthetic company','出表日期':'1151006','資料年月':'11509',Year:'115','季別':'2','營業收入-當月營收':'1,234','營業收入':'4,321','基本每股盈餘':'2.50',EmailAddress:'PRIVATE_CONTACT'};
}
test('TWSE/TPEX share canonical symbols, preserve actual periods and strip every non-allowlisted field',()=>{
 const captures=sources.map(s=>({exchange:s.exchange,kind:s.kind,source:s.url,status:'PASS',received_at:now,http_status:200,rows:normalizeOfficialActuals(s,[row(s),row(s,'9999')],now,['2330','6488'])}));
 const coverage=officialActualCoverage(captures,['2330','6488']);
 assert.deepEqual([coverage.company,coverage.monthly_revenue_actual,coverage.quarterly_eps_actual],[2,2,2]);
 assert.equal(coverage.consensus,0);assert.equal(coverage.guidance,0);
 assert.doesNotMatch(JSON.stringify(captures),/PRIVATE_CONTACT|EmailAddress|電子郵件|9999/);
 for(const c of captures)for(const r of c.rows){assert.equal(r.available_at,now);assert.equal(r.observed_at,now);assert.equal(r.source_timestamp,null);assert.equal(r.recommendation_contract_complete,false);assert.equal(r.consensus,null);assert.equal(r.guidance,null);}
 assert.equal(captures.find(c=>c.kind==='monthly_revenue').rows[0].period,'2026-09');
 assert.equal(captures.find(c=>c.kind==='quarterly_eps').rows[0].period,'2026-Q2');
});
test('future/invalid source dates, unfinished periods and duplicate symbols are rejected',()=>{
 const s=sources[0],r=row(s);
 for(const date of ['1151008','1150230','invalid'])assert.throws(()=>normalizeOfficialActuals(s,[{...r,'出表日期':date}],now,['2330']),/SOURCE_DATE_INVALID/);
 assert.throws(()=>normalizeOfficialActuals(s,[r,r],now,['2330']),/DUPLICATE_SYMBOL/);
 assert.throws(()=>normalizeOfficialActuals(sources[1],[{...row(sources[1]),'資料年月':'11510'}],now,['2330']),/PERIOD_INVALID/);
 assert.throws(()=>normalizeOfficialActuals(sources[2],[{...row(sources[2]),'季別':'4'}],now,['2330']),/PERIOD_INVALID/);
});
test('missing actual is null, not zero; reported amount has no invented conversion or consensus',()=>{
 const s=sources[2],r={...row(s),'基本每股盈餘(元)':'--','營業收入':'--'};
 const [x]=normalizeOfficialActuals(s,[r],now,['2330']);assert.equal(x.eps_actual_as_reported,null);assert.equal(x.revenue_actual_as_reported,null);assert.equal(x.contract_twd_amount,null);
 const [zero]=normalizeOfficialActuals(s,[{...r,'基本每股盈餘(元)':'0'}],now,['2330']);assert.equal(zero.eps_actual_as_reported,0);
});
test('two exchanges claiming same canonical company fail closed instead of double counting',()=>{
 const captures=[sources[0],sources[3]].map(s=>({exchange:s.exchange,kind:s.kind,source:s.url,status:'PASS',rows:normalizeOfficialActuals(s,[row(s,'2330')],now,['2330'])}));
 const coverage=officialActualCoverage(captures,['2330']);assert.deepEqual(coverage.conflicting_symbols,['2330']);assert.equal(coverage.company,0);
});
test('public source acquisition is credential-free, six requests with at most two concurrent, nonblocking failure',async()=>{
 let active=0,max=0,calls=0;
 const captures=await acquireOfficialActuals({symbols:['2330','6488'],now:()=>now,signal:AbortSignal.timeout(5000),fetcher:async(url,init)=>{
  assert.equal(init.headers,undefined);assert.equal(init.redirect,'error');calls++;active++;max=Math.max(max,active);
  await new Promise(r=>setTimeout(r,1));active--;const s=sources.find(s=>s.url===url);
  return s.exchange==='TWSE'?Response.json([row(s)]):new Response('DO_NOT_CAPTURE',{status:429});
 }});
 assert.equal(calls,6);assert.ok(max<=2);assert.equal(officialActualCoverage(captures,['2330','6488']).company,1);
 assert.equal(captures.filter(c=>c.status==='OFFICIAL_HTTP_429').length,3);assert.doesNotMatch(JSON.stringify(captures),/DO_NOT_CAPTURE/);
});
test('aborted official acquisition starts no network, huge bodies and parser errors are bounded',async()=>{
 let calls=0;const c=new AbortController();c.abort();
 const result=await acquireOfficialActuals({symbols:['2330'],now:()=>now,signal:c.signal,fetcher:async()=>{calls++;throw Error('SECRET');}});
 assert.equal(calls,0);assert.ok(result.every(r=>r.status==='OFFICIAL_DEADLINE'));
 for(const body of ['{',' '.repeat(3_000_001)]){
  const r=await acquireOfficialActuals({symbols:['2330'],now:()=>now,signal:AbortSignal.timeout(5000),fetcher:async()=>new Response(body)});
  assert.ok(r.every(c=>c.rows.length===0&&c.status===(body==='{'?'OFFICIAL_JSON_INVALID':'OFFICIAL_RESPONSE_LIMIT')));
 }
});
function full(){
 const source=evidenceRows(),data=structuredClone(source);
 for(const key of ['quotes','flows','earnings','universe','mappings']){
  const template=source[key].filter(r=>(r.symbol||r.stock_symbol)==='2330');
  data[key]=source[key].filter(r=>!/^\d/.test(String(r.symbol||r.stock_symbol)));
  for(const symbol of RECOMMENDATION_UNIVERSE)for(const r of template){const copy=JSON.parse(JSON.stringify(r).replaceAll('2330',symbol));copy.id=String(copy.id)+'-'+symbol;data[key].push(copy);}
 }
 return data;
}
test('official actual supplement does not change a complete Recommendation decision or masquerade as consensus',async()=>{
 const d=full(),before=await buildRecommendationProof(d,IDENTITY);
 assert.equal(before.decision.phase_evaluation.ready_count,72);
 const official=[{exchange:'TWSE',kind:'quarterly_eps',source:sources[2].url,status:'PASS',received_at:IDENTITY.generated_at,http_status:200,rows:[{symbol:'2330',eps_actual_as_reported:99,available_at:IDENTITY.generated_at}]}];
 const after=await buildRecommendationProof(d,IDENTITY,[],official);
 assert.deepEqual(after.decision,before.decision);assert.deepEqual(after.business_writes,[]);
 assert.equal(after.acquisition.official_actuals.coverage.quarterly_eps_actual,1);
 for(const c of [{...official[0],received_at:'2099-01-01'}, {...official[0],rows:[{...official[0].rows[0],available_at:'2099-01-01'}]}]){
  const future=await buildRecommendationProof(d,IDENTITY,[],[c]);
  assert.equal(future.acquisition.official_actuals.coverage.quarterly_eps_actual,0);
  assert.equal(future.acquisition.official_actuals.captures[0].status,'OFFICIAL_NOT_AVAILABLE_AT_CUTOFF');
  assert.deepEqual(future.acquisition.official_actuals.captures[0].rows,[]);
 }
});
for(const gap of ['institutional','consensus','catalyst'])test(`SYNTHETIC complete prices still block all72 when required ${gap} is absent`,async()=>{
 const d=full();if(gap==='institutional')d.flows=[];if(gap==='consensus')for(const e of d.earnings){e.revenue_consensus=null;e.eps_consensus=null;}if(gap==='catalyst')d.mappings=[];
 const result=await buildRecommendationProof(d,IDENTITY);const p=result.decision.phase_evaluation;
 assert.equal(p.blocked_count,72);assert.equal(p.ready_count,0);assert.equal(p.none_count,0);
 const reason=gap==='institutional'?'THREE_INSTITUTIONS_MISSING':gap==='consensus'?'FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING':'SOURCED_COMPANY_CATALYST_MAPPING_MISSING';
 assert.equal(p.candidates.filter(c=>c.reasons.includes(reason)).length,72);
});
test('2330 handler scope never starts six full-universe official reads; public actuals do not write business tables',()=>{
 const handler=readFileSync(new URL('../supabase/functions/recommendation-stock-evidence-v1/index.ts',import.meta.url),'utf8');
 assert.match(handler,/scope==='SMOKE_2330'\?Promise.resolve\(\[\]\):acquireOfficialActuals/);
 assert.doesNotMatch(handler,/\.insert\(|\.upsert\(|\.update\(/);
});
