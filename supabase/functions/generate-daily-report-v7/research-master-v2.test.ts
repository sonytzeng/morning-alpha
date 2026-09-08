import {
  assembleResearchMasterV2,
  admitResearchRecommendations,
  type ResearchMasterV2AssemblerInput,
  validateResearchMasterV2,
} from "./research-master-v2.ts";
import { evaluateMarketReportGate, evaluateStockRecommendationGate, RECOMMENDATION_EVIDENCE_INSUFFICIENT_MESSAGE } from '../_shared/market-report-gate.ts';
import { evaluatePremiumContentGate } from '../_shared/premium-content-gate.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('same evidence identity can support different assertions without merging claims', () => {
  const fixture = completeFixture();
  fixture.evidenceIndex[0].source_fingerprint = 'one-source';
  fixture.evidenceIndex.push({ ...fixture.evidenceIndex[0], evidence_id: 'MD_OTHER', summary: 'SOX 成交量增加。' });
  fixture.marketThesis!.supporting_evidence = [{ evidence_id: 'MD001' }, { evidence_id: 'MD_OTHER' }];
  const master = assembleResearchMasterV2(fixture);
  assert(master.sections.supporting_evidence.length === 2, 'distinct claims cannot be collapsed by shared source');
});

Deno.test('same claim from independent sources merges while preserving corroboration refs', () => {
  const fixture = completeFixture();
  fixture.evidenceIndex[0].source_fingerprint = 'source-a';
  fixture.evidenceIndex.push({ ...fixture.evidenceIndex[0], evidence_id: 'MD_CORROBORATION', source: 'source-b', source_fingerprint: 'source-b' });
  fixture.marketThesis!.supporting_evidence = [{ evidence_id: 'MD001' }, { evidence_id: 'MD_CORROBORATION' }];
  const master = assembleResearchMasterV2(fixture);
  assert(master.sections.supporting_evidence.length === 1, 'corroboration is one assertion');
  assert(master.sections.supporting_evidence[0].evidence_refs.length === 2, 'both source references retained');
});

Deno.test('coverage is traceable and cannot count future criteria or unresolved evidence as supported', () => {
  const input = completeFixture();
  const master = assembleResearchMasterV2(input);
  master.sections.supporting_evidence[0].evidence_refs = ['DOES_NOT_EXIST'];
  const quality = validateResearchMasterV2(master, input).quality;
  const audit = quality.coverage_audit!;
  assert(audit.numerator < audit.denominator && quality.evidence_coverage < 100, 'unknown reference must reduce coverage');
  assert(audit.denominator === audit.claims.length, 'one denominator per audited assertion');
  assert(audit.numerator === audit.claims.filter((row) => row.supported).length, 'numerator must be reproducible');
  assert(master.sections.failure_scenario.triggers.every((row) => audit.excluded_conditional_criteria.includes(row.claim_id)), 'future invalidation is not evidence');
});

Deno.test('stock admission preserves genuine company evidence and audits unsupported candidates', () => {
  const input = completeFixture();
  input.evidenceIndex.push({ evidence_id: 'COMPANY_NEWS', evidence_type: 'market_news', title: '2330 台積電 raises revenue outlook', summary: '2330 company revenue', source: 'Company IR', freshness: 'fresh', published_at: input.generatedAt });
  const candidates = input.candidateUniverse.candidates as Record<string, unknown>[];
  candidates[0].related_evidence = [{ evidence_id: 'COMPANY_NEWS' }];
  input.legacy.today_beneficiary_stocks_v10 = [
    { symbol: '2330', name: '台積電', entry_condition: '放量確認', validation_signal: '量價同步', invalidation_condition: '反向失效' },
    { symbol: '3034', name: '聯詠', entry_condition: '放量確認', validation_signal: '量價同步', invalidation_condition: '反向失效' },
  ];
  const result = admitResearchRecommendations(input);
  assert(result.accepted.length === 1 && result.accepted[0].symbol === '2330', 'supported stock must remain');
  assert(result.rejected.length === 1 && result.rejected[0].symbol === '3034', 'unsupported company must be audited, not recommended');
  assert(result.accepted[0].confirmation_condition === '量價同步', 'confirmation alias preserves source condition');
  assert(result.accepted[0].stop_logic === '反向失效', 'stop condition is not invented');
  assert(result.accepted[0].confidence === null, 'missing confidence must not become a fake score');
  assert(result.accepted[0].data_timestamp === input.generatedAt, 'actual source timestamp retained');
  input.evidenceIndex.find((row) => row.evidence_id === 'COMPANY_NEWS')!.freshness = 'stale';
  assert(admitResearchRecommendations(input).accepted.length === 0, 'stale company evidence cannot qualify');
});

Deno.test('independent recommendation gate preserves a company with audited fresh evidence and complete reasoning', () => {
  const input = completeFixture(), ai = input.legacy;
  const companyNews = input.evidenceIndex.find(item => item.evidence_id === 'NEWS001')!;
  companyNews.title = '2330 台積電營收更新';
  companyNews.summary = '台積電 2330 營收更新，半導體主線需再由市場同步確認。';
  companyNews.source = 'Company IR';
  const candidate = (input.candidateUniverse.candidates as Record<string, unknown>[])[0];
  candidate.related_evidence = [{ evidence_id: 'NEWS001' }, { evidence_id: 'SEC001' }];
  ai.today_quote = 'SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
  ai.data_quality = 'complete'; ai.missing_sources = []; ai.v10_beneficiary_enabled = true;
  ai.content_evidence_quality = { contract_version: 'PREMIUM_EVIDENCE_V1', verified_market_count: 2, verified_news_count: 1, all_news_traceable: true, blank_market_change_count: 0 };
  ai.today_beneficiary_stocks_v10 = [{
    symbol: '2330', name: '台積電', trigger_event: companyNews.title,
    entry_condition: '09:30 台積電與台股量價同步後再確認，不在事件前先追價。',
    transmission_logic: 'SOX 與台積電營收更新支持半導體主線，再由台灣先進製程及封裝量價反應驗證。',
    taiwan_supply_chain_link: '台積電提供半導體先進製程及先進封裝，依公司營收來源與台股量價驗證。',
    validation_signal: '09:30 台積電相對加權指數維持強勢，且半導體成交比重同步上升。',
    invalidation_condition: '台積電轉弱且半導體族群沒有同步，或公司後續更新否定營收條件。',
    data_basis: 'NEWS001; https://investor.tsmc.com/; market_data:SOX',
  }];
  const admission = admitResearchRecommendations(input);
  assert(admission.accepted.length === 1, 'valid company admission remains available');
  ai.today_beneficiary_stocks_v10 = admission.accepted;
  ai.v10_analysis_debug = { evidence_index: input.evidenceIndex };
  const master = assembleResearchMasterV2(input);
  master.quality = validateResearchMasterV2(master, input).quality;
  ai.research_master_v2 = master;
  const gate = evaluateStockRecommendationGate(ai);
  assert(gate.eligible && gate.status === 'QUALIFIED', JSON.stringify(gate));
  companyNews.freshness = 'stale';
  assert(evaluateStockRecommendationGate(ai).status === 'BLOCKED', 'stale company evidence cannot remain qualified');
});

Deno.test('valid no-recommendation market report is independent of Premium note quality', () => {
  const input = completeFixture(), ai = input.legacy;
  const sentence = 'SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
  ai.today_quote = sentence; ai.v8_daily_sentence = { sentence };
  ai.free_summary = { one_sentence: sentence };
  (ai.member_research_note_v2 as Record<string, unknown>).today_core_thesis = sentence;
  ai.today_beneficiary_stocks_v10 = []; ai.v10_beneficiary_enabled = true;
  ai.v10_data_quality_status = 'insufficient_positive_evidence';
  ai.data_quality = 'complete'; ai.missing_sources = []; ai.member_value_score = 0;
  ai.content_evidence_quality = { contract_version: 'PREMIUM_EVIDENCE_V1', verified_market_count: 3, verified_news_count: 1, blank_market_change_count: 0, all_news_traceable: true };
  const master = assembleResearchMasterV2(input); master.quality = validateResearchMasterV2(master, input).quality;
  const selectedEvidence = [...input.evidenceIndex].filter(item=>item.evidence_id&&item.evidence_type!=='previous_validation').sort((a,b)=>(Number(b.importance)||0)-(Number(a.importance)||0)).slice(0,5);
  assert(JSON.stringify(master.sections.why_today_matters.evidence_refs)===JSON.stringify(selectedEvidence.map(item=>item.evidence_id)), 'every source used in the no-recommendation narrative must be cited, not replaced by unrelated thesis refs');
  ai.research_master_v2 = master;
  const gate = evaluateMarketReportGate(ai, input.reportDate);
  assert(gate.eligible, JSON.stringify(gate));
  assert(gate.status === 'READY_MARKET_ONLY', 'missing recommendation evidence is market-only, not a completed no-opportunity result');
  assert(gate.decision_mode === 'market_only', 'publication must use the explicit independently validated market-only contract');
  assert(gate.recommendation_status === 'BLOCKED', 'empty candidates do not prove a completed universe assessment');
  assert(gate.wait_reason === RECOMMENDATION_EVIDENCE_INSUFFICIENT_MESSAGE, 'subscriber receives the real recommendation gap');
  assert(!evaluatePremiumContentGate(ai, 1).eligible, 'do not relax Premium quality');
  assert(Boolean(gate.wait_reason && gate.watch_condition && gate.next_recheck_time), 'abstention must have actionable context');
  (ai.member_research_note_v2 as Record<string, unknown>).subscriber_value_sentence = '市場瞬息萬變，投資人應謹慎';
  ai.premium_content_status = 'blocked';
  ai.research_generation_audit = { source_quality: { publish_status: 'blocked' }, rejected_recommendations: [{ symbol: '3034' }] };
  assert(evaluateMarketReportGate(ai, input.reportDate).eligible, 'private QA and Premium-note failures must not replace the audited market document');
  assert(!evaluatePremiumContentGate(ai, 1).eligible, 'private Premium failure remains a failure');
  const validQuality = { ...master.quality };
  master.quality.evidence_coverage = 99;
  assert(!evaluateMarketReportGate(ai, input.reportDate).eligible, 'market-only never relaxes the 100% evidence threshold');
  master.quality = { ...validQuality, unsupported_claims: ['unsupported market claim'] };
  assert(!evaluateMarketReportGate(ai, input.reportDate).eligible, 'market-only never admits unsupported market claims');
  master.quality = validQuality;
  ai.data_quality = 'insufficient'; ai.missing_sources = ['market_data'];
  assert(!evaluateMarketReportGate(ai, input.reportDate).eligible, 'missing market data cannot be disguised as no recommendation');
});

Deno.test('recommendation absence cannot be called NO_QUALIFIED_OPPORTUNITY without a complete evidenced universe', () => {
  const input = completeFixture();
  input.legacy.today_beneficiary_stocks_v10 = [];
  input.legacy.research_master_v2 = assembleResearchMasterV2(input);
  const ai = input.legacy;
  const assessment = {
    schema_version: 'decision-evidence-v1', report_date: input.reportDate, today_date: input.todayDate,
    generated_at: input.generatedAt, revision_id: 'canonical-assessment-revision',
    action: 'NO_QUALIFIED_OPPORTUNITY', stock_opportunities: [],
    evidence_quality: 'complete', data_freshness: 'valid_at_assessment',
    evidence: [{ id: 'market_quotes:immutable-evidence' }],
    screening: { status: 'COMPLETE', universe_count: 3, evaluated_count: 3, rejected: [] },
  };
  for (const screened of [undefined, { status: 'COMPLETE' }, { status: 'COMPLETE', universe_count: 3, evaluated_count: 2, rejected: [] }, { status: 'COMPLETE', universe_count: 0, evaluated_count: 0, rejected: [] }, { status: 'INCOMPLETE', universe_count: 3, evaluated_count: 3, rejected: [] }]) {
    ai.decision_v1 = { ...assessment, screening: screened };
    const gate = evaluateStockRecommendationGate(ai);
    assert(gate.status === 'BLOCKED' && !gate.universe_evaluation_complete, 'unproven universe completion must fail closed');
    assert(gate.subscriber_message === RECOMMENDATION_EVIDENCE_INSUFFICIENT_MESSAGE, 'do not disguise missing evidence as no picks');
  }
  ai.decision_v1 = assessment;
  assert(evaluateStockRecommendationGate(ai).status === 'NO_QUALIFIED_OPPORTUNITY', 'complete same-day evidence permits an actual no-match result');
  ai.decision_v1 = { ...assessment, report_date: '2026-07-13' };
  assert(evaluateStockRecommendationGate(ai).status === 'BLOCKED', 'yesterday full evaluation cannot certify today');
  ai.decision_v1 = { ...assessment, evidence: [] };
  assert(evaluateStockRecommendationGate(ai).status === 'BLOCKED', 'a status string alone is not evidence');
});

Deno.test('Sep 7: distinct sector subjects must survive identical direction summaries', () => {
  const fixture = completeFixture();
  fixture.evidenceIndex.push(
    { evidence_id: 'SEC002', evidence_type: 'sector_rotation', title: '電子權值', summary: '轉強', raw_reference: '電子權值' },
    { evidence_id: 'SEC003', evidence_type: 'sector_rotation', title: 'AI Server', summary: '轉強', raw_reference: 'AI Server' },
  );
  fixture.marketThesis!.supporting_evidence = [{ evidence_id: 'SEC002' }, { evidence_id: 'SEC003' }];
  const master = assembleResearchMasterV2(fixture);
  assert(master.sections.supporting_evidence.length === 2, 'must retain both actual sectors');
  assert(validateResearchMasterV2(master).quality.duplicate_claims.length === 0, 'different subjects are not duplicates');
  assert(master.sections.supporting_evidence[0].statement.includes('電子權值'), 'subject must remain visible');
});

Deno.test('reposted evidence is one claim with retained lineage, not two independent confirmations', () => {
  const fixture = completeFixture();
  fixture.evidenceIndex.push({ ...fixture.evidenceIndex[0], evidence_id: 'MD_REPOST' });
  fixture.marketThesis!.supporting_evidence = [{ evidence_id: 'MD001' }, { evidence_id: 'MD_REPOST' }];
  const master = assembleResearchMasterV2(fixture);
  assert(master.sections.supporting_evidence.length === 1, 'same subject/source/time/claim must merge');
  assert(master.sections.supporting_evidence[0].evidence_refs.length === 2, 'retain both evidence references');
});

Deno.test('canonical empty recommendation set does not resurrect legacy or observation stocks', () => {
  const fixture=completeFixture();
  fixture.legacy.today_beneficiary_stocks_v10=[];
  const master=assembleResearchMasterV2(fixture);
  assert(master.sections.representative_stocks.length===0,'canonical abstention must remain authoritative');
});
Deno.test('future failure conditions remain criteria, never asserted as observed counter-evidence', () => {
  const fixture=completeFixture();
  const note=fixture.legacy.member_research_note_v2 as Record<string,unknown>;
  note.invalidation_rules=[{condition:'若台積電明日反向則停止假設',action_note:'等候新的市場證據'}];
  const master=assembleResearchMasterV2(fixture);
  assert(!master.sections.counter_evidence.some(row=>row.statement.includes('明日反向')),'a future condition is not an observed failure');
  assert(master.sections.failure_scenario.triggers.some(row=>row.condition.includes('明日反向')),'do not remove the actual failure criterion');
});

function completeFixture(): ResearchMasterV2AssemblerInput {
  return {
    reportDate: "2026-07-14",
    todayDate: "2026-07-14",
    dataAsOf: "2026-07-14T00:00:00.000Z",
    engineVersion: "V9.0_THREE_TIER_BENEFICIARY",
    promptVersion: null,
    generatedAt: "2026-07-14T00:01:00.000Z",
    reportMode: "normal_overnight",
    marketStatus: "OPEN",
    isTradingDay: true,
    evidencePack: {
      version: "V10",
      data_quality: {
        available_sources: [
          "market_data",
          "market_news",
          "sector_rotation_scores",
        ],
        missing_sources: [],
      },
    },
    normalizedEvidence: {
      market_context: {
        primary_event: "SOX 隔夜轉強",
        macro_summary: "美股半導體轉強，台股需要確認權值與族群是否同步。",
      },
      previous_validation: {
        summary: "上一交易日主線未完全擴散。",
        previous_market_bias: "震盪觀察",
      },
    },
    evidenceIndex: [
      {
        evidence_id: "MD001",
        evidence_type: "market_data",
        source: "market_data",
        title: "SOX",
        summary: "SOX 隔夜上漲，半導體風險偏好改善。",
        importance: 90,
        freshness: "fresh",
        raw_reference: "SOX",
        published_at: "2026-07-13T20:00:00Z",
      },
      {
        evidence_id: "NEWS001",
        evidence_type: "market_news",
        source: "market_news",
        title: "AI Server",
        summary: "AI Server 需求訊號延續。",
        importance: 70,
        freshness: "fresh",
        raw_reference: "AI Server",
        published_at: "2026-07-13T22:00:00Z",
      },
      {
        evidence_id: "SEC001",
        evidence_type: "sector_rotation",
        source: "sector_rotation_scores",
        title: "半導體",
        summary: "半導體輪動分數維持正向。",
        importance: 75,
        freshness: "previous_trading_day",
        raw_reference: "半導體",
        published_at: "2026-07-13",
      },
      {
        evidence_id: "MD002",
        evidence_type: "market_data",
        source: "market_data",
        title: "VIX",
        summary: "VIX 仍高，風險偏好尚未完全確認。",
        importance: 85,
        freshness: "fresh",
        raw_reference: "VIX",
        published_at: "2026-07-13T20:00:00Z",
      },
    ],
    candidateUniverse: {
      candidates: [
        {
          symbol: "2330",
          name: "台積電",
          related_evidence: [
            { evidence_id: "MD001", weight: 90, purpose: "primary_support" },
            { evidence_id: "SEC001", weight: 75, purpose: "confirming" },
          ],
        },
      ],
    },
    marketThesis: {
      primary_driver: "美股半導體風險偏好改善",
      market_story: "今天的主軸是半導體偏多假設能否由台積電與族群同步確認。",
      taiwan_transmission:
        "SOX 轉強後，台股先由台積電確認，再觀察半導體族群擴散。",
      primary_validation_axis: "確認台積電、TAIEX 與半導體族群是否同向。",
      confidence: 72,
      confidence_reason: "市場、新聞與類股輪動三類證據同時存在。",
      supporting_evidence: [
        { evidence_id: "MD001", weight: 90, purpose: "primary_support" },
        { evidence_id: "SEC001", weight: 75, purpose: "confirming" },
      ],
      counter_evidence: [{
        evidence_id: "MD002",
        weight: 85,
        purpose: "counter_evidence",
      }],
      alternative_hypotheses: [
        {
          driver: "風險偏好仍可能轉弱",
          why_rejected: "目前 SOX 與類股輪動證據較強，但 VIX 仍需盤中確認。",
          supporting_evidence: [{
            evidence_id: "MD002",
            weight: 85,
            purpose: "counter_evidence",
          }],
        },
      ],
      bear_case: "若台積電與半導體族群不同步，原主軸需要降級。",
    },
    legacy: {
      confidence_score: 72,
      market_bias: "偏多觀察",
      free_summary: {
        one_sentence: "半導體偏多假設等待台積電與族群同步確認。",
        do_not_do: "不要追價；不要把單一權值股上漲當成族群主線。",
      },
      member_research_note_v2: {
        today_core_thesis:
          "今天只看一件事：半導體偏多假設能否由台積電與族群同步確認。",
        subscriber_value_sentence: "先確認權值，再確認族群擴散。",
        data_status: "complete",
        opening_thesis: {
          summary: "今天只看一件事：半導體偏多假設能否由台積電與族群同步確認。",
          confidence_score: 72,
          signals: ["SOX", "半導體"],
        },
        core_reasoning: [
          "SOX 隔夜轉強，台股需要先確認台積電是否承接。",
          "台積電確認後，仍要看半導體族群是否擴散。",
        ],
        overnight_chain: [
          {
            event: "SOX 隔夜轉強",
            event_group: "US_SEMICONDUCTOR",
            source_market: "美股半導體",
            impact_logic: "風險偏好先反映在半導體供應鏈。",
            taiwan_mapping: "台股先由台積電與半導體族群驗證。",
            validation_points: ["確認台積電、TAIEX 與半導體族群是否同向。"],
            evidence_refs: ["MD001", "SEC001"],
          },
        ],
        beneficiary_candidates: [
          {
            stock_code: "2330",
            stock_name: "台積電",
            sector: "半導體",
            reason: "台積電是隔夜半導體訊號映射至台股的第一個確認角色。",
            validation_signal: "09:00 後確認台積電是否與 TAIEX 同向。",
            invalidation_condition: "台積電轉弱且半導體族群沒有擴散。",
            evidence: ["SOX", "半導體"],
          },
        ],
        intraday_time_windows: [
          {
            time: "08:30",
            purpose: "確認盤前研究假設。",
            what_to_watch: "確認隔夜資料是否完整。",
            bullish_confirmation: "資料與研究假設一致。",
            bearish_warning: "核心資料缺失。",
          },
          {
            time: "09:00",
            purpose: "開盤確認",
            what_to_watch: "確認台積電與 TAIEX 是否同向。",
            bullish_confirmation: "台積電與 TAIEX 同向。",
            bearish_warning: "台積電與 TAIEX 背離。",
          },
          {
            time: "11:00",
            purpose: "族群擴散確認",
            what_to_watch: "確認半導體族群是否擴散。",
            bullish_confirmation: "族群多檔同步。",
            bearish_warning: "只有台積電單點上漲。",
          },
          {
            time: "13:00",
            purpose: "午後資金確認",
            what_to_watch: "確認資金是否維持半導體方向。",
            bullish_confirmation: "資金維持同向。",
            bearish_warning: "資金轉向防禦。",
          },
          {
            time: "13:30",
            purpose: "修正研究假設",
            what_to_watch: "確認是否需要降低主軸權重。",
            bullish_confirmation: "原主軸仍成立。",
            bearish_warning: "原主軸已失效。",
          },
        ],
        intraday_validation: [
          {
            time_window: "09:00-09:30",
            what_to_watch: "確認台積電與 TAIEX 是否同向。",
            bullish_confirm: "台積電與 TAIEX 同向。",
            bearish_fail: "台積電與 TAIEX 背離。",
            neutral_condition: "開盤方向未定。",
          },
        ],
        invalidation_rules: [
          {
            condition: "VIX 轉強且台積電與半導體族群同步轉弱。",
            meaning: "原半導體偏多假設失效。",
            action_note: "終止原假設，等待下一個 Checkpoint。",
            evidence_refs: ["MD002"],
          },
        ],
        closing_feedback_plan: {
          what_to_compare: "比較台積電、TAIEX 與半導體族群收盤方向。",
          success_criteria: "台積電與族群同步且失效條件未觸發。",
          miss_reason_tracking: "若不同步，回查隔夜傳導與族群輪動。",
        },
        capital_rotation_scenarios: [
          {
            beneficiary_impact:
              "保持半導體主軸並提升完整證據股票的觀察優先級。",
            groups_to_watch: ["半導體"],
          },
        ],
        risk_scenarios: [
          { risk: "族群不同步", response: "降低半導體主軸權重。" },
        ],
        tomorrow_follow_up: {
          continuation_condition: "若收盤仍維持族群同步，保留同一研究主軸。",
        },
      },
      today_beneficiary_stocks_v10: [
        {
          symbol: "2330",
          name: "台積電",
          benefit_chain: ["SOX", "半導體", "台積電"],
        },
      ],
      v10_observation_watchlist: [],
      v8_beneficiary_chain: { status: "ready", beneficiaries: [] },
      closing_feedback_plan: {
        what_to_check_after_close: "比較台積電、TAIEX 與半導體族群收盤方向。",
      },
    },
  };
}

Deno.test("Case A: complete trading day assembles a readable shadow master", () => {
  const master = assembleResearchMasterV2(completeFixture());
  const validation = validateResearchMasterV2(master);
  assert(
    master.sections.core_thesis.status === "proposed",
    "complete fixture must propose one thesis",
  );
  assert(
    master.sections.supporting_evidence.length > 0,
    "complete fixture must map supporting evidence",
  );
  assert(
    master.sections.counter_evidence.length > 0,
    "complete fixture must map counter evidence",
  );
  assert(
    master.sections.representative_stocks.length === 1,
    "complete fixture must map one deduplicated stock",
  );
  assert(
    validation.quality.publish_status === "ready",
    `complete fixture expected ready, received ${validation.quality.publish_status}`,
  );
});

Deno.test("Case B: insufficient data never invents a thesis", () => {
  const fixture = completeFixture();
  fixture.legacy = {};
  fixture.evidencePack = {};
  fixture.normalizedEvidence = {};
  fixture.evidenceIndex = [];
  fixture.candidateUniverse = {};
  fixture.marketThesis = null;
  const master = assembleResearchMasterV2(fixture);
  const validation = validateResearchMasterV2(master);
  assert(
    master.sections.core_thesis.status === "insufficient",
    "missing evidence must mark thesis insufficient",
  );
  assert(
    master.sections.representative_stocks.length === 0,
    "missing data must not generate stocks",
  );
  assert(
    validation.quality.publish_status === "blocked",
    `missing open-market evidence expected blocked, received ${validation.quality.publish_status}`,
  );
});

Deno.test("Case C: closed market keeps checkpoints but creates no intraday signal", () => {
  const fixture = completeFixture();
  fixture.marketStatus = "CLOSED";
  fixture.isTradingDay = false;
  fixture.reportMode = "non_trading_day";
  fixture.legacy = {
    market_status: "CLOSED",
    today_quote: "今日台股休市，不產生盤前交易判斷。",
    member_research_note_v2: { data_status: "insufficient" },
  };
  fixture.evidencePack = {};
  fixture.normalizedEvidence = {};
  fixture.evidenceIndex = [];
  fixture.candidateUniverse = {};
  fixture.marketThesis = null;
  const master = assembleResearchMasterV2(fixture);
  const validation = validateResearchMasterV2(master);
  assert(
    master.sections.timeline.length === 6,
    "closed market must retain six research checkpoints",
  );
  assert(
    master.sections.timeline.every((item) => item.question.includes("休市")),
    "closed checkpoints must be explicitly inapplicable",
  );
  assert(
    master.sections.representative_stocks.length === 0,
    "closed market must not generate stocks",
  );
  assert(
    validation.quality.publish_status === "degraded",
    "closed shadow master should be degraded, not a fake ready report",
  );
});

Deno.test("Case D: duplicate stock symbols merge into one item and preserve evidence", () => {
  const fixture = completeFixture();
  const note = fixture.legacy.member_research_note_v2 as Record<
    string,
    unknown
  >;
  const candidates = note.beneficiary_candidates as Record<string, unknown>[];
  candidates.push({
    stock_code: "2330",
    stock_name: "台積電",
    confirmation: "11:00 確認半導體族群擴散。",
    invalidation: "台積電與族群同步轉弱。",
    evidence_refs: ["NEWS001"],
  });
  const master = assembleResearchMasterV2(fixture);
  assert(
    master.sections.representative_stocks.length === 1,
    "duplicate symbol must be removed",
  );
  assert(
    master.sections.representative_stocks[0].evidence_refs.includes("MD001"),
    "candidate-universe evidence must remain",
  );
  assert(
    master.sections.representative_stocks[0].evidence_refs.includes("NEWS001"),
    "duplicate evidence must merge",
  );
});

Deno.test("Case E: opposite executive and thesis directions block shadow quality", () => {
  const master = assembleResearchMasterV2(completeFixture());
  master.sections.executive_summary.text = "今日偏空觀察。";
  master.sections.core_thesis.statement = "今日偏多觀察。";
  const validation = validateResearchMasterV2(master);
  assert(
    validation.quality.contradictions.length > 0,
    "opposite directions must record contradiction",
  );
  assert(
    validation.quality.publish_status === "blocked",
    "contradiction must block shadow quality",
  );
});

Deno.test("Case F: identical input produces identical deterministic identities", () => {
  const first = assembleResearchMasterV2(completeFixture());
  const second = assembleResearchMasterV2(completeFixture());
  assert(
    first.research_id === second.research_id,
    "research_id must be deterministic",
  );
  assert(
    first.thesis_id === second.thesis_id,
    "thesis_id must be deterministic",
  );
  assert(
    first.sections.executive_summary.claim_id ===
      second.sections.executive_summary.claim_id,
    "claim_id must be deterministic",
  );
  assert(
    JSON.stringify(
      first.sections.timeline.map((item) => item.checkpoint_id),
    ) ===
      JSON.stringify(
        second.sections.timeline.map((item) => item.checkpoint_id),
      ),
    "checkpoint_id must be deterministic",
  );
  assert(
    JSON.stringify(
      first.sections.supporting_evidence.map((item) => item.claim_id),
    ) ===
      JSON.stringify(
        second.sections.supporting_evidence.map((item) => item.claim_id),
      ),
    "supporting claim identities must be deterministic",
  );
});

Deno.test("Case G: production aliases and guardrails remain fully traceable without debug agents", () => {
  const fixture = completeFixture();
  fixture.marketThesis = null;
  fixture.evidencePack = {
    data_quality: {
      available_sources: [
        "market_data",
        "market_news",
        "sector_rotation_scores",
      ],
      missing_sources: ["market_snapshot.djia", "market_snapshot.aapl"],
    },
  };
  fixture.evidenceIndex = [
    {
      evidence_id: "MD001",
      evidence_type: "market_data",
      title: "TAIEX",
      summary: "TAIEX UP 1.19% 台股現貨大盤方向",
      raw_reference: "market_data:TAIEX@2026-07-14T00:00:00Z",
      importance: 100,
    },
    {
      evidence_id: "MD002",
      evidence_type: "market_data",
      title: "2330",
      summary: "2330 UP 0.42% 台股最大權值與半導體核心驗證股",
      raw_reference: "market_data:2330@2026-07-14T00:00:00Z",
      importance: 100,
    },
    {
      evidence_id: "MD003",
      evidence_type: "market_data",
      title: "SOX",
      summary: "SOX UP 1.56% 半導體族群對台股電子權值影響",
      raw_reference: "market_data:SOX@2026-07-14T00:00:00Z",
      importance: 98,
    },
    {
      evidence_id: "MD006",
      evidence_type: "market_data",
      title: "NVDA",
      summary: "NVDA UP 2.19% AI server 與半導體供應鏈風向",
      raw_reference: "market_data:NVDA@2026-07-14T00:00:00Z",
      importance: 94,
    },
    {
      evidence_id: "SEC001",
      evidence_type: "sector_rotation",
      title: "電子權值",
      summary: "轉強",
      raw_reference: "sector_rotation_scores:電子權值",
      importance: 56,
    },
    {
      evidence_id: "SEC003",
      evidence_type: "sector_rotation",
      title: "半導體",
      summary: "觀察",
      raw_reference: "sector_rotation_scores:半導體",
      importance: 50,
    },
    {
      evidence_id: "SEC004",
      evidence_type: "sector_rotation",
      title: "AI伺服器",
      summary: "觀察",
      raw_reference: "sector_rotation_scores:AI伺服器",
      importance: 45,
    },
  ];
  fixture.candidateUniverse = {
    candidates: [{
      symbol: "2330",
      related_evidence: [
        { evidence_id: "MD002" },
        { evidence_id: "MD003" },
      ],
    }],
  };
  fixture.legacy.data_quality = "complete";
  const note = fixture.legacy.member_research_note_v2 as Record<
    string,
    unknown
  >;
  note.opening_thesis = {
    summary: "NVDA 先傳導至 AI Server，開盤確認台積電與族群是否同步。",
    signals: ["NVDA", "TAIEX", "AI Server"],
    confidence_score: 82,
  };
  note.today_core_thesis =
    "NVDA 先傳導至 AI Server，開盤確認台積電與族群是否同步。";
  note.overnight_chain = [
    {
      event: "NVIDIA 股價上漲",
      source_market: "美股",
      impact_logic: "NVIDIA 強勢推動半導體及 AI 伺服器信心",
      taiwan_mapping: "台積電與 AI 伺服器供應鏈等待確認",
    },
    {
      event: "費城半導體指數上漲",
      source_market: "美股",
      impact_logic: "費半上漲反映半導體需求預期",
      taiwan_mapping: "台積電與半導體族群等待確認",
    },
  ];
  note.invalidation_rules = [
    {
      condition: "開盤方向與盤前偏多觀察相反超過 1%",
      meaning: "盤前假設失效",
      action_note: "停止沿用盤前框架",
    },
    {
      condition: "候選族群只有單一權值股表態",
      meaning: "資金未擴散",
      action_note: "延伸候選降級為觀察",
    },
  ];
  fixture.legacy.invalidation_conditions = note.invalidation_rules;

  const master = assembleResearchMasterV2(fixture);
  const validation = validateResearchMasterV2(master);
  assert(
    master.provenance.source_status === "complete",
    `traceable deterministic production input expected complete, received ${master.provenance.source_status}`,
  );
  assert(
    validation.quality.evidence_coverage === 100,
    `production alias coverage expected 100, received ${validation.quality.evidence_coverage}`,
  );
  assert(
    validation.quality.unsupported_claims.length === 0,
    `production aliases left unsupported claims: ${
      validation.quality.unsupported_claims.join(" | ")
    }`,
  );
  assert(
    validation.quality.duplicate_claims.length === 0,
    `duplicate failure triggers remained: ${
      validation.quality.duplicate_claims.join(" | ")
    }`,
  );
  assert(
    validation.quality.publish_status === "ready",
    `production regression expected ready, received ${validation.quality.publish_status}`,
  );
});
