import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { formatTaipeiDate } from '@/utils/tradingDay';
import { renderSafeText } from '@/utils/renderSafe';
import { parseAIStrategy, type ParsedAIStrategy } from '@/utils/aiStrategyParser';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { trackPageView, trackEvent } from '@/utils/analytics';

function MemberNoteContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<{
    reportDate: string;
    marketBias: string;
    confidenceScore: number | null;
    twCoreDate: string;
    usGlobalDate: string;
    created_at: string;
    todaySummary: string;
  } | null>(null);
  const [strategy, setStrategy] = useState<ParsedAIStrategy | null>(null);
  const [marketClosed, setMarketClosed] = useState<{ closed: boolean; holidayName: string | null }>({ closed: false, holidayName: null });
  // V9.0: Causal overnight impact chains from new format
  const [causalChains, setCausalChains] = useState<Record<string, unknown>[]>([]);
  // V10.0: Display state for market status fields
  const [dsState, setDsState] = useState<MorningAlphaDisplayState | null>(null);

  useEffect(() => {
    trackPageView('/member-note');
    async function load() {
      try {
        setLoading(true);
        const resolved = await resolveActiveMorningAlphaReport();
        const r = resolved.rawRow;
        if (!r) {
          setReportData(null);
          return;
        }

        // DEBUG: 確認從 Supabase 拿到的原始資料
        console.log('[MemberNote] REPORT RAW ROW', r);
        console.log('[MemberNote] AI STRATEGY JSON (raw)', r.ai_strategy_json);
        console.log('[MemberNote] AI STRATEGY JSON (type)', typeof r.ai_strategy_json);

        // V8.2.1 SAFETY: ai_strategy_json 可能是已解析的 object（jsonb 自動展開）
        // 也可能是 JSON string（Edge Function 雙重序列化時的保護）
        const rawAiJson = r.ai_strategy_json;
        const ai = typeof rawAiJson === 'string'
          ? (() => { try { const parsed = JSON.parse(rawAiJson); console.log('[MemberNote] ai_strategy_json was string, parsed to object', parsed); return parsed as Record<string, unknown>; } catch { console.warn('[MemberNote] ai_strategy_json parse failed, using empty'); return {}; } })()
          : (rawAiJson as Record<string, unknown>) || {};

        console.log('[MemberNote] AI STRATEGY (parsed)', ai);
        console.log('[MemberNote] MEMBER RESEARCH NOTE (raw value)', ai?.member_research_note);
        console.log('[MemberNote] MEMBER RESEARCH NOTE (type)', typeof ai?.member_research_note);
        console.log('[MemberNote] MEMBER RESEARCH NOTE (length)', typeof ai?.member_research_note === 'string' ? (ai.member_research_note as string).length : 'N/A');

        const twDate = (ai.tw_core_date as string) || (ai.market_data_date as string) || r.report_date || '—';
        const usDate = (ai.us_global_date as string) || (ai.us_market_date as string) || '—';

        // V10.0: Unified display state — compute FIRST before using
        const ds = getMorningAlphaDisplayState(r as Record<string, unknown> | null);
        setDsState(ds);

        setReportData({
          reportDate: r.report_date || '—',
          marketBias: ds.marketBias,
          confidenceScore: ds.confidenceScore,
          twCoreDate: twDate,
          usGlobalDate: usDate,
          created_at: r.created_at || '—',
          todaySummary: (r.today_summary as string) || '',
        });

        setMarketClosed({ closed: ds.isMarketClosed, holidayName: ds.holidayName });

        // V9.0: Causal overnight impact chains
        const cChains = Array.isArray(ai.causal_overnight_impact_chains)
          ? (ai.causal_overnight_impact_chains as Record<string, unknown>[])
          : [];
        setCausalChains(cChains);

        const parsed = parseAIStrategy(r as unknown as Record<string, unknown>);
        console.log('[MemberNote] PARSED STRATEGY', parsed);
        console.log('[MemberNote] PARSED MEMBER NOTE', parsed?.member_research_note);
        console.log('[MemberNote] PARSED MEMBER NOTE type', typeof parsed?.member_research_note);
        setStrategy(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : '讀取資料失敗');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-forest-400/60 rounded-full animate-spin mx-auto mb-3" />
            <span className="text-white/50 text-sm">載入研究筆記...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-error-warning-line text-red-500 text-3xl mb-3"></i>
            <h2 className="text-white font-semibold text-base mb-2">讀取失敗</h2>
            <p className="text-white/50 text-sm mb-4">{error}</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10">
              重新載入
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!reportData || !strategy) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-book-open-line text-white/20 text-3xl mb-3"></i>
            <h2 className="text-white font-semibold text-base mb-2">今日報告尚未產生</h2>
            <p className="text-white/50 text-sm mb-4">每天 07:30 自動生成，請稍後再回來查看。</p>
            <Link to="/" className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors inline-block whitespace-nowrap border border-white/10">
              返回首頁
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // V10.0: Market closed — show today's market status, NOT last report date
  if (marketClosed.closed) {
    const nextDate = dsState?.nextTradingDate || '—';
    const nextWeekday = dsState?.nextTradingWeekday || '';
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-navy-900/70 border border-red-500/20 rounded-2xl p-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-400/20 flex items-center justify-center">
              <span className="text-2xl">🔴</span>
            </div>
            <h1 className="text-white font-bold text-xl mb-2">今日市場狀態</h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-red-500/12 border border-red-400/30 rounded-full text-red-300 text-[10px] font-semibold mb-3 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
              非交易日
            </span>
            <p className="text-slate-400 text-sm mb-1">
              日期：{dsState?.currentDate || reportData.reportDate}（{dsState?.currentWeekday || ''}）
            </p>
            <p className="text-slate-500 text-sm mb-4">
              原因：{dsState?.holidayName || marketClosed.holidayName || '休市'}
            </p>
            <div className="bg-navy-800/70 border border-navy-700/70 rounded-xl p-4 mb-5">
              <p className="text-slate-400 text-xs mb-1">下一個交易日</p>
              <p className="text-white font-bold text-base">{nextDate}（{nextWeekday}）</p>
              <p className="text-slate-500 text-[10px] mt-1">07:30 自動更新</p>
            </div>
            <p className="text-slate-500 text-xs leading-relaxed mb-5">
              今日台股休市，Morning Alpha 不產生盤前研究筆記。請於下一個台股交易日再查看完整盤前研究內容。
            </p>
            <Link to="/" className="inline-block mt-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10">
              返回首頁
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const { reportDate, marketBias, confidenceScore, twCoreDate, usGlobalDate, todaySummary } = reportData;

  // V8.2.1: member_research_note 優先，null 時 fallback 到 today_summary
  const memberNoteContent = strategy.member_research_note || todaySummary || null;
  const hasMemberNote = !!memberNoteContent;
  const hasReasoningChain = strategy.reasoning_chain.length > 0;
  const hasOvernightChains = strategy.overnight_impact_chain.length > 0 || causalChains.length > 0;
  const hasValidationPlan = !!strategy.intraday_validation_plan;
  const hasInvalidation = strategy.invalidation_conditions.length > 0;
  const hasClosingPlan = !!strategy.closing_feedback_plan;
  const hasRenewalBlock = !!strategy.renewal_value_block;
  const hasPremiumSummary = !!strategy.premium_value_summary;

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        {/* HEADER */}
        <div className="border-b border-navy-800 bg-navy-900/80 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-forest-500/15 flex items-center justify-center">
                <i className="ri-book-open-line text-forest-400 text-sm"></i>
              </div>
              <h1 className="text-slate-50 font-bold text-sm md:text-base whitespace-nowrap">
                完整盤前研究筆記
              </h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/12 text-emerald-300 text-[10px] font-medium rounded-full border border-emerald-400/35 whitespace-nowrap">
                <i className="ri-check-line text-[9px]"></i>
                完整公開
              </span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/12 text-forest-300 text-[10px] font-medium rounded-full border border-forest-400/35 whitespace-nowrap">
              <i className="ri-calendar-line"></i>
              報告日期：{reportDate}
            </span>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">

          {/* REPORT META */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-3 rounded-xl bg-navy-900/60 border border-navy-800">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">報告日期</p>
              <p className="text-slate-100 font-bold text-sm">{reportDate}</p>
            </div>
            <div className="p-3 rounded-xl bg-navy-900/60 border border-navy-800">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">盤前假設</p>
              <p className="text-slate-100 font-bold text-sm">{marketBias}</p>
            </div>
            <div className="p-3 rounded-xl bg-navy-900/60 border border-navy-800">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">把握度</p>
              <p className="text-slate-100 font-bold text-sm">{confidenceScore != null ? `${confidenceScore}/100` : '—'}</p>
            </div>
            <div className="p-3 rounded-xl bg-navy-900/60 border border-navy-800">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">資料基準</p>
              <p className="text-slate-200 text-xs">{twCoreDate} 收盤 / {usGlobalDate}</p>
            </div>
          </div>

          {/* ═══════════════════════════════ */}
          {/* MEMBER RESEARCH NOTE SECTIONS */}
          {/* ═══════════════════════════════ */}
          {hasMemberNote && memberNoteContent ? (
            typeof memberNoteContent === 'string' ? (
              /* ═══ 純文字多段落路徑 (V8.2.1) ═══ */
              <section>
                <div className="relative bg-gradient-to-br from-navy-900/80 via-navy-900/60 to-navy-900/80 border border-forest-500/10 rounded-2xl p-5 md:p-8 overflow-hidden">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[60%] h-px bg-gradient-to-r from-transparent via-forest-400/30 to-transparent"></div>

                  <div className="text-center mb-6">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/12 rounded-full border border-emerald-400/35 mb-4">
                      <i className="ri-eye-line text-emerald-400 text-xs"></i>
                      <span className="text-emerald-300 text-[10px] font-semibold uppercase tracking-wider">完整研究筆記</span>
                    </div>
                    <h2 className="text-white font-bold text-lg md:text-xl mb-2">
                      第二層：完整盤前研究筆記
                    </h2>
                    <p className="text-slate-300 text-xs mb-3">
                      本篇為 {reportDate} 盤前研究筆記，行情基準採用最近完整交易日 {twCoreDate}。
                    </p>
                  </div>

                  {/* V8.2.1: 多段落渲染，每段獨立顯示，不做截斷 */}
                  <div className="p-4 md:p-6 rounded-xl bg-white/[0.02] border border-white/5 space-y-4">
                    {memberNoteContent.split('\n').filter(Boolean).map((paragraph, i) => (
                      <p key={i} className="text-white/70 text-sm leading-relaxed">
                        {paragraph.trim()}
                      </p>
                    ))}
                  </div>
                </div>
              </section>
            ) : (
            /* ═══ 結構化物件路徑 ═══ */
            <section>
              <div className="relative bg-gradient-to-br from-navy-900/80 via-navy-900/60 to-navy-900/80 border border-forest-500/10 rounded-2xl p-5 md:p-8 overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[60%] h-px bg-gradient-to-r from-transparent via-forest-400/30 to-transparent"></div>

                <div className="text-center mb-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/12 rounded-full border border-emerald-400/35 mb-4">
                    <i className="ri-eye-line text-emerald-400 text-xs"></i>
                    <span className="text-emerald-300 text-[10px] font-semibold uppercase tracking-wider">完整研究筆記</span>
                  </div>
                  <h2 className="text-white font-bold text-lg md:text-xl mb-2">
                    第二層：完整盤前研究筆記
                  </h2>
                  <p className="text-slate-300 text-xs mb-3">
                    本篇為 {reportDate} 盤前研究筆記，行情基準採用最近完整交易日 {twCoreDate}。
                  </p>
                </div>

                {/* Executive Brief */}
                {memberNoteContent.executive_brief?.one_line && (
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 mb-4">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">執行摘要</p>
                    <p className="text-white/70 text-sm leading-relaxed">{memberNoteContent.executive_brief.one_line}</p>
                    {memberNoteContent.executive_brief.why_today_matters && (
                      <p className="text-white/45 text-xs mt-2">{memberNoteContent.executive_brief.why_today_matters}</p>
                    )}
                  </div>
                )}

                {/* Sections — accordion, first expanded by default */}
                <div className="space-y-3">
                  {memberNoteContent.sections.map((sec, idx) => (
                    <details key={sec.key || idx} className="group" open={idx === 0}>
                      <summary className="p-4 rounded-xl bg-navy-800/50 border border-white/5 hover:border-forest-500/20 transition-colors cursor-pointer list-none">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-md bg-forest-500/10 border border-forest-500/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-forest-400 text-[10px] font-bold">{idx + 1}</span>
                          </div>
                          <h3 className="text-white font-semibold text-sm">{renderSafeText(sec.title)}</h3>
                          <i className="ri-arrow-down-s-line text-white/30 text-sm ml-auto group-open:rotate-180 transition-transform"></i>
                        </div>
                      </summary>
                      <div className="mt-2 p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
                        {sec.conclusion && (
                          <div>
                            <p className="text-forest-400/60 text-[10px] uppercase tracking-wider mb-1">結論</p>
                            <p className="text-white/70 text-sm leading-relaxed">{renderSafeText(sec.conclusion)}</p>
                          </div>
                        )}
                        {sec.data_points && sec.data_points.length > 0 && (
                          <div>
                            <p className="text-forest-400/60 text-[10px] uppercase tracking-wider mb-1">資料點</p>
                            <div className="flex flex-wrap gap-1.5">
                              {sec.data_points.map((dp, i) => (
                                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/50">
                                  {renderSafeText(dp)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {sec.reasoning && (
                          <div>
                            <p className="text-forest-400/60 text-[10px] uppercase tracking-wider mb-1">推理</p>
                            <p className="text-white/60 text-xs leading-relaxed">{renderSafeText(sec.reasoning)}</p>
                          </div>
                        )}
                        {sec.market_mechanism && (
                          <div>
                            <p className="text-forest-400/60 text-[10px] uppercase tracking-wider mb-1">市場機制</p>
                            <p className="text-white/50 text-xs leading-relaxed">{renderSafeText(sec.market_mechanism)}</p>
                          </div>
                        )}
                        {sec.intraday_confirmation && (
                          <div>
                            <p className="text-forest-400/60 text-[10px] uppercase tracking-wider mb-1">盤中驗證</p>
                            <p className="text-white/50 text-xs leading-relaxed">{renderSafeText(sec.intraday_confirmation)}</p>
                          </div>
                        )}
                        {sec.invalidation_conditions && (
                          <div>
                            <p className="text-red-400/60 text-[10px] uppercase tracking-wider mb-1">失效條件</p>
                            <p className="text-red-400/70 text-xs leading-relaxed">{renderSafeText(sec.invalidation_conditions)}</p>
                          </div>
                        )}
                        {sec.member_takeaway && (
                          <div>
                            <p className="text-forest-400/60 text-[10px] uppercase tracking-wider mb-1">會員提醒</p>
                            <p className="text-amber-400/70 text-xs leading-relaxed">{renderSafeText(sec.member_takeaway)}</p>
                          </div>
                        )}
                        {sec.chains && sec.chains.length > 0 && (
                          <div>
                            <p className="text-forest-400/60 text-[10px] uppercase tracking-wider mb-1">影響鏈</p>
                            <div className="space-y-2">
                              {sec.chains.map((c, i) => (
                                <div key={i} className="p-2 rounded-lg bg-navy-800/50 border border-white/5">
                                  <p className="text-white/60 text-xs"><span className="text-white/30">催化：</span>{renderSafeText(c.catalyst)}</p>
                                  {c.taiwan_market_impact && <p className="text-forest-400/60 text-[11px] mt-0.5">台股影響：{renderSafeText(c.taiwan_market_impact)}</p>}
                                  {c.affected_sectors && c.affected_sectors.length > 0 && <p className="text-white/45 text-[11px] mt-0.5">族群：{c.affected_sectors.map((s: string) => s).join('、')}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {sec.timeline && sec.timeline.length > 0 && (
                          <div>
                            <p className="text-forest-400/60 text-[10px] uppercase tracking-wider mb-1">盤中追蹤</p>
                            <div className="space-y-2">
                              {sec.timeline.map((t, i) => (
                                <div key={i} className="p-2 rounded-lg bg-navy-800/50 border border-white/5">
                                  <p className="text-white/50 text-xs"><span className="text-amber-400/60">{renderSafeText(t.time)}</span> — {renderSafeText(t.question)}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {sec.evidence_items && sec.evidence_items.length > 0 && (
                          <div>
                            <p className="text-forest-400/60 text-[10px] uppercase tracking-wider mb-1">證據</p>
                            <div className="space-y-2">
                              {sec.evidence_items.map((ei, i) => (
                                <div key={i} className="p-2 rounded-lg bg-navy-800/50 border border-white/5">
                                  <p className="text-white/60 text-xs"><span className="text-white/30">訊號：</span>{renderSafeText(ei.signal)}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </section>
            )
          ) : (
            /* ═══ 無內容路徑 ═══ */
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-6 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-navy-800/80 flex items-center justify-center">
                <i className="ri-book-open-line text-white/15 text-2xl"></i>
              </div>
              <p className="text-slate-300 text-sm mb-2">今日完整研究筆記尚未生成</p>
              <p className="text-slate-500 text-xs max-w-md mx-auto">完整研究筆記會在每日盤前報告產生後自動填入，通常於 07:30 前完成。若已過該時間仍未顯示，請稍後重新整理。</p>
            </section>
          )}

          {/* B: Reasoning Chain */}
          {hasReasoningChain && (
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h2 className="text-white font-bold text-base mb-4 flex items-center gap-2">
                <i className="ri-link text-forest-400 text-sm"></i>
                推理鏈
              </h2>
              <div className="space-y-3">
                {strategy.reasoning_chain.map((step, i) => (
                  <div key={i} className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-forest-400 text-[10px] font-bold">{i + 1}</span>
                      <p className="text-white font-semibold text-sm">{renderSafeText(step.step)}</p>
                    </div>
                    {step.evidence && <p className="text-white/50 text-xs ml-5">證據：{renderSafeText(step.evidence)}</p>}
                    {step.inference && <p className="text-white/45 text-xs ml-5 mt-0.5">推論：{renderSafeText(step.inference)}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* C: 隔夜影響鏈 */}
          {hasOvernightChains && (
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h2 className="text-white font-bold text-base mb-4 flex items-center gap-2">
                <i className="ri-global-line text-amber-400 text-sm"></i>
                隔夜影響鏈
              </h2>

              {/* V9.0: Causal chain format (new) */}
              {causalChains.length > 0 ? (
                <div className="space-y-4">
                  {causalChains.map((chain, i) => (
                    <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
                      {/* Overseas trigger */}
                      {chain.overseas_trigger && (
                        <div>
                          <p className="text-amber-400/60 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <i className="ri-flashlight-line text-[11px]"></i>海外觸發
                          </p>
                          <p className="text-white/80 text-sm leading-relaxed">{renderSafeText(String(chain.overseas_trigger))}</p>
                        </div>
                      )}

                      {/* First order impact */}
                      {chain.first_order_impact && (
                        <div>
                          <p className="text-sky-400/60 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <i className="ri-arrow-right-circle-line text-[11px]"></i>第一層影響
                          </p>
                          <p className="text-sky-300/80 text-xs leading-relaxed">{renderSafeText(String(chain.first_order_impact))}</p>
                        </div>
                      )}

                      {/* Taiwan market bridge */}
                      {chain.taiwan_market_bridge && (
                        <div>
                          <p className="text-accent-400/60 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <i className="ri-exchange-line text-[11px]"></i>台股傳導
                          </p>
                          <p className="text-accent-300/80 text-xs leading-relaxed">{renderSafeText(String(chain.taiwan_market_bridge))}</p>
                        </div>
                      )}

                      {/* Sector transmission */}
                      {Array.isArray(chain.sector_transmission) && (chain.sector_transmission as string[]).length > 0 && (
                        <div>
                          <p className="text-accent-400/60 text-[10px] uppercase tracking-wider mb-1">影響產業</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(chain.sector_transmission as string[]).map((s, si) => (
                              <span key={si} className="text-[9px] px-2 py-0.5 rounded-full bg-accent-100/10 text-accent-300 border border-accent-400/20">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Stock selection logic */}
                      {chain.stock_selection_logic && (
                        <div>
                          <p className="text-violet-400/60 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <i className="ri-list-check text-[11px]"></i>選股邏輯
                          </p>
                          <p className="text-violet-300/70 text-xs leading-relaxed">{renderSafeText(String(chain.stock_selection_logic))}</p>
                        </div>
                      )}

                      {/* Invalidation */}
                      {chain.invalidation_condition && (
                        <div className="p-2.5 rounded-lg bg-red-500/[0.04] border border-red-500/12">
                          <p className="text-red-400/60 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <i className="ri-close-circle-line text-[11px]"></i>失效條件
                          </p>
                          <p className="text-red-400/70 text-xs leading-relaxed">{renderSafeText(String(chain.invalidation_condition))}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                /* Legacy format fallback */
                <div className="space-y-3">
                  {strategy.overnight_impact_chain.map((chain, i) => (
                    <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                      <p className="text-white font-semibold text-sm mb-2">{renderSafeText(chain.catalyst)}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {chain.taiwan_market_impact && <p className="text-amber-400/70">台股影響：{renderSafeText(chain.taiwan_market_impact)}</p>}
                        {chain.affected_sectors.length > 0 && <p className="text-white/50">族群：{chain.affected_sectors.map((s: string) => s).join('、')}</p>}
                        {chain.invalidation_condition && <p className="text-red-400/60 col-span-full">失效：{renderSafeText(chain.invalidation_condition)}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* D: Intraday Validation Plan */}
          {hasValidationPlan && strategy.intraday_validation_plan && (
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h2 className="text-white font-bold text-base mb-4 flex items-center gap-2">
                <i className="ri-timer-line text-sky-400 text-sm"></i>
                盤中驗證計畫
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {strategy.intraday_validation_plan.open_0900_0930 && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-sky-400/60 text-[10px] uppercase tracking-wider mb-1">09:00-09:30</p>
                    <p className="text-white/60 text-xs">{renderSafeText(strategy.intraday_validation_plan.open_0900_0930)}</p>
                  </div>
                )}
                {strategy.intraday_validation_plan.mid_session_1000_1130 && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-sky-400/60 text-[10px] uppercase tracking-wider mb-1">10:00-11:30</p>
                    <p className="text-white/60 text-xs">{renderSafeText(strategy.intraday_validation_plan.mid_session_1000_1130)}</p>
                  </div>
                )}
                {strategy.intraday_validation_plan.afternoon_1300_1330 && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-sky-400/60 text-[10px] uppercase tracking-wider mb-1">13:00-13:30</p>
                    <p className="text-white/60 text-xs">{renderSafeText(strategy.intraday_validation_plan.afternoon_1300_1330)}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* E: Invalidation Conditions */}
          {hasInvalidation && (
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h2 className="text-white font-bold text-base mb-4 flex items-center gap-2">
                <i className="ri-close-circle-line text-red-400 text-sm"></i>
                失效條件
              </h2>
              <div className="space-y-3">
                {strategy.invalidation_conditions.map((ic, i) => (
                  <div key={i} className="p-3 rounded-xl bg-red-500/[0.03] border border-red-500/10">
                    {ic.condition && <p className="text-white font-semibold text-sm mb-1">{renderSafeText(ic.condition)}</p>}
                    {ic.meaning && <p className="text-white/50 text-xs">{renderSafeText(ic.meaning)}</p>}
                    {ic.required_adjustment && <p className="text-amber-400/70 text-xs mt-1">調整：{renderSafeText(ic.required_adjustment)}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* F: Closing Feedback Plan */}
          {hasClosingPlan && strategy.closing_feedback_plan && (
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h2 className="text-white font-bold text-base mb-4 flex items-center gap-2">
                <i className="ri-check-double-line text-violet-400 text-sm"></i>
                收盤回饋計畫
              </h2>
              <div className="space-y-3">
                {strategy.closing_feedback_plan.what_to_check_after_close && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-violet-400/60 text-[10px] uppercase tracking-wider mb-1">收盤後檢查</p>
                    <p className="text-white/60 text-xs">{renderSafeText(strategy.closing_feedback_plan.what_to_check_after_close)}</p>
                  </div>
                )}
                {strategy.closing_feedback_plan.how_to_score_today && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-violet-400/60 text-[10px] uppercase tracking-wider mb-1">今日評分</p>
                    <p className="text-white/60 text-xs">{renderSafeText(strategy.closing_feedback_plan.how_to_score_today)}</p>
                  </div>
                )}
                {strategy.closing_feedback_plan.what_to_adjust_tomorrow && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-violet-400/60 text-[10px] uppercase tracking-wider mb-1">明日修正</p>
                    <p className="text-white/60 text-xs">{renderSafeText(strategy.closing_feedback_plan.what_to_adjust_tomorrow)}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* G: Renewal Value Block */}
          {hasRenewalBlock && strategy.renewal_value_block && (
            <section className="bg-navy-900/60 border border-amber-500/10 rounded-2xl p-5 md:p-6">
              <h2 className="text-white font-bold text-base mb-4 flex items-center gap-2">
                <i className="ri-bookmark-line text-amber-400 text-sm"></i>
                持續研究價值
              </h2>
              <div className="space-y-3">
                {strategy.renewal_value_block.why_member_should_read_today && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-amber-400/60 text-[10px] uppercase tracking-wider mb-1">今天為什麼要看</p>
                    <p className="text-white/70 text-sm">{renderSafeText(strategy.renewal_value_block.why_member_should_read_today)}</p>
                  </div>
                )}
                {strategy.renewal_value_block.what_free_news_does_not_provide && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-amber-400/60 text-[10px] uppercase tracking-wider mb-1">深度分析補充</p>
                    <p className="text-white/60 text-xs">{renderSafeText(strategy.renewal_value_block.what_free_news_does_not_provide)}</p>
                  </div>
                )}
                {strategy.renewal_value_block.tomorrow_followup_hook && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-amber-400/60 text-[10px] uppercase tracking-wider mb-1">明天為什麼要回來</p>
                    <p className="text-white/60 text-xs">{renderSafeText(strategy.renewal_value_block.tomorrow_followup_hook)}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* H: Premium Value Summary */}
          {hasPremiumSummary && strategy.premium_value_summary && (
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h2 className="text-white font-bold text-base mb-4">研究內容價值摘要</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {strategy.premium_value_summary.why_member_would_pay && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">研究價值</p>
                    <p className="text-white/60 text-xs">{renderSafeText(strategy.premium_value_summary.why_member_would_pay)}</p>
                  </div>
                )}
                {strategy.premium_value_summary.free_vs_member_gap && (
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">分析深度差距</p>
                    <p className="text-white/60 text-xs">{renderSafeText(strategy.premium_value_summary.free_vs_member_gap)}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* WHY COME BACK */}
          <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
            <h2 className="text-white font-bold text-lg mb-5 text-center">
              為什麼這會讓你每天想回來？
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
              {[
                '不是報明牌，是每天建立市場判斷節奏。',
                '不是追新聞，是把新聞、指數、期貨、權值股與族群變成因果判斷。',
                '收盤後會回驗盤前假設，慢慢形成你自己的市場直覺。',
              ].map((point, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                  <div className="w-10 h-10 rounded-xl bg-forest-500/10 border border-forest-500/20 flex items-center justify-center mx-auto mb-3">
                    <span className="text-forest-400 text-sm font-bold">{idx + 1}</span>
                  </div>
                  <p className="text-white/60 text-sm leading-relaxed">{point}</p>
                </div>
              ))}
            </div>
          </section>

          {/* BOTTOM NAV */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-center pt-2 pb-4">
            <Link
              to="/report/today"
              onClick={() => trackEvent('click_today_report', { location: 'member_note' })}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap"
            >
              <i className="ri-file-text-line"></i>
              查看今日判斷
            </Link>
            <Link
              to="/opportunities"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber-500/12 hover:bg-amber-500/18 text-amber-300 text-sm rounded-xl transition-colors border border-amber-400/30 whitespace-nowrap"
            >
              <i className="ri-focus-3-line"></i>
              查看今日受惠股
            </Link>
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-800/70 hover:bg-slate-700/70 text-slate-200 text-sm rounded-xl transition-colors border border-slate-600/40 whitespace-nowrap"
            >
              <i className="ri-home-line"></i>
              返回首頁
            </Link>
          </div>

          <p className="text-white/20 text-[10px] text-center leading-relaxed">
            本平台提供市場資訊整理與情緒判讀參考，不構成投資建議。Morning Alpha 由愛吉網路資訊有限公司營運。
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function MemberNote() {
  return (
    <ErrorBoundary
      fallbackTitle="完整研究筆記暫時無法載入"
      fallbackMessage="資料讀取或畫面渲染時發生錯誤，請稍後再試。"
    >
      <MemberNoteContent />
    </ErrorBoundary>
  );
}