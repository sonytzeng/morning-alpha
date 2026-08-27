import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { evaluateResearchQualityGate } from "../_shared/research-quality-gate.ts";
import { evaluatePublicPremiumLeakageGate, evaluateSemanticCoherenceGate } from "../_shared/production-architecture-core.mjs";
import { authorizeInternalRequest, internalCredentialsFromEnv } from "../_shared/internal-function-auth.mjs";

type JsonRecord = Record<string, unknown>;

const MAX_RESPONSE_BYTES = 1_000_000;
const SOURCE_PROJECTION_REVISION = "content_os_source_v6";

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function optionalObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function sha256Hex(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function serverSecretKey(): string {
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (encoded) {
    try {
      const keys = JSON.parse(encoded) as Record<string, unknown>;
      if (typeof keys.default === "string" && keys.default.trim()) {
        return keys.default.trim();
      }
    } catch {
      // Fall through to the legacy hosted variable during key migration.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function json(body: JsonRecord, status = 200): Response {
  let payload = JSON.stringify(body);
  let responseStatus = status;
  if (new TextEncoder().encode(payload).byteLength >= MAX_RESPONSE_BYTES) {
    payload = JSON.stringify({ error: "SOURCE_RESPONSE_TOO_LARGE" });
    responseStatus = 503;
  }

  return new Response(payload, {
    status: responseStatus,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "GET") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const internalAuth = await authorizeInternalRequest(
    request.headers,
    internalCredentialsFromEnv(),
  );
  const expectedToken = Deno.env.get("SONY_CONTENT_OS_SOURCE_TOKEN")?.trim() ??
    "";
  const suppliedToken = request.headers.get("Authorization")
    ?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const sourceAuthorized = Boolean(
    expectedToken && suppliedToken && constantTimeEqual(suppliedToken, expectedToken),
  );
  if (!internalAuth.ok && !sourceAuthorized) {
    const hasInternalHeader = Boolean(
      request.headers.get("x-cron-secret") || request.headers.get("apikey"),
    );
    if (hasInternalHeader) {
      return json({ error: internalAuth.error_code, error_code: internalAuth.error_code }, 401);
    }
    if (!expectedToken) {
      return json({ error: "SOURCE_TOKEN_NOT_CONFIGURED" }, 503);
    }
    return json({ error: "SOURCE_AUTH_REQUIRED" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const secretKey = serverSecretKey();
  if (!supabaseUrl || !secretKey) {
    return json({ error: "SERVER_CONFIGURATION" }, 503);
  }
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false },
  });

  const snapshotResult = await admin
    .from("decision_snapshots")
    .select(
      "id,report_id,report_date,session_type,version,status,decision_mode,action,confidence_score,coverage_score,content_score,content_grade,source_refs,generated_text,preferred_sectors,watch_sectors,blocked_sectors,reasons,risk_flags,invalidation_rules,valid_from,snapshot_fingerprint",
    )
    .eq("is_current", true)
    .eq("status", "READY")
    .eq("session_type", "PREMARKET")
    .not("report_id", "is", null)
    .order("report_date", { ascending: false })
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapshotResult.error) {
    return json({ error: "DECISION_SNAPSHOT_READ_FAILED" }, 503);
  }
  if (!snapshotResult.data) {
    return json({ error: "VERIFIED_DECISION_NOT_FOUND" }, 404);
  }
  const snapshot = snapshotResult.data as JsonRecord;

  const policyResult = await admin
    .from("runtime_quality_policies")
    .select("policy_version,premium_publish_min")
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (policyResult.error || !policyResult.data) {
    return json({ error: "RUNTIME_QUALITY_POLICY_REQUIRED" }, 503);
  }
  const qualityPolicy = policyResult.data as JsonRecord;
  const premiumPublishMinimum = Number(qualityPolicy.premium_publish_min);
  if (
    !Number.isFinite(premiumPublishMinimum) || premiumPublishMinimum < 1 ||
    premiumPublishMinimum > 100
  ) {
    return json({ error: "RUNTIME_QUALITY_POLICY_INVALID" }, 503);
  }

  const reviewResult = await admin
    .from("editorial_reviews")
    .select(
      "id,review_status,content_score,reason_codes,reviewed_at,reviewed_by",
    )
    .eq("decision_snapshot_id", String(snapshot.id))
    .eq("review_status", "APPROVED")
    .order("reviewed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reviewResult.error) {
    return json({ error: "EDITORIAL_REVIEW_READ_FAILED" }, 503);
  }
  const review = reviewResult.data as JsonRecord | null;
  const reviewScore = Number(
    review?.content_score ?? snapshot.content_score ?? 0,
  );
  if (
    !review || !Number.isFinite(reviewScore) ||
    reviewScore < premiumPublishMinimum
  ) {
    return json({ error: "APPROVED_EDITORIAL_EVIDENCE_REQUIRED" }, 409);
  }

  const reportResult = await admin
    .from("reports")
    .select(
      "id,report_date,report_mode,summary,market_bias,confidence_score,today_quote,ai_strategy_json,important_news_json,created_at,updated_at",
    )
    .eq("id", String(snapshot.report_id))
    .maybeSingle();
  if (reportResult.error) return json({ error: "REPORT_READ_FAILED" }, 503);
  if (!reportResult.data) return json({ error: "REPORT_NOT_FOUND" }, 404);
  const report = reportResult.data as JsonRecord;
  if (String(report.report_date ?? "") !== String(snapshot.report_date ?? "")) {
    return json({ error: "REPORT_SNAPSHOT_DATE_MISMATCH" }, 409);
  }

  const ai = asObject(report.ai_strategy_json);
  const researchMaster = optionalObject(ai.research_master_v2);
  const researchSections = optionalObject(researchMaster?.sections);
  const researchGate = evaluateResearchQualityGate(
    researchMaster,
    premiumPublishMinimum,
  );
  if (!researchSections || !researchGate.eligible) {
    return json({
      error: "RESEARCH_QUALITY_GATE_BLOCKED",
      quality_status: researchGate.publish_status,
      evidence_coverage: researchGate.evidence_coverage,
      unsupported_claim_count: researchGate.unsupported_claim_count,
      duplicate_claim_count: researchGate.duplicate_claim_count,
      contradiction_count: researchGate.contradiction_count,
      missing_section_count: researchGate.missing_section_count,
      required_score: researchGate.required_score,
      reason_codes: researchGate.reason_codes,
      policy_version: qualityPolicy.policy_version,
    }, 409);
  }

  const coreThesis = optionalObject(researchSections.core_thesis);
  const generated = asObject(snapshot.generated_text);
  const opportunities = firstArray(
    generated.recommendations,
    ai.today_beneficiary_stocks_v10,
    ai.today_beneficiary_stocks,
    ai.v10_observation_watchlist,
    snapshot.watch_sectors,
  );
  const publicTopicSource = asObject(opportunities[0]);
  const publicSourceReferences = firstArray(
    publicTopicSource.source_references,
    publicTopicSource.supporting_evidence,
    publicTopicSource.source_refs,
  ).slice(0, 5);
  const publicTopic = {
    symbol: optionalString(publicTopicSource.symbol ?? publicTopicSource.stock_code),
    name: optionalString(publicTopicSource.name ?? publicTopicSource.stock_name),
    role: optionalString(publicTopicSource.role_title ?? publicTopicSource.role_label ?? publicTopicSource.role),
    event_source: optionalString(publicTopicSource.event_source ?? publicTopicSource.trigger_event),
    transmission_path: optionalString(publicTopicSource.transmission_path ?? publicTopicSource.transmission_logic),
    taiwan_mapping: optionalString(publicTopicSource.taiwan_mapping ?? publicTopicSource.sector ?? publicTopicSource.industry_name),
    reason: optionalString(publicTopicSource.why_today ?? publicTopicSource.reason ?? publicTopicSource.why_selected),
    data_timestamp: optionalString(publicTopicSource.data_timestamp ?? publicTopicSource.updated_at ?? report.data_as_of),
    source_references: publicSourceReferences,
  };
  const primaryThesis = optionalString(coreThesis?.statement) ?? optionalString(generated.daily_sentence) ?? optionalString(report.today_quote);
  const publicTopicComplete = Boolean(publicTopic.symbol && publicTopic.name && publicTopic.event_source && publicTopic.transmission_path && publicTopic.taiwan_mapping && publicTopic.reason && publicTopic.data_timestamp && publicSourceReferences.length);
  if (!publicTopicComplete) return json({ error: 'PUBLIC_TOPIC_INCOMPLETE' }, 409);
  const coherenceGate = evaluateSemanticCoherenceGate({ primary_thesis: primaryThesis, sections: [publicTopic.reason, publicTopic.transmission_path, publicTopic.taiwan_mapping], contradictions: researchGate.contradiction_count > 0 ? ['research_gate_contradiction'] : [] });
  const premiumOnlySymbols = opportunities.slice(1).map((item) => optionalString(asObject(item).symbol ?? asObject(item).stock_code)).filter((symbol): symbol is string => Boolean(symbol) && symbol !== publicTopic.symbol);
  const leakageGate = evaluatePublicPremiumLeakageGate({ public_symbols: [publicTopic.symbol], premium_only_symbols: premiumOnlySymbols, public_fields: Object.keys(publicTopic), public_entities: [publicTopic.name,publicTopic.role].filter((value): value is string => Boolean(value)), premium_entities: [] });
  if (!coherenceGate.eligible || !leakageGate.eligible) return json({ error: 'PUBLIC_TOPIC_GATE_BLOCKED', reason_codes: [...coherenceGate.reason_codes, ...leakageGate.reason_codes] }, 409);
  const publishedAt = String(
    review.reviewed_at ?? snapshot.valid_from ?? report.updated_at ??
      report.created_at,
  );
  const revision = String(
    snapshot.snapshot_fingerprint ?? `${snapshot.version}:${review.id}`,
  );
  const projectedRevision = `${revision}:${SOURCE_PROJECTION_REVISION}`;
  const topicFingerprint = await sha256Hex({ report_date: report.report_date, public_topic: publicTopic, primary_thesis: primaryThesis });
  const expiresAt = new Date(new Date(publishedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();

  return json({
    external_object_id: String(report.id),
    report_id: String(report.id),
    external_revision: projectedRevision,
    source_published_at: publishedAt,
    published_at: publishedAt,
    report_date: report.report_date,
    report_mode: report.report_mode,
    market_bias: report.market_bias ?? ai.market_bias,
    confidence_score: snapshot.confidence_score ?? report.confidence_score,
    daily_sentence: generated.daily_sentence ?? report.today_quote ??
      report.summary,
    topic_fingerprint: topicFingerprint,
    expires_at: expiresAt,
    public_topic: publicTopic,
    facts: publicSourceReferences,
    catalysts: [{ event_source: publicTopic.event_source }],
    taiwan_mapping: {
      transmission: publicTopic.taiwan_mapping,
      preferred_sectors: publicTopic.role ? [publicTopic.role] : [],
      watch_sectors: [],
    },
    risk: { risk_flags: asArray(snapshot.risk_flags).slice(0, 3) },
    opportunities: [publicTopic],
    source_references: publicSourceReferences,
    morning_brief: {
      report_date: report.report_date,
      current_market_summary: optionalString(ai.today_summary),
      core_thesis: primaryThesis,
      data_quality: optionalString(ai.data_quality),
      market_regime: optionalString(ai.market_regime),
    },
    verification: {
      status: "verified",
      decision_snapshot_id: snapshot.id,
      editorial_review_id: review.id,
      review_status: review.review_status,
      content_score: reviewScore,
      content_grade: snapshot.content_grade,
      reviewed_at: review.reviewed_at,
      reviewed_by: review.reviewed_by,
      quality_policy_version: qualityPolicy.policy_version,
      required_score: premiumPublishMinimum,
      research_publish_status: researchGate.publish_status,
      evidence_coverage: researchGate.evidence_coverage,
      unsupported_claim_count: researchGate.unsupported_claim_count,
      duplicate_claim_count: researchGate.duplicate_claim_count,
      contradiction_count: researchGate.contradiction_count,
      missing_section_count: researchGate.missing_section_count,
      semantic_coherence: coherenceGate.eligible,
      public_premium_leakage: leakageGate.eligible,
    },
  });
});
