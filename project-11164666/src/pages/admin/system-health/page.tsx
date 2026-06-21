import { useEffect, useState } from 'react';
import { fetchQAHealthDashboardData } from '@/services/qaHealthService';
import type { PredictionAccuracyLog, QAHealthDashboardData, SystemHealthLog } from '@/types/qaHealth';

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '尚無資料';
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
      ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
    }`}>
      {label}
    </span>
  );
}

function IssueBadge({ issue }: { issue: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 border border-red-100">
      {issue}
    </span>
  );
}

function EmptyState({ label = '尚無資料' }: { label?: string }) {
  return <div className="rounded-lg border border-dashed border-background-200 bg-background-50 p-5 text-sm text-foreground-400">{label}</div>;
}

function ScoreCard({ title, value, hint }: { title: string; value: number | null; hint?: string }) {
  const score = value ?? 0;
  const good = score >= 90;
  return (
    <section className={`rounded-xl border bg-white p-5 shadow-sm ${good ? 'border-emerald-200' : 'border-amber-200'}`}>
      <p className="text-sm text-foreground-500">{title}</p>
      <div className="mt-3 flex items-end gap-2">
        <span className={`text-4xl font-bold ${good ? 'text-emerald-600' : 'text-amber-600'}`}>{score}</span>
        <span className="mb-1 text-sm text-foreground-400">/100</span>
      </div>
      <p className={`mt-3 text-sm font-medium ${good ? 'text-emerald-700' : 'text-amber-700'}`}>
        {good ? '狀態正常，可進一步觀察 V8 條件' : '需要檢查缺失項目'}
      </p>
      {hint && <p className="mt-2 text-xs text-foreground-400">{hint}</p>}
    </section>
  );
}

function HealthLogTable({ rows }: { rows: SystemHealthLog[] }) {
  if (rows.length === 0) return <EmptyState />;
  return (
    <div className="overflow-x-auto rounded-xl border border-background-200 bg-white">
      <table className="min-w-full divide-y divide-background-100 text-sm">
        <thead className="bg-background-50 text-left text-xs font-semibold text-foreground-500">
          <tr>
            <th className="px-4 py-3">check_date</th>
            <th className="px-4 py-3">health_score</th>
            <th className="px-4 py-3">issues</th>
            <th className="px-4 py-3">created_at</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-background-100">
          {rows.map((row) => (
            <tr key={row.id || `${row.check_date}-${row.created_at}`}>
              <td className="px-4 py-3 font-medium text-foreground-800 whitespace-nowrap">{row.check_date || '尚無資料'}</td>
              <td className={`px-4 py-3 font-semibold ${row.health_score >= 90 ? 'text-emerald-600' : 'text-amber-600'}`}>{row.health_score}</td>
              <td className="px-4 py-3">
                {row.issues.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">{row.issues.map((issue) => <IssueBadge key={issue} issue={issue} />)}</div>
                ) : (
                  <span className="text-foreground-400">無</span>
                )}
              </td>
              <td className="px-4 py-3 text-foreground-500 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PredictionTable({ rows }: { rows: PredictionAccuracyLog[] }) {
  if (rows.length === 0) return <EmptyState />;
  return (
    <div className="overflow-x-auto rounded-xl border border-background-200 bg-white">
      <table className="min-w-full divide-y divide-background-100 text-sm">
        <thead className="bg-background-50 text-left text-xs font-semibold text-foreground-500">
          <tr>
            <th className="px-4 py-3">report_date</th>
            <th className="px-4 py-3">predicted_bias</th>
            <th className="px-4 py-3">confidence</th>
            <th className="px-4 py-3">actual_direction</th>
            <th className="px-4 py-3">prediction_result</th>
            <th className="px-4 py-3">accuracy_score</th>
            <th className="px-4 py-3">created_at</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-background-100">
          {rows.map((row) => (
            <tr key={row.id || `${row.report_date}-${row.created_at}`}>
              <td className="px-4 py-3 font-medium text-foreground-800 whitespace-nowrap">{row.report_date || '尚無資料'}</td>
              <td className="px-4 py-3 text-foreground-600 whitespace-nowrap">{row.predicted_bias || '尚無資料'}</td>
              <td className="px-4 py-3 text-foreground-600">{row.confidence ?? '尚無資料'}</td>
              <td className="px-4 py-3 text-foreground-600 whitespace-nowrap">{row.actual_direction || '尚無資料'}</td>
              <td className="px-4 py-3 text-foreground-600 whitespace-nowrap">{row.prediction_result || '尚無資料'}</td>
              <td className="px-4 py-3 text-foreground-600">{row.accuracy_score ?? '尚無資料'}</td>
              <td className="px-4 py-3 text-foreground-500 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SystemHealthDashboard() {
  const [data, setData] = useState<QAHealthDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchQAHealthDashboardData());
    } catch (err) {
      setError(err instanceof Error ? err.message : '讀取 P4 健康資料失敗');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const latest = data?.latestHealthLog || null;
  const report = data?.latestReport || null;
  const issues = latest?.issues || [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground-900">P4 Health Dashboard</h1>
          <p className="mt-1 text-sm text-foreground-500">檢查每日 QA Engine、預測驗證與最新 Morning Alpha 報告狀態。</p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center justify-center rounded-lg border border-background-200 bg-white px-4 py-2 text-sm font-medium text-foreground-700 hover:bg-background-50"
        >
          重新整理
        </button>
      </header>

      {loading && <EmptyState label="載入 P4 健康資料中..." />}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <ScoreCard title="今日 Health Score" value={latest?.health_score ?? null} hint={`最新 check_date：${latest?.check_date || '尚無資料'}`} />

            <section className="rounded-xl border border-background-200 bg-white p-5 shadow-sm lg:col-span-2">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm text-foreground-500">V8 Gate</p>
                  <p className={`mt-2 text-xl font-bold ${data?.canEnterV8 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {data?.canEnterV8 ? 'can_enter_v8 = true' : 'can_enter_v8 = false'}
                  </p>
                  <p className="mt-2 text-xs text-foreground-400">
                    條件：health_score >= 90、report_date 正確、member_research_note_v2 存在，且沒有阻塞 issues。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge ok={latest?.has_member_note_v2 === true} label="member_research_note_v2" />
                  <StatusBadge ok={latest?.has_opening_radar === true} label="opening_radar" />
                  <StatusBadge ok={latest?.has_sector_rotation === true} label="sector_rotation" />
                  <StatusBadge ok={latest?.has_closing_verification === true} label="closing_verification" />
                </div>
              </div>
              <div className="mt-4">
                {issues.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">{issues.map((issue) => <IssueBadge key={issue} issue={issue} />)}</div>
                ) : (
                  <span className="text-sm text-foreground-400">issues：無</span>
                )}
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-background-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-foreground-900">最新 reports 狀態</h2>
            {report ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatusLine label="report_date" value={report.report_date || '尚無資料'} />
                <StatusLine label="market_bias" value={report.market_bias || '尚無資料'} />
                <StatusLine label="confidence_score" value={report.confidence_score ?? '尚無資料'} />
                <StatusLine label="member_note_v2 data_status" value={report.member_research_note_v2_data_status || '尚無資料'} />
                <StatusBadge ok={report.has_member_research_note_v2} label="has member_research_note_v2" />
                <StatusBadge ok={report.has_v8_beneficiary_chain} label="has v8_beneficiary_chain" />
                <StatusBadge ok={report.has_v8_overnight_causal_chain} label="has v8_overnight_causal_chain" />
                <StatusBadge ok={report.has_v8_daily_sentence} label="has v8_daily_sentence" />
              </div>
            ) : (
              <div className="mt-4"><EmptyState /></div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground-900">最近 10 筆 system_health_logs</h2>
            <HealthLogTable rows={data?.healthLogs || []} />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground-900">最近 10 筆 prediction_accuracy_logs</h2>
            <PredictionTable rows={data?.predictionLogs || []} />
          </section>
        </>
      )}
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-background-100 bg-background-50 p-3">
      <p className="text-xs text-foreground-400">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-foreground-800">{value}</p>
    </div>
  );
}
