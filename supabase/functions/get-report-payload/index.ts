import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  contentLengthExceedsLimit,
  readBoundedText,
  RequestBodyTooLargeError,
} from "../_shared/bounded-json.ts";
import { resolveMarketStatus } from "../_shared/market-status.ts";
import { evaluatePremiumContentGate } from "../_shared/premium-content-gate.ts";
import { evaluateMarketReportGate } from "../_shared/market-report-gate.ts";
import { evaluatePublishedMarketDelivery, readPublishedMarketDecision, readPublishedMemberRevision } from "../_shared/market-publication-contract.ts";
import { evaluateClosingContract, resolveClosingReceiptPointer, resolveOpeningPublicationIdentity, validateOpeningPublication } from "../_shared/closing-learning-contract.ts";
import {
  resolveEffectiveMemberAccess,
  type EffectiveMemberAccess,
  type MemberEntitlementRow,
  type ProfileAccessRow,
  type SubscriptionTier,
} from "../_shared/member-entitlement.ts";
import { buildCanonicalIntradaySyncStatus } from "../_shared/runtime-report-state.ts";
import { resolveCanonicalRuntimeMarketStatus } from "../_shared/canonical-runtime-market-status.mjs";
import { resolveCanonicalDataQuality } from "../_shared/production-architecture-core.mjs";
import { canonicalAdminReaderProjection } from "../_shared/research-pipeline-contract.ts";
import { loadDecisionEvidence } from "../_shared/decision-v1-data.ts";
import { buildEvidenceDecision, projectEvidenceDecision, sealEvidenceDecision } from "../_shared/decision-v1-evidence.ts";
import { createSubscriberState, getSubscriberReportProjection, INCOMPLETE_ANALYSIS_MESSAGE, RECOMMENDATION_INSUFFICIENT_MESSAGE } from "../../../shared/subscriber-state-contract.ts";

type ReportRow = Record<string, unknown> & {
  id?: string;
  report_date?: string;
  report_mode?: string | null;
  market_bias?: string | null;
  confidence_score?: number | string | null;
  summary?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  ai_strategy_json?: unknown;
};

type PayloadContext = {
  evaluatedAt?: string;
  todayDate?: string;
  publicationEvidence?: HistoryEvidence;
  openingRadar: Record<string, unknown> | null;
  sectorRotationRows: Record<string, unknown>[];
  marketDataSnapshots: Record<string, unknown>[];
  decisionSnapshot: Record<string, unknown> | null;
  closingDecisionSnapshot: Record<string, unknown> | null;
  closeMarketReview: Record<string, unknown> | null;
  learningRun: Record<string, unknown> | null;
  learningMetricCorrection: Record<string, unknown> | null;
  memberContentRevision: Record<string, unknown> | null;
  tradingDayState: Record<string, unknown> | null;
  componentQueryFailures: Array<{
    source: "opening_market_radar" | "sector_rotation_scores" | "market_data_snapshots" | "decision_snapshots" | "closing_decision_snapshot" | "close_market_reviews" | "learning_runs" | "learning_metric_corrections" | "member_content_revisions" | "trading_day_state";
    error_type: "QUERY_FAILED";
  }>;
};

const MAX_BODY_BYTES = 32_768;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

const PUBLIC_LOCKED_SECTIONS = [
  "opportunities_full",
  "member_note_full",
  "war_room_full",
  "vip_fund_flow",
  "vip_accuracy_history",
  "vip_alerts",
];

const MEMBER_LOCKED_SECTIONS = [
  "vip_fund_flow",
  "vip_accuracy_history",
  "vip_alerts",
];

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function readRequestBody(req: Request): Promise<Record<string, unknown>> {
  if (contentLengthExceedsLimit(req.headers.get("content-length"), MAX_BODY_BYTES)) {
    throw new RequestBodyTooLargeError();
  }
  const text = await readBoundedText(req.body, MAX_BODY_BYTES);
  if (!text.trim()) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_JSON_BODY");
  return parsed as Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[] : [];
}

function parseAi(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getAi(report: ReportRow): Record<string, unknown> {
  return parseAi(report.ai_strategy_json);
}

function normalizeClosingOutcome(value: unknown): "hit" | "partial" | "miss" | "pending" {
  const normalized = (toStringValue(value) || "").toLowerCase();
  if (["hit", "correct", "confirmed", "success", "accurate", "方向一致", "大致一致", "命中"].includes(normalized)) return "hit";
  if (["partial", "mixed", "partially_confirmed"].includes(normalized) || normalized.includes("部分")) return "partial";
  if (["miss", "wrong", "failed", "rejected", "incorrect", "inaccurate", "未命中"].includes(normalized)) return "miss";
  return "pending";
}

function buildAuthoritativeClosingVerification(
  ai: Record<string, unknown>,
  ctx: PayloadContext,
  report?: ReportRow,
): Record<string, unknown> | null {
  if (Object.hasOwn(ai, "market_publication_contract") || Object.hasOwn(ai, "closing_contract")) {
    // CORE receipts can only be read from the exact durable snapshot. A mutable
    // report alias or date-current closing row cannot supply missing evidence.
    if (!report || !ctx.publicationEvidence || ctx.publicationEvidence.queryBoundExceeded) return null;
    const evidence = ctx.publicationEvidence;
    const now = Date.parse(ctx.evaluatedAt || new Date().toISOString());
    const identity = resolveOpeningPublicationIdentity(report);
    const snapshot = evidence.snapshots.get(identity.opening_publication_revision_id) || null;
    const opening = evidence.runs.map(publicationRun => validateOpeningPublication({ report, snapshot, publicationRun, now }))
      .find(value => value.status === "PUBLISHED")
      || validateOpeningPublication({ report, snapshot, publicationRun: null, now });
    const closingId = resolveClosingReceiptPointer(report, opening);
    const closingSnapshot = closingId ? evidence.snapshots.get(closingId) || null : null;
    const verified = evaluateClosingContract({ opening, closingSnapshot, expectedSnapshotId: closingId, now });
    return closingId && verified.status === "COMPLETE"
      ? buildHistoryClosingVerdict(asObject(asObject(closingSnapshot?.generated_text).closing_verification_v2), verified) : null;
  }
  const existingV2 = asObject(ai.closing_verification_v2);
  const existingLegacy = asObject(ai.closing_verification);
  const generatedText = asObject(ctx.closingDecisionSnapshot?.generated_text);
  // A receipt is an indivisible assertion. Never borrow revision B from a
  // snapshot and outcome/actuals from date-only review A, or fill incomplete V2
  // fields from a different legacy receipt. Strict matching happens downstream.
  if (Object.keys(existingV2).length) return { ...existingV2, source_priority: "canonical_closing_verification_v2" };
  if (Object.keys(existingLegacy).length) return { ...existingLegacy, source_priority: "canonical_closing_verification" };
  if (Object.keys(generatedText).length) return {
    report_date: ctx.closingDecisionSnapshot?.report_date,
    status: ctx.closingDecisionSnapshot?.status,
    data_status: asObject(ctx.closingDecisionSnapshot?.factor_scores).data_status,
    verified_at: ctx.closingDecisionSnapshot?.created_at,
    ...generatedText,
    source_priority: "closing_decision_snapshot",
  };
  // close_market_reviews currently has no opening decision identity. Its raw
  // actuals still contribute to data_as_of, but cannot establish a thesis result.
  if (ctx.closeMarketReview) return {
    report_date: ctx.closeMarketReview.report_date,
    status: "pending_real_market_data", data_status: "insufficient",
    source_priority: "unbound_close_market_review", reason_code: "CLOSING_REVISION_UNBOUND",
  };
  return null;
}

/** Validate the final read projection, including preserved report overlays.
 * Ledger filtering alone cannot invalidate an older completed overlay. Never
 * rewrite persisted evidence or promote an elapsed checkpoint to completion. */
function sanitizeRuntimeCompletionEvidence(
  value: unknown,
  reportDate: string,
  now = Date.now(),
): Record<string, unknown> {
  const sync = asObject(value);
  const originalWindows = asObject(sync.windows);
  const windows: Record<string, unknown> = { ...originalWindows };
  const invalidated: string[] = [];
  const completedStatuses = ["ready", "complete", "completed", "synced", "succeeded", "success", "done"];
  const taipeiDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  });
  for (const checkpoint of ["0900", "0930", "1030", "1300", "1410", "1430"]) {
    const row = asObject(windows[checkpoint]);
    if (!completedStatuses.includes((toStringValue(row.status || row.checkpoint_status || windows[checkpoint]) || "").toLowerCase())) continue;
    const originalCompletedAt = typeof row.completed_at === "string" ? row.completed_at : null;
    const timestamp = originalCompletedAt && /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(originalCompletedAt)
      ? Date.parse(originalCompletedAt) : NaN;
    const reasons: string[] = [];
    if (!Number.isFinite(timestamp)) reasons.push("CHECKPOINT_COMPLETION_TIMESTAMP_INVALID");
    else {
      if (taipeiDate.format(new Date(timestamp)) !== reportDate) reasons.push("CHECKPOINT_COMPLETION_DATE_MISMATCH");
      if (timestamp > now) reasons.push("FUTURE_RUNTIME_EVIDENCE");
    }
    const scheduledAt = Date.parse(`${reportDate}T${checkpoint.slice(0, 2)}:${checkpoint.slice(2)}:00+08:00`);
    if (!Number.isFinite(scheduledAt)) reasons.push("CHECKPOINT_REPORT_DATE_INVALID");
    else if (scheduledAt > now && !reasons.includes("FUTURE_RUNTIME_EVIDENCE")) reasons.push("FUTURE_RUNTIME_EVIDENCE");
    if (toStringValue(sync.report_date) && sync.report_date !== reportDate) reasons.push("CHECKPOINT_REPORT_DATE_MISMATCH");
    if (reasons.length === 0) continue;
    invalidated.push(checkpoint);
    windows[checkpoint] = {
      ...row, status: "insufficient", checkpoint_status: "insufficient", completed_at: null,
      real_checkpoint_observation: false,
      evidence: { source: "get-report-payload", valid_completion: false, reason_codes: reasons },
      diagnostic: { ...asObject(row.diagnostic), original_completed_at: originalCompletedAt, reason_codes: reasons },
    };
  }
  if (invalidated.length === 0) return sync;
  const completed = Object.entries(windows).filter(([key, raw]) => /^\d{4}$/.test(key)
    && completedStatuses.includes((toStringValue(asObject(raw).status) || "").toLowerCase()));
  const latest = completed.sort(([left], [right]) => left.localeCompare(right)).at(-1);
  const latestWindow = asObject(latest?.[1]);
  return {
    ...sync, report_date: reportDate, windows,
    checkpoint: latest?.[0] || null,
    checkpoint_status: latest ? "completed" : "insufficient",
    captured_at: latestWindow.completed_at || null,
    last_checked_at: latestWindow.completed_at || null,
    current_state: latest ? toStringValue(asObject(latestWindow.evidence).state) : null,
    state_rank: null, ledger_guarantee: false, lifecycle_complete: false,
    warning: `已完成 ${completed.length} 個盤中驗證節點；${invalidated.length} 個節點的完成證據不足。`,
    diagnostic: { ...asObject(sync.diagnostic), invalid_completion_checkpoints: invalidated },
  };
}

function getEffectiveAi(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  const ai = getAi(report);
  const closingVerification = buildAuthoritativeClosingVerification(ai, ctx, report);
  const correctedLearning = asObject(ctx.learningMetricCorrection?.corrected_metrics);
  const learningSource = ctx.learningMetricCorrection ? "append_only_metric_correction" : "learning_run";
  return {
    ...ai,
    ...(ctx.openingRadar ? {
      opening_radar: ctx.openingRadar,
      opening_radar_status: toStringValue(ctx.openingRadar.radar_status) || toStringValue(ctx.openingRadar.status),
    } : {}),
    intraday_sync_status: sanitizeRuntimeCompletionEvidence(buildCanonicalIntradaySyncStatus(
      ai.intraday_sync_status,
      ctx.tradingDayState,
      {
        closeMarketReview: ctx.closeMarketReview,
        closingDecisionSnapshot: ctx.closingDecisionSnapshot,
        learningRun: ctx.learningRun,
      },
    ), getReportDate(report)),
    closing_verification: closingVerification,
    closing_verification_v2: closingVerification,
    continuous_learning: ctx.learningRun ? {
      status: toStringValue(ctx.learningRun.status),
      run_id: toStringValue(ctx.learningRun.id),
      completed_at: toStringValue(ctx.learningRun.completed_at),
      predictions_processed: toNumberValue(correctedLearning.predictions_processed) ?? toNumberValue(ctx.learningRun.predictions_processed),
      outcomes_created: toNumberValue(correctedLearning.outcomes_created),
      outcomes_updated: toNumberValue(correctedLearning.outcomes_updated) ?? toNumberValue(ctx.learningRun.outcomes_updated),
      reviews_created: toNumberValue(correctedLearning.reviews_created) ?? toNumberValue(ctx.learningRun.reviews_created),
      cases_created: toNumberValue(correctedLearning.cases_created) ?? toNumberValue(ctx.learningRun.cases_created),
      patterns_updated: toNumberValue(ctx.learningRun.patterns_updated),
      metric_source: learningSource,
      metric_correction_id: toStringValue(ctx.learningMetricCorrection?.id),
    } : null,
  };
}

function normalizeDataQualityToken(value: unknown): string | null {
  const normalized = (toStringValue(value) || "").toLowerCase();
  for (const token of ["blocked", "insufficient", "missing", "partial", "degraded", "sufficient", "complete"]) {
    if (normalized.includes(token)) return token;
  }
  return null;
}

function getCanonicalPayloadQuality(ai: Record<string, unknown>, ctx: PayloadContext): string {
  const snapshotGate = asObject(asObject(ctx.decisionSnapshot?.generated_text).market_report_gate);
  const master = asObject(ai.research_master_v2);
  if (ctx.decisionSnapshot?.status === 'READY' && snapshotGate.eligible === true
    && snapshotGate.report_date === ctx.decisionSnapshot.report_date) {
    // Editorial/market completeness is independent of stock screening and paid QA.
    // Runtime checkpoint quality remains separately exposed on the radar/timeline.
    return resolveCanonicalDataQuality([normalizeDataQualityToken(ai.data_quality),
      normalizeDataQualityToken(asObject(master.provenance).source_status)].filter(Boolean));
  }
  const note = asObject(ai.member_research_note_v2);
  const openingRadar = ctx.openingRadar || asObject(ai.opening_radar);
  return resolveCanonicalDataQuality([
    normalizeDataQualityToken(ai.data_quality),
    normalizeDataQualityToken(ai.data_status),
    normalizeDataQualityToken(ai.v10_data_quality_status),
    normalizeDataQualityToken(note.data_status),
    normalizeDataQualityToken(openingRadar.data_status),
    normalizeDataQualityToken(ctx.memberContentRevision?.data_quality_status),
  ].filter(Boolean));
}

function isCanonicalMemberRevisionEligible(ctx: PayloadContext): boolean {
  const revision = ctx.memberContentRevision;
  if (!revision || !ctx.decisionSnapshot) return false;
  return toStringValue(revision.status) === "PASSED"
    && toStringValue(revision.semantic_status) === "PASSED"
    && Array.isArray(revision.semantic_reason_codes) && revision.semantic_reason_codes.length === 0
    && toStringValue(revision.decision_snapshot_id) === toStringValue(ctx.decisionSnapshot.id)
    && toNumberValue(revision.decision_snapshot_version) === toNumberValue(ctx.decisionSnapshot.version)
    && revision.report_id === ctx.decisionSnapshot.report_id
    && revision.report_date === ctx.decisionSnapshot.report_date;
}

function getImportantNews(report: ReportRow, ai: Record<string, unknown>): Record<string, unknown>[] {
  const reportNews = asArray(report.important_news_json);
  return reportNews.length > 0 ? reportNews : asArray(ai.important_news);
}

function buildPublicNews(newsRows: Record<string, unknown>[]): Record<string, unknown>[] {
  return newsRows.slice(0, 3).map((news) => ({
    title: toStringValue(news.title) || "",
    source: toStringValue(news.source) || "",
    url: toStringValue(news.url),
    published_at: toStringValue(news.published_at) || toStringValue(news.created_at),
    related_sectors: Array.isArray(news.related_sectors) ? news.related_sectors.slice(0, 4) : [],
    taiwan_impact_summary: toStringValue(news.taiwan_impact_summary) || "",
  }));
}

function buildPublicOpeningRadar(value: unknown): Record<string, unknown> {
  const radar = asObject(value);
  return {
    report_date: toStringValue(radar.report_date),
    checkpoint: toStringValue(radar.checkpoint),
    radar_status: toStringValue(radar.radar_status) || toStringValue(radar.status),
    data_status: toStringValue(radar.data_status),
    captured_at: toStringValue(radar.captured_at),
    updated_at: toStringValue(radar.updated_at),
    next_check_time: toStringValue(radar.next_check_time),
    taiex_change: toNumberValue(radar.taiex_change),
    txf_change: toNumberValue(radar.txf_change),
    tsmc_change: toNumberValue(radar.tsmc_change),
  };
}

function buildPublicValidationSkeleton(): Record<string, unknown> {
  return {
    intraday_validation: [
      { time_window: "09:30", what_to_watch: "開盤驗證" },
      { time_window: "10:30", what_to_watch: "主線確認" },
      { time_window: "13:00", what_to_watch: "盤中追蹤" },
    ],
  };
}

function getReportDate(report: ReportRow): string {
  return toStringValue(report.report_date) || "";
}

function getMarketBias(report: ReportRow, ai: Record<string, unknown>): string {
  return toStringValue(ai.market_bias) || toStringValue(report.market_bias) || "觀察中";
}

function getConfidenceScore(report: ReportRow, ai: Record<string, unknown>): number | null {
  return toNumberValue(ai.confidence_score) ?? toNumberValue(report.confidence_score);
}

function getConfidenceBand(score: number | null): "high" | "medium" | "low" | "pending" {
  if (score === null) return "pending";
  if (score >= 75) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function getTodayQuote(report: ReportRow, ai: Record<string, unknown>): string {
  const v8Sentence = asObject(ai.v8_daily_sentence);
  const freeSummary = asObject(ai.free_summary);
  return (
    toStringValue(report.today_quote) ||
    toStringValue(v8Sentence.sentence) ||
    toStringValue(ai.daily_sentence) ||
    toStringValue(ai.today_quote) ||
    toStringValue(ai.today_sentence) ||
    toStringValue(freeSummary.daily_sentence) ||
    toStringValue(freeSummary.one_liner) ||
    toStringValue(freeSummary.one_sentence) ||
    toStringValue(freeSummary.summary) ||
    toStringValue(report.summary) ||
    ""
  );
}

function getGeneratedAt(report: ReportRow, ai: Record<string, unknown>): string | null {
  return (
    toStringValue(ai.generated_at) ||
    toStringValue(report.updated_at) ||
    toStringValue(report.created_at) ||
    null
  );
}

function getMarketDate(report: ReportRow, ai: Record<string, unknown>): string | null {
  return (
    toStringValue(ai.market_data_date) ||
    toStringValue(ai.tw_core_date) ||
    toStringValue(ai.market_data_latest_date) ||
    getReportDate(report) ||
    null
  );
}

function toIsoTimestamp(value: unknown): string | null {
  const raw = toStringValue(value);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function getDataAsOf(ai: Record<string, unknown>, ctx: PayloadContext): string | null {
  const researchMaster = asObject(ai.research_master_v2);
  const openingRadar = ctx.openingRadar || asObject(ai.opening_radar);
  const closingV2 = asObject(ai.closing_verification_v2);
  const closing = asObject(ai.closing_verification);
  const evidenceTimestamps = [
    researchMaster.data_as_of,
    ai.data_as_of,
    openingRadar.captured_at,
    ...ctx.marketDataSnapshots.map((row) => row.captured_at),
    asObject(closingV2.actual_taiex_close).captured_at,
    asObject(closingV2.actual_tsmc_close).captured_at,
    asObject(closingV2.actual_txf_close).captured_at,
    closingV2.verified_at,
    closing.verified_at,
    ctx.closeMarketReview?.updated_at,
    ctx.closingDecisionSnapshot?.valid_from,
    ctx.learningRun?.completed_at,
  ]
    .map(toIsoTimestamp)
    .filter((value): value is string => value !== null && Date.parse(value) <= Date.now())
    .sort((a, b) => b.localeCompare(a));

  return evidenceTimestamps[0] || null;
}

function getCanonicalMarketMetadata(
  report: ReportRow,
  ai: Record<string, unknown>,
  ctx: PayloadContext,
): { marketStatus: string; isTradingDay: boolean | null; closedReason: string | null } {
  const reportDate = getReportDate(report);
  if (!isValidDate(reportDate)) {
    return {
      marketStatus: toStringValue(ai.market_status) || "unknown",
      isTradingDay: null,
      closedReason: toStringValue(ai.closed_reason) || toStringValue(ai.holiday_name),
    };
  }

  const canonical = resolveMarketStatus(reportDate);
  return {
    marketStatus: resolveCanonicalRuntimeMarketStatus({
      isTradingDay: canonical.is_trading_day,
      tradingDayState: ctx.tradingDayState,
      closeMarketReview: ctx.closeMarketReview,
      closingDecisionSnapshot: ctx.closingDecisionSnapshot,
      learningRun: ctx.learningRun,
    }),
    isTradingDay: canonical.is_trading_day,
    closedReason: canonical.closed_reason,
  };
}

function getReportMode(
  report: ReportRow,
  ai: Record<string, unknown>,
): string | null {
  return toStringValue(report.report_mode) || toStringValue(ai.report_mode);
}

function getConfidenceLabel(score: number | null): string {
  if (score === null) return "資料完整度待確認";
  if (score >= 75) return "高把握度";
  if (score >= 55) return "中等把握度";
  if (score > 0) return "偏低";
  return "偏低，請查看缺失來源";
}

function getBeneficiaryArrays(ai: Record<string, unknown>): Record<string, unknown>[][] {
  if (isV10BeneficiaryEnabled(ai)) {
    return [asArray(ai.today_beneficiary_stocks_v10)];
  }
  return [
    asArray(ai.today_beneficiary_stocks),
    asArray(ai.beneficiary_stocks),
    asArray(ai.core_beneficiary_stocks),
  ];
}

function isV10BeneficiaryEnabled(ai: Record<string, unknown>): boolean {
  return ai.v10_beneficiary_enabled === true || toStringValue(ai.v10_beneficiary_enabled) === "true";
}

function getBeneficiaryCount(ai: Record<string, unknown>): number {
  const unique = new Set<string>();
  for (const rows of getBeneficiaryArrays(ai)) {
    for (const row of rows) {
      const symbol = toStringValue(row.symbol) || toStringValue(row.stock_id) || toStringValue(row.stock_code) || "";
      const name = toStringValue(row.stock_name) || toStringValue(row.name) || "";
      const key = symbol || name;
      if (key) unique.add(key);
    }
  }
  return unique.size;
}

function buildCanonicalTeaserStock(memberContent: unknown): Record<string, unknown> | null {
  const first = asArray(asObject(memberContent).representative_stocks)[0];
  if (!first) return null;
  return {
    symbol: toStringValue(first.symbol) || toStringValue(first.stock_id) || toStringValue(first.stock_code) || "",
    name: toStringValue(first.stock_name) || toStringValue(first.name) || toStringValue(first.symbol) || "",
    sector: toStringValue(first.sector) || toStringValue(first.group) || toStringValue(first.category) || "",
  };
}

function buildClosingVerdict(ai: Record<string, unknown>): Record<string, unknown> | null {
  const closingV2 = asObject(ai.closing_verification_v2);
  const closing = Object.keys(closingV2).length > 0 ? closingV2 : asObject(ai.closing_verification);
  if (Object.keys(closing).length === 0) return null;
  return {
    status: toStringValue(closing.status),
    data_status: toStringValue(closing.data_status),
    report_date: toStringValue(closing.report_date),
    opening_decision_snapshot_id: toStringValue(closing.opening_decision_snapshot_id),
    opening_bias: toStringValue(closing.opening_bias),
    opening_confidence: toNumberValue(closing.opening_confidence),
    predicted_bias: toStringValue(closing.predicted_bias),
    predicted_confidence: toNumberValue(closing.predicted_confidence),
    verdict_label: toStringValue(closing.verdict_label) || toStringValue(closing.hit_or_miss),
    prediction_result: toStringValue(closing.prediction_result) || toStringValue(closing.hit_or_miss),
    accuracy_score: toNumberValue(closing.accuracy_score),
    verified_at: toStringValue(closing.verified_at),
    actual_direction: toStringValue(closing.actual_direction),
    actual_taiex_change: toNumberValue(closing.actual_taiex_change) ?? toNumberValue(asObject(closing.actual_taiex_close).change_percent),
    actual_taiex_close: asObject(closing.actual_taiex_close),
    actual_2330_close: asObject(closing.actual_2330_close || closing.actual_tsmc_close),
    actual_txf_close: asObject(closing.actual_txf_close),
    data_quality: toStringValue(closing.data_quality),
    missing_data: Array.isArray(closing.missing_data) ? closing.missing_data : [],
    no_fake_data: closing.no_fake_data === true,
  };
}

function buildClosingSummary(ai: Record<string, unknown>): Record<string, unknown> | null {
  const closingV2 = asObject(ai.closing_verification_v2);
  const closing = Object.keys(closingV2).length > 0 ? closingV2 : asObject(ai.closing_verification);
  if (Object.keys(closing).length === 0) return null;
  const taiexClose = asObject(closing.actual_taiex_close);
  return {
    ...closing,
    status: toStringValue(closing.status),
    verdict_label: toStringValue(closing.verdict_label) || toStringValue(closing.hit_or_miss),
    prediction_result: toStringValue(closing.prediction_result) || toStringValue(closing.hit_or_miss),
    verification_note: toStringValue(closing.verification_note) || toStringValue(closing.what_was_right),
    actual_taiex_change: toNumberValue(closing.actual_taiex_change) ?? toNumberValue(taiexClose.change_percent),
    accuracy_score: toNumberValue(closing.accuracy_score),
    verified_at: toStringValue(closing.verified_at),
  };
}

function buildCanonicalDecision(
  ctx: PayloadContext,
  includePremiumFields: boolean,
): Record<string, unknown> | null {
  const snapshot = ctx.decisionSnapshot;
  if (!snapshot) return null;
  const generatedText = asObject(snapshot.generated_text);
  const base = {
    id: toStringValue(snapshot.id),
    version: toNumberValue(snapshot.version),
    session_type: toStringValue(snapshot.session_type),
    status: toStringValue(snapshot.status),
    action: toStringValue(snapshot.action),
    decision_mode: toStringValue(snapshot.decision_mode),
    market_regime: toStringValue(snapshot.market_regime),
    confidence_score: toNumberValue(snapshot.confidence_score),
    coverage_score: toNumberValue(snapshot.coverage_score),
    content_score: toNumberValue(snapshot.content_score),
    content_grade: toStringValue(snapshot.content_grade),
    daily_sentence: toStringValue(generatedText.daily_sentence),
    reasons: Array.isArray(generatedText.reasons) ? generatedText.reasons.slice(0, 3) : [],
    preferred_sectors: Array.isArray(generatedText.preferred_sectors) ? generatedText.preferred_sectors.slice(0, 3) : [],
    do_not_do: toStringValue(generatedText.do_not_do),
    next_checkpoint: toStringValue(generatedText.next_checkpoint),
    valid_from: toStringValue(snapshot.valid_from),
  };
  if (!includePremiumFields) return base;
  return {
    ...base,
    recommendations: asArray(generatedText.recommendations),
    invalidation_conditions: Array.isArray(generatedText.invalidation_conditions)
      ? generatedText.invalidation_conditions
      : [],
    source_refs: Array.isArray(snapshot.source_refs) ? snapshot.source_refs : [],
    content_score_breakdown: asObject(snapshot.content_score_breakdown),
    reason_codes: Array.isArray(snapshot.reason_codes) ? snapshot.reason_codes : [],
  };
}

function buildPublicPayload(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  const ai = getEffectiveAi(report, ctx);
  const importantNews = getImportantNews(report, ai);
  const premiumGate = evaluatePremiumContentGate(ai, importantNews.length);
  const marketGate = evaluateMarketReportGate(ai, getReportDate(report));
  const canonicalQuality = getCanonicalPayloadQuality(ai, ctx);
  const semanticEligible = isCanonicalMemberRevisionEligible(ctx);
  const premiumEligible = premiumGate.eligible && semanticEligible;
  const premiumReasonCodes = Array.from(new Set([
    ...premiumGate.reason_codes,
    ...(semanticEligible ? [] : ["SEMANTIC_MEMBER_REVISION_NOT_ELIGIBLE"]),
  ]));
  const openingRadar = ctx.openingRadar || asObject(ai.opening_radar);
  const marketMetadata = getCanonicalMarketMetadata(report, ai, ctx);
  const originalDecision = buildCanonicalDecision(ctx, false);
  const revisionId = toStringValue(originalDecision?.id) || toStringValue(report.id);
  const evaluatedAt = ctx.evaluatedAt || new Date().toISOString();
  const todayDate = ctx.todayDate || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(evaluatedAt));
  const readerReport = { ...report, ai_strategy_json: { ...ai, is_trading_day: marketMetadata.isTradingDay } };
  const deliveryOptions = { todayDate, now: evaluatedAt, premiumEligible, historicalRead: true };
  const runs = ctx.publicationEvidence?.queryBoundExceeded ? [] : ctx.publicationEvidence?.runs || [];
  const delivered = runs.map(publicationRun => evaluatePublishedMarketDelivery(readerReport, ctx.decisionSnapshot,
    ctx.memberContentRevision, marketGate, { ...deliveryOptions, publicationRun })).find(value => value.eligible)
    || evaluatePublishedMarketDelivery(readerReport, ctx.decisionSnapshot, ctx.memberContentRevision, marketGate, deliveryOptions);
  const publicationVerified = !ctx.publicationEvidence?.queryBoundExceeded && delivered.eligible;
  const recommendationGate = { ...marketGate.recommendation_gate,
    status: delivered.projection.recommendation.status, eligible: delivered.projection.recommendation.available };
  const generatedAt = delivered.projection.identity.generatedAt || getGeneratedAt(report, ai);
  const subscriberState = createSubscriberState({
    report_date: getReportDate(report), revision_id: revisionId, generated_at: generatedAt,
    publicationVerified, marketEvidenceReady: publicationVerified,
    marketPublicationContract: getAi(report).market_publication_contract,
    analysisStatus: ctx.decisionSnapshot?.status, isTradingDay: marketMetadata.isTradingDay,
    confidenceValue: delivered.projection.confidence.value,
    recommendationGate,
    closing: ai.closing_verification_v2, now: evaluatedAt,
  });
  const subscriberProjection = getSubscriberReportProjection({
    report_date: getReportDate(report), revision_id: revisionId, generated_at: generatedAt,
    today_date: todayDate,
    subscriber_state: subscriberState, canonical_decision: originalDecision ? { ...originalDecision,
      report_date: getReportDate(report), generated_at: generatedAt,
      daily_sentence: delivered.projection.marketDecision.summary, market_bias: delivered.projection.marketDecision.bias } : null,
    market_publication_contract: getAi(report).market_publication_contract,
    market_bias: delivered.projection.marketDecision.bias, is_trading_day: marketMetadata.isTradingDay,
    daily_sentence: delivered.projection.marketDecision.summary,
    recommendation_gate: recommendationGate,
    closing_verification_v2: buildClosingVerdict(ai),
  });
  const marketPublished = subscriberProjection.analysisAvailable;
  const recommendationsEligible = premiumEligible && marketPublished && subscriberProjection.recommendation.available;
  const confidenceScore = subscriberProjection.confidence.value;
  const dailySentence = marketPublished
    ? subscriberProjection.marketDecision.summary ?? subscriberProjection.statusLabel : INCOMPLETE_ANALYSIS_MESSAGE;
  // Backward-safe aliases: an older deployed UI must not see QA STOP/100 or a
  // close outcome for a thesis that was never published. Raw QA stays private.
  const canonicalDecision: Record<string, unknown> = marketPublished ? {
    ...originalDecision, confidence_score: confidenceScore, daily_sentence: dailySentence,
  } : {
    id: revisionId, status: subscriberState.analysis, action: "WAIT", decision_mode: "blocked",
    confidence_score: null, daily_sentence: INCOMPLETE_ANALYSIS_MESSAGE, reasons: [],
    preferred_sectors: [], do_not_do: "", next_checkpoint: "等待有效市場分析",
  };
  const rawSync = asObject(ai.intraday_sync_status);
  const subscriberSync = marketPublished ? subscriberProjection.closing.complete ? rawSync : {
    ...rawSync, current_state: null, state_rank: null, lifecycle_complete: false,
    checkpoint: String(rawSync.checkpoint || "").replace(/\D/g, "") === "1430" ? null : rawSync.checkpoint,
    checkpoint_status: String(rawSync.checkpoint || "").replace(/\D/g, "") === "1430" ? "insufficient" : rawSync.checkpoint_status,
    // Older deployed clients fall back to this checkpoint even when the close
    // receipt is absent. A dispatch completion is not a verified close result.
    windows: { ...asObject(rawSync.windows), "1430": {
      status: subscriberProjection.closing.state === "NOT_DUE" ? "pending" : "insufficient",
      completed_at: null, real_checkpoint_observation: false,
      reason: "CLOSING_PUBLICATION_EVIDENCE_UNVERIFIED",
    } },
  } : {
    report_date: getReportDate(report), current_state: null, state_rank: null,
    checkpoint: null, checkpoint_status: "insufficient", lifecycle_complete: false,
    windows: Object.fromEntries(Object.keys(asObject(rawSync.windows)).map(key => [key, {
      status: "insufficient", completed_at: null, real_checkpoint_observation: false,
      reason: "MARKET_ANALYSIS_UNPUBLISHED",
    }])),
  };
  const componentFailureSources = ctx.componentQueryFailures.map((failure) => failure.source);
  const radarMissingSources = Array.isArray(openingRadar.missing_sources) ? openingRadar.missing_sources.map(String) : [];
  return {
    report_date: getReportDate(report),
    today_date: todayDate,
    report_mode: getReportMode(report, ai),
    revision_id: revisionId,
    market_date: getMarketDate(report, ai),
    base_date: getMarketDate(report, ai),
    generated_at: generatedAt,
    subscriber_state: subscriberState,
    market_publication_contract: getAi(report).market_publication_contract,
    subscriber_projection: subscriberProjection,
    data_as_of: getDataAsOf(ai, ctx),
    market_status: marketMetadata.marketStatus,
    is_trading_day: marketMetadata.isTradingDay,
    closed_reason: marketMetadata.closedReason,
    // Regime (e.g. range) is not directional bias. Preserve both contracts.
    market_bias: marketPublished ? subscriberProjection.marketDecision.bias : "分析尚未完成",
    confidence_score: confidenceScore,
    confidence_label: getConfidenceLabel(confidenceScore),
    confidence_band: getConfidenceBand(confidenceScore),
    today_quote: dailySentence,
    daily_sentence: dailySentence,
    v8_daily_sentence: { sentence: dailySentence },
    public_summary: {
      daily_sentence: dailySentence,
      one_sentence: dailySentence,
    },
    beneficiary_count: recommendationsEligible ? getBeneficiaryCount(ai) : 0,
    one_teaser_stock: recommendationsEligible ? buildCanonicalTeaserStock(ctx.memberContentRevision?.member_content) : null,
    v10_beneficiary_enabled: isV10BeneficiaryEnabled(ai),
    v10_data_quality_status: canonicalQuality,
    v10_warning: toStringValue(ai.v10_warning),
    v10_candidate_count: toNumberValue(ai.v10_candidate_count),
    premium_content_status: premiumEligible && marketPublished ? "eligible" : "blocked",
    report_status: subscriberState.analysis,
    recommendation_status: subscriberState.recommendation,
    recommendation_gate: marketPublished && subscriberProjection.recommendation.status !== "BLOCKED" ? recommendationGate
      : { ...marketGate.recommendation_gate, eligible: false, status: "BLOCKED", subscriber_message: RECOMMENDATION_INSUFFICIENT_MESSAGE },
    recommendation_message: subscriberState.recommendation === "BLOCKED" ? RECOMMENDATION_INSUFFICIENT_MESSAGE : marketGate.recommendation_gate.subscriber_message,
    market_report_gate: marketGate,
    premium_decision_mode: premiumGate.decision_mode,
    premium_content_reason_codes: premiumReasonCodes,
    recommendation_count: recommendationsEligible ? premiumGate.recommendation_count : 0,
    complete_recommendation_count: recommendationsEligible ? premiumGate.complete_recommendation_count : 0,
    member_value_score: marketPublished ? toNumberValue(ai.member_value_score) : null,
    content_score: marketPublished ? toNumberValue(canonicalDecision?.content_score) ?? premiumGate.content_score : null,
    content_grade: marketPublished ? toStringValue(canonicalDecision?.content_grade) || premiumGate.content_grade : null,
    content_score_breakdown: premiumGate.content_score_breakdown,
    canonical_decision: canonicalDecision,
    content_publish_gate: {
      overall_status: marketPublished ? "eligible" : "blocked",
      blocking_issues: [...delivered.reason_codes,
        ...(ctx.publicationEvidence?.queryBoundExceeded ? ["PUBLICATION_EVIDENCE_QUERY_BOUND_EXCEEDED"] : [])],
    },
    important_news: buildPublicNews(importantNews),
    fresh_news_count: importantNews.length,
    opening_radar_status: toStringValue(openingRadar.radar_status) || toStringValue(openingRadar.status),
    opening_radar: buildPublicOpeningRadar(openingRadar),
    member_research_note_v2: marketPublished ? buildPublicValidationSkeleton() : {},
    intraday_sync_status: subscriberSync,
    input_source: toStringValue(openingRadar.input_source) || null,
    degraded_metadata: {
      data_status: toStringValue(openingRadar.data_status),
      missing_sources: Array.from(new Set([
        ...radarMissingSources,
        ...componentFailureSources.map((source) => `component_query:${source}`),
      ])),
      radar_mode: toStringValue(openingRadar.radar_mode),
      txf_status: toStringValue(openingRadar.txf_status),
      input_source: toStringValue(openingRadar.input_source),
      component_query_status: componentFailureSources.length > 0 ? "degraded" : "complete",
      component_query_failures: ctx.componentQueryFailures,
      bridge_verification_status: componentFailureSources.length > 0 ? "TOOL_DEGRADED" : "VERIFIED",
    },
    sector_rotation_scores: ctx.sectorRotationRows.slice(0, 3).map((row) => ({
      score_date: row.score_date,
      sector: row.sector,
      direction: row.direction,
      signal_label: row.signal_label,
    })),
    sector_rotation_status: asObject(ai.sector_rotation_status),
    market_data_snapshots: Array.from(ctx.marketDataSnapshots.reduce((latestBySymbol, row) => {
      const symbol = (toStringValue(row.symbol) || "").toUpperCase();
      if (symbol && !latestBySymbol.has(symbol)) latestBySymbol.set(symbol, row);
      return latestBySymbol;
    }, new Map<string, Record<string, unknown>>()).values()).slice(0, 16),
    closing_verification: subscriberProjection.closing.result,
    closing_verification_v2: subscriberProjection.closing.result,
    continuous_learning: subscriberProjection.closing.complete ? asObject(ai.continuous_learning) : null,
    runtime_lifecycle_complete: subscriberProjection.closing.complete && rawSync.lifecycle_complete === true,
    data_quality: canonicalQuality,
  };
}

function projectMarketOnlyMemberNote(value: unknown): Record<string, unknown> {
  const note = asObject(value), contract = asObject(note.canonical_contract);
  // A validated market-only document is not permission to spread old stock/QA
  // aliases. Keep only the canonical market narrative and its evidence fields.
  return {
    contract_version: note.contract_version,
    decision_mode: 'market_only', action: 'WAIT',
    market_report_gate: contract.market_report_gate,
    canonical_contract: Object.fromEntries([
      'contract_version', 'decision_mode', 'market_report_gate', 'report_date',
      'snapshot_id', 'snapshot_version', 'primary_event', 'primary_causal_chain',
      'primary_taiwan_theme', 'validation_checkpoint', 'validation_signals',
      'invalidation_conditions', 'action', 'data_quality_status', 'evidence_refs',
    ].map(key => [key, contract[key]]).concat([['primary_symbols', []]])),
    data_status: note.data_status,
    today_core_thesis: note.today_core_thesis,
    strategy_summary: note.strategy_summary,
    subscriber_value_sentence: note.subscriber_value_sentence,
    taiwan_transmission: note.taiwan_transmission,
    beneficiary_candidates: [], representative_stocks: [],
    intraday_validation: note.intraday_validation,
    invalidation_conditions: note.invalidation_conditions,
    invalidation_rules: note.invalidation_rules,
    source_refs: note.source_refs,
    line_summary: note.line_summary,
    content_os_topic: { event_source: contract.primary_event, theme: contract.primary_taiwan_theme, symbols: [] },
  };
}

function buildMemberPayload(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  const ai = getEffectiveAi(report, ctx);
  const importantNews = getImportantNews(report, ai);
  const premiumGate = evaluatePremiumContentGate(ai, importantNews.length);
  const revisionEligible = isCanonicalMemberRevisionEligible(ctx);
  const rawNote = revisionEligible ? asObject(ctx.memberContentRevision?.member_content) : {};
  const publicPayload = buildPublicPayload(report, ctx);
  const recommendationGate = asObject(publicPayload.recommendation_gate);
  const marketOnlyNote = asObject(rawNote.canonical_contract).decision_mode === 'market_only'
    && asObject(asObject(rawNote.canonical_contract).market_report_gate).eligible === true
    && Array.isArray(rawNote.representative_stocks) && rawNote.representative_stocks.length === 0
    && Array.isArray(rawNote.beneficiary_candidates) && rawNote.beneficiary_candidates.length === 0;
  const note = marketOnlyNote ? projectMarketOnlyMemberNote(rawNote) : rawNote;
  const canonicalRecommendations = recommendationGate.eligible ? asArray(note.representative_stocks) : [];
  const canonicalContract = asObject(note.canonical_contract);
  const v8BeneficiaryChain = { recommendations: canonicalRecommendations };
  const v8OvernightCausalChain = { chains: canonicalContract.primary_causal_chain || [] };
  const publicDegradedMetadata = asObject(publicPayload.degraded_metadata);
  const publicMissingSources = Array.isArray(publicDegradedMetadata.missing_sources) ? publicDegradedMetadata.missing_sources.map(String) : [];
  const reportMissingSources = Array.isArray(ai.missing_sources) ? ai.missing_sources.map(String) : [];
  if (asObject(publicPayload.subscriber_state).publication !== "PUBLISHED"
    || !premiumGate.eligible || !revisionEligible || (!recommendationGate.eligible && !marketOnlyNote)) {
    const reasonCodes = Array.from(new Set([
      ...premiumGate.reason_codes,
      ...(revisionEligible ? [] : ["SEMANTIC_MEMBER_REVISION_NOT_ELIGIBLE"]),
      ...(!recommendationGate.eligible && !marketOnlyNote ? ["RECOMMENDATION_NOTE_NOT_PUBLISHED"] : []),
    ]));
    return {
      ...publicPayload,
      premium_content_status: "blocked",
      premium_content_reason_codes: reasonCodes,
      premium_content_unavailable_reason: "EVIDENCE_GATE_NOT_MET",
    };
  }
  return {
    ...publicPayload,
    canonical_decision: { ...buildCanonicalDecision(ctx, true), ...asObject(publicPayload.canonical_decision), recommendations: canonicalRecommendations },
    confidence_score: publicPayload.confidence_score,
    today_beneficiary_stocks: canonicalRecommendations,
    beneficiary_stocks: canonicalRecommendations,
    core_beneficiary_stocks: canonicalRecommendations,
    extended_watchlist: [],
    scenario_watchlist: [],
    today_beneficiary_stocks_v10: canonicalRecommendations,
    v10_observation_watchlist: [],
    v10_risk_watchlist: [],
    v10_beneficiary_enabled: true,
    v10_data_quality_status: getCanonicalPayloadQuality(ai, ctx),
    v10_warning: toStringValue(ai.v10_warning),
    v10_candidate_count: toNumberValue(ai.v10_candidate_count),
    v8_beneficiary_chain: v8BeneficiaryChain,
    v8_overnight_causal_chain: v8OvernightCausalChain,
    source_signals: Array.isArray(note.source_refs) ? note.source_refs : [],
    why_this_stock: canonicalRecommendations,
    data_status: getCanonicalPayloadQuality(ai, ctx),
    data_basis_note: toStringValue(note.data_basis_note) || null,
    strategy_summary: note.strategy_summary || null,
    degraded_metadata: {
      ...publicDegradedMetadata,
      report_data_quality: getCanonicalPayloadQuality(ai, ctx),
      missing_sources: Array.from(new Set([...publicMissingSources, ...reportMissingSources])),
    },
    member_research_note_v2: note,
    intraday_tracking: asObject(ai.intraday_tracking),
    intraday_time_windows: asArray(note.intraday_time_windows),
    intraday_replay_time_windows: asArray(asObject(ai.closing_verification_v2).intraday_replay_time_windows),
    overnight_chain: asObject(note.canonical_contract).primary_causal_chain || [],
    validation_signal: Array.isArray(note.intraday_validation) ? note.intraday_validation : [],
    invalidation_condition: Array.isArray(note.invalidation_conditions) ? note.invalidation_conditions : [],
    closing_verification: asObject(publicPayload.subscriber_state).closing === "COMPLETE" ? buildClosingSummary(ai) : null,
    closing_verification_v2: asObject(publicPayload.subscriber_state).closing === "COMPLETE" ? asObject(ai.closing_verification_v2) : null,
  };
}

function buildVipPayload(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  const ai = getEffectiveAi(report, ctx);
  const note = isCanonicalMemberRevisionEligible(ctx) ? asObject(ctx.memberContentRevision?.member_content) : {};
  const memberPayload = buildMemberPayload(report, ctx);
  if (memberPayload.premium_content_status !== "eligible" || asObject(memberPayload.recommendation_gate).eligible !== true) return memberPayload;
  // VIP prose must obey the same closing gate as every other subscriber alias.
  const closing = asObject(memberPayload.subscriber_state).closing === "COMPLETE"
    ? asObject(ai.closing_verification) : {};
  return {
    ...memberPayload,
    fund_flow_scenario: note.fund_flow_scenario || ai.fund_flow_scenario || null,
    market_mispricing: note.market_mispricing || ai.market_mispricing || null,
    institutional_behavior: note.institutional_behavior || ai.institutional_behavior || null,
    failure_analysis: {
      miss_reason: closing.miss_reason || null,
      failed_assumptions: Array.isArray(closing.failed_assumptions) ? closing.failed_assumptions : [],
      lessons_learned: Array.isArray(closing.lessons_learned) ? closing.lessons_learned : [],
    },
    tomorrow_extension_watch: note.tomorrow_extension_watch || closing.tomorrow_watch_points || null,
  };
}

function buildAdminPayload(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  return canonicalAdminReaderProjection(report, getEffectiveAi(report, ctx), buildVipPayload(report, ctx));
}

function buildPayload(report: ReportRow, tier: SubscriptionTier, ctx: PayloadContext): Record<string, unknown> {
  if (tier === "admin") return buildAdminPayload(report, ctx);
  if (tier === "vip") return buildVipPayload(report, ctx);
  if (tier === "member") return buildMemberPayload(report, ctx);
  return buildPublicPayload(report, ctx);
}

type HistoryEvidence = {
  snapshots: Map<string, Record<string, unknown>>;
  members: Map<string, Record<string, unknown>>;
  runs: Record<string, unknown>[];
  queryBoundExceeded?: boolean;
};

async function loadHistoryEvidence(client: ReturnType<typeof createServiceClient>, rows: ReportRow[]): Promise<HistoryEvidence> {
  const unique = (values: unknown[]) => Array.from(new Set(values.map(toStringValue)
    .filter((value): value is string => Boolean(value))));
  const publicationIds = unique(rows.flatMap(row => [getAi(row).revision_id,
    resolveOpeningPublicationIdentity(row).opening_publication_revision_id]));
  const snapshotIds = unique([...publicationIds, ...rows.map(row =>
    asObject(getAi(row).closing_contract).closing_snapshot_id)]);
  const memberIds = unique(rows.map(row => getAi(row).canonical_member_revision_id));
  const reportIds = unique(rows.map(row => row.id));
  const receiptLimit = Math.max(1, publicationIds.length * 2);
  const empty = { data: [], error: null };
  // Three independent batch reads after the bounded report query: never one
  // context per report. Exact identity is checked by the shared authorities.
  const [snapshots, members, runs] = await Promise.all([
    snapshotIds.length ? client.from("decision_snapshots")
      .select("id,report_id,report_date,version,session_type,status,decision_mode,action,market_regime,confidence_score,coverage_score,content_score,content_grade,content_score_breakdown,reason_codes,source_refs,source_freshness,created_at,valid_from,generated_text")
      .in("id", snapshotIds).limit(90) : empty,
    memberIds.length ? client.from("member_content_revisions")
      .select("id,report_id,report_date,decision_snapshot_id,decision_snapshot_version,status,data_quality_status,member_content,canonical_contract,semantic_coherence_reviews(status,reason_codes,checked_at,canonical_snapshot_id,canonical_snapshot_version)")
      .in("id", memberIds).order("checked_at", { referencedTable: "semantic_coherence_reviews", ascending: false })
      .limit(1, { referencedTable: "semantic_coherence_reviews" }).limit(30) : empty,
    publicationIds.length ? client.from("pipeline_runs")
      .select("id,trading_date,status,idempotency_key,completed_at,provider_status")
      .in("provider_status->result->>decision_snapshot_id", publicationIds)
      .in("provider_status->result->>report_id", reportIds)
      .eq("status", "SUCCEEDED").like("idempotency_key", "research-input:%")
      .order("completed_at", { ascending: true }).limit(receiptLimit + 1) : empty,
  ]);
  for (const [source, result] of [["REVISION", snapshots], ["MEMBER", members], ["RECEIPT", runs]] as const) {
    if (result.error) throw new Error(`REPORT_HISTORY_${source}_QUERY_FAILED`);
  }
  const memberMap = new Map<string, Record<string, unknown>>();
  for (const value of members.data || []) {
    const member = asObject(value), reviews = asArray(member.semantic_coherence_reviews);
    const semantic = asObject(reviews[0]);
    const aligned = semantic.canonical_snapshot_id === member.decision_snapshot_id
      && semantic.canonical_snapshot_version === member.decision_snapshot_version;
    memberMap.set(String(member.id), { ...member, semantic_status: aligned ? semantic.status : null,
      semantic_reason_codes: aligned ? semantic.reason_codes : null });
  }
  return { snapshots: new Map((snapshots.data || []).map(row => [String(row.id), asObject(row)])),
    members: memberMap, runs: (runs.data || []).map(asObject),
    // A bounded result may be incomplete, never evidence for an arbitrary winner.
    queryBoundExceeded: (runs.data || []).length > receiptLimit };
}

/** Public market fields only. The source is a validated immutable CLOSING
 * receipt, never report aliases, a date-joined review, or individual stocks. */
function buildHistoryClosingVerdict(closing: Record<string, unknown>, verified: ReturnType<typeof evaluateClosingContract>): Record<string, unknown> {
  const quote = (value: unknown) => {
    const row = asObject(value);
    return { symbol: toStringValue(row.symbol), source: toStringValue(row.source),
      value: toNumberValue(row.value), change_percent: toNumberValue(row.change_percent),
      captured_at: toStringValue(row.captured_at), trading_date: toStringValue(row.trading_date),
      phase: toStringValue(row.phase) };
  };
  const prose = (value: unknown) => typeof value === "string" ? value
    : Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, 5) : null;
  const adjustment = asObject(closing.tomorrow_adjustment);
  return {
    status: closing.status, data_status: closing.data_status, report_date: closing.report_date,
    opening_decision_snapshot_id: closing.opening_decision_snapshot_id,
    opening_bias: toStringValue(closing.opening_bias), opening_confidence: toNumberValue(closing.opening_confidence),
    prediction_result: toStringValue(closing.hit_or_miss), actual_direction: toStringValue(closing.actual_direction),
    verified_at: toStringValue(closing.verified_at),
    // The real V2 producer omits this legacy field. Adapt only the shared
    // validator's measured market evidence, never infer completion from absence.
    missing_data: closing.missing_data === undefined ? verified.market_reason_codes
      : Array.isArray(closing.missing_data) && closing.missing_data.length === 0
        ? verified.market_reason_codes : ["CLOSING_MISSING_DATA_UNVERIFIED"],
    actual_taiex_change: toNumberValue(asObject(closing.actual_taiex_close).change_percent),
    actual_taiex_close: quote(closing.actual_taiex_close), actual_2330_close: quote(closing.actual_2330_close),
    actual_txf_close: quote(closing.actual_txf_close),
    what_was_right: prose(closing.what_was_right), what_was_wrong: prose(closing.what_was_wrong),
    tomorrow_adjustment: Object.keys(adjustment).length ? {
      keep: prose(adjustment.keep), downgrade: prose(adjustment.downgrade), watch_tomorrow: prose(adjustment.watch_tomorrow),
    } : prose(closing.tomorrow_adjustment),
  };
}

function buildHistorySummary(
  report: ReportRow,
  decision: Record<string, unknown> | null,
  evaluatedAt: string,
  evidence: HistoryEvidence = { snapshots: new Map(), members: new Map(), runs: [] },
  todayDate?: string,
): Record<string, unknown> {
  const ai = getAi(report);
  const reportDate = getReportDate(report);
  const revisionId = toStringValue(ai.revision_id);
  const runs = evidence.queryBoundExceeded ? [] : evidence.runs.filter(run => {
    const result = asObject(asObject(run.provider_status).result);
    return result.report_id === report.id && result.report_date === reportDate;
  });
  const openingIdentity = resolveOpeningPublicationIdentity(report);
  const openingSnapshot = evidence.snapshots.get(openingIdentity.opening_publication_revision_id) || null;
  const opening = runs.map(publicationRun => validateOpeningPublication({ report, snapshot: openingSnapshot,
    publicationRun, now: Date.parse(evaluatedAt) })).find(value => value.status === "PUBLISHED")
    || validateOpeningPublication({ report, snapshot: openingSnapshot, publicationRun: null, now: Date.parse(evaluatedAt) });
  const closingId = resolveClosingReceiptPointer(report, opening);
  const closingSnapshot = closingId ? evidence.snapshots.get(closingId) || null : null;
  const closingContract = evaluateClosingContract({ opening, closingSnapshot,
    expectedSnapshotId: closingId, now: Date.parse(evaluatedAt) });
  const closing = closingId && closingContract.status === "COMPLETE"
    ? buildHistoryClosingVerdict(asObject(asObject(closingSnapshot?.generated_text).closing_verification_v2), closingContract) : null;
  // A raw completed alias is deliberately absent from this reader input.
  const readerAi = { ...ai, is_trading_day: resolveMarketStatus(reportDate).is_trading_day,
    closing_verification_v2: closing, closing_verification: null };
  const readerReport = { ...report, ai_strategy_json: readerAi };
  const marketGate = evaluateMarketReportGate(ai, reportDate);
  const member = evidence.members.get(toStringValue(ai.canonical_member_revision_id) || "") || null;
  const deliveryOptions = { todayDate: todayDate || reportDate, now: evaluatedAt, premiumEligible: false, historicalRead: true };
  const delivered = runs.map(publicationRun => evaluatePublishedMarketDelivery(readerReport, decision, member,
    marketGate, { ...deliveryOptions, publicationRun })).find(value => value.eligible)
    || evaluatePublishedMarketDelivery(readerReport, decision, member, marketGate, deliveryOptions);
  const published = !evidence.queryBoundExceeded && delivered.eligible;
  const generatedAt = delivered.projection.identity.generatedAt || getGeneratedAt(report, ai);
  const subscriberState = createSubscriberState({
    report_date: reportDate, revision_id: revisionId || toStringValue(report.id), generated_at: generatedAt,
    publicationVerified: published, marketEvidenceReady: published,
    marketPublicationContract: ai.market_publication_contract,
    analysisStatus: decision?.status,
    isTradingDay: resolveMarketStatus(reportDate).is_trading_day,
    confidenceValue: delivered.projection.confidence.value,
    // Public history carries no stocks or private member/semantic body. It must not advertise
    // recommendations as qualified just because the market report is readable.
    recommendationGate: { status: "BLOCKED", eligible: false },
    closing, now: evaluatedAt,
  });
  if (evidence.queryBoundExceeded) subscriberState.reason_codes.push("HISTORY_EVIDENCE_QUERY_BOUND_EXCEEDED");
  const publication = asObject(ai.market_publication_contract);
  const publicRow = {
    report_id: toStringValue(report.id),
    report_date: reportDate, revision_id: subscriberState.revision_id, generated_at: generatedAt,
    today_date: todayDate || null, subscriber_state: subscriberState,
    market_publication_contract: ai.market_publication_contract === undefined ? undefined : {
      schema_version: toStringValue(publication.schema_version), status: toStringValue(publication.status),
      report_date: toStringValue(publication.report_date), revision_id: toStringValue(publication.revision_id),
      opening_publication_revision_id: toStringValue(publication.opening_publication_revision_id),
    },
    is_trading_day: resolveMarketStatus(reportDate).is_trading_day,
    market_bias: delivered.projection.marketDecision.bias,
    summary: delivered.projection.marketDecision.summary,
    closing_verification_v2: closing,
    closing_contract: closingContract.status === "COMPLETE" ? {
      schema_version: closingContract.schema_version, status: closingContract.status,
      report_date: closingContract.report_date,
      opening_publication_revision_id: closingContract.opening_publication_revision_id,
      closing_snapshot_id: closingContract.closing_snapshot_id,
      evidence_fingerprint: closingContract.evidence_fingerprint, verified_at: closingContract.verified_at,
    } : null,
  };
  const subscriberProjection = getSubscriberReportProjection({
    ...publicRow,
  }, { historical: true });
  const confidenceScore = subscriberProjection.confidence.value;
  const dailySentence = subscriberProjection.analysisAvailable
    ? subscriberProjection.marketDecision.summary ?? subscriberProjection.statusLabel
    : INCOMPLETE_ANALYSIS_MESSAGE;
  return {
    ...publicRow,
    subscriber_projection: subscriberProjection,
    closing_verification_v2: subscriberProjection.closing.result,
    closing_contract: subscriberProjection.closing.complete ? publicRow.closing_contract : null,
    market_bias: subscriberProjection.marketDecision.bias || "分析尚未完成",
    confidence_score: confidenceScore,
    confidence_label: getConfidenceLabel(confidenceScore),
    summary: dailySentence,
    today_quote: dailySentence,
  };
}

function getLockedSections(tier: SubscriptionTier): string[] {
  if (tier === "admin" || tier === "vip") return [];
  if (tier === "member") return MEMBER_LOCKED_SECTIONS;
  return PUBLIC_LOCKED_SECTIONS;
}

function createServiceClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type ServiceClient = ReturnType<typeof createServiceClient>;

function isPublishedReadAligned(report: ReportRow, context: PayloadContext): boolean {
  const ai = getAi(report);
  const revision = toStringValue(ai.revision_id);
  const memberRevision = toStringValue(ai.canonical_member_revision_id);
  // No committed pointer is an unpublished report, never a current-QA selector.
  if (!revision && !memberRevision) return context.decisionSnapshot == null;
  const decision = context.decisionSnapshot;
  if (!revision || !decision || decision.id !== revision
    || decision.report_id !== report.id || decision.report_date !== report.report_date) return false;
  // Published market identity does not depend on paid-note/QA eligibility.
  // The member reader independently checks its decision/date/report/semantic gate.
  return true;
}

/** Read the report's committed pointer, never the newest internal QA attempt.
 * A published intraday revision is valid regardless of its session label. */
function publishedDecisionQuery(serviceClient: ServiceClient, report: ReportRow) {
  return readPublishedMarketDecision(serviceClient, report);
}

async function publishedMemberQuery(serviceClient: ServiceClient, report: ReportRow) {
  return await readPublishedMemberRevision(serviceClient, report);
}

/** Runtime time is checked on the server. Elapsed time never creates success;
 * impossible future receipts are withheld without changing immutable DB rows. */
function observableTradingDayState(value: unknown, now = Date.now()): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = asObject(value);
  const checkpoints = asObject(state.checkpoint_status);
  return { ...state, checkpoint_status: Object.fromEntries(Object.entries(checkpoints).map(([key, raw]) => {
    const row = asObject(raw);
    const time = Date.parse(toStringValue(row.updated_at || row.completed_at) || "");
    const slot = /^\d{4}$/.test(key) ? Date.parse(`${state.trading_date}T${key.slice(0, 2)}:${key.slice(2)}:00+08:00`) : null;
    if ((Number.isFinite(time) && time > now) || (slot !== null && Number.isFinite(slot) && slot > now)) {
      return [key, { ...row, status: "INSUFFICIENT_DATA", metadata: { ...asObject(row.metadata), core_batch_complete: false, error_code: "FUTURE_RUNTIME_EVIDENCE" } }];
    }
    return [key, row];
  })) };
}

async function fetchPayloadContext(
  serviceClient: ServiceClient,
  report: ReportRow,
): Promise<PayloadContext> {
  // Reused by public envelope and tier-specific/nested projections even when
  // bounded evidence reads cross a checkpoint boundary during this request.
  const evaluatedAt = new Date().toISOString();
  const reportDate = getReportDate(report);
  const [
    radarResult,
    sectorResult,
    snapshotResult,
    publicationEvidence,
    tradingDayStateResult,
    closeReviewResult,
    learningRunResult,
    learningMetricCorrectionResult,
  ] = await Promise.all([
    serviceClient
      .from("opening_market_radar")
      .select("*")
      .eq("report_date", reportDate)
      .lte("captured_at", new Date().toISOString())
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    serviceClient
      .from("sector_rotation_scores")
      .select("score_date,sector,rotation_score,direction,signal_label,created_at")
      .eq("score_date", reportDate)
      .order("sector", { ascending: true }),
    serviceClient
      .from("market_data_snapshots")
      .select("symbol,name,market,value,change_percent,captured_at,source,phase,trading_date")
      .eq("trading_date", reportDate)
      .lte("captured_at", new Date().toISOString())
      .order("captured_at", { ascending: false })
      .limit(50),
    loadHistoryEvidence(serviceClient, [report]),
    serviceClient
      .from("trading_day_state")
      .select("trading_date,current_state,state_rank,checkpoint_status,updated_at")
      .eq("trading_date", reportDate)
      .maybeSingle(),
    serviceClient
      .from("close_market_reviews")
      .select("*")
      .eq("report_date", reportDate)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    serviceClient
      .from("learning_runs")
      .select("id,run_date,status,completed_at,predictions_processed,outcomes_updated,reviews_created,cases_created,patterns_updated,errors,metadata")
      .eq("run_date", reportDate)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    serviceClient
      .from("learning_metric_corrections")
      .select("id,business_date,learning_run_id,corrected_metrics,authoritative_counts,reason_code,created_at")
      .eq("business_date", reportDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (radarResult.error) console.error("GET_REPORT_PAYLOAD_RADAR_QUERY_FAILED", radarResult.error.message);
  if (sectorResult.error) console.error("GET_REPORT_PAYLOAD_SECTOR_QUERY_FAILED", sectorResult.error.message);
  if (snapshotResult.error) console.error("GET_REPORT_PAYLOAD_SNAPSHOT_QUERY_FAILED", snapshotResult.error.message);
  if (tradingDayStateResult.error) console.error("GET_REPORT_PAYLOAD_TRADING_DAY_STATE_QUERY_FAILED", tradingDayStateResult.error.message);
  if (closeReviewResult.error) console.error("GET_REPORT_PAYLOAD_CLOSE_REVIEW_QUERY_FAILED", closeReviewResult.error.message);
  if (learningRunResult.error) console.error("GET_REPORT_PAYLOAD_LEARNING_RUN_QUERY_FAILED", learningRunResult.error.message);
  if (learningMetricCorrectionResult.error) console.error("GET_REPORT_PAYLOAD_LEARNING_METRIC_CORRECTION_QUERY_FAILED", learningMetricCorrectionResult.error.message);

  const componentQueryFailures: PayloadContext["componentQueryFailures"] = [];
  if (radarResult.error) componentQueryFailures.push({ source: "opening_market_radar", error_type: "QUERY_FAILED" });
  if (sectorResult.error) componentQueryFailures.push({ source: "sector_rotation_scores", error_type: "QUERY_FAILED" });
  if (snapshotResult.error) componentQueryFailures.push({ source: "market_data_snapshots", error_type: "QUERY_FAILED" });
  if (tradingDayStateResult.error) componentQueryFailures.push({ source: "trading_day_state", error_type: "QUERY_FAILED" });
  if (closeReviewResult.error) componentQueryFailures.push({ source: "close_market_reviews", error_type: "QUERY_FAILED" });
  if (learningRunResult.error) componentQueryFailures.push({ source: "learning_runs", error_type: "QUERY_FAILED" });
  if (learningMetricCorrectionResult.error) componentQueryFailures.push({ source: "learning_metric_corrections", error_type: "QUERY_FAILED" });

  return {
    evaluatedAt,
    todayDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(evaluatedAt)),
    publicationEvidence,
    openingRadar: radarResult.data ? radarResult.data as Record<string, unknown> : null,
    sectorRotationRows: Array.isArray(sectorResult.data) ? sectorResult.data as Record<string, unknown>[] : [],
    marketDataSnapshots: Array.isArray(snapshotResult.data) ? snapshotResult.data as Record<string, unknown>[] : [],
    decisionSnapshot: publicationEvidence.snapshots.get(toStringValue(getAi(report).revision_id) || "") || null,
    closingDecisionSnapshot: publicationEvidence.snapshots.get(toStringValue(asObject(getAi(report).closing_contract).closing_snapshot_id) || "") || null,
    closeMarketReview: closeReviewResult.data ? closeReviewResult.data as Record<string, unknown> : null,
    learningRun: learningRunResult.data ? learningRunResult.data as Record<string, unknown> : null,
    learningMetricCorrection: learningMetricCorrectionResult.data ? learningMetricCorrectionResult.data as Record<string, unknown> : null,
    memberContentRevision: publicationEvidence.members.get(toStringValue(getAi(report).canonical_member_revision_id) || "") || null,
    tradingDayState: observableTradingDayState(tradingDayStateResult.data),
    componentQueryFailures,
  };
}

async function resolveTierFromRequest(
  req: Request,
  serviceClient: ServiceClient,
): Promise<{ tier: SubscriptionTier; userId: string | null; access: EffectiveMemberAccess | null }> {
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  if (bearer) {
    const { data, error } = await serviceClient.auth.getUser(bearer);
    if (!error && data.user) {
      // Do not trust client-supplied tier when Authorization is present.
      const [profileResult, entitlementResult] = await Promise.all([
        serviceClient
          .from("profiles")
          .select("role,subscription_status,membership_tier,paid_until")
          .eq("id", data.user.id)
          .maybeSingle(),
        serviceClient.rpc("ensure_member_entitlement_v1", { p_user_id: data.user.id }),
      ]);

      if (profileResult.error) {
        console.warn("GET_REPORT_PAYLOAD_PROFILE_LOOKUP_FAILED", profileResult.error.message);
        return { tier: "free", userId: data.user.id, access: null };
      }

      let entitlement = entitlementResult.data as MemberEntitlementRow | null;
      if (entitlementResult.error) {
        console.warn("GET_REPORT_PAYLOAD_ENTITLEMENT_ENSURE_FAILED", entitlementResult.error.message);
        const fallbackResult = await serviceClient
          .from("member_entitlements")
          .select("state,tier,source,access_started_at,access_ends_at,trial_started_at,trial_ends_at,current_period_end,cancel_at_period_end")
          .eq("user_id", data.user.id)
          .maybeSingle();
        entitlement = fallbackResult.data as MemberEntitlementRow | null;
      }

      const access = resolveEffectiveMemberAccess(
        profileResult.data as ProfileAccessRow | null,
        entitlement,
      );
      return {
        tier: access.tier,
        userId: data.user.id,
        access,
      };
    }
    return { tier: "free", userId: null, access: null };
  }

  // Anonymous requests are always free. Client URL/body values never grant entitlement.
  return { tier: "free", userId: null, access: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Only POST allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "Supabase credentials missing" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await readRequestBody(req);
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError || (error instanceof Error && error.message === "REQUEST_TOO_LARGE");
    return jsonResponse({
      success: false,
      error: tooLarge ? "REQUEST_TOO_LARGE" : "INVALID_JSON_BODY",
    }, tooLarge ? 413 : 400);
  }

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);

  const { tier, userId, access } = await resolveTierFromRequest(req, serviceClient);
  const todayDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

  if (body.history_limit !== undefined) {
    const requestedLimit = Math.trunc(Number(body.history_limit));
    const historyLimit = Number.isFinite(requestedLimit) ? Math.min(30, Math.max(1, requestedLimit)) : 7;
    const { data: historyRows, error: historyError } = await serviceClient
      .from("reports")
      .select("id,report_date,market_bias,confidence_score,summary,today_quote,created_at,updated_at,ai_strategy_json")
      .lte("report_date", todayDate)
      .order("report_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(historyLimit);
    if (historyError) {
      console.error("GET_REPORT_PAYLOAD_HISTORY_QUERY_FAILED", historyError.message);
      return jsonResponse({ success: false, error: "REPORT_HISTORY_QUERY_FAILED" }, 500);
    }
    const rows = Array.isArray(historyRows) ? historyRows.slice(0, historyLimit) as ReportRow[] : [];
    let historyEvidence: HistoryEvidence;
    try { historyEvidence = await loadHistoryEvidence(serviceClient, rows); }
    catch (error) {
      const code = error instanceof Error ? error.message : "REPORT_HISTORY_EVIDENCE_QUERY_FAILED";
      console.error("GET_REPORT_PAYLOAD_HISTORY_EVIDENCE_QUERY_FAILED", code);
      return jsonResponse({ success: false, error: code }, 500);
    }
    const evaluatedAt = new Date().toISOString();
    return jsonResponse({
      tier,
      today_date: todayDate,
      report_date: null,
      payload: null,
      reports: rows.map(row => buildHistorySummary(row,
        historyEvidence.snapshots.get(toStringValue(getAi(row).revision_id) || "") || null,
        evaluatedAt, historyEvidence, todayDate)),
      locked_sections: getLockedSections(tier),
      source: "server_trimmed_payload",
      authenticated: Boolean(userId),
      membership: access,
    });
  }

  let query = serviceClient
    .from("reports")
    .select("*")
    .lte("report_date", todayDate)
    .order("report_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (isValidDate(body.report_date)) {
    query = serviceClient
      .from("reports")
      .select("*")
      .eq("report_date", body.report_date)
      .lte("report_date", todayDate)
      .order("created_at", { ascending: false })
      .limit(1);
  }

  const { data, error } = await query;
  if (error) {
    console.error("GET_REPORT_PAYLOAD_REPORT_QUERY_FAILED", error.message);
    return jsonResponse({ success: false, error: "REPORT_QUERY_FAILED" }, 500);
  }

  let report = Array.isArray(data) && data.length > 0 ? data[0] as ReportRow : null;
  if (!report) {
    return jsonResponse({
      success: false,
      error: "REPORT_NOT_FOUND",
      tier,
      today_date: todayDate,
      report_date: isValidDate(body.report_date) ? body.report_date : null,
      payload: null,
      locked_sections: getLockedSections(tier),
      source: "server_trimmed_payload",
      membership: access,
    }, 404);
  }

  let context: PayloadContext;
  try { context = await fetchPayloadContext(serviceClient, report); }
  catch (error) {
    console.error("GET_REPORT_PAYLOAD_EVIDENCE_QUERY_FAILED", error instanceof Error ? error.message : "QUERY_FAILED");
    return jsonResponse({ success: false, error: "REPORT_EVIDENCE_QUERY_FAILED", payload: null }, 503);
  }
  if (!isPublishedReadAligned(report, context)) {
    // PostgREST requests are separate transactions. A publication may commit
    // between the report query and the context queries. Re-read at most once.
    const refreshed = await serviceClient.from("reports").select("*")
      .eq("id", report.id).eq("report_date", getReportDate(report)).limit(1).maybeSingle();
    if (refreshed.error || !refreshed.data) {
      return jsonResponse({ success: false, error: "REPORT_RECHECK_FAILED", payload: null }, 503);
    }
    report = refreshed.data as ReportRow;
    try { context = await fetchPayloadContext(serviceClient, report); }
    catch (error) {
      console.error("GET_REPORT_PAYLOAD_EVIDENCE_QUERY_FAILED", error instanceof Error ? error.message : "QUERY_FAILED");
      return jsonResponse({ success: false, error: "REPORT_EVIDENCE_QUERY_FAILED", payload: null }, 503);
    }
    if (!isPublishedReadAligned(report, context)) {
      return jsonResponse({ success: false, error: "REPORT_REVISION_CHANGED", report_date: getReportDate(report), payload: null }, 409);
    }
  }
  const publicMetadata = buildPublicPayload(report, context);
  const canonicalDecision = asObject(publicMetadata.canonical_decision);

  // Additive, read-only projection at the published decision's as-of time. Never
  // evaluate today's close against a morning revision or write back to reports.
  const decisionIdentity = {
    report_date: getReportDate(report),
    revision_id: toStringValue(canonicalDecision.id) || "",
    generated_at: toStringValue(publicMetadata.generated_at) || "",
    data_as_of: toStringValue(publicMetadata.generated_at) || "",
    is_trading_day: publicMetadata.is_trading_day === true,
    today_date: todayDate,
  };
  const realEvidence = await loadDecisionEvidence(async (request) => {
    let read = serviceClient.from(request.table).select(request.columns);
    for (const filter of request.filters) read = filter.operator === "lte"
      ? read.lte(filter.column, filter.value) : read.gte(filter.column, filter.value);
    return await read.order(request.order, { ascending: false }).limit(request.limit)
      .abortSignal(AbortSignal.timeout(4000));
  }, decisionIdentity);
  const payload = buildPayload(report, tier, context);
  const memberRows = asArray(payload.today_beneficiary_stocks);
  const decisionEvidence = projectEvidenceDecision(await sealEvidenceDecision(buildEvidenceDecision(realEvidence, decisionIdentity)), {
    companyContentAllowed: tier !== "free" && publicMetadata.premium_content_status === "eligible"
      && asObject(publicMetadata.recommendation_gate).eligible === true
      && isCanonicalMemberRevisionEligible(context),
    canonicalAction: toStringValue(canonicalDecision.action) || "WAIT",
    publishedSymbols: memberRows.map(r => toStringValue(asObject(r).symbol) || toStringValue(asObject(r).stock_code) || ""),
  });
  const published = asObject(publicMetadata.subscriber_state).publication === "PUBLISHED";
  const subscriberDecisionEvidence = published ? decisionEvidence : {
    ...decisionEvidence, action: "INSUFFICIENT_DATA", reason_summary: INCOMPLETE_ANALYSIS_MESSAGE,
    direction_probability: null, model_confidence: null, entry_environment_score: null,
    market_risk_score: null, direction_evidence_score: null, stock_opportunities: [],
    evidence_quality: "insufficient", data_freshness: "unavailable",
    issues: [...decisionEvidence.issues, "MARKET_ANALYSIS_UNPUBLISHED"],
  };
  payload.decision_engine_v1 = subscriberDecisionEvidence;
  // Admin has a nested effective-AI view as well; no stale nested model may win.
  if (tier === "admin") payload.ai_strategy_json = { ...asObject(payload.ai_strategy_json), decision_engine_v1: subscriberDecisionEvidence };
  // Subscriber routes (including Owner browsing them) use one projection. The
  // existing admin nested raw document remains an explicitly internal QA view.
  const subscriberProjection = getSubscriberReportProjection({ ...payload, today_date: todayDate });
  payload.subscriber_projection = subscriberProjection;

  return jsonResponse({
    tier,
    today_date: todayDate,
    report_date: getReportDate(report),
    revision_id: toStringValue(canonicalDecision.id) || toStringValue(report.id),
    generated_at: publicMetadata.generated_at,
    data_as_of: publicMetadata.data_as_of,
    market_status: publicMetadata.market_status,
    is_trading_day: publicMetadata.is_trading_day,
    subscriber_state: publicMetadata.subscriber_state,
    subscriber_projection: subscriberProjection,
    payload,
    locked_sections: getLockedSections(tier),
    source: "server_trimmed_payload",
    authenticated: Boolean(userId),
    membership: access,
  });
});
