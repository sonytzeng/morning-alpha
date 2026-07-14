export type ResearchSourceStatus =
  | "complete"
  | "partial"
  | "insufficient"
  | "legacy_mapped";
export type ResearchPublishStatus = "ready" | "degraded" | "blocked";
export type ResearchEvidenceStrength = "strong" | "medium" | "weak";
export type ResearchStockRole =
  | "leader"
  | "confirmation"
  | "transmission"
  | "breadth"
  | "risk_proxy";
export type ResearchDataStatus = "complete" | "partial" | "insufficient";

export interface ExecutiveSummarySection {
  section_id: "executive_summary";
  text: string;
  claim_id: string;
  evidence_refs: string[];
}

export interface WhyTodayMattersSection {
  section_id: "why_today_matters";
  narrative: string;
  overnight_event_ids: string[];
  what_changed: string;
  why_now: string;
  evidence_refs: string[];
}

export interface CoreThesisSection {
  section_id: "core_thesis";
  thesis_id: string;
  statement: string;
  confidence: number | null;
  confidence_reason: string;
  status: "proposed" | "insufficient";
  evidence_refs: string[];
}

export type TransmissionStage =
  | "global_event"
  | "us_market"
  | "industry"
  | "capital"
  | "taiwan_market"
  | "representative_stock"
  | "validation";

export interface TransmissionPathNode {
  node_id: string;
  stage: TransmissionStage;
  subject: string;
  claim: string;
  evidence_refs: string[];
}

export interface TransmissionNarrativeSection {
  section_id: "transmission_narrative";
  narrative: string;
  path: TransmissionPathNode[];
  primary_validation_axis: string;
}

export interface SupportingEvidenceItem {
  claim_id: string;
  statement: string;
  evidence_refs: string[];
  strength: ResearchEvidenceStrength;
  role: "primary" | "confirming";
}

export interface CounterEvidenceItem {
  claim_id: string;
  statement: string;
  evidence_refs: string[];
  severity: "watch" | "threat" | "invalidating";
  implication: string;
}

export interface RepresentativeStockItem {
  stock_id: string;
  symbol: string;
  name: string;
  role: ResearchStockRole;
  reason: string;
  confirmation: string;
  invalidation: string;
  evidence_refs: string[];
  data_status: ResearchDataStatus;
}

export interface DecisionGuideSection {
  section_id: "decision_guide";
  current_action: string;
  first_watch: string;
  avoid_actions: string[];
  next_checkpoint_id: string;
  next_checkpoint_time: string;
  risk_level: "low" | "medium" | "high" | "unknown";
}

export interface ResearchCheckpoint {
  checkpoint_id: string;
  time: string;
  purpose: string;
  question: string;
  expected_signal: string;
  success_condition: string;
  failure_condition: string;
}

export interface FailureTrigger {
  claim_id: string;
  condition: string;
  meaning: string;
  severity: "warning" | "invalidating";
  evidence_required: string[];
}

export interface FailureScenarioSection {
  section_id: "failure_scenario";
  narrative: string;
  triggers: FailureTrigger[];
  stop_action: string;
}

export interface NextActionBranch {
  action: string;
  what_to_promote?: string[];
  what_to_downgrade?: string[];
  next_checkpoint_id: string;
}

export interface NextActionSection {
  section_id: "next_action";
  if_success: NextActionBranch & { what_to_promote: string[] };
  if_failure: NextActionBranch & { what_to_downgrade: string[] };
}

export interface ReelsSummarySection {
  section_id: "reels_summary";
  source_section_ids: string[];
  hook_0_5_sec: string;
  context_5_15_sec: string;
  thesis_15_30_sec: string;
  action_30_42_sec: string;
  risk_42_52_sec: string;
  close_52_60_sec: string;
  full_script: string;
  target_duration_seconds: 60;
}

export interface ResearchMasterQuality {
  evidence_coverage: number;
  unsupported_claims: string[];
  duplicate_claims: string[];
  contradictions: string[];
  missing_sections: string[];
  publish_status: ResearchPublishStatus;
}

export interface ResearchMasterV2 {
  schema_version: "2.0";
  research_id: string;
  thesis_id: string;
  revision: number;
  report_date: string;
  today_date: string;
  data_as_of: string | null;
  timezone: "Asia/Taipei";
  market_status: "OPEN" | "CLOSED";
  is_trading_day: boolean;
  report_mode: string;
  provenance: {
    engine_version: string;
    prompt_version: string | null;
    evidence_pack_version: string | null;
    generated_at: string;
    source_status: ResearchSourceStatus;
  };
  sections: {
    executive_summary: ExecutiveSummarySection;
    why_today_matters: WhyTodayMattersSection;
    core_thesis: CoreThesisSection;
    transmission_narrative: TransmissionNarrativeSection;
    supporting_evidence: SupportingEvidenceItem[];
    counter_evidence: CounterEvidenceItem[];
    representative_stocks: RepresentativeStockItem[];
    decision_guide: DecisionGuideSection;
    timeline: ResearchCheckpoint[];
    failure_scenario: FailureScenarioSection;
    next_action: NextActionSection;
    reels_summary: ReelsSummarySection;
  };
  quality: ResearchMasterQuality;
}

export interface ResearchEvidenceItem {
  evidence_id: string;
  evidence_type?: string;
  source?: string;
  title?: string;
  summary?: string;
  importance?: number;
  freshness?: string;
  raw_reference?: string;
}

export interface ResearchMasterV2AssemblerInput {
  reportDate: string;
  todayDate: string;
  dataAsOf: string | null;
  engineVersion: string;
  promptVersion: string | null;
  generatedAt: string;
  reportMode: string;
  marketStatus: "OPEN" | "CLOSED";
  isTradingDay: boolean;
  legacy: Record<string, unknown>;
  evidencePack: Record<string, unknown>;
  normalizedEvidence: Record<string, unknown>;
  evidenceIndex: ResearchEvidenceItem[];
  candidateUniverse: Record<string, unknown>;
  marketThesis: Record<string, unknown> | null;
}

export interface ResearchMasterValidationResult {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
  quality: ResearchMasterQuality;
}

const SECTION_IDS = [
  "executive_summary",
  "why_today_matters",
  "core_thesis",
  "transmission_narrative",
  "supporting_evidence",
  "counter_evidence",
  "representative_stocks",
  "decision_guide",
  "timeline",
  "failure_scenario",
  "next_action",
  "reels_summary",
] as const;

const CHECKPOINT_DEFINITIONS = [
  { time: "08:30", purpose: "確認盤前研究假設與資料完整度" },
  { time: "09:00", purpose: "確認開盤是否接受盤前研究假設" },
  { time: "11:00", purpose: "確認主線、量能與族群擴散" },
  { time: "13:00", purpose: "確認午後資金方向是否改變" },
  { time: "13:30", purpose: "決定是否修正今日原始假設" },
  { time: "14:10", purpose: "以收盤資料驗證今日研究判斷" },
] as const;

const INSUFFICIENT_TEXT = "資料不足，無法建立可驗證的研究主軸。";
const CHECKPOINT_INSUFFICIENT_TEXT = "資料不足，等待該時段更新。";
const CLOSED_CHECKPOINT_TEXT = "今日休市，此節點不適用。";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    : [];
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(toText).filter(Boolean);
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
    if (Array.isArray(value)) {
      const nested = value.map(toText).find(Boolean);
      if (nested) return nested;
    }
  }
  return "";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function compactTextParts(values: unknown[]): string {
  return uniqueStrings(
    values.flatMap((value) =>
      Array.isArray(value) ? value.map(toText) : [toText(value)]
    ).filter(Boolean),
  ).join("；");
}

function firstSentence(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const match = text.match(/^.*?[。！？!?](?=\s|$|[^。！？!?])/u);
  return (match?.[0] || text).trim();
}

function normalizedForHash(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const char of normalizedForHash(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function safeIdPart(value: string): string {
  return normalizedForHash(value).replace(/[^a-z0-9._-]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  ) || "unknown";
}

function claimId(
  reportDate: string,
  section: string,
  statement: string,
): string {
  return `claim:${reportDate}:${safeIdPart(section)}:${stableHash(statement)}`;
}

function nodeId(reportDate: string, stage: string, statement: string): string {
  return `node:${reportDate}:${safeIdPart(stage)}:${stableHash(statement)}`;
}

function checkpointId(reportDate: string, time: string): string {
  return `checkpoint:${reportDate}:${time.replace(":", "")}`;
}

function evidenceIdSet(evidenceIndex: ResearchEvidenceItem[]): Set<string> {
  return new Set(evidenceIndex.map((item) => item.evidence_id).filter(Boolean));
}

function evidenceRefsFromUnknown(
  value: unknown,
  allowed: Set<string>,
): string[] {
  const refs: string[] = [];
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      if (allowed.has(item)) refs.push(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    const record = asRecord(item);
    const id = firstText(record.evidence_id, record.id);
    if (allowed.has(id)) refs.push(id);
  };
  visit(value);
  return uniqueStrings(refs);
}

function searchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function matchingEvidenceRefs(
  texts: string[],
  evidenceIndex: ResearchEvidenceItem[],
): string[] {
  const haystacks = texts.map(searchText).filter(Boolean);
  if (haystacks.length === 0) return [];
  const refs: string[] = [];
  for (const evidence of evidenceIndex) {
    const needles = [evidence.title, evidence.raw_reference]
      .map((value) => searchText(toText(value)))
      .filter((value) => value.length >= 2);
    if (
      needles.some((needle) =>
        haystacks.some((haystack) =>
          haystack.includes(needle) || needle.includes(haystack)
        )
      )
    ) {
      refs.push(evidence.evidence_id);
    }
  }
  return uniqueStrings(refs);
}

function resolveEvidenceRefs(
  value: unknown,
  texts: string[],
  evidenceIndex: ResearchEvidenceItem[],
): string[] {
  return uniqueStrings([
    ...evidenceRefsFromUnknown(value, evidenceIdSet(evidenceIndex)),
    ...matchingEvidenceRefs(texts, evidenceIndex),
  ]);
}

function evidenceById(
  evidenceIndex: ResearchEvidenceItem[],
): Map<string, ResearchEvidenceItem> {
  return new Map(evidenceIndex.map((item) => [item.evidence_id, item]));
}

function boundedConfidence(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0 && number <= 100) {
      return Math.round(number);
    }
  }
  return null;
}

function sourceStatus(
  input: ResearchMasterV2AssemblerInput,
  hasLegacyResearch: boolean,
): ResearchSourceStatus {
  if (input.evidenceIndex.length === 0) return "insufficient";
  const thesis = input.marketThesis || {};
  const hasV10Thesis = Boolean(
    firstText(thesis.primary_driver, thesis.market_story),
  );
  const dataQuality = asRecord(input.evidencePack.data_quality);
  const missing = Array.isArray(dataQuality.missing_sources)
    ? dataQuality.missing_sources.length
    : 0;
  if (hasV10Thesis && missing === 0) return "complete";
  if (hasV10Thesis) return "partial";
  return hasLegacyResearch ? "legacy_mapped" : "insufficient";
}

function primaryResearchText(
  legacy: Record<string, unknown>,
  note: Record<string, unknown>,
  thesis: Record<string, unknown>,
): string {
  const opening = asRecord(note.opening_thesis);
  const v8Sentence = asRecord(legacy.v8_daily_sentence);
  return firstText(
    note.today_core_thesis,
    opening.summary,
    thesis.market_story,
    thesis.primary_driver,
    v8Sentence.sentence,
    legacy.primary_driver,
    legacy.market_story,
    legacy.taiwan_transmission,
    legacy.today_quote,
    asRecord(legacy.free_summary).one_sentence,
  );
}

function buildTransmissionPath(
  input: ResearchMasterV2AssemblerInput,
  note: Record<string, unknown>,
): TransmissionPathNode[] {
  const paths: TransmissionPathNode[] = [];
  const add = (
    stage: TransmissionStage,
    subject: string,
    claim: string,
    rawRefs: unknown = [],
  ): void => {
    const statement = firstText(claim);
    if (!statement) return;
    paths.push({
      node_id: nodeId(input.reportDate, stage, statement),
      stage,
      subject: firstText(subject, statement),
      claim: statement,
      evidence_refs: resolveEvidenceRefs(
        rawRefs,
        [subject, statement],
        input.evidenceIndex,
      ),
    });
  };

  const memberChains = asRecords(note.overnight_chain);
  for (const chain of memberChains.slice(0, 3)) {
    add(
      "global_event",
      firstText(chain.event_group, chain.event),
      firstText(chain.event),
      chain.evidence_refs,
    );
    add(
      "us_market",
      firstText(chain.source_market),
      firstText(chain.source_market),
      chain.evidence_refs,
    );
    add(
      "industry",
      firstText(chain.event, chain.source_market),
      firstText(chain.impact_logic),
      chain.evidence_refs,
    );
    add(
      "taiwan_market",
      firstText(chain.taiwan_mapping),
      firstText(chain.taiwan_mapping),
      chain.evidence_refs,
    );
    for (const validation of asStrings(chain.validation_points).slice(0, 2)) {
      add("validation", "盤中驗證", validation, chain.evidence_refs);
    }
  }

  if (paths.length === 0) {
    const v8 = asRecord(input.legacy.v8_overnight_causal_chain);
    const stageOrder: TransmissionStage[] = [
      "global_event",
      "us_market",
      "industry",
      "capital",
      "taiwan_market",
      "representative_stock",
      "validation",
    ];
    for (const chain of asRecords(v8.chains).slice(0, 3)) {
      const steps = asStrings(chain.causal_steps);
      steps.forEach((step, index) =>
        add(
          stageOrder[Math.min(index, stageOrder.length - 1)],
          firstText(chain.theme, chain.event),
          step,
          chain.source_signals,
        )
      );
      asStrings(chain.watch_points).slice(0, 2).forEach((watch) =>
        add("validation", "盤中驗證", watch, chain.source_signals)
      );
    }
  }

  const unique = new Map<string, TransmissionPathNode>();
  for (const path of paths) {
    const key = `${path.stage}:${normalizedForHash(path.claim)}`;
    if (!unique.has(key)) unique.set(key, path);
  }
  return Array.from(unique.values());
}

function buildSupportingEvidence(
  input: ResearchMasterV2AssemblerInput,
  coreStatement: string,
  coreRefs: string[],
): SupportingEvidenceItem[] {
  const thesis = input.marketThesis || {};
  const index = evidenceById(input.evidenceIndex);
  const explicitRefs = evidenceRefsFromUnknown(
    thesis.supporting_evidence,
    evidenceIdSet(input.evidenceIndex),
  );
  const refs = explicitRefs.length > 0 ? explicitRefs : coreRefs;
  return refs.map((ref, indexPosition) => {
    const evidence = index.get(ref);
    const statement = firstText(
      evidence?.summary,
      evidence?.title,
      coreStatement,
    );
    const importance = Number(evidence?.importance ?? 0);
    return {
      claim_id: claimId(
        input.reportDate,
        "supporting_evidence",
        `${ref}:${statement}`,
      ),
      statement,
      evidence_refs: [ref],
      strength: importance >= 80
        ? "strong"
        : importance >= 50
        ? "medium"
        : "weak",
      role: indexPosition === 0 ? "primary" : "confirming",
    };
  });
}

function buildCounterEvidence(
  input: ResearchMasterV2AssemblerInput,
  note: Record<string, unknown>,
): CounterEvidenceItem[] {
  const thesis = input.marketThesis || {};
  const index = evidenceById(input.evidenceIndex);
  const result: CounterEvidenceItem[] = [];
  const explicitRefs = evidenceRefsFromUnknown(
    thesis.counter_evidence,
    evidenceIdSet(input.evidenceIndex),
  );
  for (const ref of explicitRefs) {
    const evidence = index.get(ref);
    const statement = firstText(evidence?.summary, evidence?.title);
    if (!statement) continue;
    result.push({
      claim_id: claimId(
        input.reportDate,
        "counter_evidence",
        `${ref}:${statement}`,
      ),
      statement,
      evidence_refs: [ref],
      severity: Number(evidence?.importance ?? 0) >= 80 ? "threat" : "watch",
      implication: firstText(
        thesis.bear_case,
        "此證據要求降低原研究主軸的確信度。",
      ),
    });
  }
  for (const alternative of asRecords(thesis.alternative_hypotheses)) {
    const statement = firstText(alternative.driver);
    if (!statement) continue;
    result.push({
      claim_id: claimId(input.reportDate, "alternative_hypothesis", statement),
      statement,
      evidence_refs: resolveEvidenceRefs(alternative.supporting_evidence, [
        statement,
      ], input.evidenceIndex),
      severity: "watch",
      implication: firstText(alternative.why_rejected, thesis.bear_case),
    });
  }
  const invalidations = [
    ...asRecords(note.invalidation_rules),
    ...asRecords(note.invalidation_conditions),
    ...asRecords(input.legacy.invalidation_conditions),
  ];
  for (const invalidation of invalidations) {
    const statement = firstText(invalidation.condition);
    if (!statement) continue;
    result.push({
      claim_id: claimId(input.reportDate, "invalidation", statement),
      statement,
      evidence_refs: resolveEvidenceRefs(invalidation.evidence_refs, [
        statement,
      ], input.evidenceIndex),
      severity:
        /失效|停止|反向/.test(`${statement}${firstText(invalidation.meaning)}`)
          ? "invalidating"
          : "threat",
      implication: firstText(
        invalidation.meaning,
        invalidation.action_note,
        invalidation.required_adjustment,
      ),
    });
  }
  const unique = new Map<string, CounterEvidenceItem>();
  result.forEach((item) => {
    const key = normalizedForHash(item.statement);
    if (!unique.has(key)) unique.set(key, item);
  });
  return Array.from(unique.values());
}

interface StockSource {
  record: Record<string, unknown>;
  role: ResearchStockRole;
}

function stockSymbol(record: Record<string, unknown>): string {
  return firstText(record.symbol, record.stock_code, record.stock_id)
    .toUpperCase();
}

function mapStockRole(
  record: Record<string, unknown>,
  fallback: ResearchStockRole,
): ResearchStockRole {
  const raw = firstText(
    record.role,
    record.observation_role,
    record.decision_role,
  ).toUpperCase();
  if (/LEADER|MAIN_THESIS|CORE/.test(raw)) return "leader";
  if (/CONFIRM/.test(raw)) return "confirmation";
  if (/RISK|STOP/.test(raw)) return "risk_proxy";
  if (/BREADTH|CAPITAL_NEXT|ROTATION/.test(raw)) return "breadth";
  if (/TRANSMISSION/.test(raw)) return "transmission";
  return fallback;
}

function candidateUniverseRefs(
  input: ResearchMasterV2AssemblerInput,
  symbol: string,
): string[] {
  const candidate = asRecords(input.candidateUniverse.candidates).find((item) =>
    stockSymbol(item) === symbol
  );
  return resolveEvidenceRefs(
    candidate?.related_evidence,
    [symbol],
    input.evidenceIndex,
  );
}

function buildRepresentativeStocks(
  input: ResearchMasterV2AssemblerInput,
  note: Record<string, unknown>,
): RepresentativeStockItem[] {
  const sources: StockSource[] = [
    ...asRecords(note.beneficiary_candidates).map((record) => ({
      record,
      role: "transmission" as const,
    })),
    ...asRecords(input.legacy.today_beneficiary_stocks_v10).map((record) => ({
      record,
      role: "leader" as const,
    })),
    ...asRecords(input.legacy.v10_observation_watchlist).map((record) => ({
      record,
      role: "confirmation" as const,
    })),
    ...asRecords(asRecord(input.legacy.v8_beneficiary_chain).beneficiaries).map(
      (record) => ({ record, role: "transmission" as const }),
    ),
  ];
  const result = new Map<string, RepresentativeStockItem>();
  for (const source of sources) {
    const record = source.record;
    const symbol = stockSymbol(record);
    if (!symbol) continue;
    const benefitChain = asStrings(record.benefit_chain).length > 0
      ? asStrings(record.benefit_chain).join(" → ")
      : asStrings(record.reason_chain).join(" → ");
    const reason = firstText(
      record.reason,
      record.why_this_stock,
      record.relationship_to_thesis,
      record.observation_reason,
      record.narrative,
      benefitChain,
    );
    const confirmation = firstText(
      record.confirmation,
      record.validation_signal,
      record.watch_point,
      record.validation_point,
      record.confirmation_pending_reason,
      record.intraday_validation,
    );
    const invalidation = firstText(
      record.invalidation,
      record.invalidation_condition,
      record.risk,
      record.risk_note,
      record.stop_observing_condition,
      record.stop_condition,
    );
    const refs = uniqueStrings([
      ...candidateUniverseRefs(input, symbol),
      ...resolveEvidenceRefs(record.evidence_refs, [
        symbol,
        reason,
        confirmation,
        invalidation,
        ...asStrings(record.evidence),
      ], input.evidenceIndex),
    ]);
    const complete = Boolean(
      reason && confirmation && invalidation && refs.length > 0,
    );
    const partial = Boolean(
      reason || confirmation || invalidation || refs.length > 0,
    );
    const item: RepresentativeStockItem = {
      stock_id: `stock:${input.reportDate}:${symbol}`,
      symbol,
      name: firstText(record.name, record.stock_name, symbol),
      role: mapStockRole(record, source.role),
      reason,
      confirmation,
      invalidation,
      evidence_refs: refs,
      data_status: complete ? "complete" : partial ? "partial" : "insufficient",
    };
    const existing = result.get(symbol);
    if (!existing) {
      result.set(symbol, item);
      continue;
    }
    result.set(symbol, {
      ...existing,
      name: firstText(existing.name, item.name),
      reason: firstText(existing.reason, item.reason),
      confirmation: firstText(existing.confirmation, item.confirmation),
      invalidation: firstText(existing.invalidation, item.invalidation),
      evidence_refs: uniqueStrings([
        ...existing.evidence_refs,
        ...item.evidence_refs,
      ]),
      data_status:
        existing.data_status === "complete" || item.data_status === "complete"
          ? "complete"
          : existing.data_status === "partial" || item.data_status === "partial"
          ? "partial"
          : "insufficient",
    });
  }
  return Array.from(result.values());
}

function parseMinutes(value: string): number | null {
  const match = value.match(/(?:^|\D)(\d{1,2}):(\d{2})(?:\D|$)/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function timelineSources(
  note: Record<string, unknown>,
  legacy: Record<string, unknown>,
): Record<string, unknown>[] {
  const plan = asRecord(legacy.intraday_validation_plan);
  const planRows: Record<string, unknown>[] = [
    {
      time: "09:00",
      purpose: plan.open_0900_0930,
      what_to_watch: plan.open_0900_0930,
    },
    {
      time: "11:00",
      purpose: plan.mid_session_1000_1130,
      what_to_watch: plan.mid_session_1000_1130,
    },
    {
      time: "13:00",
      purpose: plan.afternoon_1300_1330,
      what_to_watch: plan.afternoon_1300_1330,
    },
  ].filter((item) => firstText(item.what_to_watch));
  return [
    ...asRecords(note.intraday_time_windows),
    ...asRecords(note.intraday_validation),
    ...planRows,
  ];
}

function buildTimeline(
  input: ResearchMasterV2AssemblerInput,
  note: Record<string, unknown>,
): ResearchCheckpoint[] {
  const assignments = new Map<
    string,
    { record: Record<string, unknown>; distance: number }
  >();
  for (const record of timelineSources(note, input.legacy)) {
    const timeText = firstText(record.time, record.time_window, record.window);
    const minutes = parseMinutes(timeText);
    if (minutes === null) continue;
    let selected: (typeof CHECKPOINT_DEFINITIONS)[number] =
      CHECKPOINT_DEFINITIONS[0];
    let selectedDistance = Number.POSITIVE_INFINITY;
    for (const checkpoint of CHECKPOINT_DEFINITIONS) {
      const checkpointMinutes = parseMinutes(checkpoint.time) ?? 0;
      const distance = Math.abs(checkpointMinutes - minutes);
      if (distance < selectedDistance) {
        selected = checkpoint;
        selectedDistance = distance;
      }
    }
    const previous = assignments.get(selected.time);
    if (!previous || selectedDistance < previous.distance) {
      assignments.set(selected.time, { record, distance: selectedDistance });
    }
  }
  const closing = asRecord(note.closing_feedback_plan);
  const rootClosing = asRecord(input.legacy.closing_feedback_plan);
  const closingRecord = Object.keys(closing).length > 0 ? closing : rootClosing;
  if (Object.keys(closingRecord).length > 0) {
    assignments.set("14:10", { record: closingRecord, distance: 0 });
  }

  return CHECKPOINT_DEFINITIONS.map((definition) => {
    const record = assignments.get(definition.time)?.record || {};
    const unavailable = input.marketStatus === "CLOSED"
      ? CLOSED_CHECKPOINT_TEXT
      : CHECKPOINT_INSUFFICIENT_TEXT;
    return {
      checkpoint_id: checkpointId(input.reportDate, definition.time),
      time: definition.time,
      purpose: definition.purpose,
      question: input.marketStatus === "CLOSED"
        ? CLOSED_CHECKPOINT_TEXT
        : firstText(
          record.question,
          record.what_to_watch,
          record.purpose,
          record.what_to_compare,
          unavailable,
        ),
      expected_signal: input.marketStatus === "CLOSED"
        ? CLOSED_CHECKPOINT_TEXT
        : firstText(
          record.expected_signal,
          record.signals_to_watch,
          record.neutral_condition,
          record.what_to_watch,
          unavailable,
        ),
      success_condition: input.marketStatus === "CLOSED"
        ? CLOSED_CHECKPOINT_TEXT
        : firstText(
          record.success_condition,
          record.bullish_confirmation,
          record.bullish_confirm,
          record.success_criteria,
          unavailable,
        ),
      failure_condition: input.marketStatus === "CLOSED"
        ? CLOSED_CHECKPOINT_TEXT
        : firstText(
          record.failure_condition,
          record.bearish_warning,
          record.bearish_fail,
          record.miss_reason_tracking,
          unavailable,
        ),
    };
  });
}

function decisionStepRecord(
  legacy: Record<string, unknown>,
): Record<string, unknown> {
  const step = legacy.decision_step;
  return typeof step === "string" ? { action: step } : asRecord(step);
}

function riskLevelFrom(
  ...values: unknown[]
): "low" | "medium" | "high" | "unknown" {
  for (const value of values) {
    const text = toText(value).toLowerCase();
    if (/high|高/.test(text)) return "high";
    if (/medium|mid|中/.test(text)) return "medium";
    if (/low|低/.test(text)) return "low";
  }
  return "unknown";
}

function buildFailureScenario(
  input: ResearchMasterV2AssemblerInput,
  note: Record<string, unknown>,
  counterEvidence: CounterEvidenceItem[],
): FailureScenarioSection {
  const rules = [
    ...asRecords(note.invalidation_rules),
    ...asRecords(note.invalidation_conditions),
    ...asRecords(input.legacy.invalidation_conditions),
  ];
  const triggers: FailureTrigger[] = [];
  for (const rule of rules) {
    const condition = firstText(rule.condition);
    if (!condition) continue;
    const meaning = firstText(
      rule.meaning,
      rule.action_note,
      rule.required_adjustment,
    );
    triggers.push({
      claim_id: claimId(input.reportDate, "failure_scenario", condition),
      condition,
      meaning,
      severity: /失效|停止|反向/.test(`${condition}${meaning}`)
        ? "invalidating"
        : "warning",
      evidence_required: resolveEvidenceRefs(rule.evidence_refs, [
        condition,
        meaning,
      ], input.evidenceIndex),
    });
  }
  if (triggers.length === 0) {
    counterEvidence.filter((item) => item.severity === "invalidating").forEach(
      (item) => {
        triggers.push({
          claim_id: item.claim_id,
          condition: item.statement,
          meaning: item.implication,
          severity: "invalidating",
          evidence_required: item.evidence_refs,
        });
      },
    );
  }
  const stopAction = firstText(
    ...rules.map((rule) =>
      firstText(rule.action_note, rule.required_adjustment)
    ),
    asRecord(input.legacy.free_summary).do_not_do,
    input.marketStatus === "CLOSED" ? "今日休市，不執行盤中研究決策。" : "",
    CHECKPOINT_INSUFFICIENT_TEXT,
  );
  return {
    section_id: "failure_scenario",
    narrative: compactTextParts(
      triggers.map((item) => item.meaning || item.condition),
    ) || INSUFFICIENT_TEXT,
    triggers,
    stop_action: stopAction,
  };
}

function buildInitialQuality(): ResearchMasterQuality {
  return {
    evidence_coverage: 0,
    unsupported_claims: [],
    duplicate_claims: [],
    contradictions: [],
    missing_sections: [],
    publish_status: "blocked",
  };
}

export function assembleResearchMasterV2(
  input: ResearchMasterV2AssemblerInput,
): ResearchMasterV2 {
  const legacy = input.legacy;
  const note = asRecord(legacy.member_research_note_v2);
  const thesis = input.marketThesis || {};
  const opening = asRecord(note.opening_thesis);
  const coreStatementRaw = primaryResearchText(legacy, note, thesis);
  const coreStatement = firstSentence(coreStatementRaw) || INSUFFICIENT_TEXT;
  const openingSignals = asStrings(opening.signals);
  const thesisRefs = resolveEvidenceRefs(
    [thesis.supporting_evidence, opening.evidence_refs],
    [
      coreStatement,
      firstText(thesis.primary_driver),
      firstText(thesis.market_story),
      ...openingSignals,
    ],
    input.evidenceIndex,
  );
  const thesisId = `thesis:${input.reportDate}:primary`;
  const researchId = `research:${input.reportDate}:${
    safeIdPart(input.engineVersion)
  }`;
  const hasResearch = coreStatement !== INSUFFICIENT_TEXT;
  const status = sourceStatus(input, hasResearch);
  const transmissionPath = buildTransmissionPath(input, note);
  const intraday = asRecords(note.intraday_validation);
  const coreReasoning = asStrings(note.core_reasoning);
  const marketContext = asRecord(input.normalizedEvidence.market_context);
  const previousValidation = asRecord(
    input.normalizedEvidence.previous_validation,
  );
  const whyNarrative = compactTextParts([
    ...asRecords(note.overnight_chain).flatMap((
      chain,
    ) => [chain.event, chain.impact_logic, chain.taiwan_mapping]),
    thesis.market_story,
    marketContext.macro_summary,
  ]) || INSUFFICIENT_TEXT;
  const whatChanged = firstText(
    marketContext.primary_event,
    previousValidation.summary,
    previousValidation.previous_market_bias,
    asRecords(note.overnight_chain)[0]?.event,
    INSUFFICIENT_TEXT,
  );
  const primaryValidationAxis = firstText(
    thesis.primary_validation_axis,
    intraday[0]?.what_to_watch,
    asRecord(legacy.intraday_validation_plan).open_0900_0930,
    CHECKPOINT_INSUFFICIENT_TEXT,
  );
  const supportingEvidence = buildSupportingEvidence(
    input,
    coreStatement,
    thesisRefs,
  );
  const counterEvidence = buildCounterEvidence(input, note);
  const representativeStocks = buildRepresentativeStocks(input, note);
  const timeline = buildTimeline(input, note);
  const failureScenario = buildFailureScenario(input, note, counterEvidence);
  const freeSummary = asRecord(legacy.free_summary);
  const step = decisionStepRecord(legacy);
  const firstIntraday = intraday[0] || {};
  const nextCheckpointTime = firstText(
    step.time,
    step.next_time,
    legacy.next_update_time,
    "09:00",
  );
  const nextCheckpoint =
    timeline.find((item) => item.time === nextCheckpointTime) ||
    timeline.find((item) => item.time === "09:00") ||
    timeline[0];
  const avoidActions = uniqueStrings([
    ...toText(freeSummary.do_not_do).split(/[。；;]/).map((item) => item.trim())
      .filter(Boolean),
    ...asStrings(legacy.do_not_do_list),
    ...asStrings(legacy.avoid_today),
  ]);
  const decisionGuide: DecisionGuideSection = {
    section_id: "decision_guide",
    current_action: firstText(
      step.action,
      step.title,
      firstIntraday.action_note,
      freeSummary.do_not_do,
      CHECKPOINT_INSUFFICIENT_TEXT,
    ),
    first_watch: firstText(
      primaryValidationAxis,
      firstIntraday.what_to_watch,
      CHECKPOINT_INSUFFICIENT_TEXT,
    ),
    avoid_actions: avoidActions,
    next_checkpoint_id: nextCheckpoint.checkpoint_id,
    next_checkpoint_time: nextCheckpoint.time,
    risk_level: riskLevelFrom(
      legacy.risk_level,
      thesis.risk_level,
      representativeStocks[0]?.data_status,
    ),
  };
  const tomorrow = asRecord(note.tomorrow_follow_up);
  const closingPlan = asRecord(note.closing_feedback_plan);
  const capitalScenarios = asRecords(note.capital_rotation_scenarios);
  const riskScenarios = asRecords(note.risk_scenarios);
  const successAction = firstText(
    tomorrow.continuation_condition,
    capitalScenarios[0]?.beneficiary_impact,
    closingPlan.success_criteria,
    CHECKPOINT_INSUFFICIENT_TEXT,
  );
  const failureAction = firstText(
    failureScenario.stop_action,
    riskScenarios[0]?.response,
    CHECKPOINT_INSUFFICIENT_TEXT,
  );
  const nextAction: NextActionSection = {
    section_id: "next_action",
    if_success: {
      action: successAction,
      what_to_promote: uniqueStrings([
        ...asStrings(capitalScenarios[0]?.groups_to_watch),
        ...representativeStocks.filter((stock) =>
          stock.data_status === "complete"
        ).map((stock) => stock.symbol),
      ]),
      next_checkpoint_id: checkpointId(input.reportDate, "13:30"),
    },
    if_failure: {
      action: failureAction,
      what_to_downgrade: uniqueStrings(
        riskScenarios.map((scenario) =>
          firstText(scenario.response, scenario.risk)
        ).filter(Boolean),
      ),
      next_checkpoint_id: checkpointId(input.reportDate, "14:10"),
    },
  };
  const transmissionNarrative = compactTextParts([
    ...coreReasoning,
    whyNarrative,
    thesis.taiwan_transmission,
    ...transmissionPath.map((path) => path.claim),
  ]) || INSUFFICIENT_TEXT;
  const executiveText = coreStatement;
  const reelsParts = {
    hook: executiveText,
    context: firstSentence(whyNarrative),
    thesis: coreStatement,
    action: decisionGuide.current_action,
    risk: firstText(
      failureScenario.triggers[0]?.condition,
      failureScenario.narrative,
    ),
    close: firstText(
      nextAction.if_success.action,
      nextAction.if_failure.action,
    ),
  };
  const reelsSummary: ReelsSummarySection = {
    section_id: "reels_summary",
    source_section_ids: [
      "executive_summary",
      "why_today_matters",
      "core_thesis",
      "decision_guide",
      "failure_scenario",
      "next_action",
    ],
    hook_0_5_sec: reelsParts.hook,
    context_5_15_sec: reelsParts.context,
    thesis_15_30_sec: reelsParts.thesis,
    action_30_42_sec: reelsParts.action,
    risk_42_52_sec: reelsParts.risk,
    close_52_60_sec: reelsParts.close,
    full_script: compactTextParts(Object.values(reelsParts)),
    target_duration_seconds: 60,
  };

  return {
    schema_version: "2.0",
    research_id: researchId,
    thesis_id: thesisId,
    revision: 1,
    report_date: input.reportDate,
    today_date: input.todayDate,
    data_as_of: input.dataAsOf,
    timezone: "Asia/Taipei",
    market_status: input.marketStatus,
    is_trading_day: input.isTradingDay,
    report_mode: input.reportMode,
    provenance: {
      engine_version: input.engineVersion,
      prompt_version: input.promptVersion,
      evidence_pack_version: firstText(input.evidencePack.version) || null,
      generated_at: input.generatedAt,
      source_status: status,
    },
    sections: {
      executive_summary: {
        section_id: "executive_summary",
        text: executiveText,
        claim_id: claimId(input.reportDate, "executive_summary", executiveText),
        evidence_refs: thesisRefs,
      },
      why_today_matters: {
        section_id: "why_today_matters",
        narrative: whyNarrative,
        overnight_event_ids: matchingEvidenceRefs(
          asRecords(note.overnight_chain).map((chain) => firstText(chain.event))
            .filter(Boolean),
          input.evidenceIndex,
        ),
        what_changed: whatChanged,
        why_now: primaryValidationAxis,
        evidence_refs: resolveEvidenceRefs(
          thesis.supporting_evidence,
          [whyNarrative, whatChanged, primaryValidationAxis],
          input.evidenceIndex,
        ),
      },
      core_thesis: {
        section_id: "core_thesis",
        thesis_id: thesisId,
        statement: coreStatement,
        confidence: boundedConfidence(
          opening.confidence_score,
          thesis.confidence,
          legacy.confidence_score,
        ),
        confidence_reason: firstText(
          thesis.confidence_reason,
          legacy.ai_confidence_reason,
          note.subscriber_value_sentence,
          INSUFFICIENT_TEXT,
        ),
        status: hasResearch && thesisRefs.length > 0
          ? "proposed"
          : "insufficient",
        evidence_refs: thesisRefs,
      },
      transmission_narrative: {
        section_id: "transmission_narrative",
        narrative: transmissionNarrative,
        path: transmissionPath,
        primary_validation_axis: primaryValidationAxis,
      },
      supporting_evidence: supportingEvidence,
      counter_evidence: counterEvidence,
      representative_stocks: representativeStocks,
      decision_guide: decisionGuide,
      timeline,
      failure_scenario: failureScenario,
      next_action: nextAction,
      reels_summary: reelsSummary,
    },
    quality: buildInitialQuality(),
  };
}

function direction(
  value: string,
): "positive" | "negative" | "neutral" | "unknown" {
  const normalized = normalizedForHash(value);
  if (/偏多|看多|轉強|正向|上漲|走強/.test(normalized)) return "positive";
  if (/偏空|偏弱|看空|轉弱|負向|下跌|走弱/.test(normalized)) return "negative";
  if (/中性|震盪|休市/.test(normalized)) return "neutral";
  return "unknown";
}

function duplicateStatements(
  items: Array<{ claim_id: string; statement: string }>,
): string[] {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const item of items) {
    const normalized = normalizedForHash(item.statement);
    if (!normalized) continue;
    const previous = seen.get(normalized);
    if (previous) duplicates.push(`${previous}|${item.claim_id}`);
    else seen.set(normalized, item.claim_id);
  }
  return uniqueStrings(duplicates);
}

export function validateResearchMasterV2(
  master: ResearchMasterV2,
): ResearchMasterValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unsupported: string[] = [];
  const missing: string[] = [];
  const contradictions: string[] = [];
  if (master.schema_version !== "2.0") {
    errors.push("schema_version must be 2.0");
  }
  if (!master.research_id) errors.push("research_id is required");
  if (!master.thesis_id) errors.push("thesis_id is required");
  if (master.sections.core_thesis.thesis_id !== master.thesis_id) {
    errors.push("core_thesis.thesis_id must equal master.thesis_id");
  }

  const sectionValues: Record<string, unknown> = master.sections;
  for (const sectionId of SECTION_IDS) {
    const section = sectionValues[sectionId];
    if (section === undefined || section === null) missing.push(sectionId);
  }
  const sectionIdChecks: Array<[string, string]> = [
    ["executive_summary", master.sections.executive_summary.section_id],
    ["why_today_matters", master.sections.why_today_matters.section_id],
    ["core_thesis", master.sections.core_thesis.section_id],
    [
      "transmission_narrative",
      master.sections.transmission_narrative.section_id,
    ],
    ["decision_guide", master.sections.decision_guide.section_id],
    ["failure_scenario", master.sections.failure_scenario.section_id],
    ["next_action", master.sections.next_action.section_id],
    ["reels_summary", master.sections.reels_summary.section_id],
  ];
  sectionIdChecks.forEach(([expected, actual]) => {
    if (actual !== expected) errors.push(`invalid section_id:${expected}`);
  });
  const expectedCheckpoints = new Set(
    CHECKPOINT_DEFINITIONS.map((item) => item.time),
  );
  const actualCheckpoints = new Set(
    master.sections.timeline.map((item) => item.time),
  );
  if (
    master.sections.timeline.length !== CHECKPOINT_DEFINITIONS.length ||
    [...expectedCheckpoints].some((time) => !actualCheckpoints.has(time))
  ) {
    errors.push("timeline must contain the six fixed checkpoints");
    missing.push("timeline");
  }
  for (const checkpoint of master.sections.timeline) {
    if (
      checkpoint.checkpoint_id !==
        checkpointId(master.report_date, checkpoint.time)
    ) errors.push(`invalid checkpoint_id:${checkpoint.time}`);
  }

  const allClaimIds = [
    master.sections.executive_summary.claim_id,
    ...master.sections.supporting_evidence.map((item) => item.claim_id),
    ...master.sections.counter_evidence.map((item) => item.claim_id),
    ...master.sections.failure_scenario.triggers.map((item) => item.claim_id),
  ];
  if (allClaimIds.some((id) => !id)) {
    errors.push("all important claims require claim_id");
  }
  if (master.sections.core_thesis.evidence_refs.length === 0) {
    unsupported.push(`core_thesis:${master.sections.core_thesis.statement}`);
  }
  if (master.sections.executive_summary.evidence_refs.length === 0) {
    unsupported.push(
      `executive_summary:${master.sections.executive_summary.text}`,
    );
  }
  master.sections.supporting_evidence.forEach((item) => {
    if (item.evidence_refs.length === 0) {
      unsupported.push(`${item.claim_id}:${item.statement}`);
    }
  });
  master.sections.counter_evidence.forEach((item) => {
    if (item.evidence_refs.length === 0) {
      unsupported.push(`${item.claim_id}:${item.statement}`);
    }
  });
  master.sections.transmission_narrative.path.forEach((item) => {
    if (item.evidence_refs.length === 0) {
      unsupported.push(`${item.node_id}:${item.claim}`);
    }
  });
  master.sections.representative_stocks.forEach((stock) => {
    if (!stock.role) {
      errors.push(`representative stock ${stock.symbol} requires role`);
    }
    if (!stock.reason) {
      warnings.push(`representative stock ${stock.symbol} has no reason`);
    }
    if (stock.evidence_refs.length === 0 && stock.reason) {
      unsupported.push(`${stock.stock_id}:${stock.reason}`);
    }
  });
  const symbols = master.sections.representative_stocks.map((stock) =>
    stock.symbol
  );
  const duplicateSymbols = symbols.filter((symbol, index) =>
    symbols.indexOf(symbol) !== index
  );
  if (duplicateSymbols.length > 0) {
    errors.push(
      `duplicate representative stock symbols:${
        uniqueStrings(duplicateSymbols).join(",")
      }`,
    );
  }

  const executiveDirection = direction(master.sections.executive_summary.text);
  const thesisDirection = direction(master.sections.core_thesis.statement);
  if (
    executiveDirection !== "unknown" && thesisDirection !== "unknown" &&
    executiveDirection !== "neutral" && thesisDirection !== "neutral" &&
    executiveDirection !== thesisDirection
  ) {
    contradictions.push("executive_summary conflicts with core_thesis");
  }
  if (
    !master.sections.core_thesis.statement ||
    master.sections.core_thesis.statement === INSUFFICIENT_TEXT
  ) missing.push("core_thesis");
  if (
    !master.sections.why_today_matters.narrative ||
    master.sections.why_today_matters.narrative === INSUFFICIENT_TEXT
  ) missing.push("why_today_matters");
  if (
    !master.sections.transmission_narrative.narrative ||
    master.sections.transmission_narrative.narrative === INSUFFICIENT_TEXT
  ) missing.push("transmission_narrative");
  if (master.sections.supporting_evidence.length === 0) {
    missing.push("supporting_evidence");
  }
  if (
    master.sections.failure_scenario.triggers.length === 0 &&
    master.market_status === "OPEN"
  ) missing.push("failure_scenario");

  const duplicateClaims = uniqueStrings([
    ...duplicateStatements(master.sections.supporting_evidence.map((item) => ({
      claim_id: item.claim_id,
      statement: item.statement,
    }))),
    ...duplicateStatements(master.sections.counter_evidence.map((item) => ({
      claim_id: item.claim_id,
      statement: item.statement,
    }))),
    ...duplicateStatements(
      master.sections.failure_scenario.triggers.map((item) => ({
        claim_id: item.claim_id,
        statement: item.condition,
      })),
    ),
  ]);
  const claimCount = allClaimIds.length +
    master.sections.transmission_narrative.path.length +
    master.sections.representative_stocks.filter((stock) => stock.reason)
      .length;
  const supportedCount = claimCount - unsupported.length;
  const coverage = claimCount > 0
    ? Math.max(
      0,
      Math.min(100, Math.round((supportedCount / claimCount) * 100)),
    )
    : 0;
  const criticalOpenFailure = master.market_status === "OPEN" &&
    (master.sections.core_thesis.status === "insufficient" ||
      master.sections.core_thesis.evidence_refs.length === 0);
  let publishStatus: ResearchPublishStatus = "ready";
  if (errors.length > 0 || contradictions.length > 0 || criticalOpenFailure) {
    publishStatus = "blocked";
  } else if (
    unsupported.length > 0 ||
    missing.length > 0 ||
    duplicateClaims.length > 0 ||
    master.provenance.source_status !== "complete" ||
    master.sections.representative_stocks.some((stock) =>
      stock.data_status !== "complete"
    )
  ) publishStatus = "degraded";
  if (publishStatus === "degraded") {
    warnings.push(
      "research master is safe to inspect but contains incomplete shadow data",
    );
  }
  if (publishStatus === "blocked") {
    errors.push("research master shadow quality is blocked");
  }

  const quality: ResearchMasterQuality = {
    evidence_coverage: coverage,
    unsupported_claims: uniqueStrings(unsupported),
    duplicate_claims: duplicateClaims,
    contradictions: uniqueStrings(contradictions),
    missing_sections: uniqueStrings(missing),
    publish_status: publishStatus,
  };
  return {
    is_valid: publishStatus !== "blocked",
    errors: uniqueStrings(errors),
    warnings: uniqueStrings(warnings),
    quality,
  };
}

export function buildBlockedResearchMasterV2(
  input: ResearchMasterV2AssemblerInput,
  errorCode: string,
): ResearchMasterV2 {
  const researchId = `research:${input.reportDate}:${
    safeIdPart(input.engineVersion)
  }`;
  const thesisId = `thesis:${input.reportDate}:primary`;
  const executiveText = "Research Master Shadow 組合失敗，既有報告仍可使用。";
  const checkpointText = input.marketStatus === "CLOSED"
    ? CLOSED_CHECKPOINT_TEXT
    : CHECKPOINT_INSUFFICIENT_TEXT;
  const timeline: ResearchCheckpoint[] = CHECKPOINT_DEFINITIONS.map(
    (definition) => ({
      checkpoint_id: checkpointId(input.reportDate, definition.time),
      time: definition.time,
      purpose: definition.purpose,
      question: checkpointText,
      expected_signal: checkpointText,
      success_condition: checkpointText,
      failure_condition: checkpointText,
    }),
  );
  return {
    schema_version: "2.0",
    research_id: researchId,
    thesis_id: thesisId,
    revision: 1,
    report_date: input.reportDate,
    today_date: input.todayDate,
    data_as_of: input.dataAsOf,
    timezone: "Asia/Taipei",
    market_status: input.marketStatus,
    is_trading_day: input.isTradingDay,
    report_mode: input.reportMode,
    provenance: {
      engine_version: input.engineVersion,
      prompt_version: input.promptVersion,
      evidence_pack_version: null,
      generated_at: input.generatedAt,
      source_status: "insufficient",
    },
    sections: {
      executive_summary: {
        section_id: "executive_summary",
        text: executiveText,
        claim_id: claimId(input.reportDate, "executive_summary", errorCode),
        evidence_refs: [],
      },
      why_today_matters: {
        section_id: "why_today_matters",
        narrative: INSUFFICIENT_TEXT,
        overnight_event_ids: [],
        what_changed: INSUFFICIENT_TEXT,
        why_now: checkpointText,
        evidence_refs: [],
      },
      core_thesis: {
        section_id: "core_thesis",
        thesis_id: thesisId,
        statement: INSUFFICIENT_TEXT,
        confidence: null,
        confidence_reason: INSUFFICIENT_TEXT,
        status: "insufficient",
        evidence_refs: [],
      },
      transmission_narrative: {
        section_id: "transmission_narrative",
        narrative: INSUFFICIENT_TEXT,
        path: [],
        primary_validation_axis: checkpointText,
      },
      supporting_evidence: [],
      counter_evidence: [],
      representative_stocks: [],
      decision_guide: {
        section_id: "decision_guide",
        current_action: checkpointText,
        first_watch: checkpointText,
        avoid_actions: [],
        next_checkpoint_id: checkpointId(input.reportDate, "09:00"),
        next_checkpoint_time: "09:00",
        risk_level: "unknown",
      },
      timeline,
      failure_scenario: {
        section_id: "failure_scenario",
        narrative: INSUFFICIENT_TEXT,
        triggers: [],
        stop_action: checkpointText,
      },
      next_action: {
        section_id: "next_action",
        if_success: {
          action: checkpointText,
          what_to_promote: [],
          next_checkpoint_id: checkpointId(input.reportDate, "13:30"),
        },
        if_failure: {
          action: checkpointText,
          what_to_downgrade: [],
          next_checkpoint_id: checkpointId(input.reportDate, "14:10"),
        },
      },
      reels_summary: {
        section_id: "reels_summary",
        source_section_ids: [],
        hook_0_5_sec: executiveText,
        context_5_15_sec: INSUFFICIENT_TEXT,
        thesis_15_30_sec: INSUFFICIENT_TEXT,
        action_30_42_sec: checkpointText,
        risk_42_52_sec: INSUFFICIENT_TEXT,
        close_52_60_sec: checkpointText,
        full_script: executiveText,
        target_duration_seconds: 60,
      },
    },
    quality: {
      evidence_coverage: 0,
      unsupported_claims: ["research_master_v2:assembler_failed"],
      duplicate_claims: [],
      contradictions: [],
      missing_sections: SECTION_IDS.map(String),
      publish_status: "blocked",
    },
  };
}
