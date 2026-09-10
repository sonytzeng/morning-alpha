import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { evaluateResearchQualityGate } from "../_shared/research-quality-gate.ts";
import { evaluatePublicPremiumLeakageGate } from "../_shared/production-architecture-core.mjs";
import { evaluateMarketReportGate } from "../_shared/market-report-gate.ts";
import { evaluatePremiumContentGate } from "../_shared/premium-content-gate.ts";
import { evaluatePublishedMarketDelivery, fetchPublishedDeliveryEvidence } from "../_shared/market-publication-contract.ts";
import { canonicalMarketDocument, canonicalMarketSourceRefs } from "../_shared/canonical-market-state.ts";
import { authorizeInternalRequest, internalCredentialsFromEnv } from "../_shared/internal-function-auth.mjs";
import type { RuntimeDatabase } from "../_shared/runtime-database-contract.ts";

type JsonRecord = Record<string, unknown>;
type AdminClient = ReturnType<typeof createClient<RuntimeDatabase>>;

const MAX_RESPONSE_BYTES = 1_000_000;
const PUBLIC_CONTRACT_VERSION = "morning_alpha_public_contract_v1";
const SOURCE_PROJECTION_REVISION = "content_os_source_v13_committed_market_projection";

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
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

/** The deployed v19 market_brief wire requires actual HTTPS references. Ledger
 * IDs are not URLs. Only committed snapshot references may supply these fields;
 * missing metadata must never be filled from mutable report/news aliases. */
function publicHttpsSourceReferences(value: unknown, generated: JsonRecord): JsonRecord[] {
  // canonicalMarketSourceRefs applies the producer's one metadata validator.
  // Every outward URL must be an exact view of that frozen claim source, not an
  // arbitrary URL attached to an otherwise valid ledger ID at read time.
  const frozenReferences = canonicalMarketSourceRefs(generated);
  return asArray(value).map(asObject).flatMap((reference) => {
    const keys = ["evidence_id", "source", "source_date", "freshness"];
    if (!keys.every((key) => optionalString(reference[key]))) return [];
    const frozen = frozenReferences.find((row) => keys.every((key) => row[key] === reference[key]));
    if (!frozen || !["title", "url", "published_at"].every((key) => optionalString(frozen[key]) && frozen[key] === reference[key])
      || reference.published_at !== reference.source_date) return [];
    const url = optionalString(reference.url);
    const source = optionalString(reference.source);
    const title = optionalString(reference.title);
    const publishedAt = optionalString(reference.published_at);
    if (!url || !source || !title || !publishedAt || !Number.isFinite(Date.parse(publishedAt))) return [];
    try {
      if (new URL(url).protocol !== "https:") return [];
    } catch {
      return [];
    }
    return [{ source, title, url, published_at: publishedAt }];
  }).slice(0, 5);
}

type PublishedDelivery = ReturnType<typeof evaluatePublishedMarketDelivery>;

/** Presentation of an already verified publication. It does not select a
 * decision, score research, or promote a private recommendation draft. */
async function buildContentOsPublicPayload(
  report: JsonRecord,
  snapshot: JsonRecord,
  memberRevision: JsonRecord,
  review: JsonRecord,
  policy: JsonRecord,
  publicationRun: JsonRecord | null,
  delivery: PublishedDelivery,
): Promise<{ payload: JsonRecord | null; reasonCodes: string[] }> {
  const projection = delivery.projection;
  if (!delivery.eligible) return { payload: null, reasonCodes: delivery.reason_codes };
  const generated = asObject(snapshot.generated_text);
  const document = canonicalMarketDocument(generated);
  // The new outgoing source contract never borrows a mutable legacy report
  // document. Older snapshots remain untouched and explicitly unsupported when
  // the frozen proof required for this verified wire was not persisted.
  if (!Object.hasOwn(generated, "canonical_market_state") || !Object.keys(document).length) {
    return { payload: null, reasonCodes: ["FROZEN_PUBLIC_MARKET_EVIDENCE_REQUIRED"] };
  }
  const researchGate = evaluateResearchQualityGate(document);
  const sections = asObject(document.sections);
  const sentence = projection.marketDecision.summary;
  const publishedAt = optionalString(publicationRun?.completed_at) ?? optionalString(review.reviewed_at);
  const generatedAt = projection.identity.generatedAt;
  const confidence = projection.confidence.value;
  if (!sentence || !projection.marketDecision.bias || confidence === null || !publishedAt || !generatedAt
    || !Number.isFinite(Date.parse(publishedAt)) || !Number.isFinite(Date.parse(generatedAt))) {
    return { payload: null, reasonCodes: ["PUBLIC_TOPIC_INCOMPLETE"] };
  }

  const opportunities = projection.recommendation.available ? projection.recommendation.items : [];
  const stock = asObject(opportunities[0]);
  let publicTopic: JsonRecord;
  let references: unknown[];
  if (opportunities.length > 0) {
    references = firstArray(stock.source_references, stock.supporting_evidence, stock.source_refs).slice(0, 5);
    publicTopic = {
      kind: "stock_opportunity",
      symbol: optionalString(stock.symbol ?? stock.stock_code),
      name: optionalString(stock.name ?? stock.stock_name),
      role: optionalString(stock.role_title ?? stock.role_label ?? stock.role),
      event_source: optionalString(stock.event_source ?? stock.trigger_event),
      transmission_path: optionalString(stock.transmission_path ?? stock.transmission_logic),
      taiwan_mapping: optionalString(stock.taiwan_mapping ?? stock.sector ?? stock.industry_name),
      reason: optionalString(stock.why_today ?? stock.why_this_stock ?? stock.reason ?? stock.why_selected ?? stock.taiwan_supply_chain_relation),
      data_timestamp: optionalString(stock.data_timestamp ?? stock.updated_at) ?? publishedAt,
      source_references: references,
    };
    if (!["symbol", "name", "event_source", "transmission_path", "taiwan_mapping", "reason", "data_timestamp"].every((key) => optionalString(publicTopic[key])) || !references.length) {
      return { payload: null, reasonCodes: ["PUBLIC_TOPIC_INCOMPLETE"] };
    }
    publicTopic.title = `${publicTopic.symbol} ${publicTopic.name}`;
    publicTopic.summary = publicTopic.reason;
  } else {
    references = publicHttpsSourceReferences(snapshot.source_refs, generated);
    if (!references.length) return { payload: null, reasonCodes: ["PUBLIC_MARKET_EVIDENCE_INCOMPLETE"] };
    const firstReference = asObject(references[0]);
    publicTopic = {
      kind: "market_brief",
      title: sentence,
      name: "台股盤前市場與風險指標",
      summary: sentence,
      reason: sentence,
      event_source: `${firstReference.source}：${firstReference.title}`,
      transmission_path: optionalString(asObject(sections.transmission_narrative).narrative) ?? sentence,
      taiwan_mapping: "台股大盤與盤前風險指標",
      data_timestamp: publishedAt,
      source_references: references,
    };
  }
  const premiumSymbols = opportunities.slice(1).map((value) => {
    const stock = asObject(value);
    return optionalString(stock.symbol ?? stock.stock_code);
  }).filter((symbol): symbol is string => Boolean(symbol) && symbol !== publicTopic.symbol);
  const leakageGate = evaluatePublicPremiumLeakageGate({
    public_symbols: publicTopic.symbol ? [publicTopic.symbol] : [],
    premium_only_symbols: premiumSymbols,
    public_fields: Object.keys(publicTopic),
    public_entities: publicTopic.symbol ? [publicTopic.name, publicTopic.role].filter(Boolean) : [],
    premium_entities: [],
  });
  if (!leakageGate.eligible) return { payload: null, reasonCodes: ["PUBLIC_TOPIC_GATE_BLOCKED", ...leakageGate.reason_codes] };
  const marketBrief = publicTopic.kind === "market_brief";
  const payload: JsonRecord = {
    contract_version: PUBLIC_CONTRACT_VERSION,
    external_object_id: String(report.id), report_id: String(report.id),
    source_published_at: publishedAt, published_at: publishedAt, generated_at: generatedAt,
    report_date: projection.identity.reportDate,
    report_mode: optionalString(document.report_mode) ?? optionalString(report.report_mode),
    market_bias: projection.marketDecision.bias, confidence_score: confidence,
    daily_sentence: sentence, public_summary: sentence,
    expires_at: new Date(Date.parse(publishedAt) + 24 * 60 * 60 * 1000).toISOString(),
    public_topic: publicTopic, facts: references,
    catalysts: marketBrief ? [] : [{ event_source: publicTopic.event_source }], surprises: [],
    taiwan_mapping: { transmission: marketBrief ? null : publicTopic.taiwan_mapping,
      preferred_sectors: !marketBrief && publicTopic.role ? [publicTopic.role] : [], watch_sectors: [] },
    risk: { risk_flags: delivery.marketContent.risk ? [delivery.marketContent.risk] : [] },
    opportunities: marketBrief ? [] : [publicTopic], source_references: references,
    morning_brief: { report_date: projection.identity.reportDate, current_market_summary: sentence,
      core_thesis: sentence, data_quality: generated.data_quality, market_regime: projection.marketDecision.bias },
    core_data_status: generated.data_quality,
    public_delivery_status: "PASS", content_os_status: "PASS", premium_locked: true, evidence_status: "verified",
    premium: { status: "BLOCKED", locked: true, reason_codes: marketBrief
      ? ["NO_VERIFIED_STOCK_OPPORTUNITY"] : ["PUBLIC_SOURCE_CONTRACT"] },
    verification: {
      status: "verified", contract_version: PUBLIC_CONTRACT_VERSION,
      decision_snapshot_id: snapshot.id, editorial_review_id: review.id, review_status: review.review_status,
      content_score: review.content_score, content_grade: snapshot.content_grade,
      reviewed_at: review.reviewed_at, reviewed_by: review.reviewed_by,
      ...(!marketBrief ? { quality_policy_version: policy.policy_version, required_score: policy.premium_publish_min } : {}),
      research_publish_status: researchGate.publish_status, evidence_coverage: researchGate.evidence_coverage,
      published_claim_evidence_coverage: researchGate.evidence_coverage,
      unsupported_published_claims: asArray(asObject(document.quality).unsupported_claims),
      unsupported_claim_count: researchGate.unsupported_claim_count, duplicate_claim_count: researchGate.duplicate_claim_count,
      contradiction_count: researchGate.contradiction_count, missing_section_count: researchGate.missing_section_count,
      semantic_coherence: true, member_content_revision_id: memberRevision.id, public_premium_leakage: leakageGate.eligible,
    },
  };
  payload.topic_fingerprint = await sha256Hex({ report_date: report.report_date, public_topic: publicTopic, primary_thesis: sentence });
  const projectionFingerprint = await sha256Hex(payload);
  const projectedRevision = `${snapshot.snapshot_fingerprint ?? `${snapshot.version}:${review.id}`}:${memberRevision.id}:${SOURCE_PROJECTION_REVISION}:${projectionFingerprint.slice(0, 16)}`;
  payload.external_revision = projectedRevision;
  payload.revision_id = projectedRevision;
  return { payload, reasonCodes: [] };
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

  const now = new Date().toISOString();
  const todayDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(now));
  const reportResult = await admin.from("reports")
    .select("id,report_date,report_mode,created_at,updated_at,ai_strategy_json,important_news_json")
    .eq("report_date", todayDate).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (reportResult.error) return json({ error: "REPORT_READ_FAILED" }, 503);
  if (!reportResult.data) return json({ error: "VERIFIED_DECISION_NOT_FOUND" }, 404);
  const report = asObject(reportResult.data);
  let evidence: Awaited<ReturnType<typeof fetchPublishedDeliveryEvidence>>;
  try {
    evidence = await fetchPublishedDeliveryEvidence(admin, report);
  } catch {
    return json({ error: "PUBLISHED_DECISION_EVIDENCE_READ_FAILED" }, 503);
  }
  const { snapshot, member: memberRevision, publicationRun } = evidence;
  if (!snapshot) return json({ error: "VERIFIED_DECISION_NOT_FOUND" }, 404);
  const policyResult = await admin.from("runtime_quality_policies")
    .select("policy_version,premium_publish_min").eq("active", true)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const qualityPolicy = asObject(policyResult.data);
  const premiumPublishMinimum = qualityPolicy.premium_publish_min;
  const premiumPolicyAvailable = !policyResult.error && typeof premiumPublishMinimum === "number"
    && Number.isFinite(premiumPublishMinimum) && premiumPublishMinimum >= 1 && premiumPublishMinimum <= 100;
  const ai = asObject(report.ai_strategy_json);
  const newsCount = asArray(report.important_news_json).length;
  const premiumGate = evaluatePremiumContentGate(ai, newsCount);
  const marketGate = evaluateMarketReportGate(ai, String(report.report_date));
  // The live Premium policy may suppress stocks, never revoke a committed
  // market publication. The shared authority retains its frozen Editorial proof.
  const delivery = evaluatePublishedMarketDelivery(report, snapshot, memberRevision, marketGate,
    { todayDate, now, premiumEligible: premiumGate.eligible && premiumPolicyAvailable
      && typeof snapshot.content_score === "number" && typeof premiumPublishMinimum === "number"
      && snapshot.content_score >= premiumPublishMinimum, publicationRun });
  if (!delivery.eligible || !memberRevision) {
    return recordBlockingIncident(admin, snapshot, delivery.reason_codes, "PUBLISHED_MARKET_CONTRACT_BLOCKED");
  }

  // These are the existing export's editorial/semantic receipts, not a new
  // assessment of current research or member quality. They must name this exact
  // committed revision; a same-day/newest private QA result is not a substitute.
  const reviewResult = await admin.from("editorial_reviews")
    .select("id,decision_snapshot_id,review_status,content_score,reviewed_at,reviewed_by,reason_codes")
    .eq("decision_snapshot_id", String(snapshot.id)).eq("review_status", "APPROVED")
    .order("reviewed_at", { ascending: false }).limit(1).maybeSingle();
  if (reviewResult.error) return json({ error: "EDITORIAL_REVIEW_READ_FAILED" }, 503);
  const review = asObject(reviewResult.data);
  const reviewScore = review.content_score;
  const publishedAt = optionalString(publicationRun?.completed_at) ?? optionalString(review.reviewed_at);
  const reviewedAt = Date.parse(String(review.reviewed_at || ""));
  if (!reviewResult.data || typeof reviewScore !== "number" || !Number.isFinite(reviewScore)
    || reviewScore !== snapshot.content_score
    || !Number.isFinite(reviewedAt) || reviewedAt > Date.parse(publishedAt || "")
    || !Array.isArray(review.reason_codes) || review.reason_codes.length > 0) {
    return recordBlockingIncident(admin, snapshot, ["EDITORIAL_REVIEW_NOT_APPROVED"], "EDITORIAL_REVIEW_NOT_APPROVED");
  }
  const semantic = asObject(asArray(memberRevision.semantic_coherence_reviews)[0]);
  const semanticCheckedAt = Date.parse(String(semantic.checked_at || ""));
  if (memberRevision.semantic_status !== "PASSED" || !Array.isArray(memberRevision.semantic_reason_codes)
    || memberRevision.semantic_reason_codes.length > 0 || !Number.isFinite(semanticCheckedAt)
    || semanticCheckedAt > Date.parse(publishedAt || "")) {
    return recordBlockingIncident(admin, snapshot, ["SEMANTIC_COHERENCE_BLOCKED"], "SEMANTIC_COHERENCE_BLOCKED",
      { member_content_revision_id: memberRevision.id });
  }

  const result = await buildContentOsPublicPayload(report, snapshot, memberRevision, review, qualityPolicy, publicationRun, delivery);
  if (!result.payload) {
    return recordBlockingIncident(admin, snapshot, result.reasonCodes, result.reasonCodes[0] || "PUBLIC_TOPIC_INCOMPLETE",
      { member_content_revision_id: memberRevision.id });
  }
  // A too-large or incomplete export must never close an existing incident.
  const response = json(result.payload);
  if (response.status !== 200) return response;
  const incidentKey = `content-os:${String(snapshot.report_date)}:${String(snapshot.id)}`;
  const { error: resolveIncidentError } = await admin.rpc("resolve_content_os_incident_v1", {
    p_incident_key: incidentKey,
    p_snapshot_version: Number(snapshot.version),
    p_metadata: { member_content_revision_id: memberRevision.id, source_revision: SOURCE_PROJECTION_REVISION,
      projection_mode: asObject(result.payload.public_topic).kind },
  });
  if (resolveIncidentError) return json({ error: "CONTENT_OS_INCIDENT_RESOLUTION_FAILED" }, 503);
  return response;
});
