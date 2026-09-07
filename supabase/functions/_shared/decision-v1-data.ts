/** Read-side only. Column lists are the 2026-09-07 Production catalog contract.
 * No provider calls, RPC, writes, credentials, or AI scores. Pagination overflow is
 * insufficient evidence, never an apparently complete stock screen. */
export type Row = Record<string, unknown>;
export type DecisionIdentity = {
  report_date: string; revision_id: string; generated_at: string; data_as_of: string;
  is_trading_day: boolean; today_date: string;
};
export type Dataset = 'quotes' | 'news' | 'flows' | 'earnings' | 'universe' | 'mappings' | 'catalysts' | 'evaluations';
export type EvidenceData = Record<Dataset, Row[]> & { failures: string[] };
export const emptyEvidenceData = (): EvidenceData => ({ quotes: [], news: [], flows: [], earnings: [], universe: [], mappings: [], catalysts: [], evaluations: [], failures: [] });
export const DATA_QUERIES = {
  quotes: { table: 'market_quotes', columns: 'id,provider,symbol,asset_type,market,trading_date,phase,value,change_percent,captured_at,freshness_status,quality_status,raw_payload,ingested_at', time: 'captured_at', available: 'ingested_at', days: 65, cap: 6000 },
  news: { table: 'news_events', columns: 'id,title,summary,source_name,source_url,published_at,event_type,symbols,sectors,created_at', time: 'published_at', available: 'created_at', days: 4, cap: 500 },
  flows: { table: 'institutional_flows', columns: 'id,provider,market,trading_date,institution_type,symbol,buy_amount,sell_amount,net_amount,currency,captured_at,source_ref,created_at', time: 'captured_at', available: 'created_at', days: 10, cap: 1000 },
  earnings: { table: 'earnings_events', columns: 'id,provider,symbol,fiscal_period,announced_at,revenue_actual,revenue_consensus,eps_actual,eps_consensus,guidance_direction,source_ref,created_at', time: 'announced_at', available: 'created_at', days: 550, cap: 1000 },
  universe: { table: 'sector_stock_map', columns: 'id,symbol,stock_name,sector,is_active,created_at,updated_at', time: 'updated_at', available: 'created_at', days: null, cap: 1000 },
  mappings: { table: 'catalyst_tw_mappings', columns: 'id,catalyst_id,stock_symbol,company_name,sector,transmission_path,taiwan_supply_chain_relation,confirmation_condition,invalidation_condition,source_refs,created_at', time: 'created_at', available: 'created_at', days: 7, cap: 500 },
  catalysts: { table: 'research_catalysts', columns: 'id,title,summary,event_at,source_refs,status,created_at', time: 'event_at', available: 'created_at', days: 7, cap: 500 },
  evaluations: { table: 'model_evaluations', columns: 'id,model_version,evaluation_version,period_start,period_end,sample_size,brier_score,calibration_gap,evaluated_at', time: 'evaluated_at', available: 'created_at', days: 365, cap: 500 },
} as const;
// model_evaluations has no created_at: evaluated_at is its actual availability time.
export type EvidenceRead = (request: { table: string; columns: string; filters: { column: string; operator: 'lte' | 'gte'; value: string }[]; order: string; limit: number }) => Promise<{ data: unknown; error: unknown }>;
export async function loadDecisionEvidence(read: EvidenceRead, identity: DecisionIdentity): Promise<EvidenceData> {
  const output = emptyEvidenceData();
  if (identity.today_date !== identity.report_date || !identity.is_trading_day) return output;
  const asOf = Date.parse(identity.generated_at);
  if (!Number.isFinite(asOf) || !identity.revision_id) { output.failures.push('INVALID_REPORT_IDENTITY'); return output; }
  await Promise.all((Object.keys(DATA_QUERIES) as Dataset[]).map(async key => {
    const q = DATA_QUERIES[key];
    const available = key === 'evaluations' ? 'evaluated_at' : q.available;
    const filters: Parameters<EvidenceRead>[0]['filters'] = [
      { column: q.time, operator: 'lte', value: identity.generated_at },
      { column: available, operator: 'lte', value: identity.generated_at },
    ];
    if (q.days !== null) filters.push({ column: q.time, operator: 'gte', value: new Date(asOf - q.days * 86400000).toISOString() });
    try {
      const result = await read({ table: q.table, columns: q.columns, filters, order: q.time, limit: q.cap + 1 });
      if (result.error || !Array.isArray(result.data)) { output.failures.push(`${key}:QUERY_FAILED`); return; }
      if (result.data.length > q.cap) { output.failures.push(`${key}:TRUNCATED`); return; }
      output[key] = result.data.filter((r): r is Row => Boolean(r) && typeof r === 'object' && !Array.isArray(r));
    } catch { output.failures.push(`${key}:QUERY_FAILED`); }
  }));
  output.failures.sort();
  return output;
}
