/** News collection is optional enrichment, not an Atomic dependency.
 * The existing refresh checkpoint/lease owns scheduling; no new Cron or write path.
 */
export function shouldAcquirePremarketNews(input: {
  phase: string;
  taipeiMinutes: number;
  hasReport: boolean;
  forceRegenerate: boolean;
  actions: readonly string[];
}): boolean {
  return input.phase === 'refresh' && input.taipeiMinutes >= 7 * 60 && input.taipeiMinutes < 7 * 60 + 5
    && !input.hasReport && !input.forceRegenerate
    && !input.actions.includes('refresh_news') && !input.actions.includes('deliver_incident');
}

export const NEWS_ACQUISITION_BUDGET = { timeoutMs: 60_000, maxAttempts: 2 } as const;

export interface NewsAcquisitionResult {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
  attempts?: number;
}

/** Persist counters only; never echo provider logs, URLs with credentials or bodies. */
export function newsAcquisitionObservation(result: NewsAcquisitionResult): Record<string, unknown> {
  const p = result.payload;
  const count = (key: string): number | null => typeof p[key] === 'number'
    && Number.isSafeInteger(p[key]) && Number(p[key]) >= 0 ? Number(p[key]) : null;
  const raw = count('total_raw');
  const canonical = count('canonical_upserted_count');
  const classification = !result.ok
    ? p.canonical_complete === false ? 'INTEGRATION_FAILED' : 'FETCH_FAILED'
    : raw === 0 ? 'SOURCE_EMPTY'
    : canonical === 0 ? 'FILTER_REJECTION_BREAKDOWN_NOT_RETAINED'
    : 'CAPTURED_PENDING_REPORT_QUALITY';
  return {
    schema_version: 'MARKET_NEWS_ACQUISITION_V1',
    status: result.status, success: result.ok, attempts: result.attempts ?? 1,
    classification, total_raw: raw, after_dedup: count('after_dedup'),
    invalid_published_at_count: count('invalid_published_at_count'),
    blacklisted: count('blacklisted'), selected_count: count('selected_count'),
    canonical_upserted_count: canonical, canonical_complete: p.canonical_complete === true,
    // Captured does not mean the independent Report relevance/quality gate passed.
    report_accepted: null, business_dependency: false,
  };
}

export async function collectOptionalPremarketNews(
  invoke: () => Promise<NewsAcquisitionResult>,
): Promise<Record<string, unknown>> {
  try { return newsAcquisitionObservation(await invoke()); }
  catch {
    return newsAcquisitionObservation({ ok: false, status: 599, payload: {} });
  }
}
