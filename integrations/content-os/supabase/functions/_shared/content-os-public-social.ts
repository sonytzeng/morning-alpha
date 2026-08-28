import {
  asObject,
  type JsonRecord,
  RuntimeError,
  textValue,
} from "./content-os-contract-core.ts";

export const PUBLIC_SOCIAL_ENGINE_VERSION = "morning_alpha_public_social_v1";
export const PUBLIC_SOCIAL_PLATFORMS = [
  "threads",
  "instagram",
  "facebook",
] as const;

export type PublicSocialPlatform = typeof PUBLIC_SOCIAL_PLATFORMS[number];

export type PublicSocialContent = {
  platform: PublicSocialPlatform;
  title: string;
  caption: string;
  hashtags: string[];
};

export type PublicSocialPackage = {
  reportId: string;
  reportDate: string;
  revisionId: string;
  publicStoryId: string;
  selectionPublicPayload: JsonRecord;
  script: { title: string; text: string };
  platforms: PublicSocialContent[];
};

function compactText(value: unknown, maxLength: number): string | null {
  const text = textValue(value)?.replace(/\s+/gu, " ").trim() ?? null;
  if (!text) return null;
  return text.length <= maxLength ? text : text.slice(0, maxLength).trimEnd();
}

function firstText(maxLength: number, ...values: unknown[]): string {
  for (const value of values) {
    const text = compactText(value, maxLength);
    if (text) return text;
  }
  throw new RuntimeError("PUBLIC_SOURCE_TEXT_REQUIRED", 409);
}

function sourceUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.map((entry) => textValue(asObject(entry).url)).filter((
        url,
      ): url is string => Boolean(url)),
    ),
  ];
}

function assertReportDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new RuntimeError("PUBLIC_REPORT_DATE_INVALID", 409);
  }
}

function cappedCaption(parts: string[], maxLength: number): string {
  const value = parts.filter(Boolean).join("\n\n");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function buildPublicSocialPackage(
  payloadValue: unknown,
  snapshotIdentity: { externalObjectId: string; externalRevision: string },
): PublicSocialPackage {
  const payload = asObject(payloadValue);
  const publicTopic = asObject(payload.public_topic);
  const morningBrief = asObject(payload.morning_brief);
  const verification = asObject(payload.verification);

  const reportId = firstText(
    240,
    payload.report_id,
    snapshotIdentity.externalObjectId,
  );
  const reportDate = firstText(10, payload.report_date);
  const revisionId = firstText(
    300,
    payload.revision_id,
    snapshotIdentity.externalRevision,
  );
  assertReportDate(reportDate);

  if (
    payload.premium_locked !== true || asObject(payload.premium).locked !== true
  ) {
    throw new RuntimeError("PUBLIC_PREMIUM_LOCK_REQUIRED", 409);
  }
  if (
    textValue(payload.contract_version) !==
      "morning_alpha_public_contract_v1" ||
    textValue(payload.core_data_status) !== "PASS" ||
    textValue(payload.public_delivery_status) !== "PASS" ||
    textValue(payload.evidence_status) !== "verified" ||
    textValue(verification.status) !== "verified"
  ) {
    throw new RuntimeError("VERIFIED_PUBLIC_SOURCE_REQUIRED", 409);
  }

  const publicStoryId = firstText(240, payload.topic_fingerprint);
  const title = firstText(
    240,
    publicTopic.title,
    publicTopic.name,
    payload.daily_sentence,
  );
  const whatHappened = firstText(
    2_500,
    publicTopic.reason,
    publicTopic.summary,
    payload.public_summary,
  );
  const whyImportant = firstText(
    2_500,
    payload.public_summary,
    publicTopic.summary,
  );
  const marketReaction = firstText(
    2_500,
    morningBrief.current_market_summary,
    payload.public_summary,
  );
  const taiwanImpact = firstText(
    2_500,
    payload.daily_sentence,
    publicTopic.title,
  );
  const category = firstText(120, publicTopic.kind);
  const sourceReferences = sourceUrls(payload.source_references);
  if (sourceReferences.length === 0) {
    throw new RuntimeError("PUBLIC_SOURCE_REFERENCES_REQUIRED", 409);
  }

  const selectionPublicPayload: JsonRecord = {
    reportId,
    date: reportDate,
    heroStory: {
      id: publicStoryId,
      title,
      whatHappened,
      whyImportant,
      marketReaction,
      taiwanImpact,
      category,
      sourceReferences,
    },
    publicContext: whyImportant,
    publicExplanation: whatHappened,
    socialHook: firstText(400, payload.daily_sentence, title),
    ctaContext: firstText(600, publicTopic.summary, payload.public_summary),
    premiumTeaserCount: 0,
    sourceReferences,
  };

  const scriptTitle = `Morning Alpha｜${reportDate} 台股盤前重點`;
  const scriptText = [title, whyImportant, marketReaction].filter((
    value,
    index,
    values,
  ) => values.indexOf(value) === index).join("\n\n");
  const threads = cappedCaption([
    `【${reportDate} Morning Alpha】`,
    title,
    whyImportant,
  ], 500);
  const instagram = cappedCaption([
    `【${reportDate} 台股盤前重點】`,
    title,
    whyImportant,
    marketReaction,
  ], 2_200);
  const facebook = cappedCaption([
    `Morning Alpha｜${reportDate}`,
    title,
    whyImportant,
    marketReaction,
  ], 5_000);

  return {
    reportId,
    reportDate,
    revisionId,
    publicStoryId,
    selectionPublicPayload,
    script: { title: scriptTitle, text: scriptText },
    platforms: [
      {
        platform: "threads",
        title: scriptTitle,
        caption: threads,
        hashtags: ["台股", "MorningAlpha"],
      },
      {
        platform: "instagram",
        title: scriptTitle,
        caption: instagram,
        hashtags: ["台股", "投資決策", "MorningAlpha"],
      },
      {
        platform: "facebook",
        title: scriptTitle,
        caption: facebook,
        hashtags: ["台股", "MorningAlpha"],
      },
    ],
  };
}
