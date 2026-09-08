// Pure contracts shared by the generator and isolated regression tests.
// This is not an alternative decision engine: publication uses the existing
// decision_snapshots / member_content_revisions and pipeline_runs authorities.
export const RESEARCH_PIPELINE_VERSION = 'CORE_RELIABILITY_20260907_V1';
type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

export function presentNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Normal generation reads current provider rows, not an immutable historical
// input set. Reject historical/date-conflicting requests before any write.
// The separately authorized canonical_member_recovery path does not regenerate.
export function currentResearchDateError(body: Row, todayDate: string): string | null {
  for (const key of ['report_date', 'target_date', 'business_date']) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return 'INVALID_RESEARCH_DATE';
    if (value !== todayDate) return 'HISTORICAL_RESEARCH_REGENERATION_UNSUPPORTED';
  }
  return null;
}

// Preserve ordered evidence/causal paths. Only the known market/sector input
// collections below are sets. Capture timestamps remain significant.
// Execution timestamps are excluded by
// constructing the input manifest explicitly at the caller, never a broad regex.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value ?? null;
}

export async function researchInputFingerprint(input: {
  report_date: string; sources: unknown; source_version: string; engine_version: string;
  quality_policy: unknown; previous_revision: unknown;
}): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.report_date) || !input.engine_version || !input.source_version) throw new Error('INPUT_MANIFEST_INCOMPLETE');
  const sources = { ...record(input.sources) };
  for (const key of ['market', 'sectors', 'missing_sources']) {
    if (Array.isArray(sources[key])) sources[key] = sources[key].map(stable)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  const bytes = new TextEncoder().encode(JSON.stringify(stable({ ...input, sources })));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) => v.toString(16).padStart(2, '0')).join('');
}

export function canonicalReportProjection(ai: Row, decision: Row): Row {
  const generated = record(decision.generated_text);
  const sentence = typeof generated.daily_sentence === 'string' ? generated.daily_sentence : '';
  if (!sentence.trim()) throw new Error('CANONICAL_SENTENCE_MISSING');
  const recommendations = Array.isArray(generated.recommendations) ? generated.recommendations.map((value) => {
    const row=record(value);
    return {...row,trigger_event:row.event_source,transmission_logic:row.transmission_path,
      taiwan_supply_chain_link:row.taiwan_supply_chain_relation,intraday_validation:row.confirmation_condition};
  }) : [];
  const blocked = decision.decision_mode === 'blocked';
  const marketOnly = decision.decision_mode === 'market_only';
  if ((blocked || marketOnly) && recommendations.length) throw new Error('BLOCKED_RECOMMENDATIONS_CONTRADICTION');
  const marketGate = record(generated.market_report_gate);
  if (marketOnly && (marketGate.eligible !== true || marketGate.status !== 'READY_MARKET_ONLY'
    || marketGate.decision_mode !== 'market_only' || decision.action !== 'WAIT')) throw new Error('MARKET_PUBLICATION_PROOF_INVALID');
  return {
    ...ai,
    decision_mode: decision.decision_mode,
    canonical_action: decision.action,
    ...(Object.keys(marketGate).length ? { market_report_gate: marketGate, report_status: marketGate.report_status,
      recommendation_status: marketGate.recommendation_status, recommendation_gate: marketGate.recommendation_gate } : {}),
    today_quote: sentence,
    today_summary: sentence,
    daily_sentence: sentence,
    public_summary: { ...record(ai.public_summary), daily_sentence: sentence, one_sentence: sentence },
    free_summary: { ...record(ai.free_summary), one_sentence: sentence, do_not_do: generated.do_not_do },
    v8_daily_sentence: { ...record(ai.v8_daily_sentence), sentence },
    line_push_copy: { ...record(ai.line_push_copy), one_sentence: sentence },
    // Keep raw research and quality rejection evidence intact. Only public
    // presentation aliases are projected from the authoritative decision.
    today_beneficiary_stocks: recommendations,
    today_beneficiary_stocks_v10: recommendations,
    member_research_note_v2: { ...record(ai.member_research_note_v2), today_core_thesis: sentence,
      strategy_summary: sentence, beneficiary_candidates: recommendations },
  };
}

// Only the server-authorized admin branch calls this. Owner screens must use
// the same gated read model as other readers; raw diagnostics remain explicitly
// separate and cannot take precedence through nested ai_strategy_json aliases.
export function canonicalAdminReaderProjection(report: Row, _effectiveAi: Row, reader: Row): Row {
  const stocks = reader.premium_content_status === 'eligible' && Array.isArray(reader.today_beneficiary_stocks)
    ? reader.today_beneficiary_stocks : [];
  const display = {
    ...reader,
    today_beneficiary_stocks: stocks,
    today_beneficiary_stocks_v10: stocks,
    beneficiary_stocks: stocks,
    core_beneficiary_stocks: stocks,
    extended_watchlist: [],
    scenario_watchlist: [],
    why_this_stock: stocks,
    v8_beneficiary_chain: { recommendations: stocks },
    summary: reader.daily_sentence,
    today_summary: reader.daily_sentence,
  };
  return {
    ...display,
    id: report.id,
    // Raw Owner diagnostics are accessible only through their explicit namespace;
    // they must not become a second subscriber content or recommendation source.
    ai_strategy_json: { ...display },
    admin_source_report: report,
  };
}

export function classifyResearchResult(status: number, payload: Row, attempt: number) {
  if (status >= 200 && status < 300 && payload.success === true) return { outcome: 'SUCCEEDED', retry_after_seconds: null };
  if (status === 409 && ['RESEARCH_IN_PROGRESS', 'RESEARCH_BACKOFF'].includes(String(payload.error_code))) {
    return { outcome: 'IN_PROGRESS', retry_after_seconds: null };
  }
  const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
  return { outcome: retryable ? 'FAILED' : 'DEGRADED',
    retry_after_seconds: retryable && attempt < 3 ? Math.min(300, 30 * 2 ** (attempt - 1)) : null };
}

// Company identity must be grounded in the source, not an industry tag on a
// candidate. Supply-chain evidence needs an explicit, source-backed link.
export function companyEvidenceSupported(candidate: Row, evidence: Row): boolean {
  const text = `${evidence.title || ''} ${evidence.summary || ''}`.normalize('NFKC').toLowerCase();
  const symbol = String(candidate.symbol || '').replace(/^TWSE:|^TPEX:|\.TW$|\.TWO$/gi, '');
  const name = String(candidate.name || '').trim().toLowerCase();
  const aliases = Array.isArray(candidate.aliases) ? candidate.aliases.filter((v): v is string => typeof v === 'string' && v.length > 2) : [];
  const direct = (/^\d{4,6}$/.test(symbol) && new RegExp(`(^|[^0-9])${symbol}([^0-9]|$)`).test(text))
    || (name.length > 1 && text.includes(name)) || aliases.some((alias) => text.includes(alias.toLowerCase()));
  // A quote or sector score establishes price/rotation, not the company catalyst.
  if (String(evidence.evidence_type) !== 'market_news') return false;
  if (direct) return true;
  const links = Array.isArray(evidence.company_links) ? evidence.company_links.map(record) : [];
  return links.some((link) => link.symbol === symbol && link.verified === true
    && typeof link.source_quote === 'string' && link.source_quote.length >= 12
    && text.includes(link.source_quote.toLowerCase())
    && typeof link.relationship === 'string' && link.relationship.trim().length > 0);
}

export function evaluateAutomaticTradingDay(input: {
  report_date: string; today_date: string; is_trading_day: boolean; manual_recovery: boolean;
  stages: Record<string, { report_date: string; revision_id: string; status: string; completed_at?: string }>;
  delivery: { type: string; sent_at: string | null }; checkpoints: Array<{ report_date: string; status: string; evidence: boolean }>;
  failed_dispatches: number | null; open_dead_letters: number | null;
}) {
  if (!input.is_trading_day) return { status: 'NOT_APPLICABLE', automatic_stable_day: false, reasons: ['NON_TRADING_DAY'] };
  const reasons: string[] = [];
  const required = ['sources', 'canonical', 'evidence', 'editorial', 'premium', 'semantic', 'line', 'closing', 'learning', 'acceptance'];
  const revision = input.stages.canonical?.revision_id;
  for (const stage of required) {
    const row = input.stages[stage];
    if (!row || row.status !== 'PASS' || !row.completed_at || !Number.isFinite(Date.parse(row.completed_at))
      || row.report_date !== input.report_date || !revision || row.revision_id !== revision) reasons.push(`UNVERIFIED_${stage.toUpperCase()}`);
  }
  if (input.checkpoints.length !== 6 || input.checkpoints.some((row) => row.report_date !== input.report_date || row.status !== 'SUCCEEDED' || !row.evidence)) reasons.push('CHECKPOINTS_INCOMPLETE');
  const deadline = Date.parse(`${input.report_date}T08:00:00+08:00`);
  const deliveryTime = Date.parse(input.delivery.sent_at || '');
  if (input.delivery.type !== 'daily_report' || !Number.isFinite(deliveryTime) || deliveryTime >= deadline
    || deliveryTime < Date.parse(`${input.report_date}T00:00:00+08:00`)) reasons.push('REPORT_DELIVERY_NOT_ON_TIME');
  if (input.failed_dispatches !== 0 || input.open_dead_letters !== 0) reasons.push('RUNTIME_FAILURES_UNRESOLVED');
  if (input.manual_recovery) reasons.push('MANUAL_RECOVERY');
  if (input.report_date !== input.today_date) reasons.push('HISTORICAL_REPLAY');
  return { status: reasons.length ? 'FAIL' : 'PASS', automatic_stable_day: reasons.length === 0, reasons };
}
