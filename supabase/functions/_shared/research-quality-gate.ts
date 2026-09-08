export interface ResearchQualityGateResult {
  available: boolean;
  eligible: boolean;
  publish_status: string;
  evidence_coverage: number | null;
  unsupported_claim_count: number;
  duplicate_claim_count: number;
  contradiction_count: number;
  missing_section_count: number;
  ignored_conditional_claim_count: number;
  required_score: number;
  reason_codes: string[];
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecords(value: unknown): JsonRecord[] {
  return asArray(value).filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonRecord[];
}

function normalizedCondition(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[\s，。；;、:：!?！？]/g, "")
    : "";
}

function conditionalCounterEvidenceClaimIds(researchMaster: JsonRecord): Set<string> {
  const sections = asRecord(researchMaster.sections);
  const failureScenario = asRecord(sections.failure_scenario);
  const failureConditions = new Set(
    asRecords(failureScenario.triggers)
      .map((trigger) => normalizedCondition(trigger.condition))
      .filter(Boolean),
  );
  const claimIds = asRecords(sections.counter_evidence)
    .filter((item) => asArray(item.evidence_refs).length === 0)
    .filter((item) => failureConditions.has(normalizedCondition(item.statement)))
    .map((item) => typeof item.claim_id === "string" ? item.claim_id.trim() : "")
    .filter(Boolean);
  return new Set(claimIds);
}

function unsupportedClaimId(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return typeof record.claim_id === "string" ? record.claim_id : "";
}

function normalizedMinimum(value: number): number {
  return Number.isFinite(value) && value >= 1 && value <= 100 ? value : 90;
}

export function evaluateResearchQualityGate(
  researchMasterValue: unknown,
  minimumScore = 90,
): ResearchQualityGateResult {
  const requiredScore = Math.max(100, normalizedMinimum(minimumScore));
  const researchMaster = asRecord(researchMasterValue);
  const available = Object.keys(researchMaster).length > 0;
  const quality = asRecord(researchMaster.quality);
  const publishStatus = typeof quality.publish_status === "string"
    ? quality.publish_status.trim().toLowerCase()
    : "missing";
  const coverageValue = Number(quality.evidence_coverage);
  const evidenceCoverage = Number.isFinite(coverageValue)
    ? coverageValue
    : null;
  const rawUnsupportedClaims = asArray(quality.unsupported_claims);
  const duplicateClaims = asArray(quality.duplicate_claims);
  const contradictions = asArray(quality.contradictions);
  const missingSections = asArray(quality.missing_sections);
  const conditionalClaimIds = conditionalCounterEvidenceClaimIds(researchMaster);
  const unsupportedClaims = rawUnsupportedClaims.filter((claim) => {
    const value = unsupportedClaimId(claim);
    return !Array.from(conditionalClaimIds).some((claimId) => value.includes(claimId));
  });
  const ignoredConditionalClaimCount = rawUnsupportedClaims.length - unsupportedClaims.length;
  const legacyConditionalFalseNegative = publishStatus === "degraded"
    && evidenceCoverage !== null
    && evidenceCoverage >= 95
    && ignoredConditionalClaimCount > 0
    && unsupportedClaims.length === 0
    && duplicateClaims.length === 0
    && contradictions.length === 0
    && missingSections.length === 0;
  const effectivePublishStatus = legacyConditionalFalseNegative ? "ready" : publishStatus;
  const effectiveEvidenceCoverage = legacyConditionalFalseNegative ? 100 : evidenceCoverage;
  const publishableStatuses = new Set([
    "ready",
    "approved",
    "published",
    "publishable",
  ]);
  const reasonCodes: string[] = [];

  if (!available) reasonCodes.push("research_master_missing");
  if (!publishableStatuses.has(effectivePublishStatus)) {
    reasonCodes.push("research_publish_status_not_ready");
  }
  if (effectiveEvidenceCoverage === null || effectiveEvidenceCoverage < 100) {
    reasonCodes.push("research_evidence_coverage_below_100");
  }
  if (unsupportedClaims.length > 0) {
    reasonCodes.push("research_unsupported_claims_present");
  }
  if (duplicateClaims.length > 0) {
    reasonCodes.push("research_duplicate_claims_present");
  }
  if (contradictions.length > 0) {
    reasonCodes.push("research_contradictions_present");
  }
  if (missingSections.length > 0) {
    reasonCodes.push("research_sections_missing");
  }

  return {
    available,
    eligible: reasonCodes.length === 0,
    publish_status: effectivePublishStatus,
    evidence_coverage: effectiveEvidenceCoverage,
    unsupported_claim_count: unsupportedClaims.length,
    duplicate_claim_count: duplicateClaims.length,
    contradiction_count: contradictions.length,
    missing_section_count: missingSections.length,
    ignored_conditional_claim_count: ignoredConditionalClaimCount,
    required_score: requiredScore,
    reason_codes: reasonCodes,
  };
}
