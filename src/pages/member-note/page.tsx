import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { renderSafeText } from '@/utils/renderSafe';
import type { Report } from '@/types/report';
import {
  hasValidMemberResearchNoteV2,
  hasValidMemberResearchText,
  parseAIStrategy,
  type MemberResearchNoteV2,
  type ParsedAIStrategy,
} from '@/utils/aiStrategyParser';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { trackPageView, trackEvent } from '@/utils/analytics';
import PaywallCard from '@/components/paywall/PaywallCard';
import { buildEntitlementFromTier, hasFeature } from '@/services/entitlementService';
import type { UserEntitlement } from '@/types/subscription';

function hasItems<T>(items: T[] | undefined): items is T[] {
  return Array.isArray(items) && items.length > 0;
}

type MemberBeneficiaryCandidate = {
  symbol?: string;
  name: string;
  sector?: string;
  reason?: string;
  risk?: string;
  watchPoint?: string;
  confidence?: string | number;
  evidence?: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function textValue(value: unknown): string {
  return String(value ?? '').trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textValue(value);
    if (text) return text;
  }
  return '';
}

function normalizeLegacyBeneficiary(row: Record<string, unknown>): MemberBeneficiaryCandidate | null {
  const name = firstText(row.stock_name, row.name);
  if (!name) return null;

  const evidence = Array.isArray(row.evidence)
    ? row.evidence.map((item) => textValue(item)).filter(Boolean)
    : undefined;

  return {
    symbol: firstText(row.symbol, row.stock_id, row.stock_code),
    name,
    sector: firstText(row.sector, row.group),
    reason: firstText(row.reason, row.rationale),
    risk: firstText(row.risk_note, row.risk),
    watchPoint: firstText(row.watch_point),
    confidence: row.confidence ?? row.confidence_level ?? row.confidence_score,
    evidence,
  };
}

function normalizeV2Beneficiary(item: NonNullable<MemberResearchNoteV2['beneficiary_candidates']>[number]): MemberBeneficiaryCandidate | null {
  const row = asRecord(item);
  const name = firstText(row.stock_name, row.name);
  if (!name) return null;

  return {
    symbol: firstText(row.stock_code, row.symbol, row.stock_id),
    name,
    sector: firstText(row.sector, row.group),
    reason: firstText(row.reason, row.rationale),
    risk: firstText(row.risk, row.risk_note),
    watchPoint: firstText(row.watch_point),
    confidence: row.confidence ?? row.confidence_level ?? row.confidence_score,
    evidence: Array.isArray(row.evidence) ? row.evidence.map((value) => textValue(value)).filter(Boolean) : undefined,
  };
}

function valueHasContent(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(valueHasContent);
  }
  return false;
}

function getObjectLines(value: Record<string, unknown>, preferredKeys: string[]): Array<{ label: string; value: string }> {
  const preferred = preferredKeys
    .map((key) => ({ label: key, value: textValue(value[key]) }))
    .filter((item) => item.value);

  if (preferred.length > 0) return preferred.slice(0, 6);

  return Object.entries(value)
    .filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item) && textValue(item))
    .slice(0, 6)
    .map(([key, item]) => ({ label: key, value: textValue(item) }));
}

function getDataLines(value: unknown, preferredKeys: string[]): Array<{ label: string; value: string }> {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = textValue(value);
    return text ? [{ label: 'summary', value: text }] : [];
  }

  if (Array.isArray(value)) {
    return value
      .map((item, idx) => ({ label: `item_${idx + 1}`, value: textValue(item) }))
      .filter((item) => item.value)
      .slice(0, 6);
  }

  if (value && typeof value === 'object') {
    return getObjectLines(value as Record<string, unknown>, preferredKeys);
  }

  return [];
}


function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => textValue(item)).filter(Boolean);
  const text = textValue(value);
  return text ? [text] : [];
}

function recordList(value: unknown): Record<string, unknown>[] {
  return asRecordArray(value);
}


function humanStatus(value: unknown): string {
  const raw = textValue(value).toLowerCase();
  if (!raw) return '待驗證';
  if (['ready', 'complete', 'completed'].includes(raw)) return '資料已完成';
  if (raw === 'mixed' || raw === 'partial') return '部分成立';
  if (raw === 'true') return '符合推論';
  if (raw === 'false') return '未符合盤前推論';
  if (raw === 'pending' || raw === 'pending_real_market_data') return '等待收盤資料';
  if (raw === 'hit' || raw === 'correct') return '命中';
  if (raw === 'miss' || raw === 'wrong') return '失準';
  if (raw === 'degraded') return '資料部分完成';
  return textValue(value);
}

function scoreTone(score: number | null): { stars: string; label: string } {
  if (score === null || !Number.isFinite(score)) return { stars: '☆☆☆☆☆', label: '待驗證' };
  if (score >= 80) return { stars: '★★★★★', label: '高把握' };
  if (score >= 65) return { stars: '★★★★☆', label: '中高把握' };
  if (score >= 50) return { stars: '★★★☆☆', label: '觀察' };
  if (score >= 35) return { stars: '★★☆☆☆', label: '低把握' };
  return { stars: '★☆☆☆☆', label: '僅供觀察' };
}

function firstLine(value: unknown): string {
  return textList(value)[0] || '';
}

function labelText(label: string): string {
  const labels: Record<string, string> = {
    summary: '摘要',
    market_bias: '方向',
    confidence_score: '判斷把握度',
    status: '資料狀態',
    data_status: '資料狀態',
    logic_source: '判斷依據',
    reason_chain: '推理鏈',
    market_score: '市場分數',
    news_score: '新聞分數',
    stock_code: '代號',
    stock_name: '名稱',
    sector: '族群',
    benefit_source: '受惠來源',
    relationship_to_thesis: '與主軸關係',
    validation_signal: '盤中驗證',
    invalidation_condition: '失效條件',
    trigger: '觸發條件',
    beneficiary_impact: '受惠股影響',
    avoid: '今日避免',
    condition: '條件',
    response: '應對',
    continuation_condition: '延續條件',
    what_to_verify: '驗證項目',
    expected_update: '更新方式',
    purpose: '目的',
    signals_to_watch: '觀察訊號',
    bullish_confirmation: '成立訊號',
    bearish_warning: '轉弱警訊',
    action_note: '操作提醒',
    expected_signal: '預期訊號',
    actual_signal: '實際訊號',
    tracked_count: '追蹤檔數',
    with_close_data_count: '有收盤資料',
    up_count: '上漲',
    down_count: '下跌',
    outperformed_taiex_count: '跑贏大盤',
    keep: '保留',
    downgrade: '降權',
    watch_tomorrow: '明日觀察',
    close_change_percent: '收盤漲跌',
    taiex_relative_percent: '相對 TAIEX',
    matched_logic: '是否符合邏輯',
    note: '驗證說明',
  };
  return labels[label] || label.replace(/_/g, ' ');
}

function MemberResearchNoteV2View({
  note,
  reportDate,
  twCoreDate,
  isHistoricalFallback,
  beneficiaryCandidates,
  hasClosingVerification,
}: {
  note: MemberResearchNoteV2;
  reportDate: string;
  twCoreDate: string;
  isHistoricalFallback: boolean;
  beneficiaryCandidates: MemberBeneficiaryCandidate[];
  hasClosingVerification: boolean;
}) {
  return (
    <section>
      <div className="relative bg-gradient-to-br from-navy-900/80 via-navy-900/60 to-navy-900/80 border border-forest-500/10 rounded-2xl p-5 md:p-8 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[60%] h-px bg-gradient-to-r from-transparent via-forest-400/30 to-transparent"></div>

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/12 rounded-full border border-emerald-400/35 mb-4">
            <i className="ri-eye-line text-emerald-400 text-xs"></i>
            <span className="text-emerald-300 text-[10px] font-semibold uppercase tracking-wider">
              {isHistoricalFallback ? '歷史資料模式' : '完整研究筆記'}
            </span>
          </div>
          <h2 className="text-white font-bold text-lg md:text-xl mb-2">
            第二層：{isHistoricalFallback ? '歷史盤前研究筆記' : '完整盤前研究筆記'}
          </h2>
          <p className="text-slate-300 text-xs mb-3">
            本篇為 {reportDate} 盤前研究筆記，行情基準採用最近完整交易日 {twCoreDate}。
          </p>
        </div>

        <div className="space-y-4">
          {valueHasContent(note.opening_thesis) && (
            <section className="p-4 rounded-xl bg-emerald-500/[0.04] border border-emerald-400/20">
              <h3 className="text-white font-semibold text-sm mb-3">今日主軸</h3>
              <div className="space-y-2">
                {textList(asRecord(note.opening_thesis).summary).map((line, idx) => (
                  <p key={idx} className="text-white/70 text-sm leading-relaxed">{renderSafeText(line)}</p>
                ))}
                {hasItems(textList(asRecord(note.opening_thesis).signals)) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {textList(asRecord(note.opening_thesis).signals).map((signal, idx) => (
                      <span key={idx} className="text-[10px] px-2 py-1 rounded-full bg-white/5 text-emerald-200 border border-white/10">{renderSafeText(signal)}</span>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {hasItems(textList(note.core_reasoning)) && (
            <section className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h3 className="text-white font-semibold text-sm mb-3">核心推理</h3>
              <ul className="space-y-2">
                {textList(note.core_reasoning).map((line, idx) => (
                  <li key={idx} className="flex gap-2 text-white/60 text-xs leading-relaxed">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-forest-400/70 flex-shrink-0"></span>
                    <span>{renderSafeText(line)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {valueHasContent(note.first_beneficiary_stock) && (
            <section className="p-4 rounded-xl bg-amber-500/[0.04] border border-amber-400/20">
              <h3 className="text-white font-semibold text-sm mb-3">第一受惠股推理</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {getDataLines(note.first_beneficiary_stock, ['stock_code', 'stock_name', 'sector', 'benefit_source', 'relationship_to_thesis', 'validation_signal', 'invalidation_condition']).map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                    <p className="text-amber-300/80 text-[10px] mb-1">{labelText(item.label)}</p>
                    <p className="text-white/65 text-xs leading-relaxed">{renderSafeText(item.value)}</p>
                  </div>
                ))}
              </div>
              {hasItems(textList(asRecord(note.first_beneficiary_stock).source_signals)) && (
                <p className="text-forest-300/70 text-xs mt-3">來源訊號：{textList(asRecord(note.first_beneficiary_stock).source_signals).join('、')}</p>
              )}
            </section>
          )}

          {hasItems(recordList(note.capital_rotation_scenarios)) && (
            <section className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h3 className="text-white font-semibold text-sm mb-3">今日資金輪動劇本</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {recordList(note.capital_rotation_scenarios).map((scenario, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                    <p className="text-white/85 text-sm font-semibold mb-2">{renderSafeText(scenario.scenario || `劇本 ${idx + 1}`)}</p>
                    <p className="text-white/55 text-xs leading-relaxed mb-2">觸發：{renderSafeText(scenario.trigger || '—')}</p>
                    {hasItems(textList(scenario.groups_to_watch)) && <p className="text-sky-300/70 text-xs mb-2">觀察族群：{textList(scenario.groups_to_watch).join('、')}</p>}
                    <p className="text-forest-300/70 text-xs leading-relaxed mb-2">影響：{renderSafeText(scenario.beneficiary_impact || '—')}</p>
                    <p className="text-red-300/70 text-xs leading-relaxed">避免：{renderSafeText(scenario.avoid || '—')}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasItems(recordList(note.risk_scenarios)) && (
            <section className="p-4 rounded-xl bg-red-500/[0.03] border border-red-500/10">
              <h3 className="text-white font-semibold text-sm mb-3">風險劇本</h3>
              <div className="space-y-3">
                {recordList(note.risk_scenarios).map((risk, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-red-500/10">
                    <p className="text-red-300/80 text-sm font-medium">{renderSafeText(risk.risk || `風險 ${idx + 1}`)}</p>
                    <p className="text-white/55 text-xs mt-1">條件：{renderSafeText(risk.condition || '—')}</p>
                    <p className="text-amber-300/70 text-xs mt-1">應對：{renderSafeText(risk.response || '—')}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {valueHasContent(note.tomorrow_follow_up) && (
            <section className="p-4 rounded-xl bg-violet-500/[0.04] border border-violet-400/20">
              <h3 className="text-white font-semibold text-sm mb-3">明日追蹤</h3>
              {hasItems(textList(asRecord(note.tomorrow_follow_up).after_close_check)) && (
                <ul className="space-y-2 mb-3">
                  {textList(asRecord(note.tomorrow_follow_up).after_close_check).map((line, idx) => (
                    <li key={idx} className="flex gap-2 text-white/60 text-xs leading-relaxed">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-violet-300/80 flex-shrink-0"></span>
                      <span>{renderSafeText(line)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-white/60 text-xs leading-relaxed">{renderSafeText(asRecord(note.tomorrow_follow_up).continuation_condition || '')}</p>
              {hasItems(textList(asRecord(note.tomorrow_follow_up).carry_over_signals)) && (
                <p className="text-violet-300/70 text-xs mt-2">保留訊號：{textList(asRecord(note.tomorrow_follow_up).carry_over_signals).join('、')}</p>
              )}
            </section>
          )}

          {valueHasContent(note.closing_feedback_placeholder) && !hasClosingVerification && (
            <section className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h3 className="text-white font-semibold text-sm mb-3">收盤後回測欄位</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {getDataLines(note.closing_feedback_placeholder, ['status', 'what_to_verify', 'expected_update']).map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                    <p className="text-violet-300/80 text-[10px] mb-1">{labelText(item.label)}</p>
                    <p className="text-white/55 text-xs leading-relaxed">{renderSafeText(item.value)}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasItems(note.overnight_chain) && (
            <section className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h3 className="text-white font-semibold text-sm mb-3">隔夜事件鏈</h3>
              <div className="space-y-3">
                {note.overnight_chain.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                    <p className="text-white/80 text-sm font-medium">{renderSafeText(item.event || '—')}</p>
                    <p className="text-white/40 text-xs mt-1">來源市場：{renderSafeText(item.source_market || '—')}｜判斷把握度：{item.confidence ?? '—'}</p>
                    <p className="text-white/55 text-xs mt-2 leading-relaxed">{renderSafeText(item.impact_logic || '—')}</p>
                    <p className="text-forest-300/70 text-xs mt-1 leading-relaxed">台股映射：{renderSafeText(item.taiwan_mapping || '—')}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasItems(note.taiwan_impact_map) && (
            <section className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h3 className="text-white font-semibold text-sm mb-3">台股映射</h3>
              <div className="space-y-3">
                {note.taiwan_impact_map.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-white/80 text-sm font-medium">{renderSafeText(item.sector || '—')}</p>
                      {item.sensitivity && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-400/20">{item.sensitivity}</span>}
                    </div>
                    <p className="text-white/55 text-xs leading-relaxed">{renderSafeText(item.why_it_matters || '—')}</p>
                    {hasItems(item.affected_stocks) && <p className="text-sky-300/70 text-xs mt-1">影響標的：{item.affected_stocks.join('、')}</p>}
                    {item.invalidation && <p className="text-red-400/70 text-xs mt-1">失效：{renderSafeText(item.invalidation)}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasItems(beneficiaryCandidates) && (
            <section className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h3 className="text-white font-semibold text-sm mb-3">第一受惠股候選</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {beneficiaryCandidates.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                    <p className="text-white/85 text-sm font-semibold">{[item.symbol, item.name].filter(Boolean).join(' ')}</p>
                    <p className="text-white/35 text-[10px] mt-0.5">
                      {renderSafeText(item.sector || '—')}{item.confidence !== undefined && item.confidence !== '' ? `｜判斷把握度：${item.confidence}` : ''}
                    </p>
                    <p className="text-white/55 text-xs mt-2 leading-relaxed">{renderSafeText(item.reason || '—')}</p>
                    {hasItems(item.evidence) && <p className="text-forest-300/70 text-xs mt-1">證據：{item.evidence.join('；')}</p>}
                    {item.risk && <p className="text-red-400/70 text-xs mt-1">風險：{renderSafeText(item.risk)}</p>}
                    {item.watchPoint && <p className="text-sky-300/70 text-xs mt-1">觀察：{renderSafeText(item.watchPoint)}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasItems(recordList(note.intraday_time_windows)) && (
            <section className="p-4 rounded-xl bg-sky-500/[0.04] border border-sky-400/20">
              <h3 className="text-white font-semibold text-sm mb-3">當沖資金驗證時間窗</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {recordList(note.intraday_time_windows).map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sky-300 text-xs font-semibold">{renderSafeText(item.time || `T${idx + 1}`)}</span>
                      <p className="text-white/85 text-sm font-semibold">{renderSafeText(item.title || '盤中驗證')}</p>
                    </div>
                    <p className="text-white/55 text-xs leading-relaxed mb-2">{renderSafeText(item.purpose || '')}</p>
                    {hasItems(textList(item.signals_to_watch)) && (
                      <p className="text-sky-300/70 text-xs mb-2">觀察：{textList(item.signals_to_watch).join('、')}</p>
                    )}
                    <p className="text-forest-300/70 text-xs leading-relaxed mb-1">成立：{renderSafeText(item.bullish_confirmation || '—')}</p>
                    <p className="text-red-300/70 text-xs leading-relaxed mb-1">警訊：{renderSafeText(item.bearish_warning || '—')}</p>
                    <p className="text-amber-300/70 text-xs leading-relaxed">提醒：{renderSafeText(item.action_note || '待驗證')}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasItems(note.intraday_validation) && (
            <section className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h3 className="text-white font-semibold text-sm mb-3">盤中驗證條件</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {note.intraday_validation.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                    <p className="text-sky-300/80 text-xs font-semibold mb-1">{renderSafeText(item.time_window || '—')}</p>
                    <p className="text-white/55 text-xs leading-relaxed">{renderSafeText(item.what_to_watch || '—')}</p>
                    <p className="text-forest-300/70 text-xs mt-2">確認：{renderSafeText(item.bullish_confirm || '—')}</p>
                    <p className="text-red-400/70 text-xs mt-1">失敗：{renderSafeText(item.bearish_fail || '—')}</p>
                    <p className="text-white/35 text-xs mt-1">中性：{renderSafeText(item.neutral_condition || '—')}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasItems(note.invalidation_rules) && (
            <section className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h3 className="text-white font-semibold text-sm mb-3">失效條件</h3>
              <div className="space-y-3">
                {note.invalidation_rules.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-red-500/[0.03] border border-red-500/10">
                    <p className="text-white/80 text-sm font-medium">{renderSafeText(item.condition || '—')}</p>
                    <p className="text-white/50 text-xs mt-1">{renderSafeText(item.meaning || '—')}</p>
                    <p className="text-amber-300/70 text-xs mt-1">行動：{renderSafeText(item.action_note || '—')}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!hasClosingVerification && note.closing_feedback_plan && (
            <section className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <h3 className="text-white font-semibold text-sm">收盤後回饋</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-400/20">待收盤驗證</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                  <p className="text-violet-300/80 text-[10px] mb-1">比較項目</p>
                  <p className="text-white/55 text-xs">{renderSafeText(note.closing_feedback_plan.what_to_compare || '—')}</p>
                </div>
                <div className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                  <p className="text-violet-300/80 text-[10px] mb-1">成功標準</p>
                  <p className="text-white/55 text-xs">{renderSafeText(note.closing_feedback_plan.success_criteria || '—')}</p>
                </div>
                <div className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                  <p className="text-violet-300/80 text-[10px] mb-1">落空追蹤</p>
                  <p className="text-white/55 text-xs">{renderSafeText(note.closing_feedback_plan.miss_reason_tracking || '—')}</p>
                </div>
              </div>
            </section>
          )}

          {note.subscriber_value_sentence && (
            <section className="p-4 rounded-xl bg-amber-500/[0.04] border border-amber-400/20">
              <h3 className="text-white font-semibold text-sm mb-2">會員價值一句話</h3>
              <p className="text-amber-300/80 text-sm leading-relaxed">{renderSafeText(note.subscriber_value_sentence)}</p>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}

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
  } | null>(null);
  const [strategy, setStrategy] = useState<ParsedAIStrategy | null>(null);
  const [marketClosed, setMarketClosed] = useState<{ closed: boolean; holidayName: string | null }>({ closed: false, holidayName: null });
  const [isHistoricalFallback, setIsHistoricalFallback] = useState(false);
  const [fallbackReportDate, setFallbackReportDate] = useState<string | null>(null);
  // V9.0: Causal overnight impact chains from new format
  const [causalChains, setCausalChains] = useState<Record<string, unknown>[]>([]);
  // V10.0: Display state for market status fields
  const [dsState, setDsState] = useState<MorningAlphaDisplayState | null>(null);
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);

  useEffect(() => {
    trackPageView('/member-note');
    async function load() {
      try {
        setLoading(true);
        const resolved = await resolveActiveMorningAlphaReport();
        setEntitlement(buildEntitlementFromTier(resolved.tier));
        setIsHistoricalFallback(resolved.isHistoricalFallback);
        setFallbackReportDate(resolved.fallbackReportDate);
        const r = resolved.rawRow;
        const ds = getMorningAlphaDisplayState(r as Record<string, unknown> | null);
        setDsState(ds);
        setMarketClosed({ closed: ds.isMarketClosed, holidayName: ds.holidayName });
        if (!r) {
          setReportData(null);
          return;
        }

        // V8.2.1 SAFETY: ai_strategy_json 可能是已解析的 object（jsonb 自動展開）
        // 也可能是 JSON string（Edge Function 雙重序列化時的保護）
        const rawAiJson = r.ai_strategy_json;
        const ai = typeof rawAiJson === 'string'
          ? (() => { try { return JSON.parse(rawAiJson) as Record<string, unknown>; } catch { return {}; } })()
          : (rawAiJson as Record<string, unknown>) || {};

        const twDate = (ai.tw_core_date as string) || (ai.market_data_date as string) || r.report_date || '—';
        const usDate = (ai.us_global_date as string) || (ai.us_market_date as string) || '—';

        setReportData({
          reportDate: r.report_date || '—',
          marketBias: ds.marketBias,
          confidenceScore: ds.confidenceScore,
          twCoreDate: twDate,
          usGlobalDate: usDate,
          created_at: r.created_at || '—',
        });
        // V9.0: Causal overnight impact chains
        const cChains = Array.isArray(ai.causal_overnight_impact_chains)
          ? (ai.causal_overnight_impact_chains as Record<string, unknown>[])
          : [];
        setCausalChains(cChains);

        const parsed = parseAIStrategy(r as unknown as Report);
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
              日期：{dsState?.currentDate || reportData?.reportDate || '—'}（{dsState?.currentWeekday || ''}）
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

  const { reportDate, marketBias, confidenceScore, twCoreDate, usGlobalDate } = reportData;

  const memberNoteV2 = hasValidMemberResearchNoteV2(strategy) ? strategy.member_research_note_v2 : null;
  const memberNoteText = !memberNoteV2 && hasValidMemberResearchText(strategy) && typeof strategy.member_research_note === 'string'
    ? strategy.member_research_note
    : null;
  const hasMemberNote = !!memberNoteV2 || !!memberNoteText;
  const hasReasoningChain = strategy.reasoning_chain.length > 0;
  const hasOvernightChains = strategy.overnight_impact_chain.length > 0 || causalChains.length > 0;
  const hasValidationPlan = !!strategy.intraday_validation_plan;
  const hasInvalidation = strategy.invalidation_conditions.length > 0;
  const hasClosingPlan = !!strategy.closing_feedback_plan;
  const hasRenewalBlock = !!strategy.renewal_value_block;
  const hasPremiumSummary = !!strategy.premium_value_summary;
  const rawAI = asRecord(strategy.raw);
  const researcherSummary = firstText(
    memberNoteV2?.subscriber_value_sentence,
    strategy.premium_value_summary?.strongest_member_value_today,
    rawAI.today_quote,
  ) || '本段資料不足，等待下一次交易日報告補齊。';
  const v2BeneficiaryCandidates = (memberNoteV2?.beneficiary_candidates || [])
    .map(normalizeV2Beneficiary)
    .filter((candidate): candidate is MemberBeneficiaryCandidate => candidate !== null);
  const legacyBeneficiaryCandidates = asRecordArray(rawAI.beneficiary_stocks)
    .map(normalizeLegacyBeneficiary)
    .filter((candidate): candidate is MemberBeneficiaryCandidate => candidate !== null);
  const beneficiaryCandidates = hasItems(v2BeneficiaryCandidates) ? v2BeneficiaryCandidates : legacyBeneficiaryCandidates;
  const openingRadar = rawAI.opening_radar;
  const closingVerificationV2 = asRecord(rawAI.closing_verification_v2);
  const closingVerification = valueHasContent(closingVerificationV2) ? closingVerificationV2 : rawAI.closing_verification;
  const closingVerificationRecord = asRecord(closingVerification);
  const closingStatus = firstText(
    closingVerificationRecord.status,
    closingVerificationRecord.hit_or_miss,
    closingVerificationRecord.prediction_result,
    closingVerificationRecord.verdict_label,
  ).toLowerCase();
  const hasOpeningRadar = valueHasContent(openingRadar);
  const hasClosingVerification = valueHasContent(closingVerification);
  const isClosingVerificationPending = !hasClosingVerification
    || closingStatus.includes('pending')
    || firstText(closingVerificationRecord.data_status).toLowerCase() === 'pending'
    || firstText(closingVerificationRecord.status).toLowerCase() === 'pending_real_market_data';
  const hasCompletedClosingVerification = hasClosingVerification && !isClosingVerificationPending;
  const isClosingVerificationDegraded = hasCompletedClosingVerification
    && firstText(closingVerificationRecord.data_status).toLowerCase() === 'degraded';
  const openingRadarLines = getDataLines(openingRadar, [
    'status',
    'radar_status',
    'summary',
    'market_bias',
    'bias',
    'watch_point',
    'what_to_watch',
  ]);
  const closingVerificationLines = getDataLines(closingVerification, [
    'prediction_result',
    'verification_result',
    'result',
    'summary',
    'actual_direction',
    'accuracy_score',
    'reason',
  ]);
  const closingTaiex = asRecord(closingVerificationRecord.actual_taiex_close);
  const closingTsmc = asRecord(closingVerificationRecord.actual_2330_close);
  const firstBeneficiaryValidation = asRecord(closingVerificationRecord.first_beneficiary_validation);
  const beneficiaryListValidation = asRecord(closingVerificationRecord.beneficiary_list_validation);
  const intradayReplaySignals = asRecordArray(closingVerificationRecord.intraday_validation_signals);
  const intradayReplayTimeWindows = asRecordArray(closingVerificationRecord.intraday_replay_time_windows);
  const sectorPerformance = asRecordArray(closingVerificationRecord.actual_sector_performance);
  const tomorrowAdjustment = asRecord(closingVerificationRecord.tomorrow_adjustment);
  const canViewMemberNoteFull = hasFeature(entitlement, 'member_note_full');
  const canViewVipFundFlow = hasFeature(entitlement, 'vip_fund_flow');
  const hasVipResearchFields = valueHasContent(memberNoteV2?.fund_flow_scenario)
    || valueHasContent(memberNoteV2?.market_mispricing)
    || valueHasContent(memberNoteV2?.institutional_behavior)
    || valueHasContent(memberNoteV2?.tomorrow_extension_watch);
  const scoreDisplay = scoreTone(confidenceScore);
  const openingThesis = asRecord(memberNoteV2?.opening_thesis);
  const firstStockNote = asRecord(memberNoteV2?.first_beneficiary_stock);
  const todayOneLine = firstText(
    rawAI.v8_daily_sentence && asRecord(rawAI.v8_daily_sentence).sentence,
    researcherSummary,
    openingThesis.summary,
    rawAI.daily_sentence,
  );
  const importantObservation = firstText(
    firstLine(openingThesis.summary),
    firstLine(memberNoteV2?.core_reasoning),
    firstLine(rawAI.do_not_do_list),
  ) || '今天先看 2330、TAIEX 與 TXF 是否同向，沒有同步就不要急著放大部位。';
  const firstStockName = [firstText(firstStockNote.stock_code, firstStockNote.symbol), firstText(firstStockNote.stock_name, firstStockNote.name)].filter(Boolean).join(' ') || [beneficiaryCandidates[0]?.symbol, beneficiaryCandidates[0]?.name].filter(Boolean).join(' ') || '尚未產生';
  const firstStockReason = firstText(firstStockNote.relationship_to_thesis, firstStockNote.benefit_source, beneficiaryCandidates[0]?.reason, '等待完整受惠股推理補齊。');
  const firstStockValidation = firstText(firstStockNote.validation_signal, beneficiaryCandidates[0]?.watchPoint, '09:30 後看 2330、TAIEX 與族群是否同步。');
  const firstStockInvalidation = firstText(firstStockNote.invalidation_condition, beneficiaryCandidates[0]?.risk, firstLine(memberNoteV2?.invalidation_conditions), '若 2330 無法轉強且大盤續弱，今日推論降級。');
  const rotationScenarios = recordList(memberNoteV2?.capital_rotation_scenarios);
  const scenarioLabels = ['如果今天變強', '如果今天震盪', '如果今天轉弱'];
  const dontDoItems = [
    ...textList(rawAI.do_not_do_list),
    ...textList(rawAI.avoid_today),
    ...recordList(memberNoteV2?.risk_scenarios).map((item) => firstText(item.response, item.condition, item.risk)),
    ...recordList(memberNoteV2?.invalidation_conditions).map((item) => firstText(item.action_note, item.condition, item.meaning)),
    ...recordList(memberNoteV2?.invalidation_rules).map((item) => firstText(item.action_note, item.condition, item.meaning)),
  ].filter(Boolean).slice(0, 5);
  const closingResultText = hasCompletedClosingVerification
    ? humanStatus(closingVerificationRecord.hit_or_miss || closingVerificationRecord.prediction_result || closingVerificationRecord.status)
    : '等待收盤資料';
  const firstBeneficiaryResult = firstText(firstBeneficiaryValidation.note, '收盤資料完成後更新。');
  const listValidationResult = hasCompletedClosingVerification
    ? `${renderSafeText(beneficiaryListValidation.with_close_data_count ?? 0)} / ${renderSafeText(beneficiaryListValidation.tracked_count ?? 0)} 檔已有收盤比較`
    : '等待收盤資料';

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
                {canViewMemberNoteFull ? '會員內容' : '免費摘要'}
              </span>
              {isHistoricalFallback && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-500/12 text-sky-300 text-[10px] font-medium rounded-full border border-sky-400/25 whitespace-nowrap">
                  <i className="ri-history-line text-[9px]"></i>
                  歷史資料模式：{fallbackReportDate || reportDate}
                </span>
              )}
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
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">盤前方向</p>
              <p className="text-slate-100 font-bold text-sm">{marketBias}</p>
            </div>
            <div className="p-3 rounded-xl bg-navy-900/60 border border-navy-800">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">判斷把握度</p>
              <p className="text-slate-100 font-bold text-sm">{scoreDisplay.stars} {scoreDisplay.label}</p>
              {confidenceScore != null && <p className="text-slate-500 text-[10px] mt-1">{confidenceScore}/100</p>}
            </div>
            <div className="p-3 rounded-xl bg-navy-900/60 border border-navy-800">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">資料基準</p>
              <p className="text-slate-200 text-xs">{twCoreDate} 收盤 / {usGlobalDate}</p>
            </div>
          </div>

          {/* 30-second member read */}
          <section className="bg-gradient-to-br from-forest-500/12 via-navy-900/70 to-navy-900/80 border border-forest-400/20 rounded-2xl p-5 md:p-6 space-y-4">
            <div>
              <p className="text-forest-300 text-[10px] uppercase tracking-[0.3em] font-semibold mb-2">今日一句</p>
              <h2 className="text-white text-xl md:text-2xl font-bold leading-snug">{renderSafeText(todayOneLine)}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 p-4 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">今天最重要觀察</p>
                <p className="text-white/75 text-sm leading-relaxed">今天只看一件事：{renderSafeText(importantObservation)}</p>
              </div>
              <div className="p-4 rounded-xl bg-amber-500/[0.06] border border-amber-400/20">
                <p className="text-amber-200 text-[10px] uppercase tracking-wider mb-2">今天不要做什麼</p>
                <p className="text-amber-50/85 text-sm leading-relaxed">{renderSafeText(dontDoItems[0] || firstStockInvalidation)}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">第一受惠股</p>
                <h3 className="text-white font-bold text-lg mb-2">{renderSafeText(firstStockName)}</h3>
                <p className="text-white/65 text-xs leading-relaxed mb-2">為什麼看它：{renderSafeText(firstStockReason)}</p>
                <p className="text-sky-200/80 text-xs leading-relaxed mb-2">09:30 驗證：{renderSafeText(firstStockValidation)}</p>
                <p className="text-red-200/80 text-xs leading-relaxed">看錯訊號：{renderSafeText(firstStockInvalidation)}</p>
              </div>
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">收盤驗證</p>
                <p className="text-white/80 text-sm font-semibold mb-2">今天判斷：{closingResultText}</p>
                <p className="text-white/60 text-xs leading-relaxed mb-1">第一受惠股：{renderSafeText(firstBeneficiaryResult)}</p>
                <p className="text-white/45 text-xs leading-relaxed">受惠股名單：{listValidationResult}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {scenarioLabels.map((label, idx) => {
                const scenario = rotationScenarios[idx] || {};
                return (
                  <div key={label} className="p-3 rounded-xl bg-navy-800/60 border border-white/5">
                    <p className="text-white/85 text-sm font-semibold mb-2">{label}</p>
                    <p className="text-white/55 text-xs leading-relaxed">{renderSafeText(firstText(scenario.trigger, scenario.beneficiary_impact, scenario.avoid, '等待盤中訊號確認。'))}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Researcher Summary */}
          <section className="bg-navy-900/60 border border-forest-500/10 rounded-2xl p-5 md:p-6">
            <div className="flex items-center gap-2 mb-3">
              <i className="ri-quill-pen-line text-forest-400 text-sm"></i>
              <h2 className="text-white font-bold text-base">研究員摘要</h2>
            </div>
            <p className="text-white/70 text-sm leading-relaxed">{renderSafeText(researcherSummary)}</p>
          </section>

          {hasOpeningRadar && (
            <section className="bg-navy-900/60 border border-sky-500/10 rounded-2xl p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <i className="ri-radar-line text-sky-400 text-sm"></i>
                <h2 className="text-white font-bold text-base">盤中雷達狀態</h2>
              </div>
              {openingRadarLines.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {openingRadarLines.map((item, idx) => (
                    <div key={`${item.label}-${idx}`} className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                      <p className="text-sky-400/60 text-[10px] uppercase tracking-wider mb-1">{renderSafeText(item.label)}</p>
                      <p className="text-white/60 text-xs leading-relaxed">{renderSafeText(item.value)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-white/50 text-xs leading-relaxed">盤中雷達資料已存在，等待下一版格式化顯示。</p>
              )}
            </section>
          )}

          <section className="bg-navy-900/60 border border-violet-500/10 rounded-2xl p-5 md:p-6">
            <div className="flex items-center gap-2 mb-4">
              <i className="ri-check-double-line text-violet-400 text-sm"></i>
              <h2 className="text-white font-bold text-base">收盤驗證</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-400/20">
                {hasCompletedClosingVerification ? (isClosingVerificationDegraded ? '大盤方向已驗證' : '收盤驗證已完成') : '收盤驗證待完成'}
              </span>
            </div>

            {hasCompletedClosingVerification ? (
              <div className="space-y-4">
                {isClosingVerificationDegraded && (
                  <div className="p-4 rounded-xl bg-amber-500/[0.06] border border-amber-400/20">
                    <p className="text-amber-200 text-sm font-semibold mb-1">大盤方向已驗證，個股與類股資料仍不完整</p>
                    <p className="text-amber-100/70 text-xs leading-relaxed">目前只完成大盤方向驗證；受惠股收盤資料或當日類股輪動尚未完整，因此不把本次驗證視為完整回測。</p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-violet-400/60 text-[10px] uppercase tracking-wider mb-1">盤前方向</p>
                    <p className="text-white/70 text-xs leading-relaxed">{renderSafeText(closingVerificationRecord.opening_bias || closingVerificationRecord.predicted_bias || marketBias)}</p>
                    <p className="text-white/35 text-[10px] mt-1">判斷把握度：{renderSafeText(closingVerificationRecord.opening_confidence || closingVerificationRecord.predicted_confidence || confidenceScore || '—')}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-violet-400/60 text-[10px] uppercase tracking-wider mb-1">實際收盤</p>
                    <p className="text-white/70 text-xs leading-relaxed">TAIEX {renderSafeText(closingTaiex.change_percent ?? closingVerificationRecord.actual_taiex_change ?? '待資料')}%</p>
                    <p className="text-white/35 text-[10px] mt-1">2330 {renderSafeText(closingTsmc.change_percent ?? '待資料')}%</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-violet-400/60 text-[10px] uppercase tracking-wider mb-1">命中程度</p>
                    <p className="text-white/70 text-xs leading-relaxed">{humanStatus(closingVerificationRecord.hit_or_miss || closingVerificationRecord.prediction_result || closingVerificationRecord.verdict_label || '待驗證')}</p>
                    <p className="text-white/35 text-[10px] mt-1">資料狀態：{humanStatus(closingVerificationRecord.data_status || '—')}</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <h3 className="text-white font-semibold text-sm mb-3">第一受惠股驗證</h3>
                  {valueHasContent(firstBeneficiaryValidation.predicted_stock) && (
                    <p className="text-white/65 text-xs leading-relaxed mb-3">
                      盤前第一受惠股：{renderSafeText(asRecord(firstBeneficiaryValidation.predicted_stock).symbol || '')} {renderSafeText(asRecord(firstBeneficiaryValidation.predicted_stock).name || '')}
                    </p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {getDataLines(firstBeneficiaryValidation, ['close_change_percent', 'taiex_relative_percent', 'matched_logic', 'note']).map((item, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                        <p className="text-violet-300/80 text-[10px] mb-1">{labelText(item.label)}</p>
                        <p className="text-white/60 text-xs leading-relaxed">{renderSafeText(item.value)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <h3 className="text-white font-semibold text-sm mb-3">受惠股名單驗證</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
                    {['tracked_count', 'with_close_data_count', 'up_count', 'down_count', 'outperformed_taiex_count'].map((key) => (
                      <div key={key} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                        <p className="text-white/35 text-[10px] mb-1">{labelText(key)}</p>
                        <p className="text-white/75 text-sm font-semibold">{renderSafeText(beneficiaryListValidation[key] ?? '—')}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-white/45 text-xs leading-relaxed">比較方式：每檔受惠股收盤表現扣除 TAIEX 收盤漲跌幅，跑贏大盤才算相對成立；資料不足時標示資料不完整，不硬判。</p>
                </div>

                {hasItems(intradayReplayTimeWindows) && (
                  <div className="p-4 rounded-xl bg-sky-500/[0.04] border border-sky-400/20">
                    <h3 className="text-white font-semibold text-sm mb-3">當沖資金驗證時間窗回放</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {intradayReplayTimeWindows.map((item, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-sky-300/80 text-xs font-semibold">{renderSafeText(item.time || item.title || `時間窗 ${idx + 1}`)}</p>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/50 border border-white/10">{humanStatus(item.status || '待驗證')}</span>
                          </div>
                          <p className="text-white/80 text-sm font-medium mb-2">{renderSafeText(item.title || '盤中驗證')}</p>
                          <p className="text-white/45 text-xs leading-relaxed mb-2">預期：{renderSafeText(item.expected_signal || '—')}</p>
                          <p className="text-white/60 text-xs leading-relaxed mb-2">實際：{renderSafeText(item.actual_signal || '待驗證')}</p>
                          <p className="text-amber-300/70 text-xs leading-relaxed">{renderSafeText(item.note || '資料不足，不硬判。')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {hasItems(intradayReplaySignals) && (
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <h3 className="text-white font-semibold text-sm mb-3">盤中驗證訊號回放</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {intradayReplaySignals.map((item, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                          <p className="text-sky-300/80 text-xs font-semibold mb-1">{renderSafeText(item.time || item.label || `訊號 ${idx + 1}`)}</p>
                          <p className="text-white/35 text-[10px] mb-1">{humanStatus(item.status || '資料不足')}</p>
                          <p className="text-white/55 text-xs leading-relaxed">{renderSafeText(item.finding || item.summary || '—')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {hasItems(sectorPerformance) && (
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <h3 className="text-white font-semibold text-sm mb-3">類股收盤表現</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {sectorPerformance.slice(0, 4).map((item, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                          <p className="text-white/80 text-sm font-medium">{renderSafeText(item.sector || `類股 ${idx + 1}`)}</p>
                          <p className="text-white/45 text-xs mt-1">輪動分數：{renderSafeText(item.rotation_score ?? '—')}｜{renderSafeText(item.signal_label || item.direction || '')}</p>
                          <p className="text-white/55 text-xs mt-2 leading-relaxed">{renderSafeText(item.summary || '')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-4 rounded-xl bg-violet-500/[0.04] border border-violet-400/20">
                  <h3 className="text-white font-semibold text-sm mb-3">明日調整</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {['keep', 'downgrade', 'watch_tomorrow'].map((key) => (
                      <div key={key} className="p-3 rounded-lg bg-navy-800/50 border border-white/5">
                        <p className="text-violet-300/80 text-[10px] mb-2">{labelText(key)}</p>
                        <ul className="space-y-1">
                          {textList(tomorrowAdjustment[key]).map((line, idx) => (
                            <li key={idx} className="text-white/55 text-xs leading-relaxed">• {renderSafeText(line)}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                <p className="text-white/70 text-sm font-medium mb-1">收盤驗證將於收盤資料完成後更新</p>
                <p className="text-white/45 text-xs leading-relaxed">目前為待驗證，尚未納入績效統計。第一受惠股與受惠股名單會在有效收盤資料完成後回測，不硬判。</p>
              </div>
            )}
          </section>

          {/* ═══════════════════════════════ */}
          {/* MEMBER RESEARCH NOTE SECTIONS */}
          {/* ═══════════════════════════════ */}
          {canViewMemberNoteFull ? (
            <>
              {memberNoteV2 ? (
                <details className="group rounded-2xl bg-navy-900/50 border border-navy-800 overflow-hidden">
                  <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-3">
                    <span className="text-white font-semibold text-sm">展開詳細研究資料</span>
                    <span className="text-white/40 text-xs group-open:hidden">隔夜事件鏈、時間窗、類股輪動、原始推理鏈</span>
                    <span className="hidden text-white/40 text-xs group-open:inline">收合詳細資料</span>
                  </summary>
                  <div className="px-4 pb-4 md:px-5 md:pb-5">
                    <MemberResearchNoteV2View
                      note={memberNoteV2}
                      reportDate={reportDate}
                      twCoreDate={twCoreDate}
                      isHistoricalFallback={isHistoricalFallback}
                      beneficiaryCandidates={beneficiaryCandidates}
                      hasClosingVerification={hasCompletedClosingVerification}
                    />
                  </div>
                </details>
              ) : hasMemberNote && memberNoteText ? (
              /* ═══ 純文字多段落路徑 (V8.2.1) ═══ */
              <section>
                <div className="relative bg-gradient-to-br from-navy-900/80 via-navy-900/60 to-navy-900/80 border border-forest-500/10 rounded-2xl p-5 md:p-8 overflow-hidden">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[60%] h-px bg-gradient-to-r from-transparent via-forest-400/30 to-transparent"></div>

                  <div className="text-center mb-6">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/12 rounded-full border border-emerald-400/35 mb-4">
                      <i className="ri-eye-line text-emerald-400 text-xs"></i>
                      <span className="text-emerald-300 text-[10px] font-semibold uppercase tracking-wider">{isHistoricalFallback ? '歷史資料模式' : '完整研究筆記'}</span>
                    </div>
                    <h2 className="text-white font-bold text-lg md:text-xl mb-2">
                      第二層：{isHistoricalFallback ? '歷史盤前研究筆記' : '完整盤前研究筆記'}
                    </h2>
                    <p className="text-slate-300 text-xs mb-3">
                      本篇為 {reportDate} 盤前研究筆記，行情基準採用最近完整交易日 {twCoreDate}。
                    </p>
                  </div>

                  {/* V8.2.1: 多段落渲染，每段獨立顯示，不做截斷 */}
                  <div className="p-4 md:p-6 rounded-xl bg-white/[0.02] border border-white/5 space-y-4">
                    {memberNoteText.split('\n').filter(Boolean).map((paragraph, i) => (
                      <p key={i} className="text-white/70 text-sm leading-relaxed">
                        {paragraph.trim()}
                      </p>
                    ))}
                  </div>
                </div>
              </section>
              ) : (
            /* ═══ 無內容路徑 ═══ */
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-6 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-navy-800/80 flex items-center justify-center">
                <i className="ri-book-open-line text-white/15 text-2xl"></i>
              </div>
              <p className="text-slate-300 text-sm mb-2">完整研究筆記尚未生成</p>
              <p className="text-slate-500 text-xs max-w-md mx-auto">目前只有公開摘要，尚不足以形成會員研究筆記。</p>
            </section>
              )}

              {!memberNoteV2 && hasItems(beneficiaryCandidates) && (
            <section className="bg-navy-900/60 border border-amber-500/10 rounded-2xl p-5 md:p-6">
              <h2 className="text-white font-bold text-base mb-4 flex items-center gap-2">
                <i className="ri-focus-3-line text-amber-400 text-sm"></i>
                第一受惠股候選
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {beneficiaryCandidates.map((item, idx) => (
                  <div key={`${item.symbol || item.name}-${idx}`} className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-white/85 text-sm font-semibold">{[item.symbol, item.name].filter(Boolean).join(' ')}</p>
                    <p className="text-white/35 text-[10px] mt-0.5">
                      {renderSafeText(item.sector || '—')}{item.confidence !== undefined && item.confidence !== '' ? `｜判斷把握度：${item.confidence}` : ''}
                    </p>
                    {item.reason && <p className="text-white/55 text-xs mt-2 leading-relaxed">{renderSafeText(item.reason)}</p>}
                    {hasItems(item.evidence) && <p className="text-forest-300/70 text-xs mt-1">證據：{item.evidence.join('；')}</p>}
                    {item.risk && <p className="text-red-400/70 text-xs mt-1">風險：{renderSafeText(item.risk)}</p>}
                    {item.watchPoint && <p className="text-sky-300/70 text-xs mt-1">觀察：{renderSafeText(item.watchPoint)}</p>}
                  </div>
                ))}
              </div>
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
              {!hasClosingVerification && hasClosingPlan && strategy.closing_feedback_plan && (
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <h2 className="text-white font-bold text-base flex items-center gap-2">
                  <i className="ri-check-double-line text-violet-400 text-sm"></i>
                  收盤回饋計畫
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-400/20">待收盤驗證</span>
              </div>
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
              {hasVipResearchFields && !canViewVipFundFlow && (
                <PaywallCard
                  title="VIP 功能即將開放"
                  description="法人可能行為、資金流推演、市場錯價與隔日延伸觀察會收在 VIP 版，供高頻回訪與週度回測使用。"
                  requiredTier="vip"
                  featureList={['資金流劇本', '市場錯價觀察', '法人行為推演', '明日延伸追蹤']}
                  tone="dark"
                />
              )}
            </>
          ) : (
            <PaywallCard
              title="升級會員查看完整盤前研究筆記"
              description="免費版保留今日核心 thesis 與摘要；完整 overnight chain、第一受惠股推理、盤中驗證、失效條件與收盤回測收在會員版。"
              requiredTier="member"
              featureList={['完整研究筆記', '第一受惠股推理鏈', '盤中驗證與收盤回測']}
              tone="dark"
            />
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
                '收盤後會回驗盤前方向，慢慢形成你自己的市場直覺。',
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
