import type { MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { buildDecisionRuntimeEvidence, getRuntimeCheckpointState, type DecisionRuntimeEvidence } from './decisionEvidence.ts';

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

function firstMeaningfulTextFromObject(value: unknown, keys: string[]): string {
  const record = asRecord(value);
  for (const key of keys) {
    const text = toText(record[key]);
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

function normalizeStatus(value: unknown): CanonicalTodayScript['status'] {
  const text = toText(value).toLowerCase();
  if (['ready', 'complete', 'completed', 'done'].includes(text)) return 'completed';
  if (['pending', 'waiting'].includes(text)) return 'pending';
  if (['missing', 'failed', 'stale'].includes(text)) return 'missing';
  return 'missing';
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

function buildTodayFocus(
  displayState: MorningAlphaDisplayState | null,
  ai: UnknownRecord,
  note: UnknownRecord,
): CanonicalTodayFocus {
  const v10Thesis = getV10MarketThesis(ai);
  const openingThesis = asRecord(note.opening_thesis);
  const v8Sentence = asRecord(ai.v8_daily_sentence);
  const freeSummary = asRecord(ai.free_summary) || asRecord(ai.public_summary);

  const headline = firstText(
    v10Thesis.primary_driver,
    firstMeaningfulTextFromObject(openingThesis, ['primary_driver', 'title', 'primary_theme', 'market_theme']),
    ai.primary_driver,
    freeSummary.primary_driver,
    '今日核心判斷',
  );

  const summary = firstText(
    v10Thesis.market_story,
    ai.market_story,
    openingThesis.summary,
    openingThesis.market_story,
    ai.today_quote,
    displayState?.todayQuote,
    v8Sentence.sentence,
    freeSummary.one_sentence,
    freeSummary.summary,
  );

  const action = firstText(
    openingThesis.action,
    openingThesis.action_note,
    ai.action_guidance,
    ai.today_action,
    freeSummary.do_not_do,
  );

  const why = firstText(
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

function buildTodayScript(note: UnknownRecord, ai: UnknownRecord): CanonicalTodayScript {
  const windows = asArray(note.intraday_time_windows).length > 0
    ? asArray(note.intraday_time_windows)
    : asArray(note.intraday_validation);
  const sync = asRecord(ai.intraday_sync_status);
  const steps = windows.slice(0, 5).map((window, index) => {
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
    const runtimeStatus = getRuntimeCheckpointState(sync, syncKey);
    const status: CanonicalScriptStep['status'] = runtimeStatus === 'completed'
      ? 'completed'
      : runtimeStatus === 'insufficient'
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
  const openingThesis = asRecord(note.opening_thesis);
  const headline = firstText(
    openingThesis.primary_theme,
    openingThesis.title,
    ai.primary_driver,
    ai.market_story,
    steps[0]?.title,
    '今日劇本',
  );

  return {
    headline,
    steps,
    current_step: firstText(current?.title, current?.time),
    status: steps.length === 0 ? 'missing' : completed.length === steps.length ? 'completed' : 'pending',
  };
}

function buildFailureTriggers(note: UnknownRecord): CanonicalFailureTrigger[] {
  const rows = asArray(note.invalidation_conditions).length > 0
    ? asArray(note.invalidation_conditions)
    : asArray(note.invalidation_rules);

  return rows.slice(0, 5).map((row) => ({
    trigger: firstText(row.condition, row.trigger),
    meaning: firstText(row.meaning, row.why_it_matters, row.reason),
    action: firstText(row.action_note, row.required_adjustment, row.action),
  })).filter((row) => row.trigger || row.meaning || row.action);
}

function buildIntradayProgress(ai: UnknownRecord, script: CanonicalTodayScript): CanonicalIntradayProgress {
  const sync = asRecord(ai.intraday_sync_status);
  const openingRadar = asRecord(ai.opening_radar);
  const intradayTracking = asRecord(ai.intraday_tracking);
  const completed_steps = ['0930', '1030', '1300']
    .filter((key) => getRuntimeCheckpointState(sync, key) === 'completed');

  const currentFromTracking = firstText(
    intradayTracking.status,
    openingRadar.radar_status,
    sync.warning,
    script.current_step,
  );

  const pendingStep = script.steps.find((step) => step.status !== 'completed');

  return {
    completed_steps,
    current_step: currentFromTracking,
    next_step: firstText(pendingStep?.title, pendingStep?.time, sync.warning),
    status: normalizeStatus(firstText(intradayTracking.status, openingRadar.radar_status, sync.warning, script.status)),
  };
}

function buildClosingOutcome(ai: UnknownRecord): CanonicalClosingOutcome {
  const closingV2 = asRecord(ai.closing_verification_v2);
  const closing = Object.keys(closingV2).length > 0 ? closingV2 : asRecord(ai.closing_verification);
  const tomorrow = asRecord(closing.tomorrow_adjustment);
  return {
    result: firstText(closing.verdict_label, closing.hit_or_miss, closing.prediction_result, closing.status),
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
  const fallbackFailure: CanonicalFailureTrigger = {
    trigger: firstText(today_focus.risk, '資料不足'),
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
  const ai = asRecord(input.ai ?? input.displayState?.rawAI);
  const note = asRecord(input.memberResearchNoteV2 ?? ai.member_research_note_v2);
  const today_focus = buildTodayFocus(input.displayState, ai, note);
  const today_script = buildTodayScript(note, ai);
  const failure_triggers = buildFailureTriggers(note);
  const intraday_progress = buildIntradayProgress(ai, today_script);
  const closing_outcome = buildClosingOutcome(ai);
  const decision_evidence = buildDecisionRuntimeEvidence({
    ai,
    checklistItemCount: today_script.steps.filter((step) => Boolean(step.title || step.detail)).length,
  });
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
