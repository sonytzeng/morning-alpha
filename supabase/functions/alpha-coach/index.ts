import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { contentLengthExceedsLimit, readBoundedText, RequestBodyTooLargeError } from '../_shared/bounded-json.ts';
import { evaluatePremiumContentGate } from '../_shared/premium-content-gate.ts';
import {
  consumeAlphaCoachRateLimit,
  resolveAlphaCoachRateLimitPolicy,
} from '../_shared/alpha-coach-rate-limit.ts';
import {
  ALPHA_COACH_REFUSAL,
  alphaCoachSourcesAreValid,
  buildGroundedAlphaCoachAnswer,
  evaluateAlphaCoachContext,
  normalizeReportImportantNews,
  type AlphaCoachSource,
  validateAlphaCoachQuestion,
} from '../_shared/alpha-coach-contract.ts';

type JsonRecord = Record<string, unknown>;

const VERSION = 'ALPHA_COACH_OWNER_PREVIEW_V1';
const MAX_BODY_BYTES = 4096;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

const OFFICIAL_GLOSSARY = [
  { term: '相對大盤', explanation: '把個股走勢和加權指數相比，觀察它是否真的更強或更弱。', url: 'https://investoredu.twse.com.tw/Pages/TWSE.aspx' },
  { term: '量價', explanation: '把價格方向與成交量變化放在一起看，確認走勢是否有資金支持。', url: 'https://investoredu.twse.com.tw/pages/TWSE_InvestmentQA.aspx?ID=1' },
  { term: '失效條件', explanation: '事前定義哪些證據出現時，原本判斷就不再成立。', url: 'https://investoredu.twse.com.tw/Pages/TWSE.aspx' },
  { term: '本益比', explanation: '股價相對於公司每股獲利的倍數。', url: 'https://www.twse.com.tw/zh/trading/historical/bwibbu-day.html' },
];

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

function asObject(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as JsonRecord[]
    : [];
}

function text(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const output = text(value);
    if (output) return output;
  }
  return '';
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
    const row = asObject(item);
    const output = firstText(
      row.statement, row.reason, row.detail, row.condition, row.trigger,
      row.what_to_watch, row.validation_signal, row.watch_point, row.action_note,
      row.meaning, row.title,
    );
    return output ? [output] : [];
  });
}

function taipeiDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function readBody(req: Request): Promise<JsonRecord> {
  if (contentLengthExceedsLimit(req.headers.get('content-length'), MAX_BODY_BYTES)) throw new RequestBodyTooLargeError();
  const raw = await readBoundedText(req.body, MAX_BODY_BYTES);
  const parsed = raw ? JSON.parse(raw) as unknown : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JSON_BODY');
  return parsed as JsonRecord;
}

type GlossaryMatch = (typeof OFFICIAL_GLOSSARY)[number] | undefined;

function sourceLabel(value: JsonRecord): string {
  return firstText(value.title, value.headline, value.label, value.source, value.name, value.evidence_id, value.id);
}

function sourceUrl(value: JsonRecord): string | undefined {
  const candidate = firstText(value.url, value.source_url, value.link);
  return /^https:\/\//i.test(candidate) ? candidate : undefined;
}

function collectStoredSources(
  report: JsonRecord,
  snapshot: JsonRecord,
  member: JsonRecord,
  importantNews: JsonRecord[],
  dataAsOf: string,
  glossaryMatch: GlossaryMatch,
): { sources: AlphaCoachSource[]; storedEvidenceCount: number } {
  const sources: AlphaCoachSource[] = [{
    id: 'S1',
    label: `Morning Alpha Decision Snapshot v${text(snapshot.version)}`,
    data_as_of: dataAsOf,
    supports: ['relation_to_today', 'confirmation_conditions', 'invalidation_conditions', 'data_source_and_time'],
  }, {
    id: 'S2',
    label: `Morning Alpha Member Research Revision v${text(member.revision)}`,
    data_as_of: text(member.generated_at) || dataAsOf,
    supports: ['plain_explanation', 'relation_to_today', 'supporting_evidence', 'confirmation_conditions', 'invalidation_conditions', 'data_source_and_time'],
  }, {
    id: 'S3',
    label: `Morning Alpha 正式報告 ${text(report.report_date)}`,
    data_as_of: firstText(report.updated_at, report.created_at, dataAsOf),
    supports: ['relation_to_today', 'data_source_and_time'],
  }];

  const memberContent = asObject(member.member_content);
  const canonical = asObject(member.canonical_contract);
  const storedCandidates: unknown[] = [
    ...asRecords(snapshot.source_refs),
    ...(Array.isArray(snapshot.source_refs) ? snapshot.source_refs.filter((item) => typeof item === 'string') : []),
    ...asRecords(memberContent.source_refs),
    ...(Array.isArray(memberContent.source_refs) ? memberContent.source_refs.filter((item) => typeof item === 'string') : []),
    ...asRecords(canonical.evidence_refs),
    ...(Array.isArray(canonical.evidence_refs) ? canonical.evidence_refs.filter((item) => typeof item === 'string') : []),
    ...importantNews.flatMap((item) => [item, ...asRecords(item.source_refs)]),
  ];
  const seen = new Set<string>();
  let storedEvidenceCount = 0;
  for (const candidate of storedCandidates) {
    const row = typeof candidate === 'string' ? { label: candidate } : asObject(candidate);
    const label = sourceLabel(row);
    const url = sourceUrl(row);
    if (!label && !url) continue;
    const dedupeKey = (url || label).trim().toLowerCase();
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    storedEvidenceCount += 1;
    sources.push({
      id: `S${sources.length + 1}`,
      label: label || `正式證據來源 ${storedEvidenceCount}`,
      url,
      data_as_of: firstText(row.published_at, row.data_as_of, row.captured_at, dataAsOf),
      supports: ['supporting_evidence'],
    });
  }

  if (glossaryMatch) {
    sources.push({
      id: `S${sources.length + 1}`,
      label: `名詞來源：${glossaryMatch.term}`,
      url: glossaryMatch.url,
      data_as_of: dataAsOf,
      supports: ['plain_explanation'],
    });
  }
  return { sources, storedEvidenceCount };
}

function matchingGlossary(question: string): GlossaryMatch {
  return OFFICIAL_GLOSSARY.find((item) => question.toLowerCase().includes(item.term.toLowerCase()));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('ALPHA_COACH_ENABLED') !== 'true') return jsonResponse({ success: false, error: 'FEATURE_DISABLED' }, 404);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ success: false, error: 'SERVICE_NOT_CONFIGURED' }, 503);

  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return jsonResponse({ success: false, error: 'AUTHENTICATION_REQUIRED' }, 401);

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return jsonResponse({ success: false, error: 'INVALID_SESSION' }, 401);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await serviceClient.from('profiles').select('role').eq('id', authData.user.id).maybeSingle();
  if (profileError) return jsonResponse({ success: false, error: 'ROLE_LOOKUP_FAILED' }, 500);
  const verifiedRole = text(profile?.role).toLowerCase();
  if (verifiedRole !== 'admin') return jsonResponse({ success: false, error: 'OWNER_REQUIRED' }, 403);

  const rateLimit = await consumeAlphaCoachRateLimit(
    (functionName, args) => serviceClient.rpc(functionName, args),
    authData.user.id,
    resolveAlphaCoachRateLimitPolicy(verifiedRole),
  );
  if (rateLimit.status === 'backend_error') {
    console.error('ALPHA_COACH_RATE_LIMIT_BACKEND_ERROR', { reason: rateLimit.reason });
    return jsonResponse({
      success: false,
      error: 'RATE_LIMIT_BACKEND_ERROR',
      message: '服務暫時忙碌，請稍後再試。',
    }, 503);
  }
  if (rateLimit.status === 'limited') {
    return jsonResponse({
      success: false,
      error: 'RATE_LIMITED',
      message: '請稍後再試。',
      retry_after_seconds: rateLimit.retryAfterSeconds,
    }, 429);
  }

  let body: JsonRecord;
  try {
    body = await readBody(req);
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError || (error instanceof Error && error.message === 'REQUEST_TOO_LARGE');
    return jsonResponse({ success: false, error: tooLarge ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON_BODY' }, tooLarge ? 413 : 400);
  }

  const questionCheck = validateAlphaCoachQuestion(body.question);
  if (!questionCheck.valid) return jsonResponse({ success: false, refused: true, answer: ALPHA_COACH_REFUSAL, reason: questionCheck.reason }, 400);

  const today = taipeiDate();
  const [reportResult, snapshotResult, memberResult] = await Promise.all([
    serviceClient.from('reports').select('*').eq('report_date', today).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    serviceClient.from('decision_snapshots').select('*').eq('report_date', today).eq('session_type', 'PREMARKET').eq('is_current', true).order('version', { ascending: false }).limit(1).maybeSingle(),
    serviceClient.from('current_member_content_revisions_v1').select('*').eq('report_date', today).order('revision', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (reportResult.error || snapshotResult.error || memberResult.error) {
    console.error('ALPHA_COACH_CONTEXT_QUERY_FAILED', {
      report: Boolean(reportResult.error), snapshot: Boolean(snapshotResult.error), member: Boolean(memberResult.error),
    });
    return jsonResponse({ success: false, refused: true, answer: ALPHA_COACH_REFUSAL }, 409);
  }

  const report = asObject(reportResult.data);
  const snapshot = asObject(snapshotResult.data);
  const member = asObject(memberResult.data);
  const ai = asObject(report.ai_strategy_json);
  const memberContent = asObject(member.member_content);
  const canonical = asObject(member.canonical_contract);
  const generatedText = asObject(snapshot.generated_text);
  const importantNews = normalizeReportImportantNews(report);
  const premiumGate = evaluatePremiumContentGate(ai, importantNews.length);
  const dataAsOf = firstText(snapshot.data_as_of, snapshot.generated_at, report.updated_at, report.created_at);
  const glossaryMatch = matchingGlossary(questionCheck.question);
  const { sources, storedEvidenceCount } = collectStoredSources(
    report,
    snapshot,
    member,
    importantNews,
    dataAsOf,
    glossaryMatch,
  );
  const contextGate = evaluateAlphaCoachContext({
    today,
    reportDate: report.report_date,
    reportId: report.id,
    snapshotStatus: snapshot.status,
    snapshotSessionType: snapshot.session_type,
    snapshotIsCurrent: snapshot.is_current,
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    memberStatus: member.status,
    semanticStatus: member.semantic_status,
    memberReportId: member.report_id,
    memberSnapshotId: member.decision_snapshot_id,
    memberSnapshotVersion: member.decision_snapshot_version,
    premiumEligible: premiumGate.eligible,
    sourceCount: storedEvidenceCount,
  });
  if (!contextGate.eligible) {
    console.warn('ALPHA_COACH_CONTEXT_BLOCKED', { reason_codes: contextGate.reasonCodes });
    return jsonResponse({ success: false, refused: true, answer: ALPHA_COACH_REFUSAL }, 409);
  }

  const thesis = firstText(
    memberContent.today_core_thesis,
    memberContent.subscriber_value_sentence,
    generatedText.daily_sentence,
    report.summary,
  );
  const evidence = [
    ...textList(memberContent.core_reasoning),
    ...textList(canonical.primary_causal_chain),
    ...textList(ai.supporting_evidence),
  ];
  const confirmation = [
    ...textList(memberContent.intraday_validation),
    ...textList(canonical.confirmation_conditions),
    ...textList(ai.confirmation_checklist),
  ];
  const invalidation = [
    ...textList(memberContent.invalidation_rules),
    ...textList(canonical.invalidation_conditions),
    ...textList(ai.risk_checklist),
  ];
  const answer = buildGroundedAlphaCoachAnswer({
    plainExplanation: glossaryMatch?.explanation || '以下說明只整理今天正式報告已確認的劇本、證據與驗證條件。',
    relationToToday: thesis,
    supportingEvidence: evidence,
    confirmationConditions: confirmation,
    invalidationConditions: invalidation,
    dataAsOf,
    sources,
  });
  if (!answer || !alphaCoachSourcesAreValid(answer, sources)) {
    return jsonResponse({ success: false, refused: true, answer: ALPHA_COACH_REFUSAL });
  }

  return jsonResponse({
    success: true,
    version: VERSION,
    report_date: today,
    data_as_of: dataAsOf,
    answer,
    sources,
    external_model_used: false,
  });
});
