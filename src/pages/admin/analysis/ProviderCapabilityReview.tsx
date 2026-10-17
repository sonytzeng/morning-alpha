import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

const EXPIRES_AT = Date.parse('2026-10-18T06:00:00Z');
const DEADLINE_MS = 15_000;
const UNCERTAIN = '結果不確定，請勿重試';
const PROBE_LABELS: Record<string, string> = {
  BOUNDED_DIAGNOSTIC_COMPLETE_EXTERNAL_BLOCKED: '限定診斷已完成，外部條件仍未證明',
  OBSERVED_ONLY: '僅觀察到回應，外部條件仍未證明',
  BLOCKED_INPUT: UNCERTAIN, BLOCKED_CONFIGURATION: UNCERTAIN, BLOCKED_CREDENTIAL: UNCERTAIN,
  BATCH_DEADLINE: UNCERTAIN, CLOCK_INVALID: UNCERTAIN, CALL_TIMEOUT: UNCERTAIN,
  AMBIGUOUS_RESPONSE: UNCERTAIN, HTTP_STOP: UNCERTAIN, BODY_LIMIT: UNCERTAIN,
  ROW_LIMIT: UNCERTAIN, NETWORK_OR_AMBIGUOUS: UNCERTAIN,
};
const OBSERVATION_LABELS = {
  BATCH_DEADLINE: '整批期限已到', CLOCK_INVALID: '時間無法確認', CALL_TIMEOUT: '單項檢查逾時',
  AMBIGUOUS_RESPONSE: '回應無法確認', HTTP_STOP: 'HTTP 回應中止檢查', BODY_LIMIT: '回應大小超限',
  ROW_LIMIT: '資料列超限', NETWORK_OR_AMBIGUOUS: '連線或回應無法確認', OBSERVED_ONLY: '僅觀察到回應',
} as const;
const SHAPE_LABELS = {
  SEARCH_ROWS: '搜尋結果（映射未證明）', EMPTY: '沒有資料（不代表零值或不支援）',
  QUARTERLY_ESTIMATE_ROWS: '季度估計資料（完整性未證明）', AMBIGUOUS: '格式無法確認', ROW_LIMIT: '資料列超限',
} as const;
const ENDPOINT_LABELS = { search: '股票搜尋', eps: '每股盈餘估計', revenue: '營收估計' } as const;
const PLAN = [
  { local_symbol: '2330', endpoint: 'search' }, { local_symbol: '2330', endpoint: 'eps' },
  { local_symbol: '2330', endpoint: 'revenue' }, { local_symbol: '6488', endpoint: 'search' },
  { local_symbol: '6488', endpoint: 'eps' }, { local_symbol: '6488', endpoint: 'revenue' },
] as const;
type SafeObservation = { symbol: typeof PLAN[number]['local_symbol']; endpoint: typeof PLAN[number]['endpoint'];
  http: number | null; status: keyof typeof OBSERVATION_LABELS; shape: keyof typeof SHAPE_LABELS | null;
  rows: number; quarters: number };
type SafeSummary = { label: string; calls: number; observed: number; rows: number; quarters: number; observations: SafeObservation[] };
type View = { kind: 'idle' | 'running' | 'uncertain' | 'cleared' } | { kind: 'result'; summary: SafeSummary };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const expiredAt = (now: number) => !Number.isFinite(now) || now >= EXPIRES_AT;

// Validate the backend's exact safe projection, then copy only fixed plan
// identities/classifications and bounded counts. Never retain raw metadata.
// Backend Auth + Owner RPC, not this UI, grants access.
function safeSummary(value: unknown): SafeSummary | null {
  if (!record(value) || !exactKeys(value, ['status', 'candidate_only', 'formal_admission', 'member_publication',
    'business_writes', 'control_object_write', 'summary'])
    || value.status !== 'DIAGNOSTIC_ONLY' || value.candidate_only !== true
    || value.formal_admission !== false || value.member_publication !== false
    || value.business_writes !== 0 || value.control_object_write !== 'CONSUMED') return null;
  const s = value.summary;
  if (!record(s) || !exactKeys(s, ['probe_status', 'calls', 'observed_responses', 'row_count', 'quarter_count',
    'observations', 'symbol_mapping', 'tw72_coverage', 'current_entitlement', 'historical_vintage',
    'commercial_member_reuse_rights', 'average_provenance', 'pure_broker_consensus'])
    || typeof s.probe_status !== 'string' || !Object.hasOwn(PROBE_LABELS, s.probe_status)
    || !count(s.calls, 6) || !count(s.observed_responses, s.calls)
    || !count(s.row_count, 384) || s.row_count > s.calls * 64
    || !count(s.quarter_count, 384) || s.quarter_count > s.calls * 64
    || s.symbol_mapping !== 'HYPOTHESIS_UNVERIFIED' || s.tw72_coverage !== 'UNKNOWN'
    || s.current_entitlement !== 'UNPROVEN' || s.historical_vintage !== 'UNPROVEN'
    || s.commercial_member_reuse_rights !== 'UNPROVEN'
    || s.average_provenance !== 'FINNHUB_AVERAGE_INCLUDING_PROPRIETARY'
    || s.pure_broker_consensus !== false || !Array.isArray(s.observations)
    || s.observations.length !== s.calls) return null;
  const observations: SafeObservation[] = [];
  let rows = 0, quarters = 0, observed = 0;
  for (let index = 0; index < s.observations.length; index++) {
    const item = s.observations[index], expected = PLAN[index];
    if (!record(item) || !exactKeys(item, ['local_symbol', 'endpoint', 'http_status', 'status', 'shape',
      'row_count', 'quarter_count', 'accepted_bytes'])
      || item.local_symbol !== expected.local_symbol || item.endpoint !== expected.endpoint
      || (item.http_status !== null && (!count(item.http_status, 599) || item.http_status < 100))
      || typeof item.status !== 'string' || !Object.hasOwn(OBSERVATION_LABELS, item.status)
      || (item.shape !== null && (typeof item.shape !== 'string' || !Object.hasOwn(SHAPE_LABELS, item.shape)))
      || !count(item.row_count, 64) || !count(item.quarter_count, 64)
      || !count(item.accepted_bytes, 65536)) return null;
    rows += item.row_count; quarters += item.quarter_count;
    if (item.status === 'OBSERVED_ONLY') observed++;
    observations.push({ symbol: expected.local_symbol, endpoint: expected.endpoint,
      http: item.http_status as number | null, status: item.status as SafeObservation['status'],
      shape: item.shape as SafeObservation['shape'], rows: item.row_count, quarters: item.quarter_count });
  }
  if (rows !== s.row_count || quarters !== s.quarter_count || observed !== s.observed_responses) return null;
  return { label: PROBE_LABELS[s.probe_status], calls: s.calls, observed: s.observed_responses,
    rows: s.row_count, quarters: s.quarter_count, observations };
}

export default function ProviderCapabilityReview() {
  const claimed = useRef(false);
  const lifecycle = useRef({ active: false, invalidated: false, generation: 0 });
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expired, setExpired] = useState(() => expiredAt(Date.now()));
  const [view, setView] = useState<View>({ kind: 'idle' });

  useEffect(() => {
    const life = lifecycle.current;
    life.active = true;
    const clear = () => {
      if (!life.active) return;
      life.invalidated = true; life.generation += 1;
      if (requestTimer.current !== null) clearTimeout(requestTimer.current);
      requestTimer.current = null;
      setView({ kind: 'cleared' });
    };
    const { data: auth } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') clear();
    });
    const expire = () => { if (life.active) { clear(); setExpired(true); } };
    const now = Date.now();
    const expiryTimer = setTimeout(expire, expiredAt(now) ? 0 : EXPIRES_AT - now);
    return () => {
      life.active = false; life.generation += 1;
      if (requestTimer.current !== null) clearTimeout(requestTimer.current);
      requestTimer.current = null;
      clearTimeout(expiryTimer); auth.subscription.unsubscribe();
    };
  }, []);

  const run = async () => {
    const life = lifecycle.current;
    if (claimed.current || !life.active || life.invalidated) return;
    const startedAt = Date.now();
    if (expiredAt(startedAt)) { setExpired(true); setView({ kind: 'cleared' }); return; }
    // Synchronous claim precedes invoke: double clicks/ambiguous errors never
    // retry. The server's durable once marker remains the global authority.
    claimed.current = true;
    const generation = life.generation;
    let settled = false;
    const current = () => !settled && life.active && !life.invalidated
      && generation === life.generation && !expiredAt(Date.now());
    setView({ kind: 'running' });
    requestTimer.current = setTimeout(() => {
      if (!current()) return;
      settled = true; requestTimer.current = null; setView({ kind: 'uncertain' });
    }, DEADLINE_MS);
    try {
      // The pinned browser SDK has no invoke AbortSignal option. Do not replace
      // the shared client or read tokens; ignore all late/invalidated results.
      const { data, error } = await supabase.functions.invoke('v1-provider-capability-review-v1', { body: {} });
      if (!current()) return;
      const elapsed = Date.now() - startedAt;
      const summary = error === null && elapsed >= 0 && elapsed < DEADLINE_MS ? safeSummary(data) : null;
      settled = true;
      if (requestTimer.current !== null) clearTimeout(requestTimer.current);
      requestTimer.current = null;
      setView(summary ? { kind: 'result', summary } : { kind: 'uncertain' });
    } catch {
      if (!current()) return;
      settled = true;
      if (requestTimer.current !== null) clearTimeout(requestTimer.current);
      requestTimer.current = null; setView({ kind: 'uncertain' });
    }
  };

  return <section className="mt-4 space-y-3 text-sm" aria-label="Owner 資料能力檢查候選">
    <p>僅限 Owner 的短期診斷候選，待具名核准後使用，不是會員功能。最多6次 GET／整批15秒；只建立私有一次性標記，不改業務資料、不公開研究。</p>
    <p>到期：2026-10-18T06:00:00Z。只可手動執行一次；無論成功或失敗都不提供重試。</p>
    <button type="button" className="min-h-11 rounded-lg border px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      disabled={expired || view.kind !== 'idle'} onClick={() => { void run(); }}>執行一次資料能力檢查</button>
    <div role="status" aria-live="polite">
      {expired ? <p>此診斷候選已到期，無法執行。</p>
        : view.kind === 'running' ? <p>檢查中，請勿重複操作。</p>
          : view.kind === 'uncertain' ? <p>{UNCERTAIN}</p>
            : view.kind === 'cleared' ? <p>登入身分已變更，結果已清除。</p>
              : view.kind === 'result' ? <>
                <p>{view.summary.label}</p>
                <dl className="mt-2 grid grid-cols-2 gap-2">
                  <div><dt>已呼叫次數</dt><dd>{view.summary.calls}／6</dd></div>
                  <div><dt>已觀察回應</dt><dd>{view.summary.observed}／6</dd></div>
                  <div><dt>資料列總數</dt><dd>{view.summary.rows}／384</dd></div>
                  <div><dt>季度欄位計數</dt><dd>{view.summary.quarters}／384</dd></div>
                </dl>
                <details className="mt-3 rounded-lg border p-3">
                  <summary className="cursor-pointer font-semibold">各項檢查結果</summary>
                  {view.summary.observations.length === 0 ? <p className="mt-2">尚無可列出的檢查結果。</p>
                    : <ol className="mt-3 space-y-3">{view.summary.observations.map(item => <li key={`${item.symbol}:${item.endpoint}`}>
                      <p>{item.symbol} {ENDPOINT_LABELS[item.endpoint]}：HTTP{item.http === null ? '未取得' : item.http}／
                        {item.http === 401 || item.http === 403 ? '權限拒絕'
                          : item.http === 429 ? '呼叫額度受限' : OBSERVATION_LABELS[item.status]}</p>
                      <p>資料分類：{item.shape === null ? '未確認' : SHAPE_LABELS[item.shape]}；列數 {item.rows}；季度欄位計數 {item.quarters}</p>
                    </li>)}</ol>}
                </details>
              </> : null}
    </div>
    <p>股票映射、TW72覆蓋、目前權限、商用／會員使用權及歷史 vintage 仍未證明。平均估計含供應商自有預估，不是已證明的純券商共識；季度計數不代表連續四季完整。</p>
    <p>實際 API 200 也不代表 V1 完整、來源准入或可向會員發布；前端不授權，仍由後端 API／RLS 與 Owner 檢查決定存取。</p>
  </section>;
}
