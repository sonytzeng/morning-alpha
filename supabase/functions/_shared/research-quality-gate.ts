export interface ResearchQualityGateResult {
  available: boolean;
  eligible: boolean;
  publish_status: string;
  evidence_coverage: number | null;
  unsupported_claim_count: number;
  duplicate_claim_count: number;
  contradiction_count: number;
  missing_section_count: number;
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
  const unsupportedClaims = asArray(quality.unsupported_claims);
  const duplicateClaims = asArray(quality.duplicate_claims);
  const contradictions = asArray(quality.contradictions);
  const missingSections = asArray(quality.missing_sections);
  const publishableStatuses = new Set([
    "ready",
    "approved",
    "published",
    "publishable",
  ]);
  const reasonCodes: string[] = [];

  if (!available) reasonCodes.push("research_master_missing");
  if (!publishableStatuses.has(publishStatus)) {
    reasonCodes.push("research_publish_status_not_ready");
  }
  if (evidenceCoverage === null || evidenceCoverage < 100) {
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
    publish_status: publishStatus,
    evidence_coverage: evidenceCoverage,
    unsupported_claim_count: unsupportedClaims.length,
    duplicate_claim_count: duplicateClaims.length,
    contradiction_count: contradictions.length,
    missing_section_count: missingSections.length,
    required_score: requiredScore,
    reason_codes: reasonCodes,
  };
}
