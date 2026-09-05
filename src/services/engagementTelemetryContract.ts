/**
 * BEST_EFFORT_TELEMETRY, not a report, entitlement, billing or delivery dependency.
 * Production currently has anon-only INSERT and no ownership column / safe RPC.
 * Do not downgrade an authenticated request to anon to evade that policy.
 * Persistence stays OFF until a separately reviewed server write contract exists.
 */
export const ENGAGEMENT_TELEMETRY_CONTRACT = Object.freeze({
  mode: 'BEST_EFFORT_TELEMETRY',
  persistence: 'DISABLED_NO_SAFE_WRITE_CONTRACT',
  retries: 0,
} as const);

export const ENGAGEMENT_EVENTS = [
  'view_home', 'view_report_today', 'click_free_summary', 'click_member_preview',
  'click_early_access', 'submit_early_access', 'click_reels_preview',
  'click_line_interest', 'view_close_review',
] as const;
export type EngagementEventName = typeof ENGAGEMENT_EVENTS[number];
export type EngagementOptions = {
  page_path?: string;
  report_date?: string;
  content_type?: string;
  metadata?: Record<string, unknown>;
};
export type EngagementOutcome = {
  contract: 'BEST_EFFORT_TELEMETRY';
  status: 'skipped' | 'rejected';
  reason: 'NO_SAFE_WRITE_CONTRACT' | 'INVALID_EVENT_PAYLOAD';
  persisted: false;
};

const forbiddenIdentity = /^(user_?id|admin|owner|role|tier|entitlement|premium|user_metadata|app_metadata)$/i;

/** Reject identity claims, arbitrary JSON, query credentials and oversized input. */
export function evaluateEngagementEvent(event: unknown, options: unknown = {}): EngagementOutcome {
  const rejected: EngagementOutcome = {
    contract: 'BEST_EFFORT_TELEMETRY', status: 'rejected',
    reason: 'INVALID_EVENT_PAYLOAD', persisted: false,
  };
  if (typeof event !== 'string' || !ENGAGEMENT_EVENTS.includes(event as EngagementEventName)) return rejected;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return rejected;
  const input = options as Record<string, unknown>;
  if (Object.keys(input).some(key => !['page_path', 'report_date', 'content_type', 'metadata'].includes(key))) return rejected;
  if (input.page_path !== undefined && (typeof input.page_path !== 'string'
    || !/^\/(?!\/)[^?#\\\s]{0,199}$/.test(input.page_path))) return rejected;
  if (input.report_date !== undefined && (typeof input.report_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.report_date)
    || !Number.isFinite(Date.parse(input.report_date))
    || new Date(input.report_date).toISOString().slice(0, 10) !== input.report_date)) return rejected;
  if (input.content_type !== undefined && (typeof input.content_type !== 'string'
    || !/^[a-z_]{1,40}$/.test(input.content_type))) return rejected;
  if (input.metadata !== undefined) {
    if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) return rejected;
    const entries = Object.entries(input.metadata);
    if (entries.length > 8 || entries.some(([key, value]) => forbiddenIdentity.test(key)
      || !/^[a-z_]{1,32}$/.test(key)
      || !['string', 'number', 'boolean'].includes(typeof value)
      || (typeof value === 'string' && value.length > 120)
      || (typeof value === 'number' && !Number.isFinite(value)))) return rejected;
  }
  return { contract: 'BEST_EFFORT_TELEMETRY', status: 'skipped', reason: 'NO_SAFE_WRITE_CONTRACT', persisted: false };
}
