import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {evidenceRows,IDENTITY} from './fixtures/decision-evidence-rows.mjs';
import {emptyEvidenceData} from '../supabase/functions/_shared/decision-v1-data.ts';
import {compareRecommendationV2} from '../research/recommendation-v2-shadow.ts';
import {COMPANY_EVENT_SOURCES,normalizeCompanyEvents,acquireCompanyEvents} from '../supabase/functions/_shared/recommendation-company-events.ts';
const src=COMPANY_EVENT_SOURCES[0],received='2026-09-07T01:00:00.000Z';
const announcement=symbol=>({'公司代號':symbol,'發言日期':'1150907','發言時間':'080000','主旨 ':'SYNTHETIC_OFFICIAL_SHAPE_NOT_PRODUCTION','說明':'PRIVATE_TEXT_MUST_NOT_RETAIN','Email':'PRIVATE_CONTACT','發言人':'PRIVATE_NAME'});
async function fixture(){
 const data=evidenceRows();data.flows=data.flows.filter(r=>r.symbol==='TAIEX');data.earnings=[];data.catalysts=[];data.mappings=[];
 const symbols=data.universe.map(r=>r.symbol),shares=symbols.flatMap(symbol=>['foreign','investment_trust','dealer'].map(institution_type=>({symbol,institution_type,trading_date:'2026-09-04',buy_shares:200,sell_shares:100,net_shares:100,unit:'SHARES',available_at:'2026-09-04T08:00:00Z',source_ref:'https://example.test/SYNTHETIC_SHARES'})));
 const periods=['2026-Q2','2026-Q1','2025-Q4','2025-Q3','2025-Q2'];
 const times=['2026-08-10','2026-05-10','2026-02-10','2025-11-10','2025-08-10'];
 const actuals=symbols.flatMap(symbol=>periods.map((period,i)=>({symbol,period,revenue:150-i*10,eps:5-i*.1,revenue_unit:'SYNTHETIC_TWD_THOUSANDS',eps_unit:'TWD_PER_SHARE',source_ref:'https://example.test/SYNTHETIC_ACTUAL/'+period,published_at:times[i]+'T00:00:00Z',available_at:times[i]+'T00:00:00Z'})));
 const events=await normalizeCompanyEvents(src,symbols.map(announcement),received,symbols);
 return {data,identity:IDENTITY,shares,actuals,events};
}
test('official company events whitelist fields, preserve available time, dedupe, never label bullish',async()=>{
 const rows=await normalizeCompanyEvents(src,[announcement('2330'),announcement('2330'),announcement('9999')],received,['2330']);
 assert.equal(rows.length,1);assert.equal(rows[0].available_at,received);assert.equal(rows[0].published_at,'2026-09-07T00:00:00.000Z');
 assert.equal(rows[0].bullishness,null);assert.equal(rows[0].impact_review,'REQUIRED');assert.match(rows[0].source_hash,/^[a-f0-9]{64}$/);
 assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|SYNTHETIC_OFFICIAL|說明|Email|發言人/);
 const other=await normalizeCompanyEvents(COMPANY_EVENT_SOURCES[1],[{SecuritiesCompanyCode:'2330','發言日期':'2026/09/07','發言時間':'08:00:00','主旨':'Synthetic'}],received,['2330']);assert.equal(other.length,1);
 for(const mutation of [r=>r['發言時間']='25:00:00',r=>r['發言日期']='1150931',r=>r['發言日期']='1150908',r=>r['主旨 ']='']){
  const row=announcement('2330');mutation(row);await assert.rejects(normalizeCompanyEvents(src,[row],received,['2330']));
 }
});
test('official-source fetcher performs exactly two fixed public reads with no credentials/persistence',async()=>{
 const calls=[];const result=await acquireCompanyEvents({symbols:['2330'],now:()=>received,signal:AbortSignal.timeout(1000),fetcher:async(url,init)=>{
  calls.push(url);assert.equal(init.headers,undefined);assert.equal(init.redirect,'error');return Response.json([announcement('2330')]);
 }});
 assert.deepEqual(calls,COMPANY_EVENT_SOURCES.map(s=>s.url));assert(result.every(r=>r.status==='PASS'));assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 const failed=await acquireCompanyEvents({symbols:['2330'],now:()=>received,signal:AbortSignal.timeout(1000),fetcher:async()=>new Response('SECRET_PROVIDER_ERROR',{status:500})});
 assert(failed.every(r=>r.events.length===0));assert.doesNotMatch(JSON.stringify(failed),/SECRET_PROVIDER_ERROR/);
});
test('same synthetic input: V1 BLOCKED, V2 research WATCH, never actionable READY or consensus/TWD fabrication',async()=>{
 const input=await fixture(),before=structuredClone(input),r=await compareRecommendationV2(input);
 assert.deepEqual(input,before);assert.equal(r.v1_status,'BLOCKED');assert(r.candidates.every(c=>c.v2_status==='WATCH'),JSON.stringify(r.candidates.map(c=>c.blockers)));
 assert(r.candidates.every(c=>c.flow.unit==='SHARES_NORMALIZED_PRESSURE'&&c.actual.consensus_available===false&&c.ready_candidate===false&&c.entry_evaluation==='NOT_RUN'));
 assert.equal(r.production_enabled,false);assert.equal(r.forward_enabled,false);assert.equal(r.promotion_allowed,false);assert.equal(r.forward_sample,0);
 assert.deepEqual(r.business_writes,[]);assert.deepEqual(await compareRecommendationV2(input),r);
});
test('complete alternative evidence can reject honestly, not every filled gate becomes WATCH',async()=>{
 const input=await fixture();input.shares.forEach(r=>{r.buy_shares=100;r.sell_shares=200;r.net_shares=-100;});
 const r=await compareRecommendationV2(input);assert(r.candidates.every(c=>c.v2_status==='NONE'));
});
test('V2 still rejects unknown/future/stale/unit-mixed/duplicate/missing data and no market flow proxy',async()=>{
 const mutations=[
  x=>x.shares=[],x=>x.shares[0].unit='TWD',x=>x.shares[0].net_shares=999,
  x=>x.shares.push(x.shares[0]),x=>x.shares[0].available_at='2026-09-08T00:00:00Z',
  x=>x.actuals=[],x=>x.actuals[0].revenue_unit='DIFFERENT',x=>x.actuals[0].available_at='2026-09-08T00:00:00Z',
  x=>x.actuals[0].period='2026-Q4',x=>x.events=[],x=>x.events[0].published_at='2026-09-01T00:00:00Z',
  x=>x.events[0].bullishness=true,x=>x.events[0].available_at='2026-09-08T00:00:00Z',
  x=>x.data.flows=[],x=>x.data.failures=['read_failed'],x=>x.data.quotes=[],
 ];
 for(const mutate of mutations){const input=await fixture();mutate(input);const r=await compareRecommendationV2(input);assert(r.candidates.some(c=>c.v2_status==='BLOCKED'));}
});
test('current retained Production evidence stays BLOCKED in BOTH versions; no synthetic enrichment',async()=>{
 const capsule=JSON.parse(readFileSync('tests/fixtures/recommendation-retained-20261006.json','utf8'));
 const data={...emptyEvidenceData(),...JSON.parse(gunzipSync(Buffer.from(capsule.data,'base64')))};
 const identity={report_date:'2026-10-06',today_date:'2026-10-06',generated_at:'2026-10-05T23:05:13.729Z',data_as_of:'2026-10-05T23:05:13.729Z',revision_id:'same-retained-input',is_trading_day:true};
 const r=await compareRecommendationV2({data,identity,shares:[],actuals:[],events:[]});
 assert.equal(r.candidates.length,72);assert.equal(r.v1_status,'BLOCKED');assert.equal(r.candidates.filter(c=>c.v2_status==='BLOCKED').length,72);
 assert.equal(data.earnings.length,0);assert.equal(data.flows.length,0);assert.equal(data.catalysts.length,0);assert.equal(data.mappings.length,0);
});
test('V2 has no Production activation; official factual events have only the named stock producer',()=>{
 for(const dir of readdirSync('supabase/functions',{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name!=='_shared')){
  let content;try{content=readFileSync(`supabase/functions/${dir.name}/index.ts`,'utf8');}catch{continue;}
  assert.doesNotMatch(content,/recommendation-v2-shadow/);
  if(dir.name!=='recommendation-stock-evidence-v1')assert.doesNotMatch(content,/recommendation-company-events/);
 }
 const source=readFileSync('research/recommendation-v2-shadow.ts','utf8');assert.doesNotMatch(source,/fetch\(|createClient|\.rpc\(|\.insert\(|Deno\.env|process\.env/);
});
