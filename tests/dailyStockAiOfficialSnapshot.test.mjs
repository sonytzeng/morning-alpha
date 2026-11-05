import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDailyAiOfficialNews,DAILY_AI_OFFICIAL_NEWS_URLS} from '../research/daily-ai-official-news.ts';
import {parseDailyAiSourceSnapshot} from '../supabase/functions/daily-stock-analysis-v1/intake.ts';
import {canonical} from '../research/daily-ai-seed.ts';

const cutoff='2026-10-31T03:00:01.654321Z',received='2026-10-31T03:00:00.123456Z',old='2026-10-29T12:00:00Z';
const digest=async text=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
const inputs=()=>Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司'+i,cutoff,through:'2026-10-30',next_session:'2026-11-02',
 v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},expected_sessions:[],bars:[],facts:[]}));
const policyGaps=['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','FINANCIAL_RETAINED_OBSERVATIONS_MAY_BE_STALE','INSTITUTIONAL_FLOW_NOT_REFRESHED',
 'CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY','NEWS_SOURCE_POLICY_GNEWS_EXCLUDED','OFFICIAL_NEWS_FIXED_FEEDS_NOT_ALL_COMPANY_OR_MARKET_NEWS',
 'MOPS_PUBLICATION_TIMEZONE_UNDECLARED_RECEIPT_BASIS_ONLY','OFFICIAL_NEWS_EXCERPT_NOT_FULL_DISCLOSURE','FED_RSS_NOT_EQUITY_CLOSE_OR_COMPLETE_MACRO_COVERAGE',
 'OFFICIAL_NEWS_SNAPSHOT_COMPANY_LIMIT_12_GLOBAL_LIMIT_4','NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES','MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE'];
function snapshot(news){return {schema:'DAILY_AI_INTAKE_SOURCE_V1',state:'SOURCED',intake_id:'11111111-1111-4111-8111-111111111111',
 lease:'22222222-2222-4222-8222-222222222222',source_id:'33333333-3333-4333-8333-333333333333',source_kind:'VNEXT_ACQUIRED',
 snapshot_hash:'a'.repeat(64),source_revision:'b'.repeat(64),projection:'DAILY_AI_RETAINED_INPUT_PROJECTION_V1',source_cutoff:old,source_business_date:'2026-10-29',
 business_date:'2026-10-31',cutoff,inputs:inputs(),news,market:[],source_issues:[],intake_gaps:[...policyGaps,...(!news.length?['NEWS_NONE_AVAILABLE_WITHIN_48H']:[])],member_published:false};}
async function officialNews(){
 const row={'出表日期':'1151031','公司代號':'1000','公司名稱':'測試公司0','主旨 ':'董事會決議','發言日期':'1151030','發言時間':'180000','說明':'公司公告內容','事實發生日':'1151030'};
 const feed='<rss version="2.0"><channel><item><title>Federal Reserve Board announces action</title><link>https://www.federalreserve.gov/newsevents/pressreleases/orders20261030a.htm</link><description>Board order on a banking application.</description><pubDate>Fri, 30 Oct 2026 20:00:00 GMT</pubDate></item></channel></rss>';
 return collectDailyAiOfficialNews({inputs:inputs(),businessDate:'2026-10-31',clock:()=>received,signal:new AbortController().signal,fetcher:async url=>{
  if(String(url)===DAILY_AI_OFFICIAL_NEWS_URLS.TWSE)return Response.json([row]);
  if(String(url)===DAILY_AI_OFFICIAL_NEWS_URLS.TPEX)return Response.json([]);
  assert.equal(String(url),DAILY_AI_OFFICIAL_NEWS_URLS.FED);return new Response(feed);
 }});
}
test('corrected official snapshots preserve unknown MOPS publication and actual Fed publication with original fetch receipts',async()=>{
 const captured=await officialNews();assert.equal(captured.complete,true);assert.equal(captured.news.length,2);
 const original=snapshot(captured.news),before=structuredClone(original),parsed=await parseDailyAiSourceSnapshot(original,cutoff,new AbortController().signal,'INTAKE');
 assert.deepEqual(parsed.news,captured.news);assert.deepEqual(original,before);
 const mops=parsed.news.find(n=>n.symbol==='1000'),fed=parsed.news.find(n=>n.symbol===null);
 assert.equal(mops.published_at,null);assert.equal(mops.time_basis,'OBSERVED_AFTER_RECEIPT');
 assert.equal(fed.published_at,'2026-10-30T20:00:00.000Z');assert.equal(fed.time_basis,'PUBLISHED');
 for(const n of parsed.news){assert.equal(n.available_at,received);assert.equal(n.first_seen_at,received);assert.equal(n.as_of,received);assert.notEqual(n.available_at,cutoff);}
 assert(!parsed.additionalGaps.includes('NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS'));
});
test('source policy, actual content hashes, company code, source dates and source hosts remain strict',async()=>{
 const captured=await officialNews(),mops=captured.news.find(n=>n.symbol==='1000');
 for(const change of [
  n=>{n.available_at='2026-11-01T00:00:00Z';},
  n=>{n.published_at=received;n.time_basis='PUBLISHED';},
  n=>{n.evidence_hash='f'.repeat(64);},
  n=>{n.source='https://money.udn.com/money/story/000/000';},
  n=>{const c=JSON.parse(n.content);c.source_metadata.company_code='1001';n.content=canonical(c);},
  n=>{const c=JSON.parse(n.content);c.source_metadata.spoken_date_coordinate='2026-10-31';n.content=canonical(c);},
  n=>{const c=JSON.parse(n.content);c.provider='GNEWS';n.content=canonical(c);},
 ]){
  const n=structuredClone(mops);change(n);await assert.rejects(()=>parseDailyAiSourceSnapshot(snapshot([n]),cutoff,new AbortController().signal,'INTAKE'),/AI_INTAKE_/);
 }
 const missing=snapshot(captured.news);missing.intake_gaps=missing.intake_gaps.filter(g=>g!=='OFFICIAL_NEWS_EXCERPT_NOT_FULL_DISCLOSURE');
 await assert.rejects(()=>parseDailyAiSourceSnapshot(missing,cutoff,new AbortController().signal,'INTAKE'),/AI_INTAKE_HANDOFF_INVALID/);
});
async function ownNews(captureMethod='RAW_HTTP_VERIFIED_FACT_CAPTURE'){
 const original_content={schema:'BOUNDED_OWN_FACTS_V1',facts:['公司公告將於十一月舉行法說會，尚無會議結果']},original_content_text=JSON.stringify(original_content);
 const content=canonical({schema:'DAILY_AI_RETAINED_OWN_NEWS_FACT_V1',classification:'REPORTED_CLAIM',scope:'RETAINED_BACKGROUND_NOT_FRESH_SOURCE_CAPTURE',
  capture_method:captureMethod,original_evidence_id:'retained-esmt-test',original_evidence_hash:'c'.repeat(64),
  original_content_hash:await digest(original_content_text),original_content,original_content_text,
  original_published_at:'2026-10-27T02:00:00Z',original_available_at:'2026-10-28T03:00:00Z',original_first_seen_at:'2026-10-28T03:00:00Z',
  verification_document_hash:'d'.repeat(64),reviewer_ref:'synthetic-independent-review',reviewed_at:received,source_document_sha256:'e'.repeat(64),provenance_document_sha256:'f'.repeat(64),
  verification_method:'SYNTHETIC_RETAINED_FACT_PROOF_FOR_TEST',verification_limits:['背景紀錄，不是新抓新聞'],verification_urls:['https://www.esmt.com.tw/en/press-room/2026102703']});
 const evidence_hash=await digest(content);
 return {id:'retained-own-news:'+evidence_hash,symbol:'1000',kind:'NEWS',source:'https://www.esmt.com.tw/en/press-room/2026102703',published_at:'2026-10-27T02:00:00Z',
  available_at:'2026-10-28T03:00:00Z',first_seen_at:'2026-10-28T03:00:00Z',as_of:'2026-10-28T03:00:00Z',time_basis:'PUBLISHED',evidence_hash,content};
}
test('verified retained own facts are explicitly background with their older original clocks',async()=>{
 const news=await ownNews(),original=snapshot([news]);original.intake_gaps.push('OWN_FACTS_RETAINED_BACKGROUND_NOT_FRESH_NEWS');
 const parsed=await parseDailyAiSourceSnapshot(original,cutoff,new AbortController().signal,'INTAKE');assert.deepEqual(parsed.news,[news]);
 for(const mutate of [
  c=>{c.scope='FRESH_NEWS';},c=>{c.reviewed_at='2026-11-01T00:00:00Z';},c=>{c.original_available_at=received;},
  c=>{c.original_content_hash='a'.repeat(64);},c=>{c.original_content={facts:['改寫原始內容']};},c=>{c.unreviewed_extra='不允許任意新增欄位';},
 ]){
  const bad=structuredClone(original),c=JSON.parse(bad.news[0].content);mutate(c);bad.news[0].content=canonical(c);
  bad.news[0].evidence_hash=await digest(bad.news[0].content);bad.news[0].id='retained-own-news:'+bad.news[0].evidence_hash;
  await assert.rejects(()=>parseDailyAiSourceSnapshot(bad,cutoff,new AbortController().signal,'INTAKE'),/AI_INTAKE_NEWS_CONTENT/);
 }
 const missing=structuredClone(original);missing.intake_gaps=missing.intake_gaps.filter(g=>g!=='OWN_FACTS_RETAINED_BACKGROUND_NOT_FRESH_NEWS');
 await assert.rejects(()=>parseDailyAiSourceSnapshot(missing,cutoff,new AbortController().signal,'INTAKE'),/AI_INTAKE_NEWS_CONTENT/);
});
test('independent web-tool fact verification preserves row-specific methods and limits without claiming a direct page capture',async()=>{
 const news=await ownNews('INDEPENDENT_WEB_TOOL_FACT_VERIFICATION'),original=snapshot([news]);original.intake_gaps.push('OWN_FACTS_RETAINED_BACKGROUND_NOT_FRESH_NEWS');
 const parsed=await parseDailyAiSourceSnapshot(original,cutoff,new AbortController().signal,'INTAKE');
 assert.deepEqual(parsed.news,[news]);
 const before=JSON.parse(news.content),after=JSON.parse(parsed.news[0].content);
 assert.equal(after.capture_method,'INDEPENDENT_WEB_TOOL_FACT_VERIFICATION');assert.equal(after.verification_method,before.verification_method);
 assert.deepEqual(after.verification_limits,before.verification_limits);assert.deepEqual(after.verification_urls,before.verification_urls);
 const obsolete=structuredClone(original),c=JSON.parse(obsolete.news[0].content);c.capture_method='WEB_TOOL_DIRECT_OPEN_FACT_CAPTURE';
 obsolete.news[0].content=canonical(c);obsolete.news[0].evidence_hash=await digest(obsolete.news[0].content);obsolete.news[0].id='retained-own-news:'+obsolete.news[0].evidence_hash;
 await assert.rejects(()=>parseDailyAiSourceSnapshot(obsolete,cutoff,new AbortController().signal,'INTAKE'),/AI_INTAKE_NEWS_CONTENT/);
});
