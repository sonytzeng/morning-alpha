import {
  assembleResearchMasterV2,
  type ResearchMasterV2AssemblerInput,
  validateResearchMasterV2,
} from "./research-master-v2.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
