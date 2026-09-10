// Isolated read/payload tests only: no external request, outbox or notification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluatePremiumContentGate } from '../supabase/functions/_shared/premium-content-gate.ts';
import { fetchPublishedDeliveryEvidence as readMarketPublicationEvidence, isPublishedDeliveryEligible as validateMarketPublicationDelivery, evaluatePublishedMarketDelivery } from '../supabase/functions/_shared/market-publication-contract.ts';
import { assembleCanonicalMarketResearch } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { buildLineDailyFlexMessage } from '../supabase/functions/_shared/line-daily-flex-message.mjs';

const record = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
const entries = ['line-daily-push','daily-delivery-orchestrator'].map(name => {
  const source=read(`supabase/functions/${name}/index.ts`);
  const dependencies={readMarketPublicationEvidence,validateMarketPublicationDelivery};
  return {name,source,fetch:isolatedFunction(source,'fetchPublishedDeliveryEvidence',dependencies),eligible:isolatedFunction(source,'isPublishedDeliveryEligible',dependencies)};
});
function fixture() {
  const input=isolatedFunction(read('supabase/functions/generate-daily-report-v7/research-master-v2.test.ts'),'completeFixture')();
  input.reportDate='2026-09-08';input.todayDate=input.reportDate;input.generatedAt='2026-09-08T00:01:00.000Z';input.dataAsOf='2026-09-08T00:00:00.000Z';
  // The real sector context carries the prior date, not a relabeled news timestamp.
  for(const row of input.evidenceIndex)row.published_at=row.source==='sector_rotation_scores'?'2026-09-07':'2026-09-07T22:00:00.000Z';
  const ai=input.legacy,sentence='SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
  Object.assign(ai,{today_quote:sentence,v8_daily_sentence:{sentence},free_summary:{one_sentence:sentence},today_beneficiary_stocks_v10:[],today_beneficiary_stocks:[],
    v10_beneficiary_enabled:true,v10_data_quality_status:'insufficient_positive_evidence',data_quality:'complete',missing_sources:[],member_value_score:0,
    content_evidence_quality:{contract_version:'PREMIUM_EVIDENCE_V1',verified_market_count:3,verified_news_count:1,blank_market_change_count:0,all_news_traceable:true}});
  ai.member_research_note_v2.today_core_thesis=sentence;
  const master=assembleCanonicalMarketResearch(input);ai.research_master_v2=master;
  const gate=evaluateMarketReportGate(ai,input.reportDate);assert.equal(gate.eligible,true,JSON.stringify(gate));assert.equal(gate.recommendation_gate.status,'BLOCKED');
  const report={id:'synthetic-report',report_date:input.reportDate,ai_strategy_json:ai};
  const snapshot={id:'synthetic-intraday',report_id:report.id,report_date:report.report_date,version:8,is_current:false,session_type:'INTRADAY',
    decision_mode:'market_only',action:'WAIT',status:'READY',market_regime:'中性觀察',content_score:gate.content_score,coverage_score:100,source_refs:canonicalMarketSourceRefs(ai),
    generated_text:{daily_sentence:sentence,recommendations:[],market_report_gate:gate,next_checkpoint:'13:00 盤中確認'}};
  const contract={snapshot_id:snapshot.id,snapshot_version:8,report_date:report.report_date,decision_mode:'market_only',action:'WAIT',primary_symbols:[],market_report_gate:gate};
  const member={id:'synthetic-member',report_id:report.id,report_date:report.report_date,decision_snapshot_id:snapshot.id,decision_snapshot_version:8,revision:8,
    status:'PASSED',semantic_status:'PASSED',semantic_reason_codes:[],canonical_contract:contract,
    member_content:{canonical_contract:contract,beneficiary_candidates:[],representative_stocks:[]},
    semantic_coherence_reviews:[{status:'PASSED',reason_codes:[],canonical_snapshot_id:snapshot.id,canonical_snapshot_version:8,checked_at:'2026-09-08T03:00:00Z'}]};
  ai.revision_id=snapshot.id;ai.canonical_member_revision_id=member.id;ai.market_report_gate=gate;
  return {report,snapshot,member,gate};
}
function database(f,trace=[]) {
  const tables={reports:[f.report],decision_snapshots:[f.snapshot,{...f.snapshot,id:'newer-private-qa',session_type:'PREMARKET',is_current:true,status:'PARTIAL',version:99}],
    member_content_revisions:f.member?[f.member]:[],current_member_content_revisions_v1:f.member?[f.member]:[]};
  return {from(table){const filters=[];const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},limit(){return q;},
    async maybeSingle(){trace.push({table,filters});return {error:null,data:(tables[table]||[]).find(row=>filters.every(([k,v])=>row[k]===v))||null};}};return q;}};
}

for(const edge of entries) {
  test(`${edge.name}: pinned INTRADAY and matching semantic member beat newer internal QA`,async()=>{
    const f=fixture(),trace=[];const result=await edge.fetch(database(f,trace),f.report);
    assert.equal(result.snapshot.id,f.snapshot.id);assert.equal(result.member.id,f.member.id);assert.equal(result.member.semantic_status,'PASSED');
    assert.equal(edge.eligible(f.report,result.snapshot,result.member,evaluateMarketReportGate(f.report.ai_strategy_json,f.report.report_date)),true);
    assert.ok(trace[0].filters.some(([k,v])=>k==='id'&&v===f.snapshot.id));assert.ok(!trace[0].filters.some(([k])=>k==='session_type'));
    f.report.ai_strategy_json.revision_id='missing';assert.equal((await edge.fetch(database(f),f.report)).snapshot,null);
    f.report.ai_strategy_json.revision_id=f.snapshot.id;delete f.report.ai_strategy_json.canonical_member_revision_id;
    assert.equal((await edge.fetch(database(f),f.report)).member,null,'No fabricated or fallback member for missing published member pointer');
  });
  test(`${edge.name}: market-only refuses stale identity, stock injection, score/coverage/source and semantic failure`,async()=>{
    const base=fixture();
    const mutations=[f=>{f.snapshot.content_score=89;},f=>{f.snapshot.coverage_score=99;},f=>{f.snapshot.source_refs=[];},
      f=>{f.snapshot.action='SELECTIVE';},f=>{f.snapshot.report_date='2026-09-06';},f=>{f.snapshot.generated_text.recommendations=[{symbol:'SYNTHETIC'}];},
      f=>{f.member.member_content.representative_stocks=[{symbol:'SYNTHETIC'}];},f=>{f.member.semantic_reason_codes=null;},
      f=>{f.member.semantic_status='BLOCKED';},f=>{f.member.decision_snapshot_id='other';},f=>{f.member=null;},
      f=>{f.report.ai_strategy_json.market_report_gate={...f.gate,eligible:false};},f=>{f.snapshot.generated_text.opportunity_score=75;}];
    for(const mutate of mutations){const f=globalThis.structuredClone(base);mutate(f);assert.equal(edge.eligible(f.report,f.snapshot,f.member,evaluateMarketReportGate(f.report.ai_strategy_json,f.report.report_date)),false);}
    const f=fixture();f.member.semantic_coherence_reviews[0].canonical_snapshot_id='unrelated';
    const queried=await edge.fetch(database(f),f.report);assert.equal(queried.member.semantic_status,null);
    assert.equal(edge.eligible(f.report,queried.snapshot,queried.member,f.gate),false);
  });
  test(`${edge.name}: existing recommendation/no_trade modes keep 90 and matching member semantic requirements`,()=>{
    for(const mode of ['recommendations','no_trade']){
      const f=fixture();f.snapshot.decision_mode=mode;
      // Current stock admission only controls recommendation projection. The
      // exact legacy publication still retains its 90/PASSED proof boundary.
      const gate=mode==='recommendations'?{...f.gate,recommendation_gate:{...f.gate.recommendation_gate,eligible:true,status:'QUALIFIED'}}:f.gate;
      assert.equal(edge.eligible(f.report,f.snapshot,f.member,gate),true);
      if(mode==='recommendations'){
        const delivery=evaluatePublishedMarketDelivery(f.report,f.snapshot,f.member,f.gate);
        assert.equal(delivery.eligible,true);
        assert.equal(delivery.projection.recommendation.available,false);
        assert.deepEqual(delivery.projection.recommendation.items,[]);
      }
      f.snapshot.content_score=89;assert.equal(edge.eligible(f.report,f.snapshot,f.member,f.gate),false);
    }
  });
}

test('actual orchestrator state treats valid market publication independently of stock/Premium eligibility',async()=>{
  const edge=entries[1],f=fixture();
  const load=isolatedFunction(edge.source,'loadDeliveryState',{asRecord:record,asStringArray:v=>Array.isArray(v)?v.map(String):[],evaluateMarketReportGate,evaluatePremiumContentGate,
    fetchPublishedDeliveryEvidence:edge.fetch,isPublishedDeliveryEligible:edge.eligible,evaluatePublishedMarketDelivery});
  const state=await load(database(f),f.report.report_date);assert.equal(state.report_eligible,true);assert.equal(state.premium_eligible,false);
  f.member=null;assert.equal((await load(database(f),f.report.report_date)).report_eligible,false);
});

test('LINE market-only payload does not reuse private recommendation aliases or imply no-qualified universe',()=>{
  const source=entries[0].source,functions={};
  const names=['parseRecord','parseAiStrategy','firstText','firstArrayText','clipLine','inferOpportunity','buildLineMessage'];
  const deps={evaluatePremiumContentGate,buildLineDailyFlexMessage,Date,Intl,...Object.fromEntries(names.map(name=>[name,(...args)=>functions[name](...args)]))};
  for(const name of names)functions[name]=isolatedFunction(source,name,deps);
  const f=fixture();f.report.ai_strategy_json.line_push_copy={opportunity:'SYNTHETIC_PRIVATE_STOCK',do_not_do:'SYNTHETIC_PRIVATE_STOCK',risk:'SYNTHETIC_PRIVATE_STOCK'};
  const delivery=evaluatePublishedMarketDelivery(f.report,f.snapshot,f.member,f.gate);
  const message=functions.buildLineMessage(delivery,'https://example.invalid');
  const rendered=JSON.stringify(message);assert.equal(message.type,'flex');
  assert.match(rendered,/推薦評估證據不足，今日暫不發布正式個股推薦/);
  assert.match(rendered,new RegExp(delivery.marketContent.confirmation));assert.doesNotMatch(rendered,/SYNTHETIC_PRIVATE_STOCK|無強受惠股|NO_QUALIFIED_OPPORTUNITY|待驗證\/100|5 檔排序/);
});

test('verified Production v59 recommendation/no_trade Flex output is preserved byte-for-byte',()=>{
  // Expected output hashes computed from readonly deployed v59 helper, not this
  // candidate. Only the new market_only branch may alter renderer output.
  const hashes={recommendations:'90c4e99485f1c2d3789116658c4ab51d3f85115ca2d7c46052af98e7e1bf6ecd',
    no_trade:'bacaebaa81baf8759513cd2cdfc8ce0a82b9e7df56655c9ab1c2c5d40d112779'};
  for(const mode of Object.keys(hashes)){
    const input={reportDate:'2026-09-08',bias:'中性觀察',todayLine:'合成測試：盤前假設仍須由量價證據確認。',
      opportunity:'半導體量價同步',risk:'市場廣度反向',avoid:'不追開盤急漲',decisionMode:mode,
      recommendations:mode==='recommendations'?[{symbol:'2330',name:'台積電',sector:'半導體',validation_signal:'量價同步',invalidation_condition:'量價背離'}]:[],siteUrl:'https://example.invalid'};
    assert.equal(createHash('sha256').update(JSON.stringify(buildLineDailyFlexMessage(input))).digest('hex'),hashes[mode]);
  }
});

test('market-only Flex renderer independently drops any supplied stocks and never claims five rankings',()=>{
  const rendered=JSON.stringify(buildLineDailyFlexMessage({reportDate:'2026-09-08',decisionMode:'market_only',
    todayLine:'合成市場判斷',recommendations:[{symbol:'INJECTED-STOCK',name:'INJECTED-STOCK'}],siteUrl:'https://example.invalid'}));
  assert.match(rendered,/推薦評估證據不足，今日暫不發布正式個股推薦/);
  assert.match(rendered,/完整市場證據與盤中驗證/);
  assert.doesNotMatch(rendered,/INJECTED-STOCK|5 檔排序|先看 1 檔|查看今日 1 檔/);
});

test('actual LINE outbox orchestration preserves v59 Flex altText preview and legacy text fallback without I/O',async()=>{
  const source=entries[0].source;
  const firstText=isolatedFunction(source,'firstText');
  const cases=[
    {message:{type:'flex',altText:'合成 Flex 摘要',text:'不得優先使用此文字',contents:{}},preview:'合成 Flex 摘要'},
    {message:{type:'text',text:'合成舊版文字摘要'},preview:'合成舊版文字摘要'},
    {message:{type:'flex',altText:'摘'.repeat(210),contents:{}},preview:'摘'.repeat(200)},
  ];
  for(const {message,preview} of cases){
    const enqueued=[],transmitted=[];
    const subscriber={id:'synthetic-subscriber',line_user_id:'synthetic-line-id'};
    let claims=0;
    const noIo=new Proxy({}, {get(){throw new Error('Unexpected database or network access');}});
    const deliver=isolatedFunction(source,'deliverOutboxMessage',{
      firstText,
      fetchActiveSubscribers:async()=>[subscriber],
      fetchAlreadySentIds:async()=>new Set(),
      reconcileAlreadySentOutbox:async()=>{},
      enqueueDeliveryOutbox:async args=>{enqueued.push(args);},
      claimDeliveryOutbox:async()=>claims++===0?[subscriber]:[],
      sendMulticastBatches:async args=>{transmitted.push(args);return {sentCount:1,failedCount:0,pendingCount:0};},
    });
    const result=await deliver({supabase:noIo,channelAccessToken:'synthetic-not-a-token',
      reportDate:'2026-09-08',decisionSnapshotId:'synthetic-snapshot',pushType:'daily_report',message});
    assert.equal(enqueued.length,1);assert.equal(transmitted.length,1);
    assert.equal(enqueued[0].messagePreview,preview);assert.equal(transmitted[0].messagePreview,preview);
    assert.equal(enqueued[0].message,message);assert.equal(transmitted[0].message,message);
    assert.equal(result.sentCount,1);assert.equal(result.failedCount,0);assert.equal(result.pendingCount,0);
    assert.equal(claims,2,'Existing bounded drain exits after the empty claim');
  }
});
