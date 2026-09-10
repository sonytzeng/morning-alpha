// Deterministic external-provider wire responses only. No business result or clock replacement.
export function resolveConsolidationVendorResponse(request, fixture, observedAt) {
  if (fixture.schema_version !== 'CORE_CONSOLIDATION_PROVIDER_BOUNDARY_V1'
    || fixture.provenance.kind !== 'SYNTHETIC_PROVIDER_CONTROL'
    || fixture.provenance.historical_capture !== false) throw new Error('Explicit synthetic provider fixture required');
  const now = Date.parse(observedAt);
  if (!Number.isFinite(now)) throw new Error('Actual runtime timestamp required');
  const phase = fixture.phases.find(row => now >= Date.parse(row.starts_at) && now < Date.parse(row.ends_at));
  if (!phase) throw new Error('No synthetic provider batch for actual runtime time');
  const url = new URL(request.url), method = request.method || 'GET';
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid original vendor URL');
  const reply = (provider, operation, body, status = 200) => ({ provider, operation, body, status,
    fixture_id: fixture.fixture_id, phase: phase.id, source_kind: 'SYNTHETIC_PROVIDER_CONTROL', historical_capture: false });
  const news = (phase.news ?? fixture.news).map((row, index) => ({ ...row, id: index + 1,
    published_at: phase.news_source_at }));
  if (url.hostname === 'finnhub.io' && url.pathname === '/api/v1/news' && method === 'GET') {
    return reply('finnhub', 'news', news.map(row => ({ id: row.id, datetime: Date.parse(row.published_at) / 1000,
      headline: row.title, summary: row.summary, url: row.url, source: 'Synthetic market provider', category: 'general' })));
  }
  if ((url.hostname === 'gnews.io' && url.pathname === '/api/v4/search'
    || url.hostname === 'newsapi.org' && url.pathname === '/v2/everything') && method === 'GET') {
    return reply(url.hostname === 'gnews.io' ? 'gnews' : 'newsapi', 'news', { articles: news.map(row => ({
      url: row.url, title: row.title, description: row.summary, publishedAt: row.published_at,
      source: { name: 'Synthetic market provider' },
    })) });
  }
  if (url.hostname === 'api.openai.com' && url.pathname === '/v1/chat/completions' && method === 'POST') {
    if (!request.body || !Array.isArray(request.body.messages)) throw new Error('Expected real Chat Completions request');
    if (request.body.messages.some(row => String(row.content).includes('candidate_evaluations'))) throw new Error('Unrecorded debug-agent completion');
    return reply('openai', 'chat-completions', fixture.openai_completion);
  }
  if (url.hostname === 'api.line.me' && ['/v2/bot/message/push', '/v2/bot/message/multicast'].includes(url.pathname) && method === 'POST') {
    const recipients = Array.isArray(request.body?.to) ? request.body.to : [request.body?.to];
    if (!recipients.length || !recipients.every(value => /^U[0-9a-f]{32}$/.test(value)) || !Array.isArray(request.body.messages)) {
      throw new Error('Malformed local-only LINE request');
    }
    return reply('line', 'local-receiver', {});
  }
  if (url.hostname === 'api.fugle.tw' && url.pathname === '/marketdata/v1.0/futopt/intraday/tickers' && method === 'GET') {
    return reply('fugle', 'futures-tickers', { data: phase.missing_txf ? [] : fixture.futures });
  }
  if (url.hostname === 'mis.twse.com.tw' && url.pathname === '/stock/api/getStockInfo.jsp' && method === 'GET') {
    return reply('twse', 'stock-info', { msgArray: [] }); // Explicit unavailable fallback, not fabricated TWSE evidence.
  }
  let symbol;
  if (url.hostname === 'finnhub.io' && url.pathname === '/api/v1/quote' && method === 'GET') symbol = url.searchParams.get('symbol');
  else if (url.hostname === 'api.fugle.tw' && /^\/marketdata\/v1\.0\/(?:stock|futopt)\/intraday\/quote\/[^/]+$/.test(url.pathname) && method === 'GET') symbol = url.pathname.split('/').at(-1);
  else throw new Error('Unrecorded vendor endpoint blocked: ' + url.hostname + url.pathname);
  const quote = fixture.quotes[symbol];
  if (!quote || phase.missing_txf && symbol.startsWith('TXF')) return reply(url.hostname === 'finnhub.io' ? 'finnhub' : 'fugle', 'quote', {}, 404);
  const sourceTime = phase.source_times[quote.market];
  if (!sourceTime || Date.parse(sourceTime) > now) throw new Error('Synthetic source timestamp missing/future');
  const value = quote.value + (phase.price_delta || 0), change = phase.missing_change ? null : quote.change;
  const percent = phase.missing_change ? null : quote.change_percent;
  if (url.hostname === 'finnhub.io') return reply('finnhub', 'quote', {
    c: value, d: change, dp: percent, h: value + 1, l: value - 1, o: value - quote.change,
    pc: value - quote.change, t: Date.parse(sourceTime) / 1000,
  });
  return reply('fugle', 'quote', { price: value, change, changePercent: percent, lastUpdated: sourceTime });
}
