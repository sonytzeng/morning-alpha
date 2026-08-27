import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { evaluateResearchQualityGate } from "../_shared/research-quality-gate.ts";

type JsonRecord = Record<string, unknown>;

const MAX_RESPONSE_BYTES = 1_000_000;
const SOURCE_PROJECTION_REVISION = "content_os_source_v5";

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

  const expectedToken = Deno.env.get("SONY_CONTENT_OS_SOURCE_TOKEN")?.trim() ??
    "";
  const suppliedToken = request.headers.get("Authorization")
    ?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!expectedToken) {
    return json({ error: "SOURCE_TOKEN_NOT_CONFIGURED" }, 503);
  }
  if (!suppliedToken || !constantTimeEqual(suppliedToken, expectedToken)) {
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

  const overnightAnalysis = optionalObject(ai.v8_overnight_causal_chain);
  const memberResearch = optionalObject(ai.member_research_note_v2);
  const whyTodayMatters = optionalObject(researchSections.why_today_matters);
  const coreThesis = optionalObject(researchSections.core_thesis);
  const globalEvents = firstArray(
    memberResearch?.overnight_chain,
    overnightAnalysis?.chains,
  ).slice(0, 5);
  const intradayValidation = asArray(memberResearch?.intraday_validation).slice(
    0,
    1,
  );
  const morningBrief = {
    report_date: report.report_date,
    ...(globalEvents.length ? { global_events: globalEvents } : {}),
    ...(optionalString(whyTodayMatters?.narrative)
      ? { overnight_market_summary: optionalString(whyTodayMatters?.narrative) }
      : {}),
    ...(optionalString(ai.today_summary)
      ? { current_market_summary: optionalString(ai.today_summary) }
      : {}),
    ...(optionalString(
        memberResearch?.taiwan_transmission ?? ai.taiwan_transmission,
      )
      ? {
        taiwan_transmission: optionalString(
          memberResearch?.taiwan_transmission ?? ai.taiwan_transmission,
        ),
      }
      : {}),
    ...(optionalString(coreThesis?.statement)
      ? { core_thesis: optionalString(coreThesis?.statement) }
      : {}),
    ...(intradayValidation.length
      ? { first_watch: intradayValidation[0] }
      : {}),
    ...(firstArray(
        memberResearch?.invalidation_rules,
        snapshot.invalidation_rules,
      ).length
      ? {
        invalidation_rules: firstArray(
          memberResearch?.invalidation_rules,
          snapshot.invalidation_rules,
        ).slice(0, 4),
      }
      : {}),
    ...(optionalString(ai.data_quality)
      ? { data_quality: optionalString(ai.data_quality) }
      : {}),
    ...(optionalString(ai.market_regime)
      ? { market_regime: optionalString(ai.market_regime) }
      : {}),
  };
  const generated = asObject(snapshot.generated_text);
  const sourceReferences = asArray(snapshot.source_refs);
  const importantNews = firstArray(
    report.important_news_json,
    ai.important_news,
  );
  const opportunities = firstArray(
    generated.recommendations,
    ai.today_beneficiary_stocks_v10,
    ai.today_beneficiary_stocks,
    ai.v10_observation_watchlist,
    snapshot.watch_sectors,
  );
  const surprises = firstArray(
    ai.surprises,
    ai.v10_observation_watchlist,
    ai.extended_watchlist,
  );
  const publishedAt = String(
    review.reviewed_at ?? snapshot.valid_from ?? report.updated_at ??
      report.created_at,
  );
  const revision = String(
    snapshot.snapshot_fingerprint ?? `${snapshot.version}:${review.id}`,
  );
  const projectedRevision = `${revision}:${SOURCE_PROJECTION_REVISION}`;

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
    facts: sourceReferences,
    catalysts: firstArray(
      ai.causal_overnight_impact_chains,
      ai.overnight_impact_chain,
      importantNews,
    ),
    surprises,
    taiwan_mapping: {
      transmission: ai.taiwan_transmission ?? ai.taiwan_mapping ?? null,
      preferred_sectors: asArray(snapshot.preferred_sectors),
      watch_sectors: asArray(snapshot.watch_sectors),
    },
    risk: {
      risk_flags: asArray(snapshot.risk_flags),
      invalidation_rules: firstArray(
        snapshot.invalidation_rules,
        generated.invalidation_conditions,
        ai.invalidation_conditions,
      ),
      blocked_sectors: asArray(snapshot.blocked_sectors),
    },
    opportunities,
    source_references: sourceReferences,
    morning_brief: morningBrief,
    research_master_v2: researchMaster,
    ...(overnightAnalysis ? { overnight_analysis: overnightAnalysis } : {}),
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
    },
  });
});
