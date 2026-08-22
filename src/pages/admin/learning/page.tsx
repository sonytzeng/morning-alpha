import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type UnknownRecord = Record<string, unknown>;

type LearningCenterPayload = {
  today_date: string;
  generated_at: string;
  today: {
    predictions: number;
    completed_outcomes: number;
    correct: number;
    incorrect: number;
    inconclusive: number;
    new_error_cases: number;
    new_success_cases: number;
    rule_candidates: number;
    backtests_running: number;
    shadow_rules: number;
    data_quality_problems: number;
  };
  metrics: {
    accuracy_30d: number | null;
    accuracy_90d: number | null;
    confidence_calibration_gap_90d: number | null;
    taiwan_mapping_accuracy_90d: number | null;
    price_in_error_rate_90d: number | null;
    direction_accuracy_90d: number | null;
    high_confidence_accuracy_90d: number | null;
    data_completeness_rate: number | null;
  };
  calibration: UnknownRecord[];
  trend: UnknownRecord[];
  latest_run: UnknownRecord | null;
  recent_runs: UnknownRecord[];
  recent_reviews: UnknownRecord[];
  recent_error_cases: UnknownRecord[];
  recent_success_cases: UnknownRecord[];
  top_patterns: UnknownRecord[];
  rules: UnknownRecord[];
  backtests: UnknownRecord[];
};

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function percent(value: unknown): string {
  const numeric = number(value);
  if (numeric === null) return '資料累積中';
  const normalized = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return `${normalized.toFixed(1)}%`;
}

function statusLabel(value: unknown): string {
  const labels: Record<string, string> = {
    running: '執行中', succeeded: '完成', degraded: '降級完成', failed: '失敗', skipped: '略過',
    candidate: '候選規則', backtesting: '回測中', eligible_shadow: '可進入影子測試', shadow: '影子測試',
    rejected: '已拒絕', production: '正式規則', archived: '已封存',
    correct: '正確', incorrect: '錯誤', partial: '部分成立', inconclusive: '無法判定',
  };
  return labels[String(value || '')] || text(value);
}

function MetricCard({ label, value, note, tone = 'neutral' }: {
  label: string;
  value: string | number;
  note?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneClass = tone === 'good'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : tone === 'bad'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-slate-200 bg-white text-slate-800';
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-65">{label}</p>
      <p className="mt-2 text-2xl font-bold leading-none">{value}</p>
      {note && <p className="mt-2 text-xs opacity-70">{note}</p>}
    </div>
  );
}

function MiniTrend({ rows }: { rows: UnknownRecord[] }) {
  const points = rows.map((row) => number(row.accuracy)).filter((value): value is number => value !== null);
  if (points.length < 2) {
    return <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">至少需要兩個有效評估日才能顯示趨勢。</div>;
  }
  return (
    <div className="flex h-28 items-end gap-1 rounded-xl border border-slate-200 bg-white p-4" aria-label="近 30 日方向正確率趨勢">
      {points.map((point, index) => (
        <div key={`${point}-${index}`} className="flex min-w-0 flex-1 items-end" title={`${(point * 100).toFixed(1)}%`}>
          <div
            className="w-full rounded-t bg-slate-800/80"
            style={{ height: `${Math.max(4, Math.min(100, point * 100))}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="grid min-h-[40vh] place-items-center rounded-2xl border border-slate-200 bg-white">
      <div className="text-center text-sm text-slate-500">
        <i className="ri-loader-4-line mb-2 block animate-spin text-2xl" />
        正在讀取內部學習資料
      </div>
    </div>
  );
}

export default function AdminLearningCenter() {
  const [payload, setPayload] = useState<LearningCenterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [sessionRedirectUrl, setSessionRedirectUrl] = useState('');
  const [sessionRestoreMessage, setSessionRestoreMessage] = useState('');
  const [restoringSession, setRestoringSession] = useState(false);
  const [promotionRuleId, setPromotionRuleId] = useState('');
  const [promotionReason, setPromotionReason] = useState('');
  const [promotionMessage, setPromotionMessage] = useState('');
  const [promoting, setPromoting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setAuthRequired(false);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setAuthRequired(true);
      setLoading(false);
      return;
    }
    const { data, error: invokeError } = await supabase.functions.invoke('get-learning-center', {
      body: {},
    });
    if (invokeError || !data?.success) {
      const code = String(data?.error || invokeError?.message || 'LEARNING_CENTER_LOAD_FAILED');
      if (['ADMIN_REQUIRED', 'INVALID_SESSION', 'AUTHENTICATION_REQUIRED'].includes(code)) setAuthRequired(true);
      else setError(code);
      setLoading(false);
      return;
    }
    setPayload(data as LearningCenterPayload);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restoreSessionFromRedirectUrl = async (redirectUrl = sessionRedirectUrl) => {
    setSessionRestoreMessage('');
    const rawUrl = redirectUrl.trim();
    if (!rawUrl) {
      setSessionRestoreMessage('請先貼上瀏覽器目前顯示的完整 localhost 網址。');
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      setSessionRestoreMessage('這不是有效的登入網址，請重新複製完整網址。');
      return;
    }

    const allowedOrigins = new Set(['http://localhost:3000', 'https://morningalphatw.com']);
    if (!allowedOrigins.has(parsedUrl.origin)) {
      setSessionRestoreMessage('基於安全考量，只接受 Morning Alpha 或 localhost 的登入回傳網址。');
      return;
    }

    const fragment = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    if (!accessToken || !refreshToken) {
      setSessionRestoreMessage('網址中沒有完整登入憑證；請先點最新登入信，再複製 localhost 頁面的完整網址。');
      return;
    }

    setRestoringSession(true);
    setSessionRedirectUrl('');
    const { data, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError || !data.session) {
      setSessionRestoreMessage('登入連結已失效，請使用最新收到的登入信再試一次。');
      setRestoringSession(false);
      return;
    }

    setSessionRestoreMessage('登入成功，正在載入 Learning Center。');
    setRestoringSession(false);
    await load();
  };

  const restoreSessionFromClipboard = async () => {
    try {
      const clipboardUrl = await navigator.clipboard.readText();
      setSessionRedirectUrl(clipboardUrl);
      await restoreSessionFromRedirectUrl(clipboardUrl);
    } catch {
      setSessionRestoreMessage('瀏覽器未允許讀取剪貼簿，請改用下方欄位貼上完整網址。');
    }
  };

  const promoteRule = async () => {
    if (!promotionRuleId || promotionReason.trim().length < 20) {
      setPromotionMessage('升級理由至少需要 20 個字元。');
      return;
    }
    setPromoting(true);
    setPromotionMessage('');
    const { data, error: invokeError } = await supabase.functions.invoke('get-learning-center', {
      body: { action: 'promote_rule', rule_id: promotionRuleId, reason: promotionReason.trim() },
    });
    if (invokeError || !data?.success) {
      setPromotionMessage(String(data?.error || invokeError?.message || 'LEARNING_RULE_PROMOTION_FAILED'));
      setPromoting(false);
      return;
    }
    setPromotionRuleId('');
    setPromotionReason('');
    setPromotionMessage('規則已升級；下一次晨報只會讀取 production 狀態的規則。');
    setPromoting(false);
    await load();
  };

  const runStatus = String(payload?.latest_run?.status || '');
  const runTone = runStatus === 'succeeded' ? 'good' : runStatus === 'failed' ? 'bad' : 'warn';
  const calibrationRows = useMemo(() => payload?.calibration || [], [payload]);

  if (loading) return <LoadingPanel />;

  if (authRequired) {
    return (
      <section className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">管理員限定</p>
        <h1 className="mt-2 text-xl font-bold">Learning Center 沒有對一般會員開放</h1>
        <p className="mt-3 text-sm leading-6 text-amber-900/80">
          這裡包含 Prediction、Error Case、Rule Candidate、Backtest 與內部校準資料。請先建立有效的 Supabase Auth 管理員 Session，且 profiles.role 必須是 admin。
        </p>

        <div className="mt-6 rounded-xl border border-amber-300 bg-white/70 p-4">
          <h2 className="text-base font-bold">登入信開到 localhost 時</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-amber-900/80">
            <li>在 localhost 錯誤頁按 ⌘L，再按 ⌘C 複製完整網址。</li>
            <li>回到這一頁，按下方按鈕即可完成登入。</li>
          </ol>
          <button
            type="button"
            onClick={() => void restoreSessionFromClipboard()}
            disabled={restoringSession}
            className="mt-4 w-full rounded-lg bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-wait disabled:opacity-60"
          >
            {restoringSession ? '正在驗證登入連結…' : '從剪貼簿完成登入'}
          </button>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-amber-900">無法讀取剪貼簿時，改為手動貼上</summary>
            <label className="mt-3 block text-xs font-semibold text-amber-800" htmlFor="session-redirect-url">
              完整 localhost 網址
            </label>
            <input
              id="session-redirect-url"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={sessionRedirectUrl}
              onChange={(event) => setSessionRedirectUrl(event.target.value)}
              placeholder="http://localhost:3000/#access_token=…"
              className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-600"
            />
            <button
              type="button"
              onClick={() => void restoreSessionFromRedirectUrl()}
              disabled={restoringSession}
              className="mt-3 rounded-lg border border-amber-800 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
            >
              使用這個連結登入
            </button>
          </details>

          {sessionRestoreMessage && (
            <p className="mt-3 text-sm font-semibold" role="status" aria-live="polite">
              {sessionRestoreMessage}
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-amber-800/70">
            登入網址只在此瀏覽器內用來建立 Session，不會寫入 Morning Alpha 資料庫或操作紀錄。
          </p>
        </div>
      </section>
    );
  }

  if (error || !payload) {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
        <h1 className="text-lg font-bold">Learning Center 讀取失敗</h1>
        <p className="mt-2 text-sm">{error || '沒有收到有效資料'}</p>
        <button type="button" onClick={() => void load()} className="mt-4 rounded-lg bg-rose-900 px-4 py-2 text-sm font-semibold text-white">
          重新讀取
        </button>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 text-slate-900">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Morning Alpha Internal</p>
          <h1 className="mt-1 text-2xl font-bold">Learning Center</h1>
          <p className="mt-2 text-sm text-slate-500">今天學到了什麼，以及長期決策品質有沒有進步。</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <i className="ri-refresh-line mr-1" />重新整理
        </button>
      </header>

      <section>
        <h2 className="mb-3 text-base font-bold">今天學到了什麼？</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <MetricCard label="Predictions" value={payload.today.predictions} />
          <MetricCard label="完成 Outcomes" value={payload.today.completed_outcomes} tone="good" />
          <MetricCard label="正確／錯誤" value={`${payload.today.correct}／${payload.today.incorrect}`} tone={payload.today.incorrect > payload.today.correct ? 'warn' : 'good'} />
          <MetricCard label="無法判定" value={payload.today.inconclusive} />
          <MetricCard label="錯誤／成功案例" value={`${payload.today.new_error_cases}／${payload.today.new_success_cases}`} />
          <MetricCard label="資料品質問題" value={payload.today.data_quality_problems} tone={payload.today.data_quality_problems > 0 ? 'bad' : 'good'} />
          <MetricCard label="Rule Candidates" value={payload.today.rule_candidates} />
          <MetricCard label="Backtests" value={payload.today.backtests_running} />
          <MetricCard label="Shadow Rules" value={payload.today.shadow_rules} />
          <MetricCard label="最近 Learning Run" value={statusLabel(runStatus)} tone={runTone} note={text(payload.latest_run?.run_date)} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-bold">長期有沒有真的進步？</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="30D Accuracy" value={percent(payload.metrics.accuracy_30d)} />
          <MetricCard label="90D Accuracy" value={percent(payload.metrics.accuracy_90d)} />
          <MetricCard label="高信心命中率" value={percent(payload.metrics.high_confidence_accuracy_90d)} />
          <MetricCard label="Confidence Gap" value={percent(payload.metrics.confidence_calibration_gap_90d)} tone={Math.abs(payload.metrics.confidence_calibration_gap_90d || 0) > 0.15 ? 'warn' : 'neutral'} />
          <MetricCard label="台股映射正確率" value={percent(payload.metrics.taiwan_mapping_accuracy_90d)} />
          <MetricCard label="Price-in Error" value={percent(payload.metrics.price_in_error_rate_90d)} />
          <MetricCard label="Direction Accuracy" value={percent(payload.metrics.direction_accuracy_90d)} />
          <MetricCard label="資料完整率" value={percent(payload.metrics.data_completeness_rate)} />
        </div>
        <div className="mt-4">
          <MiniTrend rows={payload.trend} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold">Confidence Calibration</h2>
          <div className="mt-4 space-y-3">
            {calibrationRows.length === 0 && <p className="text-sm text-slate-500">尚未累積足夠樣本。</p>}
            {calibrationRows.map((row) => (
              <div key={String(row.bucket)} className="grid grid-cols-[90px_1fr_auto] items-center gap-3 text-sm">
                <span className="font-semibold text-slate-600">{text(row.bucket)}</span>
                <div className="h-2 overflow-hidden rounded bg-slate-100">
                  <div className="h-full rounded bg-slate-800" style={{ width: `${Math.max(0, Math.min(100, (number(row.accuracy) || 0) * 100))}%` }} />
                </div>
                <span className="tabular-nums text-slate-500">{percent(row.accuracy)} · n={number(row.sample_size) || 0}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold">最近 Review</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {payload.recent_reviews.length === 0 && <p className="py-3 text-sm text-slate-500">今日尚未產生 Review。</p>}
            {payload.recent_reviews.map((row) => (
              <div key={String(row.id)} className="grid grid-cols-[70px_90px_1fr] gap-3 py-3 text-sm">
                <span className="font-mono text-xs text-slate-500">{text(row.symbol)}</span>
                <span className={row.review_result === 'incorrect' ? 'font-semibold text-rose-700' : 'font-semibold text-emerald-700'}>{statusLabel(row.review_result)}</span>
                <span className="truncate text-slate-600" title={text(row.lesson)}>{text(row.lesson)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-rose-100 bg-white p-5">
          <h2 className="font-bold text-rose-900">最近 Error Cases</h2>
          <div className="mt-3 space-y-3">
            {payload.recent_error_cases.length === 0 && <p className="text-sm text-slate-500">尚無可信錯誤案例。</p>}
            {payload.recent_error_cases.map((row) => (
              <article key={String(row.id)} className="rounded-xl bg-rose-50 p-3">
                <p className="text-sm font-bold text-rose-900">{text(row.title)}</p>
                <p className="mt-1 text-xs leading-5 text-rose-900/70">{text(row.lesson)}</p>
              </article>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white p-5">
          <h2 className="font-bold text-emerald-900">最近 Success Cases</h2>
          <div className="mt-3 space-y-3">
            {payload.recent_success_cases.length === 0 && <p className="text-sm text-slate-500">尚無可信成功案例。</p>}
            {payload.recent_success_cases.map((row) => (
              <article key={String(row.id)} className="rounded-xl bg-emerald-50 p-3">
                <p className="text-sm font-bold text-emerald-900">{text(row.title)}</p>
                <p className="mt-1 text-xs leading-5 text-emerald-900/70">{text(row.lesson)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold">Rule Candidate／Backtest</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">AI 不可直接 Promotion Production Rule</span>
        </div>
        {promotionRuleId && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <label htmlFor="learning-rule-promotion-reason" className="text-sm font-bold text-amber-950">Production 升級理由</label>
            <p className="mt-1 text-xs leading-5 text-amber-900/70">升級仍會由資料庫再次驗證：OOS 回測通過、Shadow 完成且樣本至少 10 筆、目前使用者為 admin。</p>
            <textarea
              id="learning-rule-promotion-reason"
              value={promotionReason}
              onChange={(event) => setPromotionReason(event.target.value)}
              rows={3}
              className="mt-3 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
              placeholder="說明為何此規則可影響正式晨報，以及已檢查的風險。"
            />
            <div className="mt-3 flex items-center gap-2">
              <button type="button" disabled={promoting} onClick={() => void promoteRule()} className="rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {promoting ? '升級中…' : '確認升級'}
              </button>
              <button type="button" disabled={promoting} onClick={() => { setPromotionRuleId(''); setPromotionReason(''); setPromotionMessage(''); }} className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900">
                取消
              </button>
            </div>
          </div>
        )}
        {promotionMessage && <p className="mt-3 text-sm text-slate-600" role="status">{promotionMessage}</p>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2 pr-4">規則</th><th className="py-2 pr-4">狀態</th><th className="py-2 pr-4">Shadow</th><th className="py-2 pr-4">Hypothesis</th><th className="py-2">治理動作</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payload.rules.length === 0 && <tr><td colSpan={5} className="py-5 text-center text-slate-500">尚無規則候選。</td></tr>}
              {payload.rules.map((row) => (
                <tr key={String(row.id)}>
                  <td className="py-3 pr-4 font-semibold">{text(row.name)}</td>
                  <td className="py-3 pr-4">{statusLabel(row.status)}</td>
                  <td className="py-3 pr-4 tabular-nums">{number(row.shadow_sample_size) || 0} / 10</td>
                  <td className="py-3 pr-4 text-slate-600">{text(row.hypothesis)}</td>
                  <td className="py-3">
                    {row.status === 'shadow' && row.shadow_completed_at ? (
                      <button type="button" onClick={() => { setPromotionRuleId(String(row.id)); setPromotionReason(''); setPromotionMessage(''); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                        審查並升級
                      </button>
                    ) : <span className="text-xs text-slate-400">門檻未完成</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
