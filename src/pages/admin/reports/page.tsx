import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { renderSafeText } from '@/utils/renderSafe';
import {
  computeContentGate,
  computeAutoPublishDecision,
  getAutoDecisionDisplay,
  type ContentPublishGate,
  type AutoPublishDecision,
} from '@/services/contentGateService';
import { renderNotebookSections, renderValidationFeedback, renderNotebookHeader, grabBool } from './components/ContentSections';
import { parseAIStrategy, hasMemberResearchNote, getMemberNoteSectionCount, getMemberCoreThesis } from '@/utils/aiStrategyParser';
import type { ParsedAIStrategy } from '@/utils/aiStrategyParser';

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

interface ReportRow {
  id: string;
  report_date: string;
  market_bias: string | null;
  confidence_score: number | null;
  created_at: string;
  ai_strategy_json: Record<string, unknown> | null;
  summary: string | null;
}

type ReportStatus = 'available' | 'needs_regeneration' | 'old_report';

// ═══════════════════════════════════════════════════
// Safe Helpers
// ═══════════════════════════════════════════════════

function grab(obj: unknown, ...keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '—';
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return '—';
}

function grabObj(obj: unknown, key: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const v = o[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function grabArr(obj: unknown, key: string): unknown[] {
  if (!obj || typeof obj !== 'object') return [];
  const o = obj as Record<string, unknown>;
  return Array.isArray(o[key]) ? (o[key] as unknown[]) : [];
}

function hasContent(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (typeof val === 'object' && !Array.isArray(val)) return Object.keys(val as object).length > 0;
  if (Array.isArray(val)) return val.length > 0;
  return false;
}

function ynBool(val: boolean | null): string {
  if (val === true) return '有';
  if (val === false) return '無';
  return '—';
}

// ═══════════════════════════════════════════════════
// Report Status Detection
// ═══════════════════════════════════════════════════

function detectReportStatus(aiJson: Record<string, unknown> | null): { status: ReportStatus; conclusionText: string; conclusionClass: string; icon: string } {
  // V7.53: Use proper content detection from ai_strategy_json
  const strategy = parseAIStrategy({ ai_strategy_json: aiJson });
  const hasMn = hasMemberResearchNote(strategy);
  const hasReels = !!(strategy.reels_script?.hook_0_5_sec || strategy.reels_script?.core_5_25_sec);
  const hasSocial = !!(strategy.social_post?.title || strategy.social_post?.full_post);
  const hasFreeSummary = !!(strategy.free_summary?.one_sentence || strategy.free_summary?.today_status);
  const hasQuality = strategy.quality_score >= 65 || !!strategy.content_quality_flags;
  const publishReady = strategy.publish_ready;

  // Status 1: 可用 — member content exists (flat or sections)
  if (hasMn && publishReady) {
    return {
      status: 'available',
      conclusionText: '今日會員研究筆記、Reels、社群短文已產生，已通過發布檢查，可進行內容驗收。',
      conclusionClass: 'bg-emerald-500/5 border-emerald-500/20',
      icon: 'ri-check-double-line text-emerald-500',
    };
  }

  if (hasMn && !publishReady) {
    return {
      status: 'available',
      conclusionText: '今日會員研究筆記已產生，但發布檢查尚未通過。請確認品質分數、假資料旗標與資料日期對齊狀態。',
      conclusionClass: 'bg-amber-500/5 border-amber-500/20',
      icon: 'ri-check-line text-amber-500',
    };
  }

  // Has free_summary but missing ALL new content fields → old report
  const hasLine = !!strategy.line_push_copy?.title;
  const allNewFieldsMissing = !hasMn && !hasReels && !hasSocial && !hasLine && !hasQuality;
  if (allNewFieldsMissing && hasFreeSummary) {
    return {
      status: 'old_report',
      conclusionText: '這筆報告是舊版報告，尚未包含新版會員研究筆記。請重新產生新版報告以取得會員研究筆記、Reels 腳本、社群短文。',
      conclusionClass: 'bg-amber-500/5 border-amber-500/20',
      icon: 'ri-history-line text-amber-500',
    };
  }

  // Has some new fields but missing member_note → needs regeneration
  return {
    status: 'needs_regeneration',
    conclusionText: '目前選取的報告尚未包含新版會員內容。請重新產生今日報告，讓 OpenAI 產生會員研究筆記與腳本內容。',
    conclusionClass: 'bg-orange-500/5 border-orange-500/20',
    icon: 'ri-refresh-line text-orange-500',
  };
}

// ═══════════════════════════════════════════════════
// Status badge colors
// ═══════════════════════════════════════════════════

function statusColor(val: boolean | null, isOldReport: boolean): string {
  if (val === true) return 'text-emerald-600';
  if (isOldReport) return 'text-amber-500';
  return 'text-orange-500';
}

function statusBg(val: boolean | null, isOldReport: boolean): string {
  if (val === true) return 'bg-emerald-500/5 border-emerald-500/15';
  if (isOldReport) return 'bg-amber-500/5 border-amber-500/15';
  return 'bg-orange-500/5 border-orange-500/15';
}

function statusText(val: boolean | null, isOldReport: boolean): string {
  if (val === true) return '已產生';
  if (isOldReport) return '舊版報告';
  return '尚未產生';
}

// ═══════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════

export default function AdminReports() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportRow | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{ ok: boolean; message: string; timedOut?: boolean; errorDetail?: { functionName: string; httpStatus: number | string; errorName: string; errorMessage: string; responseBody: string | null; responseBodyObj: Record<string, unknown> | null; timestamp: string; } } | null>(null);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showTroubleshootModal, setShowTroubleshootModal] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [triggerElapsed, setTriggerElapsed] = useState(0);
  const triggerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTriggeringRef = useRef(false);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const { data, error: err } = await supabase
          .from('reports')
          .select('id, report_date, market_bias, confidence_score, ai_strategy_json, summary, created_at')
          .order('report_date', { ascending: false })
          .limit(60);

        if (err) throw new Error(err.message);

        const rows: ReportRow[] = (data || []).map((r: Record<string, unknown>) => ({
          id: String(r.id || ''),
          report_date: String(r.report_date || ''),
          market_bias: r.market_bias ? String(r.market_bias) : null,
          confidence_score: r.confidence_score != null ? Number(r.confidence_score) : null,
          created_at: String(r.created_at || ''),
          ai_strategy_json: (r.ai_strategy_json as Record<string, unknown>) || null,
          summary: r.summary ? String(r.summary) : null,
        }));

        setReports(rows);
        if (rows.length > 0 && !selectedReport) {
          setSelectedReport(rows[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '讀取失敗');
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Trigger Edge Function ──
  async function triggerReportGeneration() {
    // ── Prevent duplicate clicks ──
    if (isTriggeringRef.current) {
      setTriggerResult({
        ok: false,
        message: '內容正在產生中，請先等待或點擊「我已手動觸發，重新檢查」，不要重複觸發 Edge Function。',
      });
      return;
    }

    // ── Clean up any previous timers ──
    if (triggerTimerRef.current) clearInterval(triggerTimerRef.current);
    if (triggerTimeoutRef.current) clearTimeout(triggerTimeoutRef.current);

    isTriggeringRef.current = true;
    setTriggering(true);
    setTriggerResult(null);
    setTriggerElapsed(0);

    // ── Start elapsed timer (tick every 10s) ──
    let elapsed = 0;
    triggerTimerRef.current = setInterval(() => {
      elapsed += 10;
      setTriggerElapsed(elapsed);
    }, 10000);

    // ── 120s timeout via Promise.race ──
    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      triggerTimeoutRef.current = setTimeout(() => {
        timedOut = true;
        reject(new Error('TIMEOUT_120S'));
      }, 120000);
    });

    try {
      const result = await Promise.race([
        supabase.functions.invoke('generate-daily-report-v7', {
          body: { force_run: true },
        }),
        timeoutPromise,
      ]);
      const { data, error: invokeErr } = result as { data: unknown; error: Error | null };

      // ── Edge Function returned response ──
      if (invokeErr) {
        let errorName = invokeErr.name || 'FunctionsHttpError';
        let errorMessage = invokeErr.message || '未知錯誤';
        let errorStatus: number | string = '—';
        let errorBody: string | null = null;
        let errorBodyObj: Record<string, unknown> | null = null;

        try {
          const ctx = Reflect.get(invokeErr, 'context');
          if (ctx && typeof ctx === 'object') {
            const ctxObj = ctx as Record<string, unknown>;
            if (typeof ctxObj.json === 'function') {
              errorBodyObj = await (ctxObj.json as () => Promise<Record<string, unknown>>)();
              errorBody = JSON.stringify(errorBodyObj, null, 2);
            } else if (typeof ctxObj.text === 'function') {
              errorBody = await (ctxObj.text as () => Promise<string>)();
            }
            if (typeof ctxObj.status === 'number') errorStatus = ctxObj.status;
            if (typeof ctxObj.statusText === 'string') errorMessage = `${errorMessage} (${ctxObj.statusText})`;
          }
        } catch { /* context parse failed */ }

        if (errorStatus === '—') {
          const statusCode = Reflect.get(invokeErr, 'status');
          if (typeof statusCode === 'number') errorStatus = statusCode;
        }

        setTriggerResult({
          ok: false,
          message: `觸發失敗：${errorMessage}`,
          errorDetail: {
            functionName: 'generate-daily-report-v7',
            httpStatus: errorStatus,
            errorName,
            errorMessage,
            responseBody: errorBody,
            responseBodyObj: errorBodyObj,
            timestamp: new Date().toISOString(),
          },
        });
      } else if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        if (d.success === true) {
          // ═══════ Auto-recheck after successful generation ═══════
          setTriggerResult({ ok: true, message: '內容已產生，正在重新讀取最新報告...' });
          await recheckAfterTrigger();
        } else if (d.skipped === true) {
          setTriggerResult({ ok: false, message: `跳過：${d.reason || '非交易日'}。若需強制產生，今天是${new Date().toLocaleDateString('zh-TW', { weekday: 'long' })}，請確認是否在 Supabase 手動觸發並帶 force_run: true。` });
        } else {
          setTriggerResult({ ok: false, message: `重新產生失敗，請至 Supabase Edge Functions 手動觸發 generate-daily-report-v7。${d.error ? ' 原因：' + String(d.error) : ''}` });
        }
      } else {
        setTriggerResult({ ok: true, message: '已觸發，請點擊「我已手動觸發，重新檢查」按鈕查看最新內容。' });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // ── Timeout or elapsed >= 120 ──
      if (timedOut || errMsg === 'TIMEOUT_120S' || elapsed >= 120) {
        setTriggerResult({
          ok: false,
          message: '產生時間過長，請先重新檢查最新報告；如果仍未產生，請查看 Supabase Edge Function Logs。',
          timedOut: true,
        });
      } else {
        setTriggerResult({ ok: false, message: `Edge Function 回應逾時或呼叫失敗：${errMsg}。請查看 Supabase Edge Function Logs 確認是否仍在執行。` });
      }
    } finally {
      // ── Clean up all timers ──
      if (triggerTimerRef.current) { clearInterval(triggerTimerRef.current); triggerTimerRef.current = null; }
      if (triggerTimeoutRef.current) { clearTimeout(triggerTimeoutRef.current); triggerTimeoutRef.current = null; }
      isTriggeringRef.current = false;
      setTriggering(false);
      setTriggerElapsed(0);
    }
  }

  // ── Auto-recheck helper (called after successful Edge Function invoke) ──
  async function recheckAfterTrigger() {
    setRechecking(true);
    try {
      const { data, error: err } = await supabase
        .from('reports')
        .select('id, report_date, market_bias, confidence_score, ai_strategy_json, summary, created_at')
        .order('report_date', { ascending: false })
        .limit(1);

      if (err) throw new Error(err.message);

      if (data && data.length > 0) {
        const latest = data[0] as Record<string, unknown>;
        const aiJson = (latest.ai_strategy_json as Record<string, unknown>) || null;
        const hasMn = hasContent(grabObj(aiJson, 'member_research_note'));
        const hasFs = hasContent(grabObj(aiJson, 'free_summary'));
        const hasReels = hasContent(grabObj(aiJson, 'reels_script'));
        const hasSocial = hasContent(grabObj(aiJson, 'social_post'));
        const hasLine = hasContent(grabObj(aiJson, 'line_push_copy'));

        if (hasMn && hasFs) {
          setTriggerResult({ ok: true, message: `新版會員內容已產生！（${latest.report_date}）會員研究筆記、Reels、社群文、LINE 文案皆已到位。` });
          // Refresh the full report list
          const { data: allData } = await supabase
            .from('reports')
            .select('id, report_date, market_bias, confidence_score, ai_strategy_json, summary, created_at')
            .order('report_date', { ascending: false })
            .limit(60);
          if (allData) {
            const rows: ReportRow[] = (allData || []).map((r: Record<string, unknown>) => ({
              id: String(r.id || ''),
              report_date: String(r.report_date || ''),
              market_bias: r.market_bias ? String(r.market_bias) : null,
              confidence_score: r.confidence_score != null ? Number(r.confidence_score) : null,
              created_at: String(r.created_at || ''),
              ai_strategy_json: (r.ai_strategy_json as Record<string, unknown>) || null,
              summary: r.summary ? String(r.summary) : null,
            }));
            setReports(rows);
            if (rows.length > 0) setSelectedReport(rows[0]);
          }
        } else {
          const missing: string[] = [];
          if (!hasMn) missing.push('會員研究筆記');
          if (!hasReels) missing.push('Reels 腳本');
          if (!hasSocial) missing.push('社群短文');
          if (!hasLine) missing.push('LINE 推播文案');
          setTriggerResult({ ok: false, message: `Edge Function 回報成功，但會員內容尚未到位。仍缺少：${missing.join('、')}。可能 Edge Function 仍在寫入中，請稍候再試「重新檢查」。` });
        }
      } else {
        setTriggerResult({ ok: false, message: '資料庫中尚無報告。Edge Function 可能尚未寫入完成，請稍候再試。' });
      }
    } catch (err) {
      setTriggerResult({ ok: false, message: `自動重新檢查失敗：${err instanceof Error ? err.message : String(err)}。請手動點擊「重新檢查」。` });
    } finally {
      setRechecking(false);
    }
  }

  // ── Re-check after manual trigger ──
  async function recheckReport() {
    setRechecking(true);
    setTriggerResult(null);
    try {
      const { data, error: err } = await supabase
        .from('reports')
        .select('id, report_date, market_bias, confidence_score, ai_strategy_json, summary, created_at')
        .order('report_date', { ascending: false })
        .limit(1);

      if (err) throw new Error(err.message);

      if (data && data.length > 0) {
        const latest = data[0] as Record<string, unknown>;
        const aiJson = (latest.ai_strategy_json as Record<string, unknown>) || null;
        const hasMn = hasContent(grabObj(aiJson, 'member_research_note'));
        const hasFs = hasContent(grabObj(aiJson, 'free_summary'));
        const hasReels = hasContent(grabObj(aiJson, 'reels_script'));
        const hasSocial = hasContent(grabObj(aiJson, 'social_post'));
        const hasLine = hasContent(grabObj(aiJson, 'line_push_copy'));
        const hasGate = hasContent(grabObj(aiJson, 'content_publish_gate'));
        const hasDecision = hasContent(grabObj(aiJson, 'auto_publish_decision'));

        if (hasMn && hasFs) {
          setTriggerResult({ ok: true, message: `新版會員內容已產生！（${latest.report_date}）會員研究筆記、Reels、社群文、LINE 文案皆已到位。請重新整理頁面查看完整內容。` });
          // Refresh the full report list
          const { data: allData } = await supabase
            .from('reports')
            .select('id, report_date, market_bias, confidence_score, ai_strategy_json, summary, created_at')
            .order('report_date', { ascending: false })
            .limit(60);
          if (allData) {
            const rows: ReportRow[] = (allData || []).map((r: Record<string, unknown>) => ({
              id: String(r.id || ''),
              report_date: String(r.report_date || ''),
              market_bias: r.market_bias ? String(r.market_bias) : null,
              confidence_score: r.confidence_score != null ? Number(r.confidence_score) : null,
              created_at: String(r.created_at || ''),
              ai_strategy_json: (r.ai_strategy_json as Record<string, unknown>) || null,
              summary: r.summary ? String(r.summary) : null,
            }));
            setReports(rows);
            if (rows.length > 0) setSelectedReport(rows[0]);
          }
        } else {
          const missing: string[] = [];
          if (!hasMn) missing.push('會員研究筆記');
          if (!hasReels) missing.push('Reels 腳本');
          if (!hasSocial) missing.push('社群短文');
          if (!hasLine) missing.push('LINE 推播文案');
          if (!hasGate) missing.push('內容品質檢查');
          if (!hasDecision) missing.push('自動發布判斷');
          setTriggerResult({ ok: false, message: `會員內容尚未產生。仍缺少：${missing.join('、') || '新版欄位'}。請確認 generate-daily-report-v7 是否已部署新版 OpenAI prompt，或至 Supabase Edge Functions 手動觸發。` });
        }
      } else {
        setTriggerResult({ ok: false, message: '資料庫中尚無報告。請先觸發 generate-daily-report-v7。' });
      }
    } catch (err) {
      setTriggerResult({ ok: false, message: `重新檢查失敗：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setRechecking(false);
    }
  }

  // ── Trading day check ──
  const isTradingDay = useMemo(() => {
    const dow = new Date().getDay();
    return dow !== 0 && dow !== 6;
  }, []);

  // ── Derived state ──
  const aiJson = selectedReport?.ai_strategy_json ?? null;
  const reportStatus = useMemo(() => detectReportStatus(aiJson), [aiJson]);
  const isOldReport = reportStatus.status === 'old_report';
  const isMissingContent = reportStatus.status === 'needs_regeneration' || reportStatus.status === 'old_report';

  // V7.53: Parse ai_strategy_json with unified parser
  const strategy = useMemo<ParsedAIStrategy>(() => parseAIStrategy(selectedReport), [selectedReport]);

  const freeSummary = grabObj(aiJson, 'free_summary');
  const memberNote = grabObj(aiJson, 'member_research_note');
  const reelsScript = grabObj(aiJson, 'reels_script');
  const socialPost = grabObj(aiJson, 'social_post');
  const linePush = grabObj(aiJson, 'line_push_copy');
  const qualityFlags = grabObj(aiJson, 'content_quality_flags');

  const hasFreeSummary = hasContent(freeSummary);
  const hasMemberNote = hasMemberResearchNote(strategy);
  const hasReels = !!(strategy.reels_script?.hook_0_5_sec || strategy.reels_script?.core_5_25_sec);
  const hasSocial = !!(strategy.social_post?.title || strategy.social_post?.full_post);
  const hasLine = !!strategy.line_push_copy?.title;
  const hasQuality = strategy.quality_score >= 65 || !!qualityFlags;
  const allScriptsMissing = !hasReels && !hasSocial; // LINE is optional now

  // ── Button text based on trading day ──
  const regenerateBtnText = isTradingDay ? '重新產生今日內容' : '重新產生最近交易日內容';
  const regenerateSubtitle = isTradingDay ? '' : '今天非交易日，系統會使用最近交易日資料產生會員研究筆記與腳本內容。';

  // Find the latest report that has member_research_note
  const latestCompleteReport = useMemo(() => {
    return reports.find((r) => {
      const mn = grabObj(r.ai_strategy_json, 'member_research_note');
      return hasContent(mn);
    }) || null;
  }, [reports]);

  // ── Content Gate ──
  const contentGate = useMemo<ContentPublishGate | null>(() => {
    if (!aiJson) return null;
    return computeContentGate({ ai_strategy_json: aiJson });
  }, [aiJson]);

  const autoPublishDecision = useMemo<AutoPublishDecision | null>(() => {
    return computeAutoPublishDecision(contentGate);
  }, [contentGate]);

  const autoDisplay = getAutoDecisionDisplay(autoPublishDecision);

  // ── Publish status per report in history ──
  function getPublishStatus(r: ReportRow): { label: string; cls: string } {
    const strat = parseAIStrategy({ ai_strategy_json: r.ai_strategy_json });
    const hasMn = hasMemberResearchNote(strat);
    const hasRls = !!(strat.reels_script?.hook_0_5_sec || strat.reels_script?.core_5_25_sec);
    const hasSp = !!(strat.social_post?.title || strat.social_post?.full_post);
    const hasFs = !!(strat.free_summary?.one_sentence || strat.free_summary?.today_status);
    const publishReady = strat.publish_ready;
    const qScore = strat.quality_score;
    const allNewMissing = !hasMn && !hasRls && !hasSp && !strat.line_push_copy?.title && (qScore < 65);

    if (allNewMissing && hasFs) {
      return { label: '舊版報告', cls: 'bg-amber-500/10 text-amber-600 border border-amber-500/20' };
    }
    if (!hasMn) {
      return { label: '未產生會員內容', cls: 'bg-orange-500/10 text-orange-600 border border-orange-500/20' };
    }
    if (publishReady) {
      return { label: '可公開', cls: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' };
    }
    return { label: '需人工確認', cls: 'bg-amber-500/10 text-amber-600 border border-amber-500/20' };
  }

  // ── Table helpers ──
  function getShortSummary(r: ReportRow): string {
    const fs = grabObj(r.ai_strategy_json, 'free_summary');
    const oneLine = grab(fs, 'one_sentence');
    if (oneLine !== '—') return oneLine.length > 80 ? oneLine.slice(0, 80) + '...' : oneLine;
    if (r.summary && r.summary.trim()) return r.summary.length > 80 ? r.summary.slice(0, 80) + '...' : r.summary;
    return '今日報告已生成，請查看完整內容';
  }

  function biasBadge(bias: string | null) {
    if (!bias) return <span className="text-foreground-400 text-xs">—</span>;
    const isLong = bias.includes('多') || bias.includes('強');
    const isShort = bias.includes('空') || bias.includes('弱');
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${
        isLong ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20' :
        isShort ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' :
        'bg-amber-500/10 text-amber-600 border border-amber-500/20'
      }`}>
        {bias}
      </span>
    );
  }

  const reportDate = selectedReport?.report_date || '—';

  // ── Progressive loading message based on elapsed time ──
  function getLoadingMessage(): string {
    if (triggerElapsed < 10) return '正在送出重新產生請求...';
    if (triggerElapsed < 60) return 'OpenAI 正在產生會員研究筆記，請稍候...';
    return '內容產生時間較長，系統仍在等待回應...';
  }

  // ── Loading / Error ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-center">
        <p className="text-red-600 text-sm font-medium">每日報告讀取失敗</p>
        <p className="text-foreground-500 text-[11px] font-mono mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-5">
      {/* ─── Page Header ─── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-foreground-900 font-bold text-lg">會員內容驗收中心</h1>
          <p className="text-foreground-500 text-sm mt-0.5">
            快速確認每日會員內容是否到位，決定是否公開會員預覽與推播。
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-background-100 rounded-lg text-foreground-500 text-xs">
          <i className="ri-database-2-line"></i>
          共 {reports.length} 筆報告
        </span>
      </div>

      {!selectedReport && (
        <div className="bg-white border border-background-200 rounded-xl p-8 text-center">
          <p className="text-foreground-500 text-sm">尚無報告資料</p>
        </div>
      )}

      {selectedReport && (
        <>

        {/* ═══════════════════════════════════════════ */}
        {/* 一、今日結論卡 */}
        {/* ═══════════════════════════════════════════ */}
        <section className={`rounded-xl p-5 md:p-6 border ${reportStatus.conclusionClass}`}>
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-shrink-0">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${reportStatus.status === 'available' ? 'bg-emerald-500/10' : reportStatus.status === 'old_report' ? 'bg-amber-500/10' : 'bg-orange-500/10'}`}>
                <i className={`${reportStatus.icon} text-2xl`}></i>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h2 className="text-foreground-900 font-bold text-base">今日會員內容狀態</h2>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${
                  reportStatus.status === 'available'
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                    : reportStatus.status === 'old_report'
                    ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                    : 'bg-orange-500/10 text-orange-600 border-orange-500/20'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    reportStatus.status === 'available' ? 'bg-emerald-500' : reportStatus.status === 'old_report' ? 'bg-amber-500' : 'bg-orange-500'
                  }`}></span>
                  {reportStatus.status === 'available' ? '內容已產生' : reportStatus.status === 'old_report' ? '舊版報告' : '內容待產生'}
                </span>
                <span className="text-foreground-400 text-xs">日期：{reportDate}</span>
              </div>

              <p className={`text-sm leading-relaxed mb-4 ${
                reportStatus.status === 'available' ? 'text-emerald-700' : reportStatus.status === 'old_report' ? 'text-amber-700' : 'text-orange-700'
              }`}>
                {reportStatus.conclusionText}
              </p>

              {/* Quick stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
                <div className={`p-2.5 rounded-lg border ${statusBg(hasMemberNote, isOldReport)}`}>
                  <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-0.5">會員研究筆記</p>
                  <p className={`text-xs font-bold ${statusColor(hasMemberNote, isOldReport)}`}>
                    {statusText(hasMemberNote, isOldReport)}
                  </p>
                </div>
                <div className={`p-2.5 rounded-lg border ${statusBg(hasReels, isOldReport)}`}>
                  <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-0.5">Reels / LINE</p>
                  <p className={`text-xs font-bold ${statusColor(hasReels || hasLine, isOldReport)}`}>
                    {hasReels || hasLine ? '已產生' : isOldReport ? '舊版報告' : '尚未產生'}
                  </p>
                </div>
                <div className={`p-2.5 rounded-lg border ${statusBg(hasFreeSummary, false)}`}>
                  <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-0.5">免費摘要</p>
                  <p className={`text-xs font-bold ${hasFreeSummary ? 'text-emerald-600' : 'text-orange-500'}`}>
                    {hasFreeSummary ? '已產生' : '尚未產生'}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg border bg-background-50 border-background-100">
                  <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-0.5">盤前假設</p>
                  <p className="text-foreground-800 text-xs font-bold">{selectedReport.market_bias || '—'}</p>
                </div>
              </div>

              {/* Trigger result feedback */}
              {triggerResult && (
                <div className={`mt-3 rounded-xl border ${triggerResult.ok ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'} overflow-hidden`}>
                  <div className="flex items-start gap-2.5 p-4">
                    <i className={`${triggerResult.ok ? 'ri-check-line text-emerald-500' : 'ri-error-warning-line text-red-500'} text-base mt-0.5 flex-shrink-0`}></i>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${triggerResult.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                        {triggerResult.ok ? '操作成功' : 
                          (triggerResult.errorDetail?.httpStatus === 422 || triggerResult.errorDetail?.responseBodyObj?.error === 'MEMBER_CONTENT_QUALITY_FAILED') && 
                          (triggerResult.errorDetail?.responseBodyObj?.quality_score as number | undefined ?? 0) >= 65 
                            ? '內容需人工確認' : '操作未完成'}
                      </p>
                      <p className={`text-xs mt-1 leading-relaxed ${triggerResult.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                        {triggerResult.message}
                      </p>
                    </div>
                    <button
                      onClick={() => setTriggerResult(null)}
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/5 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
                    >
                      <i className="ri-close-line text-sm"></i>
                    </button>
                  </div>

                  {/* Detailed error card — shown when errorDetail is available */}
                  {!triggerResult.ok && triggerResult.errorDetail && (
                    <div className="border-t border-red-500/15 px-4 py-3 space-y-2 bg-red-500/[0.02]">
                      <p className="text-red-600 text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
                        <i className="ri-bug-line"></i> Edge Function 錯誤詳情
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                        <DetailRow label="Function 名稱" value={triggerResult.errorDetail.functionName} />
                        <DetailRow label="HTTP Status" value={String(triggerResult.errorDetail.httpStatus)} mono />
                        <DetailRow label="錯誤類型" value={triggerResult.errorDetail.errorName} mono />
                        <DetailRow label="發生時間" value={new Date(triggerResult.errorDetail.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} />
                      </div>

                      {/* Error message from Edge Function */}
                      {triggerResult.errorDetail.responseBodyObj && (
                        <div className="space-y-1.5">
                          {triggerResult.errorDetail.responseBodyObj.error && (
                            <div className="bg-red-500/10 border border-red-500/15 rounded-lg p-2.5">
                              <p className="text-red-600 text-[10px] font-medium mb-0.5">Edge Function 回傳錯誤碼</p>
                              <p className="text-red-700 text-xs font-mono">{String(triggerResult.errorDetail.responseBodyObj.error)}</p>
                            </div>
                          )}
                          {triggerResult.errorDetail.responseBodyObj.stage && (
                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="text-foreground-400">失敗階段：</span>
                              <span className="text-red-600 font-mono font-medium">{String(triggerResult.errorDetail.responseBodyObj.stage)}</span>
                            </div>
                          )}
                          {triggerResult.errorDetail.responseBodyObj.message && (
                            <div className="bg-amber-500/10 border border-amber-500/15 rounded-lg p-2.5">
                              <p className="text-amber-600 text-[10px] font-medium mb-0.5">Edge Function 訊息</p>
                              <p className="text-amber-700 text-xs">{String(triggerResult.errorDetail.responseBodyObj.message)}</p>
                            </div>
                          )}
                          {triggerResult.errorDetail.responseBodyObj.failed_reasons && (
                            <div className="bg-red-500/5 rounded-lg p-2.5">
                              <p className="text-red-600 text-[10px] font-medium mb-1">不合格原因：</p>
                              <ul className="list-disc list-inside space-y-0.5">
                                {(triggerResult.errorDetail.responseBodyObj.failed_reasons as string[]).map((r: string, i: number) => (
                                  <li key={i} className="text-red-600 text-[11px]">{r}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {triggerResult.errorDetail.responseBodyObj.quality_score !== undefined && (
                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="text-foreground-400">品質分數：</span>
                              <span className={`font-mono font-bold text-xs ${Number(triggerResult.errorDetail.responseBodyObj.quality_score) >= 75 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {String(triggerResult.errorDetail.responseBodyObj.quality_score)}/100
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Raw response body (collapsed by default) */}
                      {triggerResult.errorDetail.responseBody && (
                        <details className="mt-2">
                          <summary className="text-foreground-400 text-[10px] cursor-pointer hover:text-foreground-600 transition-colors select-none">
                            <i className="ri-code-line mr-1"></i>查看原始回傳內容
                          </summary>
                          <pre className="mt-1.5 p-2.5 bg-foreground-950 text-emerald-300 rounded-lg text-[10px] font-mono overflow-x-auto max-h-40 whitespace-pre-wrap border border-foreground-800">{triggerResult.errorDetail.responseBody}</pre>
                        </details>
                      )}

                      {/* Next step suggestion */}
                      <div className="bg-background-50 rounded-lg p-2.5 border border-background-200 mt-2">
                        <p className="text-foreground-500 text-[10px] font-medium mb-1 flex items-center gap-1">
                          <i className="ri-lightbulb-line"></i>下一步建議
                        </p>
                        <p className="text-foreground-600 text-[11px] leading-relaxed">
                          {(() => {
                            const status = triggerResult.errorDetail.httpStatus;
                            const errCode = triggerResult.errorDetail.responseBodyObj?.error as string | undefined;
                            const qScore = triggerResult.errorDetail.responseBodyObj?.quality_score as number | undefined;
                            if (status === 422 || errCode === 'MEMBER_CONTENT_QUALITY_FAILED') {
                              if (qScore !== undefined && qScore >= 80) return `內容接近合格（品質分數 ${qScore}/100），但未達自動公開門檻。${qScore >= 90 ? '建議：' : '建議站長人工確認會員研究筆記後再決定是否公開。若需立即使用，可至 Supabase 手動觸發 generate-daily-report-v7 並在 Edge Function 內調整 quality gate 門檻。'}`;
                              if (qScore !== undefined && qScore >= 65) return `內容品質偏弱（品質分數 ${qScore}/100），建議站長人工確認後再決定是否公開。系統已自動擋下自動發布，但不影響內容留存。`;
                              return 'OpenAI 產出的會員內容未達品質標準。請至 Supabase 後台 → Edge Functions → generate-daily-report-v7 → Logs 查看詳細品質報告，必要時手動重新觸發。';
                            }
                            if (status === 401 || errCode === 'Unauthorized') return '授權失敗：請確認 Edge Function 環境變數 SUPABASE_ANON_KEY 或 CRON_SECRET 已正確設定。';
                            if (errCode === 'OPENAI_API_KEY_NOT_CONFIGURED') return 'OpenAI API Key 未設定。請至 Supabase 後台 → Edge Functions → generate-daily-report-v7 → Settings → Environment Variables 加入 OPENAI_API_KEY。';
                            if (errCode === 'NO_FRESH_DATA') return '市場數據或新聞過舊。請確認 fetch-market-data 與 fetch-global-market-news 定時任務已正常執行。';
                            if (errCode === 'DB_UPSERT_FAILED') return '資料庫寫入失敗。請檢查 reports 表的權限與 Edge Function 的 SUPABASE_SERVICE_ROLE_KEY 是否正確。';
                            if (errCode === 'NORMALIZE_REPORT_FAILED' || errCode === 'BUILD_PAYLOAD_FAILED') return '報告正規化或打包失敗，可能是 OpenAI 回傳格式異常。請查看上方原始回傳內容並檢查 Edge Function Logs。';
                            return '請至 Supabase 後台 → Edge Functions → generate-daily-report-v7 → Logs 查看完整執行日誌，或點擊「如何手動觸發？」按鈕取得操作教學。';
                          })()}
                        </p>
                      </div>
                    </div>
                  )}
                  {/* Post-timeout actions */}
                  {!triggerResult.ok && triggerResult.timedOut && !triggerResult.errorDetail && (
                    <div className="border-t border-red-500/15 px-4 py-3 space-y-3 bg-red-500/[0.02]">
                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <button onClick={() => { setTriggerResult(null); recheckReport(); }} disabled={rechecking} className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white text-sm font-medium rounded-xl transition-all cursor-pointer whitespace-nowrap w-full sm:w-auto min-h-[44px]">{rechecking ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span></> : <><i className="ri-search-line"></i> 我已觸發，重新檢查</>}</button>
                        <button onClick={() => setShowManualModal(true)} className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-background-200 hover:border-background-300 rounded-xl text-foreground-600 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap w-full sm:w-auto min-h-[44px]"><i className="ri-question-line"></i> 查看手動觸發教學</button>
                        <button onClick={() => setShowTroubleshootModal(true)} className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-amber-500/30 hover:border-amber-500/60 rounded-xl text-amber-600 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap w-full sm:w-auto min-h-[44px]"><i className="ri-error-warning-line"></i> 查看錯誤排查提示</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 mt-3">
                {!isTradingDay && isMissingContent && (
                  <p className="text-foreground-500 text-xs w-full mb-1 flex items-center gap-1.5">
                    <i className="ri-calendar-event-line"></i>
                    {regenerateSubtitle}
                  </p>
                )}
                {isMissingContent && (
                  <>
                    <button
                      onClick={() => triggerReportGeneration()}
                      disabled={triggering}
                      className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap shadow-sm hover:shadow-md active:scale-[0.97] w-full sm:w-auto min-h-[44px]"
                    >
                      {triggering ? (
                        <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> {getLoadingMessage()}</>
                      ) : (
                        <><i className="ri-refresh-line text-base"></i> {regenerateBtnText}</>
                      )}
                    </button>
                    <button
                      onClick={() => recheckReport()}
                      disabled={rechecking}
                      className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-emerald-500/30 hover:border-emerald-500/60 disabled:border-background-200 text-emerald-600 disabled:text-foreground-400 text-sm font-medium rounded-xl transition-all cursor-pointer whitespace-nowrap w-full sm:w-auto min-h-[44px]"
                    >
                      {rechecking ? (
                        <><span className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></span> 檢查中...</>
                      ) : (
                        <><i className="ri-search-line"></i> 我已手動觸發，重新檢查</>
                      )}
                    </button>
                    <button
                      onClick={() => setShowManualModal(true)}
                      className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-background-200 hover:border-background-300 rounded-xl text-foreground-600 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap w-full sm:w-auto min-h-[44px]"
                    >
                      <i className="ri-question-line"></i>
                      如何手動觸發？
                    </button>
                  </>
                )}
                {hasMemberNote && (
                  <button
                    onClick={() => {
                      const el = document.getElementById('section-member-notebook');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-background-200 hover:border-background-300 rounded-xl text-foreground-700 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-file-text-line"></i>
                    查看會員研究筆記
                  </button>
                )}
                {!allScriptsMissing && (
                  <button
                    onClick={() => {
                      const el = document.getElementById('section-scripts');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-background-200 hover:border-background-300 rounded-xl text-foreground-700 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-film-line"></i>
                    查看 Reels / LINE
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════ */}
        {/* 1.5 內容品質摘要卡 — V7.53 */}
        {/* ═══════════════════════════════════════════ */}
        <section className={`rounded-xl p-5 md:p-6 border ${
          (strategy.publish_ready && strategy.quality_score >= 75 && strategy.member_value_score >= 80 && !strategy.fake_fallback_used)
            ? 'bg-emerald-500/5 border-emerald-500/20'
            : 'bg-amber-500/5 border-amber-500/20'
        }`}>
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-shrink-0">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                (strategy.publish_ready && strategy.quality_score >= 75 && strategy.member_value_score >= 80 && !strategy.fake_fallback_used)
                  ? 'bg-emerald-500/10'
                  : 'bg-amber-500/10'
              }`}>
                <i className={`${
                  (strategy.publish_ready && strategy.quality_score >= 75 && strategy.member_value_score >= 80 && !strategy.fake_fallback_used)
                    ? 'ri-shield-check-line text-emerald-500'
                    : 'ri-shield-flash-line text-amber-500'
                } text-2xl`}></i>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-foreground-900 font-bold text-base mb-2">內容品質摘要</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 mb-3">
                <QualityBadge label="AI 版本" value={strategy.ai_version || '—'} mono />
                <QualityBadge label="資料來源" value={strategy.source || '—'} mono />
                <QualityBadge label="品質分數" value={strategy.quality_score > 0 ? `${strategy.quality_score}/100` : '—'} highlight={strategy.quality_score >= 75} />
                <QualityBadge label="會員價值分" value={strategy.member_value_score > 0 ? `${strategy.member_value_score}/100` : '—'} highlight={strategy.member_value_score >= 80} />
                <QualityBadge label="發布狀態" value={strategy.publish_ready ? '已通過' : '未通過'} highlight={strategy.publish_ready} />
                <QualityBadge label="無假資料" value={strategy.no_fake_fallback ? '是' : '否'} highlight={strategy.no_fake_fallback} />
                <QualityBadge label="假資料旗標" value={strategy.fake_fallback_used ? '⚠ 已觸發' : '未觸發'} highlight={!strategy.fake_fallback_used} />
                <QualityBadge label="日期對齊" value={strategy.data_date_aligned ? '是' : '否'} highlight={strategy.data_date_aligned} />
                <QualityBadge label="資料日期" value={strategy.market_data_latest_date || '—'} />
                <QualityBadge label="模板化" value={strategy.is_template_like ? '⚠ 是' : '否'} highlight={!strategy.is_template_like} />
              </div>
              {(strategy.publish_ready && strategy.quality_score >= 75 && strategy.member_value_score >= 80 && !strategy.fake_fallback_used) ? (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <i className="ri-check-double-line text-emerald-500"></i>
                  <span className="text-emerald-700 text-sm font-medium">會員內容已通過發布檢查</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 rounded-lg border border-amber-500/20">
                  <i className="ri-error-warning-line text-amber-500"></i>
                  <span className="text-amber-700 text-sm font-medium">發布檢查未完全通過，請確認上方品質旗標</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════ */}
        {/* 二、內容狀態總覽 — 人話版 */}
        {/* ═══════════════════════════════════════════ */}
        <section className="bg-white border border-background-200 rounded-xl p-5">
          <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
            <i className="ri-information-line text-foreground-400"></i>
            內容產生狀態
          </h2>
          {/* Mobile: list rows */}
          <div className="md:hidden divide-y divide-background-100 border border-background-100 rounded-lg">
            <StatusRow label="基礎報告" ok={hasContent(aiJson)} isOld={isOldReport} />
            <StatusRow label="免費摘要" ok={hasFreeSummary} isOld={isOldReport} />
            <StatusRow label="會員研究筆記" ok={hasMemberNote} isOld={isOldReport} />
            <StatusRow label="Reels 腳本" ok={hasReels} isOld={isOldReport} />
            <StatusRow label="社群短文" ok={hasSocial} isOld={isOldReport} />
            {hasLine ? (
              <StatusRow label="LINE 推播文案" ok={true} isOld={false} />
            ) : (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-foreground-700 text-sm">LINE 推播文案</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap bg-background-50 text-foreground-400 border-background-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground-300"></span>
                  尚未啟用 LINE 模組
                </span>
              </div>
            )}
            <StatusRow label="內容品質檢查" ok={strategy.quality_score >= 75 && strategy.publish_ready} isOld={isOldReport} />
            <StatusRow label="自動發布判斷" ok={strategy.publish_ready} isOld={false} />
          </div>
          {/* Desktop: grid */}
          <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatusItem label="基礎報告" ok={hasContent(aiJson)} isOld={isOldReport} />
            <StatusItem label="免費摘要" ok={hasFreeSummary} isOld={isOldReport} />
            <StatusItem label="會員研究筆記" ok={hasMemberNote} isOld={isOldReport} />
            <StatusItem label="Reels 腳本" ok={hasReels} isOld={isOldReport} />
            <StatusItem label="社群短文" ok={hasSocial} isOld={isOldReport} />
            {hasLine ? (
              <StatusItem label="LINE 推播文案" ok={true} isOld={false} />
            ) : (
              <div className="p-3 rounded-lg border bg-background-50 border-background-200">
                <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">LINE 推播文案</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-foreground-300"></span>
                  <p className="text-foreground-400 text-xs font-medium">尚未啟用 LINE 模組</p>
                </div>
              </div>
            )}
            <StatusItem label="內容品質檢查" ok={strategy.quality_score >= 75 && strategy.publish_ready} isOld={isOldReport} />
            <StatusItem label="自動發布判斷" ok={strategy.publish_ready} isOld={false} />
          </div>
          <div className="mt-4 flex items-center gap-4 text-[10px] text-foreground-400">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> 已產生 / 已完成</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span> 尚未產生</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> 舊版報告</span>
          </div>
        </section>

        {/* ═══════════════════════════════════════════ */}
        {/* 三、下一步操作區 */}
        {/* ═══════════════════════════════════════════ */}
        {isMissingContent && (
          <section className="bg-amber-500/3 border border-amber-500/15 rounded-xl p-5">
            <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
              <i className="ri-compass-3-line text-amber-500"></i>
              下一步該做什麼？
            </h2>
            <p className="text-foreground-600 text-sm mb-4 leading-relaxed">
              {isOldReport
                ? '這筆報告建立於新版會員內容結構上線前，因此沒有會員研究筆記、Reels 腳本、社群短文與 LINE 推播文案。請重新產生報告取得新版內容：'
                : '這筆報告尚未包含新版會員內容。請重新產生今日報告，讓 OpenAI 產生以下內容：'}
            </p>
            <ul className="space-y-1 mb-5 text-sm text-foreground-600">
              <li className="flex items-center gap-2"><i className="ri-checkbox-blank-circle-fill text-[6px] text-foreground-400"></i>會員研究筆記（9 段完整研究）</li>
              <li className="flex items-center gap-2"><i className="ri-checkbox-blank-circle-fill text-[6px] text-foreground-400"></i>Reels 60 秒腳本</li>
              <li className="flex items-center gap-2"><i className="ri-checkbox-blank-circle-fill text-[6px] text-foreground-400"></i>社群短文</li>
              <li className="flex items-center gap-2"><i className="ri-checkbox-blank-circle-fill text-[6px] text-foreground-400"></i>LINE 推播文案</li>
              <li className="flex items-center gap-2"><i className="ri-checkbox-blank-circle-fill text-[6px] text-foreground-400"></i>內容品質檢查</li>
              <li className="flex items-center gap-2"><i className="ri-checkbox-blank-circle-fill text-[6px] text-foreground-400"></i>自動發布判斷</li>
            </ul>
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
              {!isTradingDay && (
                <p className="text-foreground-500 text-xs w-full flex items-center gap-1.5">
                  <i className="ri-calendar-event-line"></i>
                  {regenerateSubtitle}
                </p>
              )}
              <button
                onClick={() => triggerReportGeneration()}
                disabled={triggering}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap shadow-sm hover:shadow-md active:scale-[0.97] w-full sm:w-auto min-h-[44px]"
              >
                {triggering ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> {getLoadingMessage()}</>
                ) : (
                  <><i className="ri-refresh-line text-base"></i> {regenerateBtnText}</>
                )}
              </button>
              <button
                onClick={() => recheckReport()}
                disabled={rechecking}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-emerald-500/30 hover:border-emerald-500/60 disabled:border-background-200 text-emerald-600 disabled:text-foreground-400 text-sm font-medium rounded-xl transition-all cursor-pointer whitespace-nowrap w-full sm:w-auto min-h-[44px]"
              >
                {rechecking ? (
                  <><span className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></span> 檢查中...</>
                ) : (
                  <><i className="ri-search-line"></i> 我已手動觸發，重新檢查</>
                )}
              </button>
              <button
                onClick={() => setShowManualModal(true)}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-background-200 hover:border-background-300 rounded-xl text-foreground-600 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap w-full sm:w-auto min-h-[44px]"
              >
                <i className="ri-question-line"></i>
                如何手動觸發？
              </button>
              {latestCompleteReport && (
                <button
                  onClick={() => setSelectedReport(latestCompleteReport)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-emerald-500/20 hover:border-emerald-500/40 text-emerald-600 text-xs font-medium rounded-xl transition-colors cursor-pointer whitespace-nowrap w-full sm:w-auto min-h-[44px]"
                >
                  <i className="ri-arrow-right-circle-line"></i>
                  查看最近一筆完整內容（{latestCompleteReport.report_date}）
                </button>
              )}
              {!latestCompleteReport && (
                <span className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-background-200 rounded-xl text-foreground-400 text-xs whitespace-nowrap w-full sm:w-auto">
                  <i className="ri-search-line"></i>
                  尚無完整內容
                </span>
              )}
              <a
                href="/admin"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-background-200 hover:border-background-300 rounded-xl text-foreground-500 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap w-full sm:w-auto min-h-[44px]"
              >
                <i className="ri-arrow-left-line"></i>
                返回總控台
              </a>
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* 四、免費版內容 */}
        {/* ═══════════════════════════════════════════ */}
        <section className="bg-white border border-background-200 rounded-xl p-5">
          <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
            <i className="ri-eye-line text-foreground-400"></i>
            免費版內容
          </h2>
          {!hasFreeSummary && !hasSocial ? (
            <div className="bg-background-50 rounded-xl p-5 text-center">
              <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center mx-auto mb-3">
                <i className="ri-file-unknow-line text-orange-500 text-lg"></i>
              </div>
              <p className="text-foreground-700 text-sm font-medium mb-1">免費摘要尚未產生</p>
              <p className="text-foreground-500 text-xs max-w-md mx-auto leading-relaxed">
                目前這筆報告尚未包含免費摘要內容。重新產生報告後，這裡會顯示新版免費摘要。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <FreeRow label="今日狀態" value={
                grab(freeSummary, 'today_status') ||
                grab(socialPost, 'title') ||
                getMemberCoreThesis(strategy) ||
                '—'
              } />
              <FreeRow label="一句話摘要" value={
                grab(freeSummary, 'one_sentence') ||
                grab(socialPost, 'title') ||
                getMemberCoreThesis(strategy) ||
                '—'
              } highlight />
              <FreeRow label="盤前假設" value={grab(freeSummary, 'market_bias')} />
              <FreeRow label="把握度" value={grab(freeSummary, 'confidence_score')} />
              <FreeRow label="今日不要做" value={grab(freeSummary, 'do_not_do')} />
              <FreeRow label="今日心法" value={grab(freeSummary, 'mindset')} />
              <FreeRow label="CTA 提示" value={grab(freeSummary, 'cta_hint')} />
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════ */}
        {/* 五、會員完整研究筆記 */}
        {/* ═══════════════════════════════════════════ */}
        <section id="section-member-notebook" className="bg-white border border-background-200 rounded-xl p-5">
          <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
            <i className="ri-file-text-line text-foreground-400"></i>
            會員完整研究筆記
          </h2>

          {!hasMemberNote ? (
            <div className="bg-background-50 rounded-xl p-5 text-center">
              <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center mx-auto mb-3">
                <i className="ri-file-unknow-line text-orange-500 text-lg"></i>
              </div>
              <p className="text-foreground-700 text-sm font-medium mb-1">尚未產生新版會員研究筆記</p>
              <p className="text-foreground-500 text-xs max-w-lg mx-auto leading-relaxed mb-4">
                新版會員內容應由 OpenAI 產生 9 段研究筆記，包括今日主劇本、資料證據、隔夜影響鏈、不要做清單、觀察名單、盤中追蹤、失效條件、收盤驗證與最近驗證回饋。目前這筆報告尚未包含這些內容。
              </p>
              <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 mt-2">
                <button
                  onClick={() => triggerReportGeneration()}
                  disabled={triggering}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white text-sm font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap shadow-sm hover:shadow-md active:scale-[0.97] w-full sm:w-auto min-h-[44px]"
                >
                  {triggering ? (
                    <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> {getLoadingMessage()}</>
                  ) : (
                    <><i className="ri-refresh-line text-base"></i> {regenerateBtnText}</>
                  )}
                </button>
                <button
                  onClick={() => setShowManualModal(true)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-background-200 hover:border-background-300 rounded-xl text-foreground-600 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap w-full sm:w-auto min-h-[44px]"
                >
                  <i className="ri-question-line"></i>
                  如何手動觸發？
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {renderNotebookHeader(memberNote)}
              {renderNotebookSections(grabArr(memberNote, 'sections'), memberNote)}
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════ */}
        {/* 6.5 推理鏈 — V7.53 */}
        {/* ═══════════════════════════════════════════ */}
        {strategy.reasoning_chain.length > 0 && (
          <section className="bg-white border border-background-200 rounded-xl p-5">
            <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
              <i className="ri-link-m text-foreground-400"></i>
              推理鏈
            </h2>
            <div className="space-y-3">
              {strategy.reasoning_chain.map((step, i) => (
                <div key={i} className="bg-background-50 rounded-lg p-4 border border-background-100">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex-shrink-0 w-6 h-6 rounded-md bg-foreground-900 text-white flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                    <span className="text-foreground-800 font-semibold text-sm">{step.step}</span>
                    {step.confidence > 0 && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${step.confidence >= 70 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                        信心 {step.confidence}%
                      </span>
                    )}
                  </div>
                  {step.evidence && <p className="text-foreground-600 text-xs leading-relaxed"><span className="text-foreground-400">證據：</span>{step.evidence}</p>}
                  {step.inference && <p className="text-foreground-700 text-xs leading-relaxed mt-1"><span className="text-foreground-400">推論：</span>{step.inference}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* 6.6 隔夜影響鏈 — V7.53 */}
        {/* ═══════════════════════════════════════════ */}
        {strategy.overnight_impact_chain.length > 0 && (
          <section className="bg-white border border-background-200 rounded-xl p-5">
            <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
              <i className="ri-global-line text-foreground-400"></i>
              隔夜影響鏈
            </h2>
            <div className="space-y-3">
              {strategy.overnight_impact_chain.map((chain, i) => (
                <div key={i} className="bg-background-50 rounded-lg p-4 border border-background-100">
                  <p className="text-foreground-800 font-semibold text-sm mb-2">
                    <span className="text-foreground-400 text-xs font-normal">來源市場：</span>
                    {chain.catalyst || `影響鏈 #${i + 1}`}
                  </p>
                  {chain.taiwan_market_impact && <p className="text-foreground-700 text-xs leading-relaxed mb-1"><span className="text-foreground-400">台股連結：</span>{chain.taiwan_market_impact}</p>}
                  {chain.affected_sectors.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-foreground-400 text-[10px]">影響族群：</span>
                      {chain.affected_sectors.map((sector, j) => (
                        <span key={j} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-violet-500/10 text-violet-600 border border-violet-500/15">{sector}</span>
                      ))}
                    </div>
                  )}
                  {chain.invalidation_condition && <p className="text-foreground-500 text-[11px] mt-2"><span className="text-foreground-400">失效條件：</span>{chain.invalidation_condition}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* 6.7 盤中驗證計畫 — V7.53 */}
        {/* ═══════════════════════════════════════════ */}
        {strategy.intraday_validation_plan && (strategy.intraday_validation_plan.open_0900_0930 || strategy.intraday_validation_plan.mid_session_1000_1130 || strategy.intraday_validation_plan.afternoon_1300_1330) && (
          <section className="bg-white border border-background-200 rounded-xl p-5">
            <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
              <i className="ri-timer-line text-foreground-400"></i>
              盤中驗證計畫
            </h2>
            <div className="space-y-3">
              {strategy.intraday_validation_plan.open_0900_0930 && (
                <div className="bg-sky-500/3 border border-sky-500/10 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-md bg-sky-500 flex items-center justify-center text-white text-[10px] font-bold">09:00</span>
                    <span className="text-foreground-800 font-semibold text-sm">開盤 09:00-09:30</span>
                  </div>
                  <p className="text-foreground-700 text-xs leading-relaxed">{strategy.intraday_validation_plan.open_0900_0930}</p>
                </div>
              )}
              {strategy.intraday_validation_plan.mid_session_1000_1130 && (
                <div className="bg-amber-500/3 border border-amber-500/10 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-md bg-amber-500 flex items-center justify-center text-white text-[10px] font-bold">10:00</span>
                    <span className="text-foreground-800 font-semibold text-sm">盤中 10:00-11:30</span>
                  </div>
                  <p className="text-foreground-700 text-xs leading-relaxed">{strategy.intraday_validation_plan.mid_session_1000_1130}</p>
                </div>
              )}
              {strategy.intraday_validation_plan.afternoon_1300_1330 && (
                <div className="bg-rose-500/3 border border-rose-500/10 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-md bg-rose-500 flex items-center justify-center text-white text-[10px] font-bold">13:00</span>
                    <span className="text-foreground-800 font-semibold text-sm">尾盤 13:00-13:30</span>
                  </div>
                  <p className="text-foreground-700 text-xs leading-relaxed">{strategy.intraday_validation_plan.afternoon_1300_1330}</p>
                </div>
              )}
              {strategy.intraday_validation_plan.fail_signals.length > 0 && (
                <div className="bg-red-500/3 border border-red-500/10 rounded-lg p-4">
                  <p className="text-red-600 text-xs font-semibold mb-2">失效訊號</p>
                  <ul className="space-y-1">
                    {strategy.intraday_validation_plan.fail_signals.map((sig, i) => (
                      <li key={i} className="text-red-600 text-xs flex items-start gap-2">
                        <i className="ri-close-circle-line text-red-500 mt-0.5 flex-shrink-0"></i>
                        {sig}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* 6.8 失效條件 — V7.53 */}
        {/* ═══════════════════════════════════════════ */}
        {strategy.invalidation_conditions.length > 0 && (
          <section className="bg-white border border-background-200 rounded-xl p-5">
            <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
              <i className="ri-close-circle-line text-foreground-400"></i>
              失效條件
            </h2>
            <div className="space-y-3">
              {strategy.invalidation_conditions.map((inv, i) => (
                <div key={i} className="bg-rose-500/3 border border-rose-500/10 rounded-lg p-4">
                  <p className="text-foreground-800 font-semibold text-xs mb-1">如果發生：{inv.condition}</p>
                  {inv.meaning && <p className="text-foreground-600 text-xs leading-relaxed mb-1"><span className="text-foreground-400">代表：</span>{inv.meaning}</p>}
                  {inv.required_adjustment && <p className="text-foreground-500 text-[11px]"><span className="text-foreground-400">修正：</span>{inv.required_adjustment}</p>}
                  {inv.why_member_should_care && <p className="text-foreground-500 text-[11px] mt-1"><span className="text-foreground-400">會員須知：</span>{inv.why_member_should_care}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* 6.9 收盤回饋計畫 — V7.53 */}
        {/* ═══════════════════════════════════════════ */}
        {strategy.closing_feedback_plan && (strategy.closing_feedback_plan.what_to_check_after_close || strategy.closing_feedback_plan.how_to_score_today || strategy.closing_feedback_plan.what_to_adjust_tomorrow) && (
          <section className="bg-white border border-background-200 rounded-xl p-5">
            <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
              <i className="ri-loop-left-line text-foreground-400"></i>
              收盤回饋計畫
            </h2>
            <div className="space-y-3">
              {strategy.closing_feedback_plan.what_to_check_after_close && (
                <div className="bg-background-50 rounded-lg p-4 border border-background-100">
                  <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">收盤後檢查</p>
                  <p className="text-foreground-700 text-sm leading-relaxed">{strategy.closing_feedback_plan.what_to_check_after_close}</p>
                </div>
              )}
              {strategy.closing_feedback_plan.how_to_score_today && (
                <div className="bg-background-50 rounded-lg p-4 border border-background-100">
                  <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">如何評分今日</p>
                  <p className="text-foreground-700 text-sm leading-relaxed">{strategy.closing_feedback_plan.how_to_score_today}</p>
                </div>
              )}
              {strategy.closing_feedback_plan.what_to_adjust_tomorrow && (
                <div className="bg-amber-500/3 rounded-lg p-4 border border-amber-500/10">
                  <p className="text-amber-600 text-[10px] uppercase tracking-wider mb-1">明日調整</p>
                  <p className="text-amber-700 text-sm leading-relaxed">{strategy.closing_feedback_plan.what_to_adjust_tomorrow}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* 6.10 會員續訂價值 — V7.53 */}
        {/* ═══════════════════════════════════════════ */}
        {strategy.renewal_value_block && (strategy.renewal_value_block.why_member_should_read_today || strategy.renewal_value_block.what_free_news_does_not_provide || strategy.renewal_value_block.tomorrow_followup_hook) && (
          <section className="bg-white border border-background-200 rounded-xl p-5">
            <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
              <i className="ri-heart-line text-foreground-400"></i>
              會員續訂價值
            </h2>
            <div className="space-y-3">
              {strategy.renewal_value_block.why_member_should_read_today && (
                <div className="bg-primary-500/3 border border-primary-500/10 rounded-lg p-4">
                  <p className="text-primary-600 text-[10px] uppercase tracking-wider mb-1">為什麼會員今天該看</p>
                  <p className="text-foreground-700 text-sm leading-relaxed">{strategy.renewal_value_block.why_member_should_read_today}</p>
                </div>
              )}
              {strategy.renewal_value_block.what_free_news_does_not_provide && (
                <div className="bg-foreground-900/3 border border-foreground-900/5 rounded-lg p-4">
                  <p className="text-foreground-500 text-[10px] uppercase tracking-wider mb-1">免費新聞沒提供的</p>
                  <p className="text-foreground-700 text-sm leading-relaxed">{strategy.renewal_value_block.what_free_news_does_not_provide}</p>
                </div>
              )}
              {strategy.renewal_value_block.tomorrow_followup_hook && (
                <div className="bg-emerald-500/3 border border-emerald-500/10 rounded-lg p-4">
                  <p className="text-emerald-600 text-[10px] uppercase tracking-wider mb-1">明天為什麼還要回來看</p>
                  <p className="text-emerald-700 text-sm leading-relaxed">{strategy.renewal_value_block.tomorrow_followup_hook}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* 七、腳本與推播文案 */}
        {/* ═══════════════════════════════════════════ */}
        <section id="section-scripts" className="bg-white border border-background-200 rounded-xl p-5">
          <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
            <i className="ri-film-line text-foreground-400"></i>
            腳本與推播文案
          </h2>

          {allScriptsMissing ? (
            <div className="bg-background-50 rounded-xl p-5 text-center">
              <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center mx-auto mb-3">
                <i className="ri-file-unknow-line text-orange-500 text-lg"></i>
              </div>
              <p className="text-foreground-700 text-sm font-medium mb-1">腳本與推播文案尚未產生</p>
              <p className="text-foreground-500 text-xs max-w-md mx-auto leading-relaxed">
                重新產生新版報告後，OpenAI 會同步產生 Reels 60 秒腳本、社群短文與 LINE 推播文案。
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* ── Reels 60 秒腳本 ── */}
              {hasReels && (
                <div>
                  <h3 className="text-foreground-700 font-semibold text-xs mb-3 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-rose-500/10 flex items-center justify-center">
                      <i className="ri-vidicon-line text-rose-500 text-sm"></i>
                    </span>
                    Reels 60 秒腳本
                  </h3>
                  <div className="space-y-2.5">
                    <ScriptCard label="開場鉤子" time="0～5 秒" value={grabOrEmpty(reelsScript, 'hook_0_5_sec')} icon="ri-flashlight-line" />
                    <ScriptCard label="核心內容" time="5～25 秒" value={grabOrEmpty(reelsScript, 'core_5_25_sec')} icon="ri-focus-3-line" />
                    <ScriptCard label="風險提醒" time="25～40 秒" value={grabOrEmpty(reelsScript, 'risk_25_40_sec')} icon="ri-alert-line" tone="warn" />
                    <ScriptCard label="觀察重點" time="40～55 秒" value={grabOrEmpty(reelsScript, 'watch_40_55_sec')} icon="ri-eye-line" />
                    <ScriptCard label="收尾 CTA" time="55～60 秒" value={grabOrEmpty(reelsScript, 'cta_55_60_sec')} icon="ri-thumb-up-line" tone="accent" />
                    {grabOrEmpty(reelsScript, 'full_script') ? (
                      <div className="bg-background-50 rounded-xl p-4 border border-background-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-foreground-500 text-[10px] uppercase tracking-wider font-medium">完整腳本</span>
                          <CopyButton text={grabOrEmpty(reelsScript, 'full_script') ?? ''} />
                        </div>
                        <p className="text-foreground-700 text-sm whitespace-pre-wrap leading-relaxed">{grabOrEmpty(reelsScript, 'full_script')}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {/* ── 社群短文 ── */}
              {hasSocial && (
                <div className={hasReels ? 'pt-5 border-t border-background-100' : ''}>
                  <h3 className="text-foreground-700 font-semibold text-xs mb-3 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-sky-500/10 flex items-center justify-center">
                      <i className="ri-chat-3-line text-sky-500 text-sm"></i>
                    </span>
                    社群短文
                  </h3>
                  <div className="space-y-2.5">
                    <ScriptCard label="標題" value={grabOrEmpty(socialPost, 'title')} icon="ri-hashtag" highlight />
                    {grabArr(socialPost, 'three_points').length > 0 ? (
                      <div className="bg-background-50 rounded-xl p-4 border border-background-100">
                        <p className="text-foreground-500 text-[10px] uppercase tracking-wider font-medium mb-2">三個重點</p>
                        <ul className="space-y-1.5">
                          {grabArr(socialPost, 'three_points').map((p, i) => (
                            <li key={i} className="flex items-start gap-2 text-foreground-700 text-sm">
                              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-foreground-900 text-white flex items-center justify-center text-[10px] font-bold mt-0.5">{i + 1}</span>
                              {renderSafeText(p)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <ScriptCard label="風險提醒" value={grabOrEmpty(socialPost, 'risk_reminder')} icon="ri-alert-line" tone="warn" />
                    <ScriptCard label="CTA" value={grabOrEmpty(socialPost, 'cta')} icon="ri-thumb-up-line" tone="accent" />
                    {grabOrEmpty(socialPost, 'full_post') ? (
                      <div className="bg-background-50 rounded-xl p-4 border border-background-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-foreground-500 text-[10px] uppercase tracking-wider font-medium">完整貼文</span>
                          <CopyButton text={grabOrEmpty(socialPost, 'full_post') ?? ''} />
                        </div>
                        <p className="text-foreground-700 text-sm whitespace-pre-wrap leading-relaxed">{grabOrEmpty(socialPost, 'full_post')}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {/* ── LINE 推播文案 ── */}
              {hasLine && (
                <div className={(hasReels || hasSocial) ? 'pt-5 border-t border-background-100' : ''}>
                  <h3 className="text-foreground-700 font-semibold text-xs mb-3 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-emerald-500/10 flex items-center justify-center">
                      <i className="ri-line-line text-emerald-500 text-sm"></i>
                    </span>
                    LINE 推播文案
                  </h3>
                  <div className="space-y-2.5">
                    <ScriptCard label="推播標題" value={grabOrEmpty(linePush, 'title')} icon="ri-hashtag" highlight />
                    <ScriptCard label="一句話" value={grabOrEmpty(linePush, 'one_sentence')} icon="ri-message-2-line" />
                    <ScriptCard label="今日不要做" value={grabOrEmpty(linePush, 'do_not_do')} icon="ri-close-circle-line" tone="warn" />
                    <ScriptCard label="觀察重點" value={grabOrEmpty(linePush, 'watch_point')} icon="ri-eye-line" />
                    <ScriptCard label="CTA" value={grabOrEmpty(linePush, 'cta')} icon="ri-thumb-up-line" tone="accent" />
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════ */}
        {/* 八、內容品質評分 */}
        {/* ═══════════════════════════════════════════ */}
        {hasQuality && (
          <section className="bg-white border border-background-200 rounded-xl p-5">
            <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
              <i className="ri-shield-check-line text-foreground-400"></i>
              內容品質檢查
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <FlagBox label="主劇本" ok={grabBool(qualityFlags, 'has_member_research_note')} />
                <FlagBox label="資料證據" ok={grabBool(qualityFlags, 'has_member_research_note')} />
                <FlagBox label="隔夜影響鏈" ok={grabBool(qualityFlags, 'has_member_research_note')} />
                <FlagBox label="今日不要做" ok={grabBool(qualityFlags, 'has_do_not_do_list')} />
                <FlagBox label="盤中追蹤" ok={grabBool(qualityFlags, 'has_intraday_tracking_plan')} />
                <FlagBox label="失效條件" ok={grabBool(qualityFlags, 'has_invalidation_conditions')} />
                <FlagBox label="收盤驗證" ok={grabBool(qualityFlags, 'has_member_research_note')} />
                <FlagBox label="Reels 腳本" ok={grabBool(qualityFlags, 'has_reels_script')} />
                <FlagBox label="社群短文" ok={grabBool(qualityFlags, 'has_social_post')} />
                <FlagBox label="LINE 推播" ok={grabBool(qualityFlags, 'has_line_push_copy')} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <RiskFlag
                  label="過度模板化"
                  triggered={grabBool(qualityFlags, 'is_template_like')}
                  warn="內容大量出現空泛句，如「留意市場變化」「等待更多訊號」但無具體線索"
                  okMsg="內容具備具體市場線索，非模板化"
                />
                <RiskFlag
                  label="禁用詞"
                  triggered={grabBool(qualityFlags, 'has_forbidden_words')}
                  warn="內容可能含有買進、賣出、明牌、必漲、必跌、目標價等禁用詞"
                  okMsg="未檢測到禁用詞"
                />
                <RiskFlag
                  label="假資料風險"
                  triggered={grabBool(qualityFlags, 'has_fake_data_risk')}
                  warn="內容可能使用了資料中不存在的股票或新聞"
                  okMsg="未檢測到假資料風險"
                />
              </div>
              <div className="bg-background-50 rounded-lg p-3 mt-2">
                <p className="text-foreground-500 text-xs font-medium mb-1">品質備註</p>
                <p className="text-foreground-700 text-sm">{grab(qualityFlags, 'quality_note')}</p>
              </div>
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* 九、最近驗證回饋 */}
        {/* ═══════════════════════════════════════════ */}
        <section className="bg-white border border-background-200 rounded-xl p-5">
          <h2 className="text-foreground-900 font-semibold text-sm mb-4 flex items-center gap-2">
            <i className="ri-loop-left-line text-foreground-400"></i>
            最近驗證回饋
          </h2>
          <p className="text-foreground-400 text-xs mb-4">
            系統不是每天重猜，而是有根據昨天驗證結果調整今天判斷。
          </p>
          {renderValidationFeedback(aiJson, memberNote)}
        </section>

        </>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* 十、報告歷史列表（含狀態） */}
      {/* ═══════════════════════════════════════════ */}
      <section className="bg-white border border-background-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-background-100">
          <h2 className="text-foreground-900 font-semibold text-sm flex items-center gap-2">
            <i className="ri-history-line text-foreground-400"></i>
            報告歷史（點擊列切換查看）
          </h2>
        </div>
        {reports.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-foreground-500 text-sm">尚無報告資料</p>
          </div>
        ) : (
          <>
            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="bg-background-50">
                  <th className="px-3 py-2.5 text-left text-foreground-500 text-[10px] font-medium whitespace-nowrap">報告日期</th>
                  <th className="px-3 py-2.5 text-left text-foreground-500 text-[10px] font-medium whitespace-nowrap">盤前假設</th>
                  <th className="px-3 py-2.5 text-left text-foreground-500 text-[10px] font-medium whitespace-nowrap">把握度</th>
                  <th className="px-3 py-2.5 text-center text-foreground-500 text-[10px] font-medium whitespace-nowrap">免費摘要</th>
                  <th className="px-3 py-2.5 text-center text-foreground-500 text-[10px] font-medium whitespace-nowrap">會員內容</th>
                  <th className="px-3 py-2.5 text-center text-foreground-500 text-[10px] font-medium whitespace-nowrap">Reels / LINE</th>
                  <th className="px-3 py-2.5 text-center text-foreground-500 text-[10px] font-medium whitespace-nowrap">發布狀態</th>
                  <th className="px-3 py-2.5 text-left text-foreground-500 text-[10px] font-medium whitespace-nowrap">建立時間</th>
                  <th className="px-3 py-2.5 text-center text-foreground-500 text-[10px] font-medium whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-100">
                {reports.map((r) => {
                  const mn = grabObj(r.ai_strategy_json, 'member_research_note');
                  const fs = grabObj(r.ai_strategy_json, 'free_summary');
                  const rls = grabObj(r.ai_strategy_json, 'reels_script');
                  const lp = grabObj(r.ai_strategy_json, 'line_push_copy');
                  const pubStatus = getPublishStatus(r);
                  const hasMn = hasContent(mn);
                  const hasFs = hasContent(fs);
                  const hasRlsOrLine = hasContent(rls) || hasContent(lp);
                  const isOldR = !hasMn && !hasContent(rls) && !hasContent(grabObj(r.ai_strategy_json, 'social_post')) && !hasContent(lp) && !hasContent(grabObj(r.ai_strategy_json, 'content_quality_flags')) && hasFs;

                  return (
                    <tr
                      key={r.id}
                      className={`hover:bg-background-50 transition-colors cursor-pointer ${selectedReport?.id === r.id ? 'bg-emerald-500/4' : ''}`}
                      onClick={() => setSelectedReport(r)}
                    >
                      <td className="px-3 py-3 text-foreground-800 text-xs font-mono whitespace-nowrap">
                        {r.report_date}
                        {isOldR && <span className="ml-1.5 text-[10px] text-amber-500">舊版</span>}
                        {!hasMn && !isOldR && <span className="ml-1.5 text-[10px] text-orange-500">缺會員</span>}
                      </td>
                      <td className="px-3 py-3">{biasBadge(r.market_bias)}</td>
                      <td className="px-3 py-3 text-foreground-700 text-xs font-mono">{r.confidence_score ?? '—'}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${hasFs ? 'bg-emerald-500/10 text-emerald-600' : 'bg-background-50 text-foreground-400'}`}>
                          {hasFs ? '有' : '無'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${hasMn ? 'bg-emerald-500/10 text-emerald-600' : isOldR ? 'bg-amber-500/10 text-amber-600' : 'bg-orange-500/10 text-orange-600'}`}>
                          {hasMn ? '有' : isOldR ? '舊版' : '無'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${hasRlsOrLine ? 'bg-emerald-500/10 text-emerald-600' : isOldR ? 'bg-amber-500/10 text-amber-600' : 'bg-orange-500/10 text-orange-600'}`}>
                          {hasRlsOrLine ? '有' : isOldR ? '舊版' : '無'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${pubStatus.cls}`}>
                          {pubStatus.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-foreground-400 text-[11px] whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-emerald-500 text-xs font-medium whitespace-nowrap cursor-pointer">
                          {selectedReport?.id === r.id ? '檢視中' : '查看'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            {/* Mobile: card list */}
            <div className="md:hidden divide-y divide-background-100">
              {reports.map((r) => {
                const mn = grabObj(r.ai_strategy_json, 'member_research_note');
                const fs = grabObj(r.ai_strategy_json, 'free_summary');
                const rls = grabObj(r.ai_strategy_json, 'reels_script');
                const lp = grabObj(r.ai_strategy_json, 'line_push_copy');
                const pubStatus = getPublishStatus(r);
                const hasMn = hasContent(mn);
                const hasFs = hasContent(fs);
                const hasRlsOrLine = hasContent(rls) || hasContent(lp);
                const isOldR = !hasMn && !hasContent(rls) && !hasContent(grabObj(r.ai_strategy_json, 'social_post')) && !hasContent(lp) && !hasContent(grabObj(r.ai_strategy_json, 'content_quality_flags')) && hasFs;
                const isSelected = selectedReport?.id === r.id;

                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedReport(r)}
                    className={`px-4 py-3 cursor-pointer transition-colors ${isSelected ? 'bg-emerald-500/5 border-l-2 border-emerald-500' : 'hover:bg-background-50 border-l-2 border-transparent'}`}
                  >
                    {/* Top row: date + status */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground-800 text-sm font-mono font-semibold">{r.report_date}</span>
                        {isOldR && <span className="text-[10px] text-amber-500 bg-amber-500/8 px-1.5 py-0.5 rounded">舊版</span>}
                        {!hasMn && !isOldR && <span className="text-[10px] text-orange-500 bg-orange-500/8 px-1.5 py-0.5 rounded">缺會員</span>}
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${pubStatus.cls}`}>
                        {pubStatus.label}
                      </span>
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 text-xs mb-2.5">
                      <span className="text-foreground-400">盤前假設：</span>
                      {biasBadge(r.market_bias)}
                      <span className="text-foreground-300 mx-1">|</span>
                      <span className="text-foreground-400">把握度：</span>
                      <span className="text-foreground-700 font-mono">{r.confidence_score ?? '—'}</span>
                    </div>

                    {/* Status badges row */}
                    <div className="flex flex-wrap items-center gap-2 mb-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${hasFs ? 'bg-emerald-500/10 text-emerald-600' : 'bg-background-100 text-foreground-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${hasFs ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
                        免費摘要{hasFs ? '有' : '無'}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${hasMn ? 'bg-emerald-500/10 text-emerald-600' : isOldR ? 'bg-amber-500/10 text-amber-600' : 'bg-orange-500/10 text-orange-600'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${hasMn ? 'bg-emerald-500' : isOldR ? 'bg-amber-500' : 'bg-orange-500'}`}></span>
                        會員{hasMn ? '有' : isOldR ? '舊版' : '無'}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${hasRlsOrLine ? 'bg-emerald-500/10 text-emerald-600' : isOldR ? 'bg-amber-500/10 text-amber-600' : 'bg-orange-500/10 text-orange-600'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${hasRlsOrLine ? 'bg-emerald-500' : isOldR ? 'bg-amber-500' : 'bg-orange-500'}`}></span>
                        Reels/LINE{hasRlsOrLine ? '有' : isOldR ? '舊版' : '無'}
                      </span>
                    </div>

                    {/* Bottom row: time + view */}
                    <div className="flex items-center justify-between">
                      <span className="text-foreground-400 text-[10px]">
                        {r.created_at ? new Date(r.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                      <span className={`text-xs font-medium ${isSelected ? 'text-emerald-500' : 'text-foreground-500'}`}>
                        {isSelected ? '檢視中' : '點擊查看 →'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* 手動觸發說明彈窗 */}
      {/* ═══════════════════════════════════════════ */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#07111f]/50" onClick={() => setShowManualModal(false)}>
          <div className="bg-white rounded-2xl border border-background-200 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-background-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <i className="ri-question-line text-amber-500 text-lg"></i>
                </div>
                <h3 className="text-foreground-900 font-bold text-base">如何手動重新產生{isTradingDay ? '今日' : '最近交易日'}內容？</h3>
              </div>
              <button
                onClick={() => setShowManualModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
              >
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-foreground-600 text-sm leading-relaxed">
                如果前端自動觸發失敗或無法連線，可以依照以下步驟在 Supabase 後台手動觸發 Edge Function。
              </p>

              <ol className="space-y-4">
                {[
                  { step: 1, title: '打開 Supabase 後台', desc: '前往你的 Supabase 專案 Dashboard。' },
                  { step: 2, title: '進入 Edge Functions', desc: '左側選單點擊 Edge Functions。' },
                  { step: 3, title: '找到 generate-daily-report-v7', desc: '在列表中尋找 generate-daily-report-v7，點擊進入。' },
                  { step: 4, title: '點擊 Invoke（或 Run / Test function）', desc: '在函數頁面右上角或編輯器內找到 Invoke 按鈕，點擊執行。可以傳入參數：{ "force_run": true } 強制重新產生。' },
                  { step: 5, title: '等待執行完成', desc: 'Edge Function 執行約需 30～90 秒，請等待日誌顯示成功。' },
                  { step: 6, title: '回到 Morning Alpha 後台重新檢查', desc: '執行成功後回到此頁面，點擊「我已手動觸發，重新檢查」按鈕，系統會檢查最新報告是否包含完整會員內容。' },
                ].map((item) => (
                  <li key={item.step} className="flex gap-3">
                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 text-xs font-bold">{item.step}</span>
                    <div>
                      <p className="text-foreground-800 text-sm font-semibold">{item.title}</p>
                      <p className="text-foreground-500 text-xs mt-0.5 leading-relaxed">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-4">
                <p className="text-amber-700 text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                  <i className="ri-lightbulb-line"></i>
                  驗收檢查
                </p>
                <p className="text-amber-600 text-xs leading-relaxed">
                  成功後檢查是否產生以下內容：會員研究筆記（9 段）、Reels 60 秒腳本、社群短文、LINE 推播文案、內容品質檢查（content_quality_flags）、內容發布閘（content_publish_gate）、自動發布決策（auto_publish_decision）。
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-background-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
              <button
                onClick={() => { setShowManualModal(false); recheckReport(); }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-search-line"></i>
                我已手動觸發，重新檢查
              </button>
              <button
                onClick={() => setShowManualModal(false)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-background-200 hover:border-background-300 rounded-xl text-foreground-600 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════

function StatusRow({ label, ok, isOld }: { label: string; ok: boolean; isOld: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-foreground-700 text-sm">{label}</span>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${
        ok ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/15' :
        isOld ? 'bg-amber-500/5 text-amber-600 border-amber-500/15' :
        'bg-orange-500/5 text-orange-600 border-orange-500/15'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : isOld ? 'bg-amber-500' : 'bg-orange-500'}`}></span>
        {ok ? '已產生' : isOld ? '舊版報告' : '尚未產生'}
      </span>
    </div>
  );
}

function StatusItem({ label, ok, isOld }: { label: string; ok: boolean; isOld: boolean }) {
  return (
    <div className={`p-3 rounded-lg border ${ok ? 'bg-emerald-500/3 border-emerald-500/15' : isOld ? 'bg-amber-500/3 border-amber-500/15' : 'bg-orange-500/3 border-orange-500/15'}`}>
      <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-500' : isOld ? 'bg-amber-500' : 'bg-orange-500'}`}></span>
        <p className={`text-xs font-medium ${ok ? 'text-emerald-600' : isOld ? 'text-amber-600' : 'text-orange-600'}`}>
          {ok ? '已產生' : isOld ? '舊版報告' : '尚未產生'}
        </p>
      </div>
    </div>
  );
}

function FreeRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-3 rounded-lg ${highlight ? 'bg-primary-500/3 border border-primary-500/10' : 'bg-background-50 border border-background-100'}`}>
      <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-sm leading-relaxed ${highlight ? 'text-foreground-900 font-semibold' : 'text-foreground-700'}`}>{value}</p>
    </div>
  );
}

function ScriptSegment({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-3 rounded-lg ${highlight ? 'bg-primary-500/3 border border-primary-500/10' : 'bg-background-50 border border-background-100'}`}>
      <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-foreground-700 text-sm leading-relaxed">{value}</p>
    </div>
  );
}

function QualityBadge({ label, value, highlight, mono }: { label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div className={`p-2 rounded-lg border ${highlight === true ? 'bg-emerald-500/3 border-emerald-500/15' : highlight === false ? 'bg-rose-500/3 border-rose-500/15' : 'bg-background-50 border-background-100'}`}>
      <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-xs font-bold truncate ${highlight === true ? 'text-emerald-600' : highlight === false ? 'text-rose-600' : 'text-foreground-800'} ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value || '—'}
      </p>
    </div>
  );
}

function CompareRow({ label, free, member }: { label: string; free: string; member: string }) {
  return (
    <tr>
      <td className="px-4 py-3 text-foreground-800 text-xs font-medium">{label}</td>
      <td className="px-4 py-3 text-foreground-500 text-xs">{free}</td>
      <td className="px-4 py-3 text-foreground-700 text-xs">{member}</td>
    </tr>
  );
}

function FlagBox({ label, ok }: { label: string; ok: boolean | null }) {
  return (
    <div className={`p-3 rounded-lg border ${ok === true ? 'bg-emerald-500/3 border-emerald-500/15' : ok === false ? 'bg-red-500/3 border-red-500/15' : 'bg-background-50 border-background-100'}`}>
      <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xs font-medium ${ok === true ? 'text-emerald-600' : ok === false ? 'text-red-500' : 'text-foreground-400'}`}>
        {ok === true ? '通過' : ok === false ? '未通過' : '—'}
      </p>
    </div>
  );
}

function RiskFlag({ label, triggered, warn, okMsg }: { label: string; triggered: boolean | null; warn: string; okMsg: string }) {
  return (
    <div className={`p-3 rounded-lg border ${triggered === true ? 'bg-red-500/3 border-red-500/15' : triggered === false ? 'bg-emerald-500/3 border-emerald-500/15' : 'bg-background-50 border-background-100'}`}>
      <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xs font-medium mb-1 ${triggered === true ? 'text-red-600' : triggered === false ? 'text-emerald-600' : 'text-foreground-400'}`}>
        {triggered === true ? '⚠ 觸發' : triggered === false ? '安全' : '—'}
      </p>
      <p className="text-foreground-500 text-[10px] leading-relaxed">
        {triggered === true ? warn : triggered === false ? okMsg : ''}
      </p>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-foreground-400 flex-shrink-0">{label}：</span>
      <span className={`text-foreground-700 truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text || text === '—') return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-background-200 hover:border-background-300 rounded-md text-foreground-400 hover:text-foreground-600 text-[10px] transition-colors cursor-pointer whitespace-nowrap"
    >
      <i className={copied ? 'ri-check-line text-emerald-500' : 'ri-file-copy-line'}></i>
      {copied ? '已複製' : '複製'}
    </button>
  );
}

// ═══════════════════════════════════════════════════
// grabOrEmpty — returns string or null (for ScriptSegmentOrEmpty)
// ═══════════════════════════════════════════════════

function grabOrEmpty(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function ScriptSegmentOrEmpty({ label, value, highlight }: { label: string; value: string | null; highlight?: boolean }) {
  if (value) {
    return (
      <div className={`p-3 rounded-lg ${highlight ? 'bg-primary-500/3 border border-primary-500/10' : 'bg-background-50 border border-background-100'}`}>
        <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">{label}</p>
        <p className="text-foreground-700 text-sm leading-relaxed">{value}</p>
      </div>
    );
  }
  return (
    <div className="p-3 rounded-lg bg-background-50 border border-background-100 border-dashed">
      <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-foreground-400 text-xs italic">此欄位尚未產生</p>
    </div>
  );
}

function ScriptCard({ label, time, value, icon, tone, highlight }: { label: string; time?: string; value: string | null; icon: string; tone?: 'warn' | 'accent'; highlight?: boolean }) {
  if (!value) {
    return (
      <div className="rounded-xl border border-background-100 border-dashed p-3.5 bg-background-50/50">
        <div className="flex items-center gap-2 mb-1">
          <i className={`${icon} text-foreground-400 text-sm`}></i>
          <span className="text-foreground-400 text-xs font-medium">{label}</span>
          {time && <span className="text-foreground-300 text-[10px]">{time}</span>}
        </div>
        <p className="text-foreground-400 text-xs italic">此欄位尚未產生</p>
      </div>
    );
  }

  const borderColor = tone === 'warn' ? 'border-rose-500/15' : tone === 'accent' ? 'border-primary-500/15' : highlight ? 'border-primary-500/15' : 'border-background-100';
  const bgColor = highlight ? 'bg-primary-500/[0.03]' : 'bg-white';

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} p-3.5`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <i className={`${icon} ${tone === 'warn' ? 'text-rose-500' : tone === 'accent' ? 'text-primary-500' : 'text-foreground-500'} text-sm`}></i>
          <span className="text-foreground-500 text-xs font-semibold">{label}</span>
          {time && <span className="text-foreground-400 text-[10px] bg-background-100 px-1.5 py-0.5 rounded-full">{time}</span>}
        </div>
        <CopyButton text={value} />
      </div>
      <p className={`text-sm leading-relaxed whitespace-pre-wrap ${highlight ? 'text-foreground-800 font-medium' : 'text-foreground-700'}`}>{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Member content extraction helpers (for comparison)
// ═══════════════════════════════════════════════════

function findSectionByKeyOrTitle(sections: Record<string, unknown>[], key: string, index?: number, titleHint?: string): Record<string, unknown> | null {
  const byKey = sections.find((s) => s.key === key);
  if (byKey) return byKey;
  if (titleHint) {
    const byTitle = sections.find((s) => {
      const t = String(s.title || '');
      return t.includes(titleHint);
    });
    if (byTitle) return byTitle;
  }
  if (index !== undefined && index >= 0 && index < sections.length) return sections[index];
  return null;
}

function extractMemberSectionSummary(memberNote: Record<string, unknown>, key: string, index?: number): string {
  const sections = grabArr(memberNote, 'sections') as Record<string, unknown>[];
  const sec = findSectionByKeyOrTitle(sections, key, index);
  if (!sec) return '—';
  const content = grab(sec, 'content');
  if (content !== '—') return content.length > 90 ? content.slice(0, 90) + '...' : content;
  const conclusion = grab(sec, 'conclusion');
  if (conclusion !== '—') return conclusion.length > 90 ? conclusion.slice(0, 90) + '...' : conclusion;
  const reasoning = grab(sec, 'reasoning');
  if (reasoning !== '—') return reasoning.length > 90 ? reasoning.slice(0, 90) + '...' : reasoning;
  // Fallback: grab any text field
  for (const f of ['thesis', 'summary', 'description', 'note']) {
    const v = grab(sec, f);
    if (v !== '—') return v.length > 90 ? v.slice(0, 90) + '...' : v;
  }
  return '已產生（請查看完整內容）';
}

function extractMemberSectionEvidence(memberNote: Record<string, unknown>): string {
  const sections = grabArr(memberNote, 'sections') as Record<string, unknown>[];
  const sec = findSectionByKeyOrTitle(sections, 'evidence', 1, '證據');
  if (!sec) return '—';
  const content = grab(sec, 'content');
  if (content !== '—') return content.length > 90 ? content.slice(0, 90) + '...' : content;
  const conclusion = grab(sec, 'conclusion');
  if (conclusion !== '—') return conclusion.length > 90 ? conclusion.slice(0, 90) + '...' : conclusion;
  const items = grabArr(sec, 'evidence_items') as Record<string, unknown>[];
  if (items.length === 0) {
    // Fallback: check supporting_signals
    const signals = grabArr(sec, 'supporting_signals');
    if (signals.length > 0) return `共 ${signals.length} 筆證據：${String(signals[0]).slice(0, 50)}...`;
    const reasoning = grab(sec, 'reasoning');
    if (reasoning !== '—') return reasoning.length > 90 ? reasoning.slice(0, 90) + '...' : reasoning;
    return '—';
  }
  const first = items[0];
  const signal = grab(first, 'signal');
  if (signal !== '—') return signal.length > 90 ? signal.slice(0, 90) + '...' : signal;
  const observation = grab(first, 'observation');
  if (observation !== '—') return observation.length > 90 ? observation.slice(0, 90) + '...' : observation;
  return `共 ${items.length} 筆證據`;
}

function extractMemberSectionDontDo(memberNote: Record<string, unknown>): string {
  const sections = grabArr(memberNote, 'sections') as Record<string, unknown>[];
  const sec = findSectionByKeyOrTitle(sections, 'do_not_do', 3, '不要做');
  if (!sec) return '—';
  const content = grab(sec, 'content');
  if (content !== '—') return content.length > 90 ? content.slice(0, 90) + '...' : content;
  const conclusion = grab(sec, 'conclusion');
  if (conclusion !== '—') return conclusion.length > 90 ? conclusion.slice(0, 90) + '...' : conclusion;
  const items = grabArr(sec, 'items') as (string | Record<string, unknown>)[];
  if (items.length === 0) return '—';
  const first = items[0];
  const firstText = typeof first === 'string' ? first : grab(first as Record<string, unknown>, 'text', 'condition', 'content');
  return `${items.length} 條：${firstText.length > 50 ? firstText.slice(0, 50) + '...' : firstText}`;
}

function CompareCard({ label, free, member }: { label: string; free: string; member: string }) {
  return (
    <div className="bg-background-50 rounded-xl border border-background-100 p-4">
      <p className="text-foreground-800 text-xs font-semibold mb-3">{label}</p>
      <div className="space-y-2">
        <div className="bg-white rounded-lg p-3 border border-background-100">
          <span className="text-foreground-400 text-[10px] uppercase tracking-wider block mb-0.5">免費版</span>
          <p className="text-foreground-500 text-xs leading-relaxed">{free}</p>
        </div>
        <div className="bg-white rounded-lg p-3 border border-emerald-500/15">
          <span className="text-emerald-500 text-[10px] uppercase tracking-wider block mb-0.5">會員版</span>
          <p className="text-foreground-700 text-xs leading-relaxed">{member}</p>
        </div>
      </div>
    </div>
  );
}
