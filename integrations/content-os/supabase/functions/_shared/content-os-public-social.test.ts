import { buildPublicSocialPackage } from "./content-os-public-social.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contract_version: "morning_alpha_public_contract_v1",
    report_id: "report-2026-08-28",
    report_date: "2026-08-28",
    revision_id: "revision-2026-08-28-v1",
    topic_fingerprint: "public-story-2026-08-28",
    core_data_status: "PASS",
    public_delivery_status: "PASS",
    evidence_status: "verified",
    premium_locked: true,
    premium: { locked: true, protected_value: "MUST_NOT_LEAK" },
    verification: { status: "verified" },
    public_topic: {
      kind: "market_brief",
      title: "盤前主軸",
      reason: "美股收盤資料顯示電子權值仍需等待開盤確認。",
      summary: "先確認大盤與代表股是否同步。",
    },
    public_summary: "盤前維持觀察，等待市場方向確認。",
    daily_sentence: "開盤後先看大盤與代表股是否同步。",
    morning_brief: {
      current_market_summary: "目前盤前資料完整，尚未進入開盤驗證。",
    },
    source_references: [
      { url: "https://example.com/a" },
      { url: "https://example.com/b" },
      { url: "https://example.com/a" },
    ],
    ...overrides,
  };
}

Deno.test("builds deterministic public script and three social variants", () => {
  const first = buildPublicSocialPackage(fixture(), {
    externalObjectId: "external-report",
    externalRevision: "external-revision",
  });
  const second = buildPublicSocialPackage(fixture(), {
    externalObjectId: "external-report",
    externalRevision: "external-revision",
  });
  assert(
    JSON.stringify(first) === JSON.stringify(second),
    "package must be deterministic",
  );
  assert(
    first.platforms.map((item) => item.platform).join(",") ===
      "threads,instagram,facebook",
    "platform contract mismatch",
  );
  assert(
    first.platforms[0].caption.length <= 500,
    "Threads caption exceeds 500 characters",
  );
  assert(
    JSON.stringify(first).includes("MUST_NOT_LEAK") === false,
    "premium-only field leaked",
  );
});

Deno.test("keeps only unique public source URLs in source order", () => {
  const result = buildPublicSocialPackage(fixture(), {
    externalObjectId: "external-report",
    externalRevision: "external-revision",
  });
  const refs = result.selectionPublicPayload.sourceReferences;
  assert(
    JSON.stringify(refs) ===
      JSON.stringify(["https://example.com/a", "https://example.com/b"]),
    "source reference normalization failed",
  );
});

Deno.test("rejects unlocked premium projection", () => {
  let failed = false;
  try {
    buildPublicSocialPackage(fixture({ premium_locked: false }), {
      externalObjectId: "external-report",
      externalRevision: "external-revision",
    });
  } catch (error) {
    failed = error instanceof Error &&
      error.message === "PUBLIC_PREMIUM_LOCK_REQUIRED";
  }
  assert(failed, "unlocked source must fail closed");
});

Deno.test("rejects unverified public source", () => {
  let failed = false;
  try {
    buildPublicSocialPackage(fixture({ evidence_status: "pending" }), {
      externalObjectId: "external-report",
      externalRevision: "external-revision",
    });
  } catch (error) {
    failed = error instanceof Error &&
      error.message === "VERIFIED_PUBLIC_SOURCE_REQUIRED";
  }
  assert(failed, "unverified source must fail closed");
});

Deno.test("rejects source without evidence references", () => {
  let failed = false;
  try {
    buildPublicSocialPackage(fixture({ source_references: [] }), {
      externalObjectId: "external-report",
      externalRevision: "external-revision",
    });
  } catch (error) {
    failed = error instanceof Error &&
      error.message === "PUBLIC_SOURCE_REFERENCES_REQUIRED";
  }
  assert(failed, "missing evidence must fail closed");
});
