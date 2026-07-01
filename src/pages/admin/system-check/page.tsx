import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { formatTaipeiDate, isTaipeiWeekendToday } from '@/utils/tradingDay';
import { resolveMorningAlphaState, type MorningAlphaState } from '@/lib/morningAlpha/resolveMorningAlphaState';

interface SystemCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'err';
  message: string;
}

export default function AdminSystemStatus() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<SystemCheck[]>([]);
  const [state, setState] = useState<MorningAlphaState | null>(null);
  const [showTech, setShowTech] = useState(false);

  useEffect(() => {
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const todayStr = formatTaipeiDate();

        // V26: Load unified state
        const unifiedState = await resolveMorningAlphaState();
        setState(unifiedState);

        const items: SystemCheck[] = [];

        // ── reports ──
        if (!unifiedState.reportExists) {
          items.push({ id: 'reports', label: '每日報告 reports', status: 'err', message: '查無報告，請檢查 cron 排程。' });
        } else {
          items.push({ id: 'reports', label: '每日報告 reports', status: 'ok', message: `最新報告日期：${unifiedState.reportDate}` });
        }

        // ── market_data ──
        const { data: mkt, error: mktErr } = await supabase.from('market_data').select('id').limit(1);
        if (mktErr) {
          items.push({ id: 'market_data', label: '市場資料 market_data', status: 'err', message: mktErr.message });
        } else if (!mkt || mkt.length === 0) {
          items.push({ id: 'market_data', label: '市場資料 market_data', status: 'warn', message: '無資料' });
        } else {
          items.push({ id: 'market_data', label: '市場資料 market_data', status: 'ok', message: '有資料' });
        }

        // ── market_news ──
        const { data: news, error: nErr } = await supabase.from('market_news').select('id').limit(1);
        if (nErr) {
          items.push({ id: 'market_news', label: '新聞資料 market_news', status: 'err', message: nErr.message });
        } else if (!news || news.length === 0) {
          items.push({ id: 'market_news', label: '新聞資料 market_news', status: 'warn', message: '無資料' });
        } else {
          items.push({ id: 'market_news', label: '新聞資料 market_news', status: 'ok', message: '有資料' });
        }

        // ── opening_market_radar ──
        const isWeekend = isTaipeiWeekendToday();
        if (isWeekend) {
          items.push({ id: 'radar', label: '盤中雷達 opening_market_radar', status: 'ok', message: '非交易日，不要求今日盤中資料。' });
        } else {
          const { data: rad, error: rErr } = await supabase
            .from('opening_market_radar')
            .select('id, report_date')
            .eq('report_date', todayStr)
            .order('created_at', { ascending: false })
            .limit(1);
          if (rErr) {
            items.push({ id: 'radar', label: '盤中雷達 opening_market_radar', status: 'err', message: rErr.message });
          } else if (!rad || rad.length === 0) {
            items.push({ id: 'radar', label: '盤中雷達 opening_market_radar', status: 'warn', message: `今日（${todayStr}）尚無盤中雷達資料。` });
          } else {
            items.push({ id: 'radar', label: '盤中雷達 opening_market_radar', status: 'ok', message: `已更新（${todayStr}）。` });
          }
        }

        // ── close_market_reviews ──
        if (isWeekend) {
          items.push({ id: 'close', label: '收盤驗證 close_market_reviews', status: 'ok', message: '非交易日。' });
        } else {
          const { data: cls, error: cErr } = await supabase
            .from('close_market_reviews')
            .select('id, report_date')
            .eq('report_date', todayStr)
            .order('created_at', { ascending: false })
            .limit(1);
          if (cErr) {
            items.push({ id: 'close', label: '收盤驗證 close_market_reviews', status: 'err', message: cErr.message });
          } else if (!cls || cls.length === 0) {
            const twNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
            const twHour = twNow.getHours();
            const twMin = twNow.getMinutes();
            const isAfterClose = twHour > 13 || (twHour === 13 && twMin >= 30);
            if (isAfterClose) {
              items.push({ id: 'close', label: '收盤驗證 close_market_reviews', status: 'warn', message: `今日（${todayStr}）收盤驗證尚未產生，已過收盤時間。` });
            } else {
              items.push({ id: 'close', label: '收盤驗證 close_market_reviews', status: 'ok', message: `等待今日收盤後更新。` });
            }
          } else {
            items.push({ id: 'close', label: '收盤驗證 close_market_reviews', status: 'ok', message: `已完成（${todayStr}）。` });
          }
        }

        // ── sector_rotation_scores ──
        if (isWeekend) {
          items.push({ id: 'sector', label: '類股輪動 sector_rotation_scores', status: 'ok', message: '非交易日。' });
        } else {
          const { data: sec, error: sErr } = await supabase
            .from('sector_rotation_scores')
            .select('id, score_date')
            .eq('score_date', todayStr)
            .limit(1);
          if (sErr) {
            items.push({ id: 'sector', label: '類股輪動 sector_rotation_scores', status: 'err', message: sErr.message });
          } else if (!sec || sec.length === 0) {
            const { data: secLatest } = await supabase
              .from('sector_rotation_scores')
              .select('score_date')
              .order('score_date', { ascending: false })
              .limit(1);
            if (secLatest && secLatest.length > 0) {
              const latestDate = String((secLatest[0] as Record<string, unknown>).score_date || '').slice(0, 10);
              items.push({ id: 'sector', label: '類股輪動 sector_rotation_scores', status: 'warn', message: `今日尚無資料，最新為 ${latestDate}（上一交易日參考）。` });
            } else {
              items.push({ id: 'sector', label: '類股輪動 sector_rotation_scores', status: 'warn', message: `今日（${todayStr}）尚無類股輪動資料。` });
            }
          } else {
            items.push({ id: 'sector', label: '類股輪動 sector_rotation_scores', status: 'ok', message: `已更新（${todayStr}）。` });
          }
        }

        setChecks(items);
      } catch (err) {
        setError(err instanceof Error ? err.message : '系統檢查失敗');
      } finally {
        setLoading(false);
      }
    }
    run();
  }, []);

  const todayStr = formatTaipeiDate();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl space-y-5">
        <div>
          <h1 className="text-foreground-900 font-bold text-lg">系統狀態</h1>
        </div>
        <div className="bg-white border border-red-200 rounded-xl p-6 text-center">
          <i className="ri-error-warning-line text-red-400 text-xl mb-2 block"></i>
          <p className="text-red-600 text-sm font-medium">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-foreground-900 font-bold text-lg">系統狀態</h1>
        <p className="text-foreground-500 text-sm mt-0.5">{todayStr}｜工程檢查用，不影響每日內容公開。</p>
      </div>

      {/* System checks */}
      <div className="bg-white border border-background-200 rounded-xl overflow-hidden divide-y divide-background-100">
        {checks.map((item) => {
          const s = item.status === 'ok' ? { dot: 'bg-emerald-500', bg: 'bg-emerald-500/5', label: '正常', labelStyle: 'text-emerald-600 bg-emerald-500/8' }
            : item.status === 'warn' ? { dot: 'bg-amber-400', bg: 'bg-amber-500/5', label: '警告', labelStyle: 'text-amber-600 bg-amber-500/8' }
            : { dot: 'bg-red-400', bg: 'bg-red-500/5', label: '異常', labelStyle: 'text-red-500 bg-red-500/8' };

          return (
            <div key={item.id} className="px-5 py-3.5 flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`}></div>
              <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                <span className="text-foreground-800 text-sm">{item.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-foreground-500 text-xs">{item.message}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${s.labelStyle}`}>{s.label}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Overall verdict */}
      {state?.reportExists && (
        <div className={`rounded-xl border p-5 ${state.publishReady ? 'bg-emerald-500/5 border-emerald-300' : 'bg-amber-500/5 border-amber-300'}`}>
          <div className="flex items-center gap-2.5 mb-2">
            <div className={`w-3 h-3 rounded-full ${state.publishReady ? 'bg-emerald-500' : 'bg-amber-400'}`}></div>
            <span className={`font-bold text-base ${state.publishReady ? 'text-emerald-700' : 'text-amber-700'}`}>
              今日系統狀態：{state.publishReady ? '可公開' : '需人工確認'}
            </span>
          </div>
          <p className="text-foreground-600 text-sm">
            {state.publishReady
              ? '所有核心資料表正常，內容品質與會員價值達標。'
              : '部分檢查項目需確認，但不影響每日內容生成。'}
          </p>
        </div>
      )}

      {/* ═══ UNIFIED DEBUG: 目前全站 active report ═══ */}
      {state && (
        <div className="bg-white border-2 border-amber-300 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-amber-500/5 border-b border-amber-100 flex items-center gap-2">
            <i className="ri-radar-line text-amber-500 text-sm"></i>
            <span className="text-amber-700 text-sm font-semibold">目前全站 active report</span>
            <span className="text-amber-500 text-[10px]">— 所有前台頁面共用此筆報告</span>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              <DebugBox label="report_id" value={state.debug.reportId} mono />
              <DebugBox label="report_date" value={state.debug.reportDate} mono />
              <DebugBox label="market_data_date" value={state.debug.marketDataDate} mono />
              <DebugBox label="us_market_date" value={state.debug.usMarketDate} mono />
              <DebugBox label="created_at_taipei" value={state.debug.createdAtTaipei} />
              <DebugBox label="market_bias" value={state.debug.marketBias} />
              <DebugBox label="confidence_score" value={state.debug.confidenceScore != null ? String(state.debug.confidenceScore) : '—'} mono />
              <DebugBox label="publish_ready" value={state.debug.publishReady ? 'true' : 'false'} mono />
              <DebugBox label="no_fake_fallback" value={state.debug.noFakeFallback ? 'true' : 'false'} mono />
              <DebugBox label="fake_fallback_used" value={state.debug.fakeFallbackUsed ? 'true' : 'false'} mono />
              <DebugBox label="ai_version" value={state.debug.aiVersion} mono />
              <DebugBox label="source" value={state.debug.source} />
              <DebugBox label="resolutionSource" value={state.debug.resolutionSource} />
              <DebugBox label="qualityScore" value={String(state.debug.qualityScore)} mono />
              <DebugBox label="memberValueScore" value={String(state.debug.memberValueScore)} mono />
            </div>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="bg-white border border-background-200 rounded-xl p-5">
        <h3 className="text-foreground-900 font-semibold text-sm mb-3">快速操作</h3>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/today-content" className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-sm rounded-lg transition-colors whitespace-nowrap">
            <i className="ri-arrow-left-line mr-1.5"></i>回到今日內容
          </Link>
          <Link to="/admin/publish" className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-sm rounded-lg transition-colors whitespace-nowrap">
            <i className="ri-film-line mr-1.5"></i>前往發布素材
          </Link>
        </div>
      </div>
    </div>
  );
}

function DebugBox({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-2 rounded-lg bg-amber-50 border border-amber-100">
      <p className="text-amber-600/60 text-[9px] uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-xs font-medium truncate ${mono ? 'font-mono' : ''} text-amber-800`}>{value || '—'}</p>
    </div>
  );
}