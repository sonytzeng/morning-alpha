import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonical} from '../research/entry-opportunity.ts';
import {refreshDailyAiFinancials,removeRestrictedFinancialFacts,dailyAiFinancialRefreshUnavailable,isRestrictedDailyAiFinancialSource,DAILY_AI_FINANCIAL_URLS} from '../research/daily-ai-financial-refresh.ts';
const clock=()=> '2026-10-31T08:00:00Z',signal=()=>new AbortController().signal,sha=s=>createHash('sha256').update(s).digest('hex');
const source='https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_115_9.csv';
const trace=(id,url=source)=>({id,source:url,evidence_hash:'a'.repeat(64),published_at:null,first_seen_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T10:00:00Z',as_of:'2026-10-30T10:00:00Z'});
function inputs(){return ['2330','2454','2317','3081',...Array.from({length:68},(_,i)=>String(1000+i))].map(symbol=>({symbol,company:'測試公司'+symbol,through:'2026-10-30',cutoff:'2026-10-30T12:00:00Z',next_session:'2026-11-02',expected_sessions:[],bars:[],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},facts:[{...trace('retained-'+symbol),kind:'REVENUE',period:'2026-09',basis:'MONTHLY',values:{yoy_percent:10}},...(['2330','2454','2317'].includes(symbol)?[{...trace('restricted-'+symbol,{'2330':'https://investor.tsmc.com/reports/old.pdf','2454':'https://www.mediatek.com/report.pdf','2317':'https://image.honhai.com/report.pdf'}[symbol]),kind:'EPS',period:'2026-Q2',basis:'CUMULATIVE',values:{value:99}}]:[])]}));}
const epsRow=(symbol,more={})=>({'出表日期':'1151031','年度':'115','季別':'2','公司代號':symbol,'公司名稱':'測試公司'+symbol,'基本每股盈餘(元)':'49.33',...more});
const incomeRow=(symbol,more={})=>({'出表日期':'1151031','年度':'115','季別':'2','公司代號':symbol,'公司名稱':'測試公司'+symbol,'營業收入':'1,000.00','營業毛利（毛損）淨額':'400.00','營業毛利（毛損）':'399.00','營業利益（損失）':'250.00','本期淨利（淨損）':'100.00',...more});
const tpexRow=(symbol,more={})=>({'Date':'1151030','Year':'115','季別':'2','SecuritiesCompanyCode':symbol,'CompanyName':'測試公司'+symbol,'基本每股盈餘':'1.23',...more});
const rows=()=>({[DAILY_AI_FINANCIAL_URLS.TWSE_EPS]:inputs().filter(s=>s.symbol!=='3081').map(s=>epsRow(s.symbol)),[DAILY_AI_FINANCIAL_URLS.TWSE_INCOME]:inputs().filter(s=>s.symbol!=='3081').map(s=>incomeRow(s.symbol)),[DAILY_AI_FINANCIAL_URLS.TPEX_EPS]:[tpexRow('3081')]});
const options=(fetcher,more={})=>({inputs:inputs(),businessDate:'2026-10-31',fetcher,clock,signal:signal(),...more});
const fetcher=(edit=()=>{})=>async(url,init)=>{assert(Object.values(DAILY_AI_FINANCIAL_URLS).includes(url));assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert(!new Headers(init.headers).has('Authorization'));const r=structuredClone(rows()[url]);edit(r,url);return Response.json(r);};
test('restricted fact removal matches exact company domains/subdomains and never relabels retained observations',()=>{
 const original=inputs(),before=structuredClone(original),clean=removeRestrictedFinancialFacts(original);assert.deepEqual(original,before);assert.equal(clean.removed.length,3);
 for(const s of clean.inputs){assert(!s.facts.some(f=>isRestrictedDailyAiFinancialSource(f.source)));assert.deepEqual(s.facts[0],before.find(x=>x.symbol===s.symbol).facts[0]);}
 assert(isRestrictedDailyAiFinancialSource('https://sub.investor.tsmc.com/report'));assert(!isRestrictedDailyAiFinancialSource('https://tsmc.com.example.test/report'));assert(!isRestrictedDailyAiFinancialSource('https://example.test/tsmc.com'));
});
test('three shared official requests create actual AS_REPORTED EPS and same-unit ratios with exact raw/row/body provenance',async()=>{
 const original=inputs(),r=await refreshDailyAiFinancials(options(fetcher(),{inputs:original}));assert.equal(r.inputs.length,72);assert.equal(r.receipts.length,3);assert.equal(r.proof.additions.length,143);assert.equal(r.removed.length,3);
 for(const response of r.proof.responses){assert.equal(response.state,'CAPTURED');assert.equal(response.source_sha256,sha(response.response_text));assert.equal(response.source_bytes,Buffer.byteLength(response.response_text));assert.equal(response.received_at,clock());}
 const company=r.inputs.find(s=>s.symbol==='2330'),eps=company.facts.find(f=>f.kind==='EPS_AS_REPORTED'),income=company.facts.find(f=>f.kind==='FINANCIAL_AS_REPORTED');
 assert.equal(eps.values.value,49.33);assert.equal(eps.basis,'AS_REPORTED');assert.equal(eps.period,'2026-Q2');assert.equal(eps.values.period_basis,'AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_INFERRED');assert.equal(eps.values.no_single_quarter_or_ttm_inference,'TRUE');assert.equal(eps.values.unit,'SOURCE_REPORTED_YUAN_PER_SHARE');assert(!('eps_ttm' in eps.values));
 assert.equal(income.values.gross_margin_percent,40);assert.equal(income.values.operating_margin_percent,25);assert.equal(income.values.net_margin_percent,10);assert.equal(income.values.source_monetary_scale,'NOT_EXPLICIT_IN_API_ROW_NO_SCALED_AMOUNT_CLAIMS');assert(!('revenue' in income.values));
 const otc=r.inputs.find(s=>s.symbol==='3081').facts.find(f=>f.kind==='EPS_AS_REPORTED');assert.equal(otc.source,DAILY_AI_FINANCIAL_URLS.TPEX_EPS);assert.equal(otc.values.value,1.23);assert(r.gapsBySymbol['3081'].includes('TPEX_EPS_UNIT_YUAN_MAPPED_FROM_OFFICIAL_DATASET20757_COLUMN_NO_CURRENCY_REINFERENCE'));
 for(const added of r.proof.additions){const f=r.inputs.find(s=>s.symbol===added.symbol).facts.find(f=>f.id===added.fact_id),{id,evidence_hash,...body}=f;assert.equal(added.body_text,canonical(body));assert.equal(evidence_hash,sha(added.body_text));assert.equal(f.source_locator.row_sha256,sha(added.row_text));assert.deepEqual(JSON.parse(added.row_text),JSON.parse(r.proof.responses.find(p=>p.source===f.source).response_text).find(row=>String(row['公司代號']??row.SecuritiesCompanyCode)===added.symbol));assert.equal(f.published_at,null);assert.equal(f.available_at,clock());assert.equal(f.first_seen_at,clock());assert.equal(f.as_of,clock());assert.equal(f.member_publication_approved,false);}
 assert.deepEqual(original,inputs());assert(r.inputs.every(s=>JSON.stringify(s.bars)===JSON.stringify(original.find(x=>x.symbol===s.symbol).bars)));
});
test('new actual quarter/export labels are dynamic but never converted into single-quarter or trailing values',async()=>{
 const r=await refreshDailyAiFinancials(options(fetcher((r,url)=>{if(url===DAILY_AI_FINANCIAL_URLS.TWSE_EPS){r.length=0;r.push(epsRow('2330',{'季別':'3','基本每股盈餘(元)':'78.76'}));}})));
 const eps=r.inputs.find(s=>s.symbol==='2330').facts.find(f=>f.kind==='EPS_AS_REPORTED');assert.equal(eps.period,'2026-Q3');assert.equal(eps.values.reported_quarter,'3');assert.equal(eps.values.value,78.76);assert.equal(eps.values.period_scope,'YEAR_115_QUARTER_3_AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_EXPLICIT');
});
test('same reported period is re-observed once, older periods keep their original facts, and endpoint failure preserves unrestricted receipts',async()=>{
 const first=await refreshDailyAiFinancials(options(fetcher()));const before=first.inputs.find(s=>s.symbol==='2330').facts.find(f=>f.kind==='EPS_AS_REPORTED');
 const second=await refreshDailyAiFinancials(options(fetcher(),{inputs:first.inputs,clock:()=> '2026-10-31T08:01:00Z'}));
 const eps=second.inputs.find(s=>s.symbol==='2330').facts.filter(f=>f.kind==='EPS_AS_REPORTED');assert.equal(eps.length,1);assert.notEqual(eps[0].id,before.id);assert.equal(eps[0].values.value,before.values.value);assert(second.removed.some(f=>f.id===before.id&&f.reason==='OFFICIAL_API_SAME_REPORTED_PERIOD_SUPERSEDED_BY_NEW_RECEIPT'));
 const third=await refreshDailyAiFinancials(options(fetcher((r,url)=>{if(url===DAILY_AI_FINANCIAL_URLS.TWSE_EPS)for(const x of r)x['季別']='3';}),{inputs:second.inputs}));
 assert.equal(third.inputs.find(s=>s.symbol==='2330').facts.filter(f=>f.kind==='EPS_AS_REPORTED').length,2);
 const failed=await refreshDailyAiFinancials(options(async()=>new Response('provider prose',{status:403}),{inputs:second.inputs}));assert.deepEqual(failed.inputs.find(s=>s.symbol==='2330').facts,second.inputs.find(s=>s.symbol==='2330').facts);assert(!JSON.stringify(failed).includes('provider prose'));
});
test('all endpoint failures still remove restricted sources and cannot create EPS or fresh timestamps for old facts',async()=>{
 const before=inputs(),r=await refreshDailyAiFinancials(options(async()=>new Response('not available',{status:503}),{inputs:before}));assert.equal(r.proof.additions.length,0);assert.equal(r.removed.length,3);
 for(const s of r.inputs){assert.deepEqual(s.facts,[before.find(x=>x.symbol===s.symbol).facts[0]]);assert(r.gapsBySymbol[s.symbol].includes('NO_MATCHING_COMPANY_EPS_ROW_IN_ACTUAL_OPEN_API_RESPONSE'));}
 assert(r.proof.responses.every(p=>p.state==='UNAVAILABLE'&&p.response_text===null&&p.received_at===null&&p.source_sha256===null&&p.source_bytes===null));
 const safe=dailyAiFinancialRefreshUnavailable(before,clock());assert.equal(safe.proof.responses.length,0);assert.equal(safe.removed.length,3);assert(safe.additionalGaps.includes('FINANCIAL_REFRESH_UNAVAILABLE'));
});
test('ambiguous or future labels and invalid EPS values produce gaps rather than inferred financial amounts',async()=>{
 for(const edit of [r=>r.push(epsRow('2330')),r=>r.find(x=>x['公司代號']==='2330')['年度']='2026',r=>r.find(x=>x['公司代號']==='2330')['季別']='4',r=>r.find(x=>x['公司代號']==='2330')['出表日期']='1151101',r=>r.find(x=>x['公司代號']==='2330')['基本每股盈餘(元)']='unavailable',r=>r.find(x=>x['公司代號']==='2330')['基本每股盈餘(元)']='1e100']){
  const result=await refreshDailyAiFinancials(options(fetcher((r,url)=>{if(url===DAILY_AI_FINANCIAL_URLS.TWSE_EPS)edit(r);})));assert(!result.inputs.find(s=>s.symbol==='2330').facts.some(f=>f.kind==='EPS_AS_REPORTED'));assert(result.gapsBySymbol['2330'].some(g=>g.includes('EPS')||g.includes('INVALID')));
 }
});
test('zero/missing reported revenue never becomes a margin or a fabricated scaled amount',async()=>{
 for(const revenue of ['0','','unknown']){
  const r=await refreshDailyAiFinancials(options(fetcher((r,url)=>{if(url===DAILY_AI_FINANCIAL_URLS.TWSE_INCOME)r.find(x=>x['公司代號']==='2330')['營業收入']=revenue;})));
  assert(!r.inputs.find(s=>s.symbol==='2330').facts.some(f=>f.kind==='FINANCIAL_AS_REPORTED'));assert(r.gapsBySymbol['2330'].includes('FINANCIAL_API_SAME_UNIT_RATIOS_UNAVAILABLE'));
 }
});
test('body size/JSON schema errors are sanitized and cancelled/invalid-clock requests cannot admit receipts',async()=>{
 const r=await refreshDailyAiFinancials(options(async()=>new Response('x'.repeat(2000001))));assert.equal(r.proof.additions.length,0);
 const malformed=await refreshDailyAiFinancials(options(async()=>Response.json({message:'API unavailable'})));assert.equal(malformed.proof.additions.length,0);
 const abort=new AbortController();abort.abort();let calls=0;await assert.rejects(()=>refreshDailyAiFinancials(options(async()=>{calls++;return Response.json([]);},{signal:abort.signal})),/AI_FINANCIAL_REFRESH_ABORTED/);assert.equal(calls,0);
 let ticks=0;await assert.rejects(()=>refreshDailyAiFinancials(options(fetcher(),{clock:()=>ticks++?'2026-10-31T01:00:00Z':clock()})),/AI_FINANCIAL_REFRESH_CLOCK/);
});
test('three API calls share a concurrency-two budget across the entire 72-stock universe',async()=>{
 let active=0,peak=0,calls=0;const result=await refreshDailyAiFinancials(options(async(u,i)=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));const r=await fetcher()(u,i);active--;return r;}));assert.equal(calls,3);assert.equal(peak,2);assert.equal(result.inputs.length,72);
});
test('stalled APIs expire in two six-second waves and retain an honest all-source failure projection',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;try{const pending=refreshDailyAiFinancials(options(async()=>{calls++;return new Promise(()=>{});}));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);t.mock.timers.tick(6000);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);t.mock.timers.tick(6000);const r=await pending;assert.equal(r.proof.additions.length,0);assert(r.proof.responses.every(p=>p.error==='AI_FINANCIAL_REFRESH_TIMEOUT'));assert.equal(r.removed.length,3);}finally{t.mock.timers.reset();}
});
test('retained three official API responses reproduce actual reported labels without company-site relicensing',async t=>{
 if(!process.env.MA_FINANCIAL_PRIMARY_DIR){t.skip('Primary API body directory was not supplied');return;}
 const {readFileSync}=await import('node:fs'),names={[DAILY_AI_FINANCIAL_URLS.TWSE_EPS]:'eps-api.json',[DAILY_AI_FINANCIAL_URLS.TWSE_INCOME]:'income-api.json',[DAILY_AI_FINANCIAL_URLS.TPEX_EPS]:'eps-tpex.json'};
 const r=await refreshDailyAiFinancials(options(async u=>new Response(readFileSync(process.env.MA_FINANCIAL_PRIMARY_DIR+'/'+names[u]))));
 const eps=r.inputs.find(s=>s.symbol==='2330').facts.find(f=>f.kind==='EPS_AS_REPORTED');assert.equal(eps.values.value,49.33);assert.equal(eps.period,'2026-Q2');assert.equal(eps.values.period_basis,'AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_INFERRED');assert.equal(r.receipts.length,3);assert(!r.inputs.some(s=>s.facts.some(f=>isRestrictedDailyAiFinancialSource(f.source))));
});
