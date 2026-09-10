import type { MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import type { DecisionRuntimeEvidence } from './decisionEvidence.ts';
import { getSubscriberReportProjection, type SubscriberCheckpointKey, type SubscriberReportProjection } from './subscriberReportContract.ts';

type UnknownRecord = Record<string, unknown>;

export interface CanonicalTodayFocus {
  headline: string;
  summary: string;
  action: string;
  why: string;
  risk: string;
}

export interface CanonicalScriptStep {
  time: string;
  title: string;
  detail: string;
  status: 'completed' | 'current' | 'pending' | 'missing';
}

export interface CanonicalTodayScript {
  headline: string;
  steps: CanonicalScriptStep[];
  current_step: string;
  status: 'ready' | 'pending' | 'missing' | 'completed';
}

export interface CanonicalFailureTrigger {
  trigger: string;
  meaning: string;
  action: string;
}

export interface CanonicalIntradayProgress {
  completed_steps: string[];
  current_step: string;
  next_step: string;
  status: 'ready' | 'pending' | 'missing' | 'completed';
}

export interface CanonicalClosingOutcome {
  result: string;
  summary: string;
  accuracy: string;
  lessons: string[];
}

export type CanonicalDecisionStatus = 'Waiting' | 'Confirmed' | 'Rejected' | 'Completed';

export interface CanonicalDecisionQuestion {
  question: string;
  why: string;
}

export interface CanonicalDecisionLifecycle {
  question: CanonicalDecisionQuestion;
  current_thesis: {
    title: string;
    summary: string;
  };
  validation_plan: {
    steps: CanonicalScriptStep[];
    next_step: string;
  };
  failure_condition: CanonicalFailureTrigger;
  decision_status: {
    status: CanonicalDecisionStatus;
    reason: string;
    next_step: string;
  };
  closing_review: {
    question: string;
    prediction: string;
    reality: string;
    lesson: string;
    tomorrow: string;
  };
  daily_lesson: string;
}

export interface CanonicalMorningNarrative {
  today_focus: CanonicalTodayFocus;
  today_script: CanonicalTodayScript;
  failure_triggers: CanonicalFailureTrigger[];
  intraday_progress: CanonicalIntradayProgress;
  closing_outcome: CanonicalClosingOutcome;
  decision_evidence: DecisionRuntimeEvidence;
  decision_lifecycle: CanonicalDecisionLifecycle;
}

export interface BuildCanonicalNarrativeInput {
  displayState: MorningAlphaDisplayState | null;
  ai?: UnknownRecord | null;
  memberResearchNoteV2?: UnknownRecord | null;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is UnknownRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => toText(item)).filter(Boolean);
  const text = toText(value);
  return text ? [text] : [];
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return '';
}

function firstLine(value: unknown): string {
  const text = Array.isArray(value) ? value.map(toText).find(Boolean) || '' : toText(value);
  return text.split(/[。；\n]/).map((part) => part.trim()).find(Boolean) || '';
}

function ensureSentence(value: string): string {
  const text = value.trim();
  if (!text) return '';
  return /[。！？?]$/.test(text) ? text : `${text}。`;
}

function toDecisionQuestion(title: string, summary: string): string {
  const source = firstText(title, summary, '今天市場主線');
  if (!source) return '今天最大的交易問題是什麼？';
  if (/[？?]$/.test(source)) return source;
  const compact = source.replace(/[。！？?；，,].*$/, '').trim();
  return `${compact}今天能不能成立？`;
}

function compactLesson(value: string): string {
  const text = firstLine(value).replace(/\s+/g, '');
  if (!text) return '';
  return ensureSentence(text.length > 35 ? `${text.slice(0, 34)}…` : text);
}

function getV10MarketThesis(ai: UnknownRecord): UnknownRecord {
  const direct = asRecord(ai);
  const debug = asRecord(ai.v10_analysis_debug);
  const marketThesis = asRecord(debug.market_thesis);
  return {
    ...asRecord(marketThesis.market_thesis),
    primary_driver: direct.primary_driver ?? asRecord(marketThesis.market_thesis).primary_driver,
    market_story: direct.market_story ?? asRecord(marketThesis.market_thesis).market_story,
    taiwan_transmission: direct.taiwan_transmission ?? asRecord(marketThesis.market_thesis).taiwan_transmission,
  };
}

function publishedMarketReasonText(reasons: string[]): string {
  // A legacy assessment score is not a market-evidence reason or a bound
  // confidence value. Keep adjacent facts; formal scores use structured fields.
  const assessmentScore = /^(?:(?:綜合|內容|品質|資料|模型|判斷|AI)?(?:評分|分數|信心)|內容品質|資料完整度|quality(?:_score)?|confidence(?:_score)?|score)\s*[：:=]?\s*\d+(?:\.\d+)?\s*[／/]\s*100(?:\s*分)?$/i;
  return reasons.flatMap((reason) => reason.split(/[。；;\n]/))
    .map((clause) => clause.trim())
    .filter((clause) => clause && !assessmentScore.test(clause))
    .join('；');
}

function buildTodayFocus(
  ai: UnknownRecord,
  note: UnknownRecord,
  projection: SubscriberReportProjection,
): CanonicalTodayFocus {
  if (!projection.analysisAvailable) return {
    headline: projection.title, summary: projection.statusLabel,
    action: projection.marketDecision.label, why: '', risk: '',
  };
  const v10Thesis = getV10MarketThesis(ai);
  const openingThesis = asRecord(note.opening_thesis);
  // The server-pinned published decision outranks a deeper internal research
  // note. A newer blocked QA draft must not rewrite the subscriber's market view.
  const published = asRecord(ai.canonical_decision);
  const publishedSentence = projection.marketDecision.summary || '';

  const headline = publishedSentence || projection.title;
  const summary = publishedSentence;
  const action = projection.marketDecision.label;

  const publishedReasons = asStringArray(published.reasons);
  // Do not refill excluded canonical QA-only reasons with private draft prose.
  const why = publishedReasons.length > 0 ? publishedMarketReasonText(publishedReasons) : firstText(
    v10Thesis.taiwan_transmission,
    ai.taiwan_transmission,
    openingThesis.why,
    openingThesis.reason,
    firstLine(note.core_reasoning),
  );

  const invalidationRows = asArray(note.invalidation_conditions).length > 0
    ? asArray(note.invalidation_conditions)
    : asArray(note.invalidation_rules);
  const firstInvalidation = invalidationRows[0] || {};
  const risk = firstText(
    openingThesis.risk,
    firstInvalidation.action_note,
    firstInvalidation.condition,
    firstLine(note.risk_scenarios),
  );

  return {
    headline,
    summary,
    action,
    why,
    risk,
  };
}

function buildTodayScript(note: UnknownRecord, projection: SubscriberReportProjection): CanonicalTodayScript {
  if (!projection.analysisAvailable || projection.closing.state === 'NOT_APPLICABLE') return {
    headline: projection.statusLabel, steps: [],
    current_step: projection.closing.state === 'NOT_APPLICABLE' ? '本節點不適用' : projection.statusLabel,
    status: 'missing',
  };
  const windows = asArray(note.intraday_time_windows).length > 0
    ? asArray(note.intraday_time_windows)
    : Array.isArray(note.intraday_validation)
      ? note.intraday_validation.map((item: unknown) => typeof item === 'string'
        // Canonical member revisions store evidence-backed condition strings.
        // Retain them verbatim; only use their explicit checkpoint, never a clock fallback.
        ? { time_window: firstText(asRecord(note.canonical_contract).validation_checkpoint), what_to_watch: item }
        : asRecord(item))
      : [];
  const steps = windows.slice(0, 5).map((window) => {
    const time = firstText(window.time, window.time_window, window.label);
    const title = firstText(window.title, window.purpose, window.what_to_watch);
    const detail = firstText(
      window.action_note,
      window.signals_to_watch,
      window.bullish_confirmation,
      window.bullish_confirm,
      window.what_to_watch,
    );
    const syncKey = time.replace(/\D/g, '');
    const checkpoint = Object.prototype.hasOwnProperty.call(projection.runtime.checkpoints, syncKey)
      ? projection.runtime.checkpoints[syncKey as SubscriberCheckpointKey] : null;
    const status: CanonicalScriptStep['status'] = checkpoint?.status === 'completed' && checkpoint.evidenceVerified
      ? 'completed'
      : !checkpoint || checkpoint.status === 'insufficient' || checkpoint.status === 'failed'
        ? 'missing'
        : 'pending';
    return {
      time,
      title,
      detail,
      status,
    };
  });

  const completed = steps.filter((step) => step.status === 'completed');
  const current = steps.find((step) => step.status === 'pending' || step.status === 'missing') || steps[steps.length - 1];
  const headline = projection.marketDecision.summary || projection.title;

  return {
    headline,
    steps,
    current_step: firstText(current?.title, current?.time),
    status: steps.length === 0 ? 'missing' : completed.length === steps.length ? 'completed' : 'pending',
  };
}

function buildFailureTriggers(note: UnknownRecord): CanonicalFailureTrigger[] {
  const source = Array.isArray(note.invalidation_conditions) && note.invalidation_conditions.length > 0
    ? note.invalidation_conditions
    : Array.isArray(note.invalidation_rules) ? note.invalidation_rules : [];
  const rows = source.map((item: unknown) => typeof item === 'string' ? { condition: item } : asRecord(item));

  return rows.slice(0, 5).map((row) => ({
    trigger: firstText(row.condition, row.trigger),
    meaning: firstText(row.meaning, row.why_it_matters, row.reason),
    action: firstText(row.action_note, row.required_adjustment, row.action),
  })).filter((row) => row.trigger || row.meaning || row.action);
}

function buildIntradayProgress(projection: SubscriberReportProjection, script: CanonicalTodayScript): CanonicalIntradayProgress {
  if (projection.closing.state === 'NOT_APPLICABLE') return {
    completed_steps: [], current_step: '今日非交易日，本節點不適用',
    next_step: '等待下一個交易日', status: 'missing',
  };
  if (!projection.analysisAvailable) return {
    completed_steps: [], current_step: projection.statusLabel,
    next_step: '等待正式市場分析與完整驗證證據', status: 'missing',
  };
  const intradayKeys = ['0930', '1030', '1300'] as const;
  const completed_steps = intradayKeys.filter((key) => projection.runtime.checkpoints[key].status === 'completed'
    && projection.runtime.checkpoints[key].evidenceVerified);
  const pendingStep = script.steps.find((step) => step.status !== 'completed');
  const incomplete = !projection.runtime.decisionEvidence.checklistAvailable
    || intradayKeys.some(key => ['insufficient', 'failed'].includes(projection.runtime.checkpoints[key].status));
  return {
    completed_steps,
    current_step: projection.closing.complete ? '收盤驗證已完成'
      : firstText(pendingStep?.title, pendingStep?.time, projection.runtime.decisionEvidence.reason),
    next_step: projection.closing.complete ? '檢視已完成的收盤驗證'
      : firstText(pendingStep?.title, pendingStep?.time, '等待下一個具完整證據的驗證節點'),
    status: completed_steps.length === intradayKeys.length ? 'completed' : incomplete ? 'missing' : 'pending',
  };
}

function buildClosingOutcome(projection: SubscriberReportProjection): CanonicalClosingOutcome {
  if (!projection.closing.complete || !projection.closing.result) return { result: '', summary: '', accuracy: '', lessons: [] };
  const closing = projection.closing.result;
  const tomorrow = asRecord(closing.tomorrow_adjustment);
  return {
    result: projection.closing.outcome || '',
    summary: firstText(closing.verification_note, closing.summary, closing.what_was_right, closing.reason),
    accuracy: firstText(closing.accuracy_score, closing.accuracy, closing.relative_result),
    lessons: [
      ...asStringArray(closing.lessons_learned),
      firstText(closing.what_was_wrong, closing.miss_reason),
      firstText(tomorrow.summary, tomorrow.action, tomorrow.note),
    ].filter(Boolean).slice(0, 5),
  };
}

function buildDecisionLifecycle(
  today_focus: CanonicalTodayFocus,
  today_script: CanonicalTodayScript,
  failure_triggers: CanonicalFailureTrigger[],
  intraday_progress: CanonicalIntradayProgress,
  closing_outcome: CanonicalClosingOutcome,
  decisionEvidence: DecisionRuntimeEvidence,
): CanonicalDecisionLifecycle {
  const question = toDecisionQuestion(today_focus.headline, today_focus.summary || today_script.headline);
  const hasUsableRuntimeEvidence = decisionEvidence.marketSnapshotAvailable
    && decisionEvidence.checklistAvailable;
  const fallbackTrigger = hasUsableRuntimeEvidence
    ? firstText(
      !/^資料(?:尚未完整|不足|缺漏)/.test(today_focus.risk) ? today_focus.risk : '',
      '盤中出現足以推翻早上判斷的新訊號',
    )
    : firstText(today_focus.risk, '資料不足');
  const fallbackFailure: CanonicalFailureTrigger = {
    trigger: fallbackTrigger,
    meaning: firstText(today_focus.why, today_focus.summary, '目前缺少足夠條件判斷劇本是否成立。'),
    action: firstText(today_focus.action, today_focus.risk),
  };
  const failure = failure_triggers[0] || fallbackFailure;
  const status: CanonicalDecisionStatus = decisionEvidence.status;
  const dailyLesson = compactLesson(
    closing_outcome.lessons[0]
      || closing_outcome.summary
      || failure.action
      || today_focus.risk,
  );

  return {
    question: {
      question,
      why: firstText(today_focus.why, today_focus.summary, '資料不足，等待今日主線補齊。'),
    },
    current_thesis: {
      title: firstText(today_script.headline, today_focus.headline, '今日劇本'),
      summary: firstText(today_focus.summary, today_focus.action, '資料不足，暫不建立完整判斷。'),
    },
    validation_plan: {
      steps: today_script.steps,
      next_step: firstText(intraday_progress.next_step, today_script.current_step, '等待下一個驗證點'),
    },
    failure_condition: failure,
    decision_status: {
      status,
      reason: firstText(decisionEvidence.reason, intraday_progress.current_step, closing_outcome.summary, '等待資料確認。'),
      next_step: firstText(intraday_progress.next_step, failure.action, '等待下一個驗證點'),
    },
    closing_review: {
      question,
      prediction: firstText(today_focus.summary, today_script.headline, '資料不足'),
      reality: firstText(closing_outcome.summary, closing_outcome.result, '等待收盤驗證資料同步'),
      lesson: dailyLesson,
      tomorrow: firstText(closing_outcome.lessons[1], closing_outcome.lessons[0], failure.action),
    },
    daily_lesson: dailyLesson,
  };
}

export function buildCanonicalNarrative(input: BuildCanonicalNarrativeInput): CanonicalMorningNarrative {
  // The server-selected row owns both identity and explanatory content. Do not
  // combine that row's proof with a caller's different revision of AI or notes.
  const sourceRow = input.displayState?.rawRow;
  const ai = sourceRow ? { ...asRecord(sourceRow.ai_strategy_json), ...sourceRow }
    : asRecord(input.ai ?? input.displayState?.rawAI);
  const note = asRecord(sourceRow ? ai.member_research_note_v2 : input.memberResearchNoteV2 ?? ai.member_research_note_v2);
  const projection = getSubscriberReportProjection(sourceRow ?? ai);
  const today_focus = buildTodayFocus(ai, note, projection);
  const today_script = buildTodayScript(note, projection);
  const failure_triggers = projection.analysisAvailable ? buildFailureTriggers(note) : [];
  const intraday_progress = buildIntradayProgress(projection, today_script);
  const closing_outcome = buildClosingOutcome(projection);
  const decision_evidence = projection.runtime.decisionEvidence;
  return {
    today_focus,
    today_script,
    failure_triggers,
    intraday_progress,
    closing_outcome,
    decision_evidence,
    decision_lifecycle: buildDecisionLifecycle(
      today_focus,
      today_script,
      failure_triggers,
      intraday_progress,
      closing_outcome,
      decision_evidence,
    ),
  };
}
