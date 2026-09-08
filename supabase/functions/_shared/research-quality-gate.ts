export interface ResearchQualityGateResult {
  available: boolean;
  eligible: boolean;
  publish_status: string;
  evidence_coverage: number | null;
  unsupported_claim_count: number | null;
  duplicate_claim_count: number | null;
  contradiction_count: number | null;
  missing_section_count: number | null;
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

function claimCount(value: unknown): number | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim())
    ? value.length : null;
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
  const rawCoverage = quality.evidence_coverage;
  const coverageValue = typeof rawCoverage === 'number' || (typeof rawCoverage === 'string' && rawCoverage.trim())
    ? Number(rawCoverage) : NaN;
  const evidenceCoverage = Number.isFinite(coverageValue) && coverageValue >= 0 && coverageValue <= 100
    ? coverageValue
    : null;
  const unsupportedClaims = claimCount(quality.unsupported_claims);
  const duplicateClaims = claimCount(quality.duplicate_claims);
  const contradictions = claimCount(quality.contradictions);
  const missingSections = claimCount(quality.missing_sections);
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
  if ([unsupportedClaims, duplicateClaims, contradictions, missingSections].some((count) => count === null)) {
    reasonCodes.push('research_quality_counters_missing_or_invalid');
  }
  if (unsupportedClaims !== null && unsupportedClaims > 0) {
    reasonCodes.push("research_unsupported_claims_present");
  }
  if (duplicateClaims !== null && duplicateClaims > 0) {
    reasonCodes.push("research_duplicate_claims_present");
  }
  if (contradictions !== null && contradictions > 0) {
    reasonCodes.push("research_contradictions_present");
  }
  if (missingSections !== null && missingSections > 0) {
    reasonCodes.push("research_sections_missing");
  }

  return {
    available,
    eligible: reasonCodes.length === 0,
    publish_status: publishStatus,
    evidence_coverage: evidenceCoverage,
    unsupported_claim_count: unsupportedClaims,
    duplicate_claim_count: duplicateClaims,
    contradiction_count: contradictions,
    missing_section_count: missingSections,
    // Historical conditional rows are not silently erased or upgraded to 100%.
    // The assembler now classifies future criteria in failure_scenario instead.
    ignored_conditional_claim_count: 0,
    required_score: requiredScore,
    reason_codes: reasonCodes,
  };
}
