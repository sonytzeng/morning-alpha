import { useState, useEffect } from 'react';
import { fetchEngagementMetrics, fetchEarlyAccessSignups, getContentProductSignal, type EngagementMetrics, type EarlyAccessSignup } from '@/services/engagementService';

const USER_TYPE_LABELS: Record<string, string> = {
  daily_trader: '每天看盤',
  occasional_trader: '偶爾看盤',
  premarket_reader: '想看盤前整理',
  reels_line_interested: '對 Reels / LINE 推播有興趣',
};

const INTEREST_LABELS: Record<string, string> = {
  daily_summary: '每日盤前摘要',
  member_notebook: '會員完整研究筆記',
  reels_script: 'Reels 60 秒腳本',
  line_reminder: 'LINE 盤前提醒',
  close_review: '收盤驗證',
};

export default function AdminGrowth() {
  const [metrics, setMetrics] = useState<EngagementMetrics | null>(null);
  const [signups, setSignups] = useState<EarlyAccessSignup[]>([]);
  const [signupTotal, setSignupTotal] = useState(0);
  const [signupPage, setSignupPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [m, s] = await Promise.all([
          fetchEngagementMetrics(),
          fetchEarlyAccessSignups(1, 50),
        ]);
        setMetrics(m);
        setSignups(s.signups);
        setSignupTotal(s.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : '讀取資料失敗');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const loadSignups = async (page: number) => {
    const s = await fetchEarlyAccessSignups(page, 50);
    setSignups(s.signups);
    setSignupTotal(s.total);
    setSignupPage(page);
  };

  const filteredSignups = search.trim()
    ? signups.filter((s) => {
        const term = search.toLowerCase();
        return (
          (s.email && s.email.toLowerCase().includes(term)) ||
          (s.line_name && s.line_name.toLowerCase().includes(term))
        );
      })
    : signups;

  const totalPages = Math.ceil(signupTotal / 50);

  const productSignal = getContentProductSignal(metrics);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          <p className="text-foreground-500 text-sm">載入中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-center">
        <i className="ri-error-warning-line text-red-400 text-xl mb-2 block"></i>
        <p className="text-red-600 text-sm font-medium mb-1">讀取失敗</p>
        <p className="text-foreground-500 text-xs">{error}</p>
      </div>
    );
  }

  const hasData = metrics && (metrics.total_home_views > 0 || metrics.total_report_views > 0 || metrics.early_access_signups > 0);

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-foreground-900 font-bold text-lg">用戶回訪與早鳥意願</h1>
        <p className="text-foreground-500 text-sm mt-0.5">
          最近 7 天真實互動數據。沒有真資料就不顯示假數字。
        </p>
      </div>

      {/* ── Product Signal ── */}
      <div className={`rounded-xl border p-5 ${hasData ? 'bg-white border-background-200' : 'bg-foreground-500/5 border-foreground-500/10'}`}>
        <h3 className="text-foreground-900 font-semibold text-sm mb-3">今日產品訊號</h3>
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            productSignal.colorClass === 'text-emerald-600' ? 'bg-emerald-500/10 border border-emerald-500/20' :
            productSignal.colorClass === 'text-amber-600' ? 'bg-amber-500/10 border border-amber-500/20' :
            'bg-foreground-500/10 border border-foreground-500/20'
          }`}>
            <i className={`${productSignal.icon} ${productSignal.colorClass} text-sm`}></i>
          </div>
          <div>
            <p className={`text-sm font-medium ${productSignal.colorClass}`}>
              {productSignal.signal}
            </p>
          </div>
        </div>
      </div>

      {/* ── Metrics Overview ── */}
      <div className="bg-white border border-background-200 rounded-xl p-5">
        <h3 className="text-foreground-900 font-semibold text-sm mb-4">最近 7 天互動概覽</h3>

        {!hasData ? (
          <div className="text-center py-6">
            <div className="w-10 h-10 rounded-xl bg-foreground-500/5 border border-foreground-500/10 flex items-center justify-center mx-auto mb-3">
              <i className="ri-time-line text-foreground-400 text-lg"></i>
            </div>
            <p className="text-foreground-500 text-sm">尚未累積足夠真實使用資料，請先小範圍公開測試。</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <MetricCard label="首頁瀏覽" value={metrics!.total_home_views} icon="ri-home-line" />
              <MetricCard label="今日判斷頁瀏覽" value={metrics!.total_report_views} icon="ri-line-chart-line" />
              <MetricCard label="會員預覽點擊" value={metrics!.total_member_preview_clicks} icon="ri-vip-crown-line" />
              <MetricCard label="早鳥區塊點擊" value={metrics!.total_early_access_clicks} icon="ri-notification-3-line" />
              <MetricCard label="早鳥名單送出" value={metrics!.total_early_access_submits} icon="ri-user-add-line" />
              <MetricCard label="Reels 興趣點擊" value={metrics!.total_reels_clicks} icon="ri-film-line" />
              <MetricCard label="LINE 興趣點擊" value={metrics!.total_line_clicks} icon="ri-message-3-line" />
              <MetricCard label="早鳥名單累積" value={metrics!.early_access_signups} icon="ri-group-line" />
            </div>

            {/* Conversion rates */}
            <h4 className="text-foreground-900 font-medium text-xs mb-3">轉換率</h4>
            <div className="space-y-2">
              <ConversionRow
                label="查看今日判斷 → 點會員預覽"
                value={metrics!.conversion_report_to_preview}
              />
              <ConversionRow
                label="點會員預覽 → 點早鳥"
                value={metrics!.conversion_preview_to_early}
              />
              <ConversionRow
                label="點早鳥 → 送出早鳥名單"
                value={metrics!.conversion_early_to_submit}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Early Access Signup List ── */}
      <div className="bg-white border border-background-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-foreground-900 font-semibold text-sm">早鳥名單</h3>
          {signupTotal > 0 && (
            <span className="text-foreground-400 text-xs">{signupTotal} 人</span>
          )}
        </div>

        {/* Search */}
        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋 Email 或 LINE 暱稱..."
            className="w-full px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-foreground-800 text-xs placeholder-foreground-400 focus:outline-none focus:border-primary-500/50 transition-colors"
          />
        </div>

        {filteredSignups.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-foreground-400 text-sm">
              {search ? '沒有符合的結果。' : '尚未有使用者加入早鳥名單。'}
            </p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-12 gap-2 px-3 py-2 bg-background-50 rounded-lg mb-1 text-foreground-500 text-[10px] font-medium uppercase tracking-wider">
              <span className="col-span-2">加入時間</span>
              <span className="col-span-3">Email / LINE</span>
              <span className="col-span-2">使用習慣</span>
              <span className="col-span-4">感興趣內容</span>
              <span className="col-span-1 text-right">來源</span>
            </div>

            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {filteredSignups.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-2 px-3 py-2.5 rounded-lg hover:bg-background-50 transition-colors border border-transparent hover:border-background-200"
                >
                  <span className="col-span-2 text-foreground-500 text-[11px] whitespace-nowrap">
                    {s.created_at ? new Date(s.created_at).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                  <span className="col-span-3 text-foreground-800 text-xs font-medium truncate">
                    {s.email || s.line_name || '—'}
                  </span>
                  <span className="col-span-2 text-foreground-500 text-[11px]">
                    {s.user_type ? (USER_TYPE_LABELS[s.user_type] || s.user_type) : '—'}
                  </span>
                  <span className="col-span-4 text-foreground-500 text-[11px] leading-relaxed">
                    {s.interests && s.interests.length > 0
                      ? s.interests.map((i) => INTEREST_LABELS[i] || i).join('、')
                      : '—'}
                  </span>
                  <span className="col-span-1 text-foreground-400 text-[10px] text-right">
                    {s.source_page || '—'}
                  </span>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 mt-3 pt-3 border-t border-background-100">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => loadSignups(p)}
                    className={`w-7 h-7 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      p === signupPage
                        ? 'bg-primary-500 text-white'
                        : 'text-foreground-500 hover:bg-background-100'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="p-3 rounded-xl bg-background-50 border border-background-200">
      <div className="flex items-center gap-2 mb-1.5">
        <i className={`${icon} text-foreground-400 text-xs`}></i>
        <span className="text-foreground-500 text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-foreground-900 text-xl font-bold">{value}</p>
    </div>
  );
}

function ConversionRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-background-50">
      <span className="text-foreground-500 text-xs">{label}</span>
      <span className={`text-xs font-semibold ${value > 0 ? 'text-emerald-600' : 'text-foreground-400'}`}>
        {value > 0 ? `${value}%` : '尚無資料'}
      </span>
    </div>
  );
}