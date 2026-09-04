import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { contentLengthExceedsLimit, readBoundedText, RequestBodyTooLargeError } from '../_shared/bounded-json.ts';
import { evaluatePremiumContentGate } from '../_shared/premium-content-gate.ts';
import {
  ALPHA_COACH_REFUSAL,
  alphaCoachSourcesAreValid,
  buildGroundedAlphaCoachAnswer,
  evaluateAlphaCoachContext,
  type AlphaCoachSource,
  validateAlphaCoachQuestion,
} from '../_shared/alpha-coach-contract.ts';

type JsonRecord = Record<string, unknown>;

const VERSION = 'ALPHA_COACH_OWNER_PREVIEW_V1';
const MAX_BODY_BYTES = 4096;
const REQUESTS_PER_MINUTE = 5;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};
const rateWindows = new Map<string, number[]>();

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

function consumeRateLimit(userId: string): boolean {
  const now = Date.now();
  const active = (rateWindows.get(userId) || []).filter((time) => now - time < 60_000);
  if (active.length >= REQUESTS_PER_MINUTE) return false;
  active.push(now);
  rateWindows.set(userId, active);
  return true;
}

async function readBody(req: Request): Promise<JsonRecord> {
  if (contentLengthExceedsLimit(req.headers.get('content-length'), MAX_BODY_BYTES)) throw new RequestBodyTooLargeError();
  const raw = await readBoundedText(req.body, MAX_BODY_BYTES);
  const parsed = raw ? JSON.parse(raw) as unknown : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JSON_BODY');
  return parsed as JsonRecord;
}

function collectStoredSources(
  snapshot: JsonRecord,
  member: JsonRecord,
  dataAsOf: string,
): AlphaCoachSource[] {
  const sources: AlphaCoachSource[] = [{
    id: 'S1',
    label: `Morning Alpha Decision Snapshot v${text(snapshot.version)}`,
    data_as_of: dataAsOf,
  }, {
    id: 'S2',
    label: `Morning Alpha Member Research Revision v${text(member.revision)}`,
    data_as_of: text(member.generated_at) || dataAsOf,
  }];
  OFFICIAL_GLOSSARY.forEach((item, index) => sources.push({
    id: `S${index + 3}`,
    label: `名詞來源：${item.term}`,
    url: item.url,
    data_as_of: dataAsOf,
  }));
  return sources;
}

function matchingGlossaryExplanation(question: string): string {
  const match = OFFICIAL_GLOSSARY.find((item) => question.toLowerCase().includes(item.term.toLowerCase()));
  return match?.explanation || '以下說明只整理今天正式報告已確認的劇本、證據與驗證條件。';
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
  if (text(profile?.role).toLowerCase() !== 'admin') return jsonResponse({ success: false, error: 'OWNER_REQUIRED' }, 403);
  if (!consumeRateLimit(authData.user.id)) return jsonResponse({ success: false, error: 'RATE_LIMITED' }, 429);

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
  const premiumGate = evaluatePremiumContentGate(ai, asRecords(report.important_news).length);
  const dataAsOf = firstText(snapshot.data_as_of, snapshot.generated_at, report.updated_at, report.created_at);
  const sources = collectStoredSources(snapshot, member, dataAsOf);
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
    sourceCount: sources.length,
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
    plainExplanation: matchingGlossaryExplanation(questionCheck.question),
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
