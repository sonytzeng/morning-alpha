import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { evaluateResearchQualityGate } from "../_shared/research-quality-gate.ts";
import { evaluateCanonicalSemanticCoherenceGate, evaluatePublicPremiumLeakageGate } from "../_shared/production-architecture-core.mjs";
import { authorizeInternalRequest, internalCredentialsFromEnv } from "../_shared/internal-function-auth.mjs";
import type { RuntimeDatabase } from "../_shared/runtime-database-contract.ts";

type JsonRecord = Record<string, unknown>;
type AdminClient = ReturnType<typeof createClient<RuntimeDatabase>>;

const MAX_RESPONSE_BYTES = 1_000_000;
const PUBLIC_CONTRACT_VERSION = "morning_alpha_public_contract_v1";
const SOURCE_PROJECTION_REVISION = "content_os_source_v9_public_contract_v1";

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

async function recordBlockingIncident(
  admin: AdminClient,
  snapshot: JsonRecord,
  reasonCodes: string[],
  errorCode: string,
  metadata: JsonRecord = {},
): Promise<Response> {
  const incidentKey = `content-os:${String(snapshot.report_date || "unknown")}:${String(snapshot.id || "unknown")}`;
  const { data: incidentId, error } = await admin.rpc("record_content_os_incident_v1", {
    p_incident_key: incidentKey,
    p_business_date: String(snapshot.report_date || ""),
    p_snapshot_id: String(snapshot.id || ""),
    p_snapshot_version: Number(snapshot.version || 0),
    p_reason_codes: Array.from(new Set(reasonCodes)),
    p_http_status: 409,
    p_metadata: { error_code: errorCode, source_revision: SOURCE_PROJECTION_REVISION, ...metadata },
  });
  if (error) return json({ error: "CONTENT_OS_INCIDENT_WRITE_FAILED", detail: error.message }, 503);
  return json({
    error: errorCode,
    reason_codes: Array.from(new Set(reasonCodes)),
    incident_id: incidentId,
    incident_key: incidentKey,
  }, 409);
}

async function buildPublicOnlySource(
  report: JsonRecord,
  snapshot: JsonRecord,
  review: JsonRecord | null,
  premiumReasonCodes: string[],
): Promise<Response> {
  const ai = asObject(report.ai_strategy_json);
  const publicGate = asObject(ai.public_delivery_gate);
  if (publicGate.eligible !== true || String(publicGate.status || "") !== "PASS") {
    return json({ error: "PUBLIC_DELIVERY_GATE_BLOCKED", reason_codes: asArray(publicGate.reason_codes) }, 409);
  }
  const generated = asObject(snapshot.generated_text);
  const sourceReferences = firstArray(snapshot.source_refs, publicGate.published_claims).slice(0, 5);
  const publishedAt = String(review?.reviewed_at ?? snapshot.valid_from ?? report.updated_at ?? report.created_at);
  const revision = String(snapshot.snapshot_fingerprint ?? snapshot.version ?? "public");
  const revisionId = `${revision}:${SOURCE_PROJECTION_REVISION}`;
  const dailySentence = optionalString(generated.daily_sentence) ?? optionalString(report.today_quote) ?? optionalString(report.summary);
  const publicSummary = optionalString(ai.today_summary) ?? dailySentence;
  const marketBias = optionalString(report.market_bias ?? ai.market_bias);
  const confidenceScore = Number(snapshot.confidence_score ?? report.confidence_score);
  const evidenceCoverage = Number(publicGate.published_claim_evidence_coverage);
  const unsupportedClaims = asArray(publicGate.unsupported_published_claims);
  if (
    !dailySentence || !publicSummary || !marketBias || !sourceReferences.length ||
    !Number.isFinite(confidenceScore) || confidenceScore < 0 || confidenceScore > 100 ||
    !Number.isFinite(evidenceCoverage) || evidenceCoverage !== 100 || unsupportedClaims.length > 0
  ) {
    return json({
      error: "PUBLIC_CONTRACT_INCOMPLETE",
      contract_version: PUBLIC_CONTRACT_VERSION,
    }, 409);
  }
  const publicTopic = {
    kind: "market_brief",
    title: dailySentence,
    name: "台股盤前市場與風險指標",
    summary: publicSummary,
    reason: publicSummary,
    data_timestamp: publishedAt,
    source_references: sourceReferences,
  };
  const topicFingerprint = await sha256Hex({
    report_date: report.report_date,
    public_topic: publicTopic,
    source_references: sourceReferences,
  });
  return json({
    contract_version: PUBLIC_CONTRACT_VERSION,
    external_object_id: String(report.id),
    report_id: String(report.id),
    external_revision: revisionId,
    revision_id: revisionId,
    source_published_at: publishedAt,
    published_at: publishedAt,
    generated_at: String(report.updated_at ?? report.created_at),
    report_date: report.report_date,
    report_mode: report.report_mode,
    market_bias: marketBias,
    confidence_score: confidenceScore,
    daily_sentence: dailySentence,
    public_summary: publicSummary,
    topic_fingerprint: topicFingerprint,
    expires_at: new Date(new Date(publishedAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    public_topic: publicTopic,
    facts: sourceReferences,
    catalysts: [],
    taiwan_mapping: { transmission: null, preferred_sectors: [], watch_sectors: [] },
    risk: { risk_flags: asArray(snapshot.risk_flags).slice(0, 3) },
    opportunities: [],
    source_references: sourceReferences,
    morning_brief: {
      report_date: report.report_date,
      current_market_summary: optionalString(ai.today_summary),
      core_thesis: dailySentence,
      data_quality: optionalString(ai.data_quality),
      market_regime: optionalString(ai.market_regime),
    },
    core_data_status: ai.core_data_status ?? asObject(ai.core_data_gate).status ?? "BLOCKED",
    public_delivery_status: "PASS",
    premium_status: "BLOCKED",
    content_os_status: "PASS",
    premium_locked: true,
    evidence_status: "verified",
    premium: { status: "BLOCKED", locked: true, reason_codes: Array.from(new Set(premiumReasonCodes)) },
    verification: {
      status: "verified",
      contract_version: PUBLIC_CONTRACT_VERSION,
      decision_snapshot_id: snapshot.id,
      editorial_review_id: review?.id ?? null,
      review_status: review?.review_status ?? null,
      content_score: Number(review?.content_score ?? snapshot.content_score),
      published_claim_evidence_coverage: evidenceCoverage,
      unsupported_published_claims: unsupportedClaims,
      public_premium_leakage: true,
      semantic_coherence: true,
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
  const admin = createClient<RuntimeDatabase>(supabaseUrl, secretKey, {
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
    return recordBlockingIncident(admin, snapshot, ["APPROVED_EDITORIAL_EVIDENCE_REQUIRED"], "APPROVED_EDITORIAL_EVIDENCE_REQUIRED");
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
    return recordBlockingIncident(admin, snapshot, ["REPORT_SNAPSHOT_DATE_MISMATCH"], "REPORT_SNAPSHOT_DATE_MISMATCH");
  }

  const ai = asObject(report.ai_strategy_json);
  const publicGate = asObject(ai.public_delivery_gate);
  const researchMaster = optionalObject(ai.research_master_v2);
  const researchSections = optionalObject(researchMaster?.sections);
  const researchGate = evaluateResearchQualityGate(
    researchMaster,
    premiumPublishMinimum,
  );
  if (!researchSections || !researchGate.eligible) {
    return buildPublicOnlySource(
      report,
      snapshot,
      review,
      ["RESEARCH_QUALITY_GATE_BLOCKED", ...researchGate.reason_codes],
    );
  }

  const memberRevisionResult = await admin
    .from("current_member_content_revisions_v1")
    .select("*")
    .eq("report_date", String(snapshot.report_date))
    .eq("decision_snapshot_id", String(snapshot.id))
    .eq("decision_snapshot_version", Number(snapshot.version))
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (memberRevisionResult.error) return json({ error: "MEMBER_CONTENT_REVISION_READ_FAILED" }, 503);
  if (!memberRevisionResult.data) {
    return buildPublicOnlySource(report, snapshot, review, ["SEMANTIC_MEMBER_REVISION_MISSING"]);
  }
  const memberRevision = memberRevisionResult.data as JsonRecord;
  const memberContent = asObject(memberRevision.member_content);
  const canonicalContract = asObject(memberRevision.canonical_contract);
  const canonicalRecommendations = asArray(memberContent.representative_stocks);
  const semanticGate = evaluateCanonicalSemanticCoherenceGate({
    canonical_contract: canonicalContract,
    sections: {
      today_core_thesis: memberContent.today_core_thesis,
      strategy_summary: memberContent.strategy_summary,
      taiwan_transmission: memberContent.taiwan_transmission,
    },
    recommendations: canonicalRecommendations,
    quality_inputs: [
      ai.data_quality,
      ai.v10_data_quality_status,
      optionalObject(ai.member_research_note_v2)?.data_status,
      memberRevision.data_quality_status,
    ],
    quality_counters: {
      unsupported_claim_count: researchGate.unsupported_claim_count,
      duplicate_claim_count: researchGate.duplicate_claim_count,
      contradiction_count: researchGate.contradiction_count,
      missing_section_count: researchGate.missing_section_count,
    },
    evidence_coverage: memberRevision.evidence_coverage,
    content_score: memberRevision.content_score,
  });
  if (!semanticGate.eligible) {
    return buildPublicOnlySource(
      report,
      snapshot,
      review,
      ["SEMANTIC_COHERENCE_BLOCKED", ...semanticGate.reason_codes],
    );
  }

  const generated = asObject(snapshot.generated_text);
  const opportunities = canonicalRecommendations;
  const publicTopicSource = asObject(opportunities[0]);
  const publicSourceReferences = firstArray(
    publicTopicSource.source_references,
    publicTopicSource.supporting_evidence,
    publicTopicSource.source_refs,
  ).slice(0, 5);
  const publicTopic = {
    kind: "stock_opportunity",
    symbol: optionalString(publicTopicSource.symbol ?? publicTopicSource.stock_code),
    name: optionalString(publicTopicSource.name ?? publicTopicSource.stock_name),
    role: optionalString(publicTopicSource.role_title ?? publicTopicSource.role_label ?? publicTopicSource.role),
    event_source: optionalString(publicTopicSource.event_source ?? publicTopicSource.trigger_event),
    transmission_path: optionalString(publicTopicSource.transmission_path ?? publicTopicSource.transmission_logic),
    taiwan_mapping: optionalString(publicTopicSource.taiwan_mapping ?? publicTopicSource.sector ?? publicTopicSource.industry_name),
    reason: optionalString(
      publicTopicSource.why_today ?? publicTopicSource.why_this_stock ??
        publicTopicSource.reason ?? publicTopicSource.why_selected ??
        publicTopicSource.taiwan_supply_chain_relation,
    ),
    data_timestamp: optionalString(publicTopicSource.data_timestamp ?? publicTopicSource.updated_at ?? report.updated_at ?? report.created_at),
    source_references: publicSourceReferences,
  };
  const primaryThesis = optionalString(memberContent.today_core_thesis) ?? optionalString(generated.daily_sentence) ?? optionalString(report.today_quote);
  Object.assign(publicTopic, {
    title: [publicTopic.symbol, publicTopic.name].filter(Boolean).join(" "),
    summary: publicTopic.reason,
  });
  const publicTopicComplete = Boolean(publicTopic.symbol && publicTopic.name && publicTopic.event_source && publicTopic.transmission_path && publicTopic.taiwan_mapping && publicTopic.reason && publicTopic.data_timestamp && publicSourceReferences.length);
  if (!publicTopicComplete) return buildPublicOnlySource(report, snapshot, review, ['PUBLIC_TOPIC_INCOMPLETE']);
  const premiumOnlySymbols = opportunities.slice(1).map((item) => optionalString(asObject(item).symbol ?? asObject(item).stock_code)).filter((symbol): symbol is string => Boolean(symbol) && symbol !== publicTopic.symbol);
  const leakageGate = evaluatePublicPremiumLeakageGate({ public_symbols: [publicTopic.symbol], premium_only_symbols: premiumOnlySymbols, public_fields: Object.keys(publicTopic), public_entities: [publicTopic.name,publicTopic.role].filter((value): value is string => Boolean(value)), premium_entities: [] });
  if (!leakageGate.eligible) return recordBlockingIncident(admin, snapshot, ['PUBLIC_TOPIC_GATE_BLOCKED', ...leakageGate.reason_codes], 'PUBLIC_TOPIC_GATE_BLOCKED', { member_content_revision_id: memberRevision.id });
  const publishedAt = String(
    review.reviewed_at ?? snapshot.valid_from ?? report.updated_at ??
      report.created_at,
  );
  const revision = String(
    snapshot.snapshot_fingerprint ?? `${snapshot.version}:${review.id}`,
  );
  const projectedRevision = `${revision}:${String(memberRevision.id)}:${SOURCE_PROJECTION_REVISION}`;
  const topicFingerprint = await sha256Hex({ report_date: report.report_date, public_topic: publicTopic, primary_thesis: primaryThesis });
  const expiresAt = new Date(new Date(publishedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const incidentKey = `content-os:${String(snapshot.report_date)}:${String(snapshot.id)}`;
  const { error: resolveIncidentError } = await admin.rpc("resolve_content_os_incident_v1", {
    p_incident_key: incidentKey,
    p_snapshot_version: Number(snapshot.version),
    p_metadata: { member_content_revision_id: memberRevision.id, source_revision: SOURCE_PROJECTION_REVISION },
  });
  if (resolveIncidentError) return json({ error: "CONTENT_OS_INCIDENT_RESOLUTION_FAILED" }, 503);

  return json({
    contract_version: PUBLIC_CONTRACT_VERSION,
    external_object_id: String(report.id),
    report_id: String(report.id),
    external_revision: projectedRevision,
    revision_id: projectedRevision,
    source_published_at: publishedAt,
    published_at: publishedAt,
    generated_at: String(report.updated_at ?? report.created_at),
    report_date: report.report_date,
    report_mode: report.report_mode,
    market_bias: report.market_bias ?? ai.market_bias,
    confidence_score: snapshot.confidence_score ?? report.confidence_score,
    daily_sentence: generated.daily_sentence ?? report.today_quote ??
      report.summary,
    public_summary: primaryThesis ?? publicTopic.reason,
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
      contract_version: PUBLIC_CONTRACT_VERSION,
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
      semantic_coherence: semanticGate.eligible,
      semantic_gate_version: semanticGate.gate_version,
      member_content_revision_id: memberRevision.id,
      public_premium_leakage: leakageGate.eligible,
      published_claim_evidence_coverage: publicGate.published_claim_evidence_coverage,
      unsupported_published_claims: publicGate.unsupported_published_claims ?? [],
    },
    core_data_status: ai.core_data_status ?? asObject(ai.core_data_gate).status ?? "BLOCKED",
    public_delivery_status: "PASS",
    premium_status: "PASS",
    content_os_status: "PASS",
    premium_locked: false,
    evidence_status: "verified",
    premium: { status: "PASS", locked: false, reason_codes: [] },
  });
});
