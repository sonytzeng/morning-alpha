import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { csvRows } from '../src/features/vnext/dailyParsers.mjs';
import { normalizeOfficialDailyOpenDataCandidate as normalize, OFFICIAL_DAILY_OPEN_PROFILES as profiles,
  OFFICIAL_DAILY_OPEN_LIMITS as limits, OFFICIAL_DAILY_OPEN_CONTRACT } from '../research/official-daily-open-data-candidate.ts';
import { RECOMMENDATION_UNIVERSE as universe } from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import { emptyEvidenceData } from '../supabase/functions/_shared/decision-v1-data.ts';
import { buildEvidenceDecision } from '../supabase/functions/_shared/decision-v1-evidence.ts';
import { eventAlignmentFromRetainedEvidence } from '../research/recommendation-event-alignment-candidate.ts';
import { v2Hash } from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import { evidenceRows, IDENTITY } from './fixtures/decision-evidence-rows.mjs';

// All market values in this section are invented contract controls, not replay
// facts, backtests, source admission assertions or examples of actual prices.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = rows => rows.map(r => r.map(v => '"' + String(v).replaceAll('"','""') + '"').join(',')).join('\r\n') + '\r\n';
const roc = date => String(Number(date.slice(0,4)) - 1911) + date.slice(4).replaceAll('-','');
const receiptTimes = { first_seen_at: '2026-10-20T21:05:27.935Z', available_at: '2026-10-20T21:05:28.082Z' };
const wrap = (id, rows, overrides = {}, headers = profiles[id].headers) => {
  const response_body = Buffer.from('\uFEFF' + encode([headers,...rows]));
  return { response_body, receipt: { schema: 'EXACT_REGISTERED_OPEN_RESOURCE_RAW_RECEIPT_V1',
    id, url: profiles[id].url, http: 200, bytes: response_body.length, raw_sha256: sha(response_body),
    ...receiptTimes, fields: [...headers], row_count: rows.length, native_dates: [...new Set(rows.map(r => r[0]))],
    original_published_at: null, original_version: null, source_session_scope: 'NOT_YET_REVIEWED',
    source_admission: false, canonical_admission: false, publication_approval: false, ...overrides } };
};
const stockRow = (id, symbol, date = '2026-10-20') => {
  const row = { '日期': roc(date), '資料日期': roc(date), '證券代號': symbol, '代號': symbol,
    '證券名稱': '隔離合成_' + symbol, '名稱': '隔離合成_' + symbol,
    '開盤價': '100', '最高價': '110', '最低價': '90', '收盤價': '102', '漲跌價差': '2',
    '開盤': '100', '最高': '110', '最低': '90', '收盤': '102', '漲跌': '+2.00', '均價': '101',
    '成交股數': '1,000,000', '成交金額': '100,000,000', '成交筆數': '100',
    '最後買價': '101', '最後賣價': '103', '發行股數': '10000000', '次日參考價': '102', '次日漲停價': '112', '次日跌停價': '92' };
  return profiles[id].headers.map(h => row[h]);
};
const indexRow = (date = '2026-10-20', name = '發行量加權股價指數') => [roc(date),name,'20000','+','10','0.05',''];
const setup = (date = '2026-10-20', cutoff = '2026-10-21T00:00:00Z') => ({ trading_date: date, cutoff,
  resources: [wrap('TWSE_11549',universe.slice(0,61).map(s => stockRow('TWSE_11549',s,date))),
    wrap('TPEX_11370',universe.slice(61).map(s => stockRow('TPEX_11370',s,date))),
    wrap('TAIEX_11555',[indexRow(date)])] });
const rewrite = (resource, change) => {
  const [header,...rows] = csvRows(new TextDecoder().decode(resource.response_body)); change(header,rows);
  return wrap(resource.receipt.id, rows, { first_seen_at: resource.receipt.first_seen_at,
    available_at: resource.receipt.available_at }, header);
};
const held = value => {
  assert.equal(value.quality_status,'source_scope_unreviewed');
  for (const k of ['source_admission','canonical_admission','publication_approval','source_approved','canonical_approved','publication_approved']) assert.equal(value[k],false);
};

test('SYNTHETIC: fixed four profiles, case-sensitive exact URLs, 72 denominator and held approvals', () => {
  assert.equal(Object.keys(profiles).length,4); assert.equal(limits.resources,4);
  assert.equal(profiles.TPEX_11370.url,'https://www.tpex.org.tw/web/stock/aftertrading/DAILY_CLOSE_quotes/stk_quote_result.php?l=zh-tw&o=data');
  assert.equal(profiles.TPEX_11371.session_scope,'EXCLUDES_1430_FIXED_PRICE');
  const input = setup(), before = sha(Buffer.from(JSON.stringify(input))), out = normalize(input);
  assert.equal(out.contract,OFFICIAL_DAILY_OPEN_CONTRACT);
  assert.deepEqual(out.counts,{universe:72,stocks_with_facts:72,stocks_missing_facts:0,benchmark_facts:1,candidate_quotes:73,verified_quotes:0});
  assert.deepEqual(out.stocks.map(s => s.symbol),universe);
  for (const value of [out,...out.stocks,...out.sources,...out.data.quotes]) held(value);
  for (const s of out.stocks) {
    held(s.fact); assert(s.gaps.includes('SOURCE_SCOPE_REVIEW_REQUIRED'));
    assert.equal(s.fact.canonical_session_scope,null); assert.equal(s.fact.volume_amount_comparable_to_history,false);
  }
  assert.equal(out.production_eligible,false); assert.equal(out.promotion_allowed,false);
  assert.equal(out.member_publication_approved,false); assert.equal(out.original_thresholds_changed,false);
  assert.deepEqual(out.business_writes,[]); assert.deepEqual(out.data.universe,[]);
  assert.equal(sha(Buffer.from(JSON.stringify(input))),before);
});

test('SYNTHETIC: no resources leaves all 72 explicit gaps without a benchmark substitute', () => {
  const input = setup(); input.resources = [];
  const out = normalize(input);
  assert.equal(out.stocks.length,72); assert.equal(out.counts.stocks_missing_facts,72);
  assert(out.stocks.every(s => s.fact === null && s.gaps.includes('SYMBOL_NOT_IN_SUPPLIED_EXACT_RESOURCES')));
  assert.equal(out.benchmark.fact,null); assert.equal(out.data.quotes.length,0);
});

test('SOURCE_CONTRACT_REPRO: missing non-analysis bid/ask/issued-share fields do not erase valid native OHLCVA facts', () => {
  for (const [index,value] of [[8,''],[12,'--'],[13,''],[14,'9007199254740991.01']]) {
    const input=setup();input.resources[1]=rewrite(input.resources[1],(_h,rows)=>{rows[0][index]=value;});
    const out=normalize(input),stock=out.stocks[61];
    assert(stock.fact,'required six native OHLCVA fields are still present');
    assert.equal(out.counts.stocks_with_facts,72);held(stock.fact);
    assert.equal(stock.fact.values.volume_shares,1_000_000);assert.equal(stock.fact.values.amount_twd,100_000_000);
    assert.equal(stock.fact.native_cells[index],value,'unused source field is retained verbatim, not invented');
  }
});

test('SOURCE_CONTRACT_REPRO: unknown native change/trade count retain OHLCVA without fabricating a return or zero', () => {
  const input=setup();input.resources[0]=rewrite(input.resources[0],(_h,rows)=>{rows[0][9]='X';rows[0][10]='--';});
  const stock=normalize(input).stocks[0];assert(stock.fact);held(stock.fact);
  assert.equal(stock.fact.values.change,null);assert.equal(stock.fact.values.change_percent,null);assert.equal(stock.fact.values.trade_count,null);
  assert(stock.fact.metric_gaps.includes('NATIVE_CHANGE_OR_REFERENCE_UNPROVEN'));
});

test('SYNTHETIC: native names/rows/ROC dates and actual unequal receipt times survive, without invented version/publication', () => {
  const input = setup(), resource = input.resources[0];
  input.resources[0] = rewrite(resource,(_h,rows) => { rows[0][2] = '隔離,"合成"名稱'; });
  const out = normalize(input), fact = out.stocks[0].fact, q = out.data.quotes.find(q => q.symbol === fact.symbol);
  assert.equal(fact.stock_name,'隔離,"合成"名稱'); assert.equal(fact.native_date,'1151020');
  assert.deepEqual(csvRows(fact.raw_record),[fact.native_cells]);
  assert.equal(fact.raw_sha256,input.resources[0].receipt.raw_sha256);
  assert.equal(fact.first_seen_at,receiptTimes.first_seen_at); assert.equal(fact.available_at,receiptTimes.available_at);
  assert.notEqual(fact.first_seen_at,fact.available_at);
  assert.equal(fact.raw_hash_basis,'RETRIEVED_BYTES_NOT_ORIGINAL_VERSION');
  for (const key of ['published_at','original_published_at','original_version','source_version']) assert.equal(fact[key],null);
  assert.equal(q.source_timestamp,null); assert.equal(q.session,null);
  assert.equal(q.captured_at_basis,'DERIVED_SESSION_REFERENCE_NOT_PUBLICATION_TIME');
  assert.equal(q.captured_at,fact.trading_date + 'T13:30:00+08:00');
  assert.notEqual(q.provider,'fugle'); assert.notEqual(q.raw_payload.contract,'RECOMMENDATION_STOCK_EVIDENCE_V1');
  assert.equal(q.raw_payload.endpoint,undefined);
  assert.equal(out.stocks.at(-1).fact.values.change,2); // explicit '+' normalizes through officialNumber
  assert.equal(out.stocks.at(-1).fact.values.volume_shares,1_000_000);
  assert.equal(out.stocks.at(-1).fact.values.amount_twd,100_000_000); // no thousand-unit multiplication
});

test('SYNTHETIC: original record spans survive quoted CRLF without a second cell-decoding implementation', () => {
  const input = setup();
  input.resources[0] = rewrite(input.resources[0],(_h,rows) => { const extra = stockRow('TWSE_11549','9999'); extra[2] = '合成\r\n非Universe'; rows.unshift(extra); });
  const fact = normalize(input).stocks[0].fact;
  assert.equal(fact.record_number,3); assert.equal(fact.line_start,4); assert.equal(fact.line_end,4);
});

test('SYNTHETIC: 11371 stays a separate scope comparison even when primary 11370 is missing or differs', () => {
  const input = setup(), rows = universe.slice(61).map(s => stockRow('TPEX_11371',s)); rows[0][9] = '123456789';
  input.resources.push(wrap('TPEX_11371',rows));
  const out = normalize(input);
  assert.equal(out.counts.stocks_with_facts,72); assert.equal(out.counts.candidate_quotes,73);
  assert.equal(out.comparison_11371.facts.length,11); assert.equal(out.comparison_11371.candidate_quotes,0);
  assert(out.comparison_11371.facts.every(f => f.session_scope === 'EXCLUDES_1430_FIXED_PRICE'));
  assert(out.stocks.slice(61).every(s => s.fact.resource_id === 'TPEX_11370'));
  assert(out.data.quotes.every(q => q.raw_payload.resource_id !== 'TPEX_11371'));
  input.resources = input.resources.filter(r => r.receipt.id !== 'TPEX_11370');
  const missing = normalize(input);
  assert.equal(missing.counts.stocks_with_facts,61); assert.equal(missing.counts.stocks_missing_facts,11);
  assert.equal(missing.comparison_11371.facts.length,11); // Never fallback across incompatible scopes.
});

test('SYNTHETIC negative: exact byte hash and declared length bind the raw body including BOM', () => {
  for (const change of [r => r.response_body[10] ^= 1,r => r.receipt.raw_sha256 = '0'.repeat(64),r => r.receipt.bytes--]) {
    const input = setup(); change(input.resources[0]); assert.throws(() => normalize(input),/HASH|SIZE_MISMATCH/);
  }
});

test('SYNTHETIC negative: URL case/query/host, receipt shape/status and approval spoofing cannot promote a source', () => {
  for (const change of [r => r.url += '&extra=1',r => r.url = r.url.replace('DAILY_CLOSE_quotes','daily_close_quotes'),
    r => r.url = 'https://example.test/data',r => r.http = 206,r => r.schema = 'OLD_SOURCE_RECEIPT',
    r => r.source_admission = true,r => r.canonical_admission = true,r => r.publication_approval = true,
    r => r.source_session_scope = 'REGULAR_COMPLETED',r => r.original_published_at = receiptTimes.first_seen_at,
    r => r.original_version = 'retrieval-' + r.raw_sha256]) {
    const input = setup(); change(input.resources[1].receipt); assert.throws(() => normalize(input),/RECEIPT_OR_SOURCE/);
  }
});

test('SYNTHETIC negative: complete exact header order rejects drift, duplicate fields and thousand-unit substitutions', () => {
  for (const change of [h => h.reverse(),h => h.push('extra'),h => h[2] = h[1],
    h => h[3] = '成交千股',h => h[4] = '成交仟元',h => h[4] = '成交金額(千元)']) {
    const input = setup(); input.resources[0] = rewrite(input.resources[0],change);
    assert.throws(() => normalize(input),/SCHEMA_OR_UNITS_CHANGED/);
  }
  const input = setup(); input.resources[0].receipt.fields.reverse(); assert.throws(() => normalize(input),/SCHEMA/);
});

test('SYNTHETIC negative: duplicate resource, symbol/date or cross-primary listing never selects first-find', () => {
  let input = setup(); input.resources.push(structuredClone(input.resources[0])); assert.throws(() => normalize(input),/RESOURCE_ID_OR_DUPLICATE/);
  for (const change of [(_h,rows) => rows.push([...rows[0]]),(_h,rows) => { const duplicate = [...rows[0]]; duplicate[0] = '1151019'; rows.push(duplicate); }]) {
    input = setup(); input.resources[0] = rewrite(input.resources[0],change); assert.throws(() => normalize(input),/DUPLICATE|SESSION_DATE/);
  }
  input = setup(); input.resources[1] = rewrite(input.resources[1],(_h,rows) => { rows[0][1] = universe[0]; });
  assert.throws(() => normalize(input),/CROSS_RESOURCE_DUPLICATE/);
});

test('SYNTHETIC negative: invalid/nontrading/mixed native dates, receipt date drift and row count drift reject', () => {
  for (const date of ['2026-02-30','2026-10-18','1151020']) assert.throws(() => normalize({...setup(),trading_date:date}),/TRADING_DATE/);
  const input = setup(); input.resources[0] = rewrite(input.resources[0],(_h,rows) => { rows[0][0] = '1151019'; });
  assert.throws(() => normalize(input),/SESSION_DATE/);
  for (const change of [r => r.native_dates = ['1151019'],r => r.row_count--]) {
    const invalid = setup(); change(invalid.resources[0].receipt); assert.throws(() => normalize(invalid),/NATIVE_DATES|ROW_COUNT/);
  }
});

test('SYNTHETIC negative: no manufactured first-seen, no backward availability, exact microsecond cutoff and unfinished sessions', () => {
  for (const change of [r => r.first_seen_at = null,r => r.available_at = null,r => r.first_seen_at = '2026-02-30T00:00:00Z',
    r => r.first_seen_at = '2026-10-20T21:06:00Z',r => r.first_seen_at = '2026-10-20T05:29:59Z',
    r => r.available_at = '2026-10-21T00:00:00.000001Z']) {
    const input = setup(); change(input.resources[0].receipt); assert.throws(() => normalize(input),/NOT_AVAILABLE/);
  }
  assert.throws(() => normalize({...setup(),cutoff:'2026-10-20T13:29:59+08:00'}),/CUTOFF/);
  assert.throws(() => normalize({...setup(),cutoff:'2026-10-20T21:05:28.081999Z'}),/NOT_AVAILABLE/);
  assert.equal(normalize({...setup(),cutoff:receiptTimes.available_at}).counts.stocks_with_facts,72);
});

test('SYNTHETIC negative: missing/invalid values reject only affected facts without zero-fill or denominator shrink', () => {
  for (const value of ['', '--', 'NaN', 'Infinity', '1,00,000']) {
    const input = setup(); input.resources[0] = rewrite(input.resources[0],(_h,rows) => { rows[0][3] = value; });
    const out = normalize(input);
    assert.equal(out.counts.stocks_with_facts,71); assert.equal(out.stocks.length,72); assert.equal(out.stocks[0].fact,null);
    assert(out.stocks[0].gaps.includes('REQUIRED_NUMERIC_VALUE_MISSING_OR_INVALID'));
    assert.equal(out.stocks[0].rejected_observation.raw_sha256,input.resources[0].receipt.raw_sha256);
    assert.equal(out.stocks[0].rejected_observation.native_date,'1151020');
    assert(!out.data.quotes.some(q => q.symbol === universe[0]));
  }
});

test('SYNTHETIC negative: illegal OHLC and unsafe/fractional/nonpositive TWD or shares reject; unproven metrics remain null', () => {
  for (const [field,value] of [[6,'80'],[7,'105'],[5,'0'],[8,'-1'],[3,'9007199254740992'],
    [3,'1.5'],[3,'9007199254740991.1'],[4,'9007199254740993'],[4,'9007199254740991.01'],[4,'0.01'],[4,'0']]) {
    const input = setup(); input.resources[0] = rewrite(input.resources[0],(_h,rows) => { rows[0][field] = value; });
    const out = normalize(input); assert.equal(out.stocks[0].fact,null); assert.equal(out.counts.stocks_missing_facts,1);
  }
  const input = setup(); input.resources[1] = rewrite(input.resources[1],(_h,rows) => { rows[0][9] = '9007199254740992'; });
  assert.equal(normalize(input).stocks[61].fact,null); // 11370 uses shares/TWD, not historical thousand units.
  const exact = setup(); exact.resources[0] = rewrite(exact.resources[0],(_h,rows) => { rows[0][4] = '9007199254740991.00'; });
  assert.equal(normalize(exact).counts.stocks_missing_facts,0);
  // Preserve the original two counterexamples, but classify the specific
  // missing metric instead of erasing the six unaffected OHLCVA measurements.
  for(const [field,value,metric,reason]of [[9,'102','change_percent','NATIVE_CHANGE_OR_REFERENCE_UNPROVEN'],[10,'0','trade_count','NATIVE_TRADE_COUNT_UNPROVEN']]){
    const partial=setup();partial.resources[0]=rewrite(partial.resources[0],(_h,rows)=>{rows[0][field]=value;});
    const out=normalize(partial),stock=out.stocks[0];assert(stock.fact);held(stock.fact);
    assert.equal(stock.fact.values[metric],null);assert(stock.gaps.includes(reason));assert.equal(out.counts.verified_quotes,0);
  }
});

test('SYNTHETIC: missing names reject; unrelated auxiliary values remain verbatim and cannot erase OHLCVA', () => {
  for (const [id,index,value] of [['TWSE_11549',2,''],['TPEX_11370',8,''],['TPEX_11370',12,'--'],
    ['TPEX_11370',14,'9007199254740991.01'],['TPEX_11371',11,'']]) {
    const input = setup();
    if (id === 'TPEX_11371') input.resources.push(wrap(id,[stockRow(id,universe.at(-1))]));
    const i = input.resources.findIndex(r => r.receipt.id === id);
    input.resources[i] = rewrite(input.resources[i],(_h,rows) => { rows[0][index] = value; });
    const out = normalize(input);
    if (id === 'TPEX_11371') { assert.equal(out.comparison_11371.facts.length,1); assert.equal(out.comparison_11371.rejected.length,0);assert.equal(out.comparison_11371.facts[0].native_cells[index],value);held(out.comparison_11371.facts[0]); }
    else if(index===2){assert.equal(out.counts.stocks_missing_facts,1);assert(out.stocks.some(s=>s.fact===null&&s.rejected_observation));}
    else {assert.equal(out.counts.stocks_missing_facts,0);const fact=out.stocks.find(s=>s.fact?.resource_id===id).fact;assert.equal(fact.native_cells[index],value);held(fact);}
  }
});

test('SYNTHETIC negative: exact TAIEX price-index name only; total-return, specials and duplicates cannot substitute', () => {
  for (const name of ['發行量加權股價報酬指數','發行量加權股價指數 ','臺灣50指數']) {
    const input = setup(); input.resources[2] = wrap('TAIEX_11555',[indexRow('2026-10-20',name)]);
    const out = normalize(input); assert.equal(out.benchmark.fact,null); assert.equal(out.counts.benchmark_facts,0);
  }
  for (const [field,value] of [[2,'--'],[3,'?'],[6,'合成特殊處理']]) {
    const input = setup(); input.resources[2] = rewrite(input.resources[2],(_h,rows) => { rows[0][field] = value; });
    assert.equal(normalize(input).benchmark.fact,null);
  }
  const input = setup(); input.resources[2] = wrap('TAIEX_11555',[indexRow(),indexRow()]);
  assert.throws(() => normalize(input),/DUPLICATE/);
});

test('SYNTHETIC negative: bounded resources/bytes/records, strict quoting, row widths and UTF8 fail closed', () => {
  const base = setup(); assert.throws(() => normalize({...base,resources:Array(5).fill(base.resources[0])}),/RESOURCE_LIMIT/);
  let input = setup(); input.resources[0].response_body = new Uint8Array(limits.bytes_per_resource + 1);
  assert.throws(() => normalize(input),/BYTE_LIMIT/);
  input = setup(); input.resources[0] = wrap('TWSE_11549',Array.from({length:limits.records_per_resource},() => stockRow('TWSE_11549','9999')));
  assert.throws(() => normalize(input),/RECORD_LIMIT/);
  input = setup(); input.resources[0] = rewrite(input.resources[0],(_h,rows) => { rows[0].pop(); });
  assert.throws(() => normalize(input),/ROW_WIDTH/);
  for (const bytes of [Buffer.from('"日期"x,代號\n'),Buffer.from('日"期,代號\n'),Buffer.from('"日期'),Buffer.from([0xff,0xfe,0x00])]) {
    input = setup(); const r = input.resources[0]; r.response_body = bytes; r.receipt.bytes = bytes.length; r.receipt.raw_sha256 = sha(bytes);
    assert.throws(() => normalize(input),/CSV_|UTF8/);
  }
});

test('SYNTHETIC: unchanged original V1 and retained-evidence alignment both refuse these unreviewed rows', async () => {
  const input = setup('2026-09-04',IDENTITY.generated_at);
  for (const r of input.resources) { r.receipt.first_seen_at = '2026-09-06T23:00:00Z'; r.receipt.available_at = '2026-09-06T23:00:01Z'; }
  const out = normalize(input), original = evidenceRows();
  original.quotes = original.quotes.filter(q => !['2330','2317','2382','TAIEX'].includes(q.symbol));
  const candidate = structuredClone(original); candidate.quotes.push(...out.data.quotes);
  assert.deepEqual(buildEvidenceDecision(candidate,IDENTITY),buildEvidenceDecision(original,IDENTITY));
  const aligned = await eventAlignmentFromRetainedEvidence(candidate,IDENTITY,await v2Hash(candidate));
  const baseline = await eventAlignmentFromRetainedEvidence(original,IDENTITY,await v2Hash(original));
  assert.deepEqual(aligned.decision,baseline.decision);
  assert(aligned.coverage.every(c => c.same_date.stock_close === 0 && c.same_date.stock_ohlcv_amount === 0 && c.same_date.taiex_close === 0));
  assert.equal(aligned.decision.phase_evaluation.ready_count,0);
  assert(out.data.quotes.every(q => q.quality_status === 'source_scope_unreviewed'));
  assert.deepEqual(out.data.universe,emptyEvidenceData().universe);
});

// Actual retained-source assertions are preserved in the controlled replay,
// not conditional CI skips or private paths in this public contract suite.
