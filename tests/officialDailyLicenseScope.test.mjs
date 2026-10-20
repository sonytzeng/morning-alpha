// Synthetic boundary controls over an actual-source licensing catalog; not a
// source grant, independent financial review or real member identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OPEN_RESOURCES,CURRENT_DAILY_OPEN_RESOURCES,CURRENT_DAILY_LICENSE_REVIEWED_AT,LICENSE_REVIEWED_AT,sourceScope} from '../src/features/vnext/publicationClearance.ts';
import {inspectPublication,appendOwnerDecision} from '../src/features/vnext/publicationAdmission.ts';

test('the original seven dated records remain intact; new exact resources have their actual later review date',()=>{
 assert.equal(OPEN_RESOURCES.length,7);
 assert(OPEN_RESOURCES.every(r=>r.reviewed_at===LICENSE_REVIEWED_AT));
 assert.equal(CURRENT_DAILY_OPEN_RESOURCES.length,3);
 assert.deepEqual(CURRENT_DAILY_OPEN_RESOURCES.map(r=>r.source_id),['DATA_GOV_TW_11370','DATA_GOV_TW_11371','DATA_GOV_TW_11555']);
 assert(Date.parse(CURRENT_DAILY_LICENSE_REVIEWED_AT)>Date.parse(LICENSE_REVIEWED_AT));
 for(const r of CURRENT_DAILY_OPEN_RESOURCES){
  const s=sourceScope(r.resource);assert.equal(s.reviewed_at,CURRENT_DAILY_LICENSE_REVIEWED_AT);
  assert.equal(s.review_status,'EXACT_OPEN_RESOURCE_VERIFIED');assert.equal(s.license_type,'OPEN_GOVERNMENT_DATA_LICENSE_1');
  assert.equal(s.attribution_required,true);assert.equal(s.confers_publication_approval,false);
  assert.equal(s.free_usage,'CONDITIONAL_ON_LICENSE_COMPLIANCE');assert.equal(s.premium_usage,'CONDITIONAL_ON_LICENSE_COMPLIANCE');
 }
});

test('different queries, OpenAPI mirrors, historical dates and lookalike hosts do not inherit an exact CSV license',()=>{
 const original=CURRENT_DAILY_OPEN_RESOURCES[0].resource;
 for(const url of [original+'&d=115/10/20',original.replace('https:','http:'),original.replace('www.tpex.org.tw','www.tpex.org.tw.evil.example'),
  'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
  'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX',
  'https://www.twse.com.tw/exchangeReport/STOCK_DAY?date=20261001&stockNo=2330&response=json']){
  const s=sourceScope(url);assert.equal(s.review_status,'LICENSING_PENDING');assert.equal(s.confers_publication_approval,false);
 }
});

test('licensing does not conflate the two different TPEx trading-session resources',()=>{
 const [all,no1430]=CURRENT_DAILY_OPEN_RESOURCES;
 assert.notEqual(all.resource,no1430.resource);assert.notEqual(all.source_id,no1430.source_id);
 assert.match(all.dataset,/鉅額/);assert.match(no1430.dataset,/不含定價/);
 assert.equal(sourceScope(all.resource.toLowerCase()).review_status,'LICENSING_PENDING','case-changed path is not silently proven identical');
});

test('a known OGL catalog entry cannot replace the independent registry or enable Owner/member publication',async()=>{
 const source=CURRENT_DAILY_OPEN_RESOURCES[0].resource,cutoff='2026-10-21T01:00:00Z',reviewed='2026-10-21T01:30:00Z',now='2026-10-21T02:00:00Z';
 const e={id:'synthetic-only-fact',symbol:'9999',kind:'RESEARCH_INPUT',source,evidence_hash:'a'.repeat(64),
  published_at:'2026-10-20T06:00:00Z',first_seen_at:cutoff,available_at:cutoff,as_of:'2026-10-20T06:00:00Z'};
 const card={symbol:'9999',horizon:'SHORT',review_hash:'b'.repeat(64),research_hash:'c'.repeat(64),reviewed_at:reviewed,next_review_at:'2026-10-22T01:00:00Z',
  cutoff,research_version:'SYNTHETIC_ENGINE',research_state:'QUALIFIED',classification:'HISTORICAL_RESEARCH_NOT_RECOMMENDATION',
  reason:'合成協定控制，不是真實股票研究',confirmation:'下一交易日資料確認至少符合原先完整條件才考慮，並不是買進建議。',
  invalidation:'下一交易日資料或研究條件失效時立即停止觀察並取消，不得持續沿用原判斷。',
  evidence:[e],supporting:[{kind:'FACT',text:'合成測試來源',evidence_ids:[e.id]}],opposing:[{kind:'UNKNOWN',text:'尚未完成獨立審核',evidence_ids:[]}],financial:[],events:[]};
 const admission=await inspectPublication(card,{sources:[e],independent:[],grants:[]},now);
 assert.equal(sourceScope(source).review_status,'EXACT_OPEN_RESOURCE_VERIFIED');
 assert.equal(admission.license_valid,false);assert.equal(admission.owner_approval_ready,false);
 assert.equal(admission.matrix.find(r=>r.key==='ANALYSIS_COMMERCIAL_RIGHTS').state,'UNVERIFIED');
 await assert.rejects(()=>appendOwnerDecision(card,admission,[],{action:'APPROVE',reason:'SYNTHETIC ONLY',key:'synthetic-ogl-control-0001'},
  {verified:true,ref:'SYNTHETIC_OWNER'},now),/PREREQUISITES/);
});
