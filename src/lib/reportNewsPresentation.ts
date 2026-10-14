/** Read-only display of the existing server-trimmed report receipt.
 * Publication date is not acquisition date or a new browser-side freshness gate.
 * This does not select news, relax quality, or turn a stale report into today's.
 */
export function reportNewsPresentation(payload: unknown, currentReport: boolean, generatedAt: string | null) {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(data.important_news) ? data.important_news : [];
  const reported = data.fresh_news_count;
  // Public projection intentionally includes only three news summaries, while
  // fresh_news_count is the server's full adopted count. Do not mistake trimming
  // for missing news, or infer unseen original timestamps from visible summaries.
  const countConsistent = reported === undefined ||
    (typeof reported === 'number' && Number.isInteger(reported) && reported >= rows.length);
  const cutoff = Date.parse(generatedAt || '');
  const stamps = rows.map((row: unknown) => {
    if (!row || typeof row !== 'object') return NaN;
    const value = (row as Record<string, unknown>).published_at;
    return typeof value === 'string' ? Date.parse(value) : NaN;
  });
  const verified = currentReport && rows.length > 0 && countConsistent && Number.isFinite(cutoff)
    && stamps.every(at => Number.isFinite(at) && at <= cutoff);
  return { accepted: verified, count: verified ? (reported === undefined ? rows.length : reported as number) : null };
}
