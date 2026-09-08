/** Deterministic, point-in-time evidence read model. Never a publication/selection
 * engine override. Thresholds are prospective policy, NOT calibrated probability.
 * LLM tags, confidence_score and narrative sentences are not numerical inputs. */
import type { Decision, Evidence, Score, Opportunity, Action } from '../../../src/features/decision-v1/contract.ts';
import type { DecisionIdentity, EvidenceData, Row } from './decision-v1-data.ts';

const VERSION = 'ma-decision-v1.0' as const;
const DAY = 86400000;
const obj = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
export const finite = (v: unknown): number | null => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : null;
const time = (v: unknown) => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
const sym = (v: unknown) => str(v).toUpperCase().replace(/^(TWSE:|TPEX:)/, '').replace(/\.(TW|TWO)$/, '');
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
const day = (v: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(v));
const url = (v: unknown) => { try { const u = new URL(str(v)); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
const score = (value: number, inputs: Record<string, number>, refs: string[], calculation: string): Score => ({ value: Math.round(clamp(value) * 1000) / 10, inputs, evidence_ids: [...new Set(refs)].sort(), calculation, meaning: 'quality_index', score_version: VERSION });
type Factor = NonNullable<Decision['factor_availability']>[string];
const missing = (why: string): Factor => ({ status: 'UNAVAILABLE', value: null, evidence_ids: [], calculation: why });
const factor = (value: number, evidence_ids: string[], calculation: string): Factor => ({ status: 'AVAILABLE', value: clamp(value), evidence_ids, calculation });
type Quote = { row: Row; symbol: string; price: number; change: number; volume: number | null; at: number; id: string };
const refs = (rows: Quote[]) => rows.map(q => q.id);
function referenceValues(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(referenceValues);
  const r = obj(v); return ['id', 'source_ref', 'source_url', 'url', 'news_event_id'].flatMap(k => typeof r[k] === 'string' ? [String(r[k])] : []);
}
export function unavailableDecision(identity: DecisionIdentity, issue = 'INSUFFICIENT_EVIDENCE'): Decision {
  return { schema_version: 'decision-evidence-v1', calibration_status: 'INSUFFICIENT_HISTORY', ...identity,
    market_direction: null, market_regime: null, direction_probability: null, direction_evidence_score: null,
    model_confidence: null, entry_environment_score: null, market_risk_score: null, action: 'INSUFFICIENT_DATA',
    reason_summary: '目前證據尚未齊全，不能把資料缺口解讀為沒有合格機會。', evidence: [], confidence_evidence: [],
    primary_catalysts: [], sector_impacts: [], stock_opportunities: [], rejected_opportunity_count: 0,
    data_freshness: 'unavailable', evidence_quality: 'insufficient', issues: [issue], factor_availability: {},
    screening: { status: 'INCOMPLETE', universe_count: 0, evaluated_count: 0, rejected: [] }, catalysts: [],
  };
}

export function buildEvidenceDecision(data: EvidenceData, identity: DecisionIdentity): Decision {
  const out = unavailableDecision(identity); out.issues = [...data.failures, 'CALIBRATION_INSUFFICIENT_HISTORY'];
  const asOf = time(identity.generated_at), dataAt = time(identity.data_as_of);
  if (!identity.revision_id || !Number.isFinite(asOf) || !Number.isFinite(dataAt) || dataAt > asOf
    || day(asOf) !== identity.report_date || identity.today_date !== identity.report_date) {
    out.issues.push('MISSING_OR_STALE_IDENTITY'); return out;
  }
  if (!identity.is_trading_day) return { ...out, action: 'NOT_APPLICABLE', reason_summary: '今日非交易日，不建立新的交易機會。' };
  const evidence = new Map<string, Evidence>();
  const add = (table: string, row: Row, source: string, observed: string, available: string, kind: Evidence['kind'], summary: string, fields: Evidence['fields'], sourceURL?: string) => {
    const id = `${table}:${str(row.id)}`;
    if (!str(row.id) || !source || !Number.isFinite(time(observed)) || time(observed) > asOf || !Number.isFinite(time(available)) || time(available) > asOf) return '';
    evidence.set(id, { id, table, row_id: str(row.id), source, observed_at: observed, available_at: available,
      kind, summary, fields, source_url: sourceURL, freshness_seconds: (asOf - time(observed)) / 1000,
      report_date: identity.report_date, revision_id: identity.revision_id }); return id;
  };
  const known = (r: Row, observed: string, available: string) => Number.isFinite(time(r[observed])) && time(r[observed]) <= asOf && Number.isFinite(time(r[available])) && time(r[available]) <= asOf;
  const quotes: Quote[] = data.quotes.flatMap(row => {
    const price = finite(row.value), change = finite(row.change_percent), symbol = sym(row.symbol);
    if (!known(row, 'captured_at', 'ingested_at') || !symbol || !price || price <= 0 || change === null
      || !/^\d{4}-\d{2}-\d{2}$/.test(str(row.trading_date)) || str(row.trading_date) > identity.report_date
      || !['verified'].includes(str(row.quality_status)) || !['fresh', 'provider_returned'].includes(str(row.freshness_status))
      || !['premarket', 'intraday', 'close'].includes(str(row.phase))) return [];
    // Only the documented Fugle quote total.tradeVolume field. Never infer volume
    // from price movement; today's persisted trimmed quote generally lacks it.
    const raw = obj(row.raw_payload), native = obj(raw.source_raw);
    const volume = finite(obj(native.total).tradeVolume);
    const id = add('market_quotes', row, str(row.provider), str(row.captured_at), str(row.ingested_at), 'market',
      `${symbol} 報價 ${price}，相對前收 ${change}%`, { symbol, price, change_percent: change, ...(volume === null ? {} : { volume }) });
    return id ? [{ row, symbol, price, change, volume, at: time(row.captured_at), id }] : [];
  }).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const conflictSymbols = new Set<string>();
  const latest = (symbol: string): Quote | undefined => {
    const rows = quotes.filter(q => q.symbol === symbol), q = rows[0];
    if (!q || asOf - q.at > (symbol.match(/^\d|TAIEX|TXF/) ? 20 : 80) * 3600000) return undefined;
    // Production provider quotes can disagree: do not pick a bullish provider.
    const sameInstant = rows.filter(r => Math.abs(r.at - q.at) < 60000);
    if (sameInstant.some(r => Math.abs(r.price / q.price - 1) > .005 || Math.abs(r.change - q.change) > .5)) {
      conflictSymbols.add(symbol); return undefined;
    }
    return q;
  };
  const marketSymbols = ['TAIEX', 'TXF', '2330', 'SOX', 'SPX'];
  const market = marketSymbols.flatMap(s => { const q = latest(s); return q ? [q] : []; });
  const taiwan = market.filter(q => ['TAIEX', 'TXF'].includes(q.symbol));
  const direction = market.length === 5 && taiwan.every(q => asOf - q.at <= 20 * 3600000)
    ? factor(mean(market.map(q => (Math.tanh(q.change / 2) + 1) / 2)), refs(market), 'mean((tanh(change_percent/2)+1)/2), five fixed markets; deterministic directional pressure, NOT probability') : missing('Five fresh canonical market quotes required');
  out.direction_evidence_score = direction.value === null ? null : score(direction.value, Object.fromEntries(market.map(q => [q.symbol, q.change])), direction.evidence_ids, direction.calculation);
  if (direction.value !== null) {
    out.market_direction = direction.value > .6 ? 'BULLISH' : direction.value < .4 ? 'BEARISH' : 'RANGE';
    out.market_regime = taiwan.every(q => q.change <= -3) ? 'RISK_OFF' : taiwan.some(q => Math.abs(q.change) >= 3) ? 'HIGH_VOLATILITY' : out.market_direction === 'RANGE' ? 'RANGE' : 'TREND';
  }
  const risk = taiwan.length === 2 ? factor(mean(taiwan.map(q => clamp(Math.abs(q.change) / 5))), refs(taiwan), 'mean(min(abs(TAIEX/TXF change_percent)/5,1)); volatility pressure, not loss probability') : missing('TAIEX and TXF required');
  out.market_risk_score = risk.value === null ? null : score(risk.value, Object.fromEntries(taiwan.map(q => [q.symbol, q.change])), risk.evidence_ids, risk.calculation);

  // True overnight window: previous Taipei calendar day 16:00 through the
  // assessment, maximum 16 hours; no arbitrary 96h news freshness override.
  const newsStart = time(`${identity.report_date}T00:00:00+08:00`) - 8 * 3600000;
  const seenNews = new Set<string>();
  const news = data.news.filter(r => known(r, 'published_at', 'created_at') && time(r.published_at) >= newsStart && url(r.source_url) && str(r.source_name) && str(r.title))
    .sort((a, b) => time(a.published_at) - time(b.published_at) || str(a.id).localeCompare(str(b.id))).flatMap(row => {
      const fingerprint = str(row.title).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (seenNews.has(fingerprint)) return []; seenNews.add(fingerprint);
      const id = add('news_events', row, str(row.source_name), str(row.published_at), str(row.created_at), 'event', str(row.title), { event_type: str(row.event_type) || 'unclassified' }, url(row.source_url));
      return id ? [{ row, id }] : [];
    });
  out.catalysts = news.map(n => ({ source: url(n.row.source_url), published_at: str(n.row.published_at), event_type: str(n.row.event_type) || 'unclassified',
    affected_sector: [], affected_company: [], fundamental_impact: 'UNAVAILABLE', evidence: [n.id] }));
  // symbols/sectors on news_events are AI classifications. Never present these
  // as proven beneficiary relationships; link canonical mappings below instead.
  const universe = data.universe.filter(r => r.is_active === true && known(r, 'updated_at', 'created_at') && /^\d{4,6}$/.test(sym(r.symbol)));
  const uniqueUniverse = [...new Map(universe.map(r => [sym(r.symbol), r])).values()].sort((a, b) => sym(a.symbol).localeCompare(sym(b.symbol)));
  const bars = (symbol: string): Quote[] => [...new Map(quotes.filter(q => q.symbol === symbol && q.row.phase === 'close').map(q => [str(q.row.trading_date), q] as const).reverse()).values()].sort((a, b) => a.at - b.at);
  const benchmark = bars('TAIEX');
  const coverage = uniqueUniverse.length ? uniqueUniverse.flatMap(r => { const q = latest(sym(r.symbol)); return q && asOf - q.at <= 20 * 3600000 ? [q] : []; }) : [];
  const breadth = uniqueUniverse.length && coverage.length === uniqueUniverse.length
    ? factor(coverage.filter(q => q.change > 0).length / coverage.length, refs(coverage), 'advancing/all stocks in the explicit active universe; NOT exchange-wide market breadth') : missing('Complete active-universe quotes missing; no index proxy for breadth');
  const flowsFor = (symbol: string, date: string) => {
    const rs = data.flows.filter(r => sym(r.symbol) === symbol && r.trading_date === date && known(r, 'captured_at', 'created_at') && asOf - time(r.captured_at) <= 4 * DAY
      && str(r.provider) && str(r.source_ref) && r.currency === 'TWD' && [r.buy_amount, r.sell_amount, r.net_amount].every(v => finite(v) !== null));
    const types = ['foreign', 'investment_trust', 'dealer'];
    if (!types.every(t => rs.filter(r => r.institution_type === t).length === 1)) return null;
    const selected = types.map(t => rs.find(r => r.institution_type === t)!);
    if (selected.some(r => Math.abs(Number(r.buy_amount) - Number(r.sell_amount) - Number(r.net_amount)) > 1 || Number(r.buy_amount) < 0 || Number(r.sell_amount) < 0)) return null;
    const gross = selected.reduce((s, r) => s + Number(r.buy_amount) + Number(r.sell_amount), 0);
    if (!gross) return null;
    const ids = selected.map(r => add('institutional_flows', r, str(r.provider), str(r.captured_at), str(r.created_at), 'market', `${symbol} ${str(r.institution_type)} 淨額 ${Number(r.net_amount)}`, { symbol, net_amount: Number(r.net_amount), buy_amount: Number(r.buy_amount), sell_amount: Number(r.sell_amount) }, url(r.source_ref)));
    return factor((selected.reduce((s, r) => s + Number(r.net_amount), 0) / gross + 1) / 2, ids, '(sum(net_amount)/sum(buy_amount+sell_amount)+1)/2; same date/currency, all three institutions');
  };
  const totalFlow = flowsFor('TAIEX', str(taiwan[0]?.row.trading_date));
  const fundamentals = (symbol: string) => {
    const rs = data.earnings.filter(r => sym(r.symbol) === symbol && known(r, 'announced_at', 'created_at') && str(r.source_ref) && str(r.provider)
      && asOf - time(r.announced_at) <= 550 * DAY && [r.revenue_actual, r.revenue_consensus, r.eps_actual, r.eps_consensus].every(v => finite(v) !== null))
      .sort((a, b) => time(b.announced_at) - time(a.announced_at));
    const quarters = rs.slice(0, 4).map(r => str(r.fiscal_period).match(/^(\d{4})-?Q([1-4])$/)).map(m => m ? Number(m[1]) * 4 + Number(m[2]) : NaN);
    if (rs.length < 4 || quarters.some((q, i) => !Number.isFinite(q) || i > 0 && quarters[i - 1] - q !== 1)
      || rs.slice(0, 4).some(r => !url(r.source_ref) || Number(r.revenue_actual) < 0 || Number(r.revenue_consensus) <= 0)
      || asOf - time(rs[0].announced_at) > 120 * DAY) return null;
    const four = rs.slice(0, 4), latestRow = four[0];
    if (!['up', 'stable', 'down'].includes(str(latestRow.guidance_direction))) return null;
    const ids = four.map(r => add('earnings_events', r, str(r.provider), str(r.announced_at), str(r.created_at), 'fundamental',
      `${symbol} ${str(r.fiscal_period)} 營收 ${Number(r.revenue_actual)}／預期 ${Number(r.revenue_consensus)}，EPS ${Number(r.eps_actual)}／預期 ${Number(r.eps_consensus)}`,
      { revenue_actual: Number(r.revenue_actual), revenue_consensus: Number(r.revenue_consensus), eps_actual: Number(r.eps_actual), eps_consensus: Number(r.eps_consensus), guidance: str(r.guidance_direction) }, url(r.source_ref)));
    const damaged = latestRow.guidance_direction === 'down' || (Number(latestRow.revenue_actual) < Number(latestRow.revenue_consensus) && Number(latestRow.eps_actual) < Number(latestRow.eps_consensus));
    const intact = four.every(r => Number(r.revenue_actual) >= Number(r.revenue_consensus) && Number(r.eps_actual) >= Number(r.eps_consensus)) && latestRow.guidance_direction !== 'down';
    return { damaged, intact, ids, latest: latestRow };
  };
  const screen = out.screening!; screen.universe_count = uniqueUniverse.length;
  const checked: Opportunity[] = [];
  for (const member of uniqueUniverse) {
    const symbol = sym(member.symbol), q = latest(symbol), series = bars(symbol), f = fundamentals(symbol);
    const reasons: string[] = [];
    if (!q) reasons.push(conflictSymbols.has(symbol) ? 'CONFLICTING_QUOTES' : 'FRESH_QUOTE_MISSING');
    if (series.length < 20) reasons.push('20_DAILY_CLOSES_MISSING');
    if (series.slice(-20).some(p => p.volume === null || p.volume <= 0) || series.length < 20) reasons.push('20_DAILY_VOLUMES_MISSING');
    const inst = flowsFor(symbol, str(q?.row.trading_date));
    if (!inst) reasons.push('THREE_INSTITUTIONS_MISSING');
    if (!f || !f.intact && !f.damaged) reasons.push('FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING');
    const mapping = data.mappings.filter(m => sym(m.stock_symbol) === symbol && known(m, 'created_at', 'created_at')).find(m => {
      const c = data.catalysts.find(c => c.id === m.catalyst_id && known(c, 'event_at', 'created_at'));
      return c && news.some(n => referenceValues(c.source_refs).some(ref => ref === n.row.id || ref === n.row.source_url))
        && str(m.transmission_path) && str(m.taiwan_supply_chain_relation) && str(m.invalidation_condition)
        && f && referenceValues(m.source_refs).includes(str(f.latest.source_ref));
    });
    const catalyst = mapping && data.catalysts.find(c => c.id === mapping.catalyst_id);
    const event = catalyst && news.find(n => referenceValues(catalyst.source_refs).some(ref => ref === n.row.id || ref === n.row.source_url));
    if (!event || !mapping) reasons.push('SOURCED_COMPANY_CATALYST_MAPPING_MISSING');
    const peers = uniqueUniverse.filter(r => r.sector === member.sector && sym(r.symbol) !== symbol).map(r => latest(sym(r.symbol))).filter((r): r is Quote => Boolean(r));
    if (peers.length < 2) reasons.push('SECTOR_REACTION_MISSING');
    const pre = event && series.filter(p => p.at < time(event.row.published_at)).slice(-6);
    const post = event && q && q.at > time(event.row.published_at) ? q : undefined;
    const preBase = pre?.[0], preLast = pre?.at(-1);
    const benchPre = preBase && benchmark.find(b => b.row.trading_date === preBase.row.trading_date);
    const benchNow = latest('TAIEX');
    if (!pre || pre.length < 6 || !preBase || !preLast || !post || !benchPre || !benchNow || post.volume === null || post.volume <= 0) reasons.push('EVENT_ALIGNED_PRICE_VOLUME_REACTION_MISSING');
    if (reasons.length || !q || !f || !inst || !mapping || !event || !preBase || !preLast || !post || !benchPre || !benchNow || !pre) {
      screen.rejected.push({ symbol, reasons: [...new Set(reasons)] }); continue;
    }
    screen.evaluated_count++;
    const priorReturn = preLast.price / preBase.price - 1, reaction = post.price / preLast.price - 1;
    const relative = post.price / preBase.price - benchNow.price / benchPre.price;
    const volumeRatio = post.volume! / mean(pre.map(p => p.volume!));
    const pricePosition = (q.price - Math.min(...series.slice(-20).map(p => p.price))) / Math.max(.000001, Math.max(...series.slice(-20).map(p => p.price)) - Math.min(...series.slice(-20).map(p => p.price)));
    const sectorReaction = mean(peers.map(p => p.change)) / 100;
    const pricedInputs = { pre_event_return: priorReturn, post_event_return: reaction, relative_return: relative, volume_ratio: volumeRatio, price_position_20d: pricePosition, sector_reaction: sectorReaction };
    const priceRefs = refs([...pre, post, benchPre, benchNow, ...peers, ...series.slice(-20)]);
    const priced = score(mean([clamp(priorReturn / .1), clamp(reaction / .05), clamp(relative / .1), clamp((volumeRatio - 1) / 2), clamp(pricePosition), clamp(sectorReaction / .05)]), pricedInputs, priceRefs,
      'mean(clamp(pre/.10),clamp(post/.05),clamp(relative/.10),clamp((volume_ratio-1)/2),clamp(20d_price_position),clamp(sector/.05)); prospective price-response index, not event causality or probability');
    const extended = priorReturn + reaction >= .1 || pricePosition >= .95 && reaction >= .03 || priced.value >= 80;
    const crash = benchNow.change <= -3 && q.change <= -3;
    const mispricing = crash && f.intact && inst.value! >= .5 && !extended;
    // Missing independent confirmation never becomes ACTIVE_WATCH. Confirmation
    // here is measured post-event relative/volume/flow alignment, not prose.
    let action: Action = f.damaged ? 'AVOID' : extended ? 'DO_NOT_CHASE' : mispricing ? 'WAIT_FOR_CONFIRMATION'
      : reaction > 0 && relative > 0 && volumeRatio >= 1 && inst.value! > .5 ? 'ACTIVE_WATCH'
      : pricePosition > .8 ? 'WAIT_FOR_PULLBACK' : 'WAIT_FOR_CONFIRMATION';
    if (conflictSymbols.size || data.failures.length) action = 'WAIT_FOR_CONFIRMATION';
    const mappingId = add('catalyst_tw_mappings', mapping, url(f.latest.source_ref), str(mapping.created_at), str(mapping.created_at), 'fundamental', str(mapping.transmission_path), { symbol }, url(f.latest.source_ref));
    const allRefs = [...priceRefs, ...f.ids, ...inst.evidence_ids, event.id, mappingId];
    const opportunity = score(mean([1 - priced.value / 100, f.intact ? 1 : 0, inst.value!, clamp(volumeRatio / 2), clamp((relative + .1) / .2)]),
      { not_priced_in: 1 - priced.value / 100, fundamental_earnings_agreement: f.intact ? 1 : 0, institutional: inst.value!, volume_ratio: volumeRatio, relative_return: relative }, allRefs,
      'equal-weight: not_priced_in, four-quarter earnings agreement, institutional net/gross, clamp(volume_ratio/2), clamp((relative+.10)/.20); evidence score, NOT expected return');
    // Complete, evidenced screening can legitimately exclude a low-scoring
    // candidate. Missing data never reaches this point. Keep explicit risk cards.
    if (opportunity.value < 50 && !['AVOID', 'DO_NOT_CHASE'].includes(action) && !mispricing) continue;
    checked.push({ symbol, company_name: str(member.stock_name), action, classification: f.damaged ? 'FUNDAMENTAL_DAMAGE' : mispricing ? 'MISPRICING_CANDIDATE' : 'CATALYST_WATCH',
      thesis: `${str(event.row.title)}；${str(mapping.transmission_path)}`, transmission: { catalyst: str(event.row.title), cause: str(mapping.transmission_path), market_impact: `加權相對前收 ${benchNow.change}%`, sector: str(member.sector), company_exposure: str(mapping.taiwan_supply_chain_relation),
        fundamental_impact: f.damaged ? 'DAMAGED' : 'INTACT', fundamental_explanation: f.damaged ? '最近財報低於預期或下修展望；不將跌幅當成錯殺。' : '最近四季營收及 EPS 未低於有來源的預期；這是已觀察財報檢查，不代表未來保證。',
        price_reaction: `事件後價格變動 ${(reaction * 100).toFixed(2)}%`, priced_in: `價格反應指標 ${priced.value}/100；估值資料未接入，不代表內在價值估算。`, risk_reward: '尚無經校準的報酬估計；僅觀察並遵守失效條件。', evidence_ids: allRefs },
      catalyst_score: null, priced_in_score: priced, risk_score: out.market_risk_score, opportunity_score: opportunity,
      mispricing_score: mispricing ? opportunity : null, evidence: allRefs.flatMap(id => evidence.has(id) ? [evidence.get(id)!] : []),
      invalidation_conditions: [str(mapping.invalidation_condition), `價格低於事件前基準 ${preLast.price}，或下一份財報下修展望時重新評估；不自動買入。`], data_quality: 'complete' });
  }
  const factors: NonNullable<Decision['factor_availability']> = {
    direction, market_regime: direction.value === null ? missing('Regime needs measured markets') : factor(direction.value, direction.evidence_ids, 'Market regime derives from signed index changes, not text'), risk,
    price_position: benchmark.length >= 20 && taiwan[0] ? factor(clamp((taiwan[0].price - Math.min(...benchmark.slice(-20).map(q => q.price))) / Math.max(.000001, Math.max(...benchmark.slice(-20).map(q => q.price)) - Math.min(...benchmark.slice(-20).map(q => q.price)))), refs(benchmark.slice(-20)), 'TAIEX position within 20 daily closing prices') : missing('20 TAIEX daily closes required'),
    valuation: missing('No persisted valuation dataset'), breadth, institutional: totalFlow ?? missing('Three same-date TAIEX institutional flows missing'),
    catalyst: news.length ? factor(1, news.map(n => n.id), 'Fresh sourced overnight events present; presence only, not bullishness') : missing('No fresh sourced overnight event'),
    priced_in: checked.length && checked.length === uniqueUniverse.length ? factor(mean(checked.map(o => o.priced_in_score!.value / 100)), checked.flatMap(o => o.priced_in_score!.evidence_ids), 'mean(event-aligned price response for every covered universe member); not valuation') : missing('Incomplete universe event-aligned price/volume/sector series'),
    historical_calibration: missing('No point-in-time out-of-sample directional calibration; CLE accuracy is a different target'),
  };
  if (conflictSymbols.size) { factors.direction = { ...missing('Conflicting canonical quotes'), status: 'CONFLICTING' }; out.issues.push('CONFLICTING_QUOTES'); out.direction_evidence_score = null; out.market_direction = null; out.market_regime = null; }
  const available = Object.values(factors).filter(f => f.status === 'AVAILABLE');
  const completeness = available.length / Object.keys(factors).length;
  factors.evidence_quality = market.length ? factor(completeness, available.flatMap(f => f.evidence_ids), 'available audited factors / all audited factors; unavailable factors are explicitly counted') : missing('No usable market evidence');
  const fresh = market.length ? mean(market.map(q => clamp(1 - (asOf - q.at) / (['SOX', 'SPX'].includes(q.symbol) ? 80 : 20) / 3600000))) : 0;
  const signalAgreement = market.length ? Math.max(market.filter(q => q.change > 0).length, market.filter(q => q.change < 0).length) / marketSymbols.length : 0;
  const crossSource = market.flatMap(q => quotes.filter(r => r.symbol === q.symbol && r.row.provider !== q.row.provider && Math.abs(r.at - q.at) < 60000));
  const sourceAgreement = crossSource.length && !conflictSymbols.size ? new Set(crossSource.map(q => q.symbol)).size / marketSymbols.length : 0;
  // Calibration is explicitly unavailable; zero means no calibration evidence,
  // NOT a fabricated raw observation or a calibration accuracy of zero.
  const confidenceInputs = { data_completeness: completeness, freshness: fresh, source_agreement: sourceAgreement, signal_agreement: signalAgreement, calibration_evidence: 0 };
  if (market.length && available.length) out.model_confidence = score(mean(Object.values(confidenceInputs)), confidenceInputs, [...refs(market), ...available.flatMap(f => f.evidence_ids)], 'mean(completeness,freshness,independent_source_coverage,signal_agreement,calibration_evidence=unavailable:0); quality coverage, NOT win probability');
  out.factor_availability = factors;
  // Entry remains null if any required factor is missing. Optional valuation
  // stays unavailable and lowers completeness; never imputed to 50/75/80/90.
  const entryKeys = ['market_regime', 'risk', 'price_position', 'breadth', 'institutional', 'catalyst', 'priced_in', 'evidence_quality'];
  if (entryKeys.every(k => factors[k].value !== null)) {
    const inputs = Object.fromEntries(entryKeys.map(k => [k, ['risk', 'price_position', 'priced_in'].includes(k) ? 1 - factors[k].value! : factors[k].value!]));
    out.entry_environment_score = score(mean(Object.values(inputs)), inputs, entryKeys.flatMap(k => factors[k].evidence_ids), 'mean(regime,1-risk,1-price_position,breadth,institutional,catalyst,1-priced_in,evidence_quality); valuation UNAVAILABLE, excluded, completeness penalized');
  }
  screen.status = uniqueUniverse.length > 0 && screen.rejected.length === 0 && data.failures.length === 0 && conflictSymbols.size === 0 ? 'COMPLETE' : 'INCOMPLETE';
  out.rejected_opportunity_count = screen.rejected.length;
  out.stock_opportunities = checked;
  out.action = screen.status === 'INCOMPLETE' || !out.market_direction ? 'INSUFFICIENT_DATA' : checked.length === 0 ? 'NO_QUALIFIED_OPPORTUNITY'
    : checked.every(o => o.action === 'AVOID') ? 'AVOID' : checked.every(o => o.action === 'DO_NOT_CHASE' || o.action === 'AVOID') ? 'DO_NOT_CHASE'
    : out.market_regime === 'RISK_OFF' ? 'DEFENSIVE' : checked.some(o => o.action === 'ACTIVE_WATCH') ? 'ACTIVE_WATCH' : 'WAIT_FOR_CONFIRMATION';
  if (out.action === 'ACTIVE_WATCH' && (!out.entry_environment_score || !out.model_confidence || out.model_confidence.value < 50)) out.action = 'WAIT_FOR_CONFIRMATION';
  else if (out.action === 'ACTIVE_WATCH' && out.entry_environment_score!.value < 50) out.action = 'WAIT_FOR_PULLBACK';
  if (['WAIT_FOR_CONFIRMATION', 'WAIT_FOR_PULLBACK'].includes(out.action)) out.stock_opportunities = out.stock_opportunities.map(o => o.action === 'ACTIVE_WATCH' ? { ...o, action: out.action } : o);
  // An incomplete universe is not a green light for its one well-covered stock.
  if (out.action === 'INSUFFICIENT_DATA') out.stock_opportunities = [];
  out.reason_summary = out.action === 'INSUFFICIENT_DATA' ? '市場與個股證據尚未齊全；缺少資料不代表今天沒有機會。' : '判斷依有時間與來源的市場、事件及財報紀錄；品質分數不是經校準的獲利機率。';
  out.evidence_quality = screen.status === 'COMPLETE' ? 'complete' : 'insufficient';
  out.data_freshness = market.length ? 'valid_at_assessment' : 'unavailable';
  // Return only referenced evidence, not every historical quote fetched.
  const used = new Set([...available.flatMap(f => f.evidence_ids), ...news.map(n => n.id), ...(out.model_confidence?.evidence_ids ?? []), ...out.stock_opportunities.flatMap(o => o.evidence.map(e => e.id))]);
  out.evidence = [...evidence.values()].filter(e => used.has(e.id)).sort((a, b) => a.id.localeCompare(b.id));
  out.confidence_evidence = out.evidence.filter(e => out.model_confidence?.evidence_ids.includes(e.id));
  if (market.length) out.data_as_of = new Date(Math.max(...market.map(q => q.at))).toISOString();
  out.issues.push(...Object.entries(factors).filter(([, f]) => f.status !== 'AVAILABLE').map(([k]) => `${k}:UNAVAILABLE`));
  return out;
}

/** Server projection: client tier/query metadata never enters this function. */
export function projectEvidenceDecision(decision: Decision, access: { companyContentAllowed: boolean; canonicalAction: string; publishedSymbols: string[] }): Decision {
  const permitted = new Set(access.publishedSymbols.map(sym));
  const companies = access.companyContentAllowed && ['ACT', 'SELECTIVE', 'TRADE'].includes(access.canonicalAction);
  const out = { ...decision, stock_opportunities: companies ? decision.stock_opportunities.filter(o => permitted.has(o.symbol)) : [] };
  if (access.canonicalAction === 'STOP' && out.action !== 'NOT_APPLICABLE' && out.action !== 'INSUFFICIENT_DATA') { out.action = 'DEFENSIVE'; out.reason_summary = '已發布決策停止進場，新評估不得覆蓋風險限制。'; }
  if (access.canonicalAction !== 'ACT' && out.action === 'ACTIVE_WATCH') out.action = 'WAIT_FOR_CONFIRMATION';
  // SELECTIVE/TRADE are the existing publisher enums, not proof of a completed
  // runtime entry checkpoint. Preserve paid observations, but never upgrade them.
  if (access.canonicalAction !== 'ACT') out.stock_opportunities = out.stock_opportunities.map(o => o.action === 'ACTIVE_WATCH' ? { ...o, action: 'WAIT_FOR_CONFIRMATION' } : o);
  const companyEvidence = new Set(out.stock_opportunities.flatMap(o => o.evidence.map(e => e.id)));
  out.evidence = out.evidence.filter(e => {
    if (e.kind === 'fundamental' || e.table === 'catalyst_tw_mappings') return companyEvidence.has(e.id);
    if (e.fields?.symbol && /^\d/.test(String(e.fields.symbol)) && e.fields.symbol !== '2330') return companies;
    return true;
  });
  if (!companies) {
    out.screening = out.screening && { ...out.screening, rejected: [] };
    out.primary_catalysts = []; out.sector_impacts = [];
  }
  const ids = new Set(out.evidence.map(e => e.id));
  // Strip hidden provenance with the score; never leak a paid symbol in inputs.
  for (const key of ['entry_environment_score', 'direction_evidence_score', 'model_confidence', 'market_risk_score'] as const) if (out[key]?.evidence_ids.some(id => !ids.has(id))) out[key] = null;
  out.factor_availability = Object.fromEntries(Object.entries(out.factor_availability ?? {}).map(([k, f]) => [k, f.evidence_ids.some(id => !ids.has(id)) ? missing('Restricted evidence') : f]));
  out.confidence_evidence = out.confidence_evidence.filter(e => ids.has(e.id));
  return out;
}

/** Content-address the read-side assessment independently of publication. This
 * makes a later availability/correction detectable without rewriting a decision.
 * Same identity plus same evidence always yields the same hash; never a ledger. */
export async function sealEvidenceDecision(decision: Decision): Promise<Decision> {
  const bytes = new TextEncoder().encode(JSON.stringify(decision));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return { ...decision, assessment_id: `decision-evidence-v1:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}` };
}
