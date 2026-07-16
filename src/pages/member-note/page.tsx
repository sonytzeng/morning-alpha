import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { renderSafeText } from '@/utils/renderSafe';
import { valueHasContent } from '@/utils/contentHelpers';
import {
  hasValidMemberResearchNoteV2,
  hasValidMemberResearchText,
  parseAIStrategy,
  type MemberResearchNoteV2,
  type ParsedAIStrategy,
} from '@/utils/aiStrategyParser';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { buildCanonicalNarrative } from '@/lib/canonicalNarrative';
import { buildDecisionPresentation, formatCheckpoint } from '@/lib/decisionPresentation';
import { trackPageView, trackEvent } from '@/utils/analytics';
import PaywallCard from '@/components/paywall/PaywallCard';
import V11ObservationSection, { mapV11ObservationItems } from '@/components/v11/V11ObservationSection';
import { buildEntitlementFromTier, hasFeature } from '@/services/entitlementService';
import type { UserEntitlement } from '@/types/subscription';

function hasItems<T>(items: T[] | undefined): items is T[] {
  return Array.isArray(items) && items.length > 0;
}

type MemberBeneficiaryCandidate = {
  symbol?: string;
  name: string;
  sector?: string;
  role?: string;
  reason?: string;
  risk?: string;
  watchPoint?: string;
  confirmation?: string;
  invalidation?: string;
  transmissionPath?: string;
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

function numericOrTextValue(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textValue(value);
    if (text) return text;
  }
  return '';
}

const researchLabelMap: Record<string, string> = {
  SEMICONDUCTOR: '半導體',
  DEFENSIVE: '防禦型資金',
  MEMORY: '記憶體',
  AI_SERVER: 'AI 伺服器',
  FINANCIAL: '金融',
  ELECTRONICS: '電子權值',
  MAIN_THESIS: '核心主軸',
  SECONDARY_CANDIDATE: '次要觀察',
  RISK_HEDGE: '風險對沖',
};

function normalizeResearchText(value: unknown): string {
  return textValue(value)
    .replace(/\s+/g, ' ')
    .replace(/[，﹐]/g, '，')
    .replace(/[。｡]/g, '。')
    .replace(/[：﹕]/g, '：')
    .replace(/^(?:摘要|事件|觸發標籤|產業|主軸|說明)\s*[：:]\s*/i, '')
    .trim();
}

function researchComparisonKey(value: unknown): string {
  return normalizeResearchText(value)
    .toLocaleLowerCase('zh-TW')
    .replace(/[\s，。、；：！？,.!?;:'"「」『』（）()【】\[\]—–-]/g, '');
}

function isDuplicateResearchText(a: unknown, b: unknown): boolean {
  const left = researchComparisonKey(a);
  const right = researchComparisonKey(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 18 && shorter.length / longer.length >= 0.72 && longer.includes(shorter);
}

function isDebugResearchText(value: unknown): boolean {
  const text = normalizeResearchText(value);
  if (!text || /^(?:null|undefined)$/i.test(text)) return true;
  return /^(?:event_score|market_score|score)$/i.test(text)
    || /\b(?:event_score|market_score|score)\s*=/i.test(text)
    || /^\s*[a-z][a-z0-9_]*\s*=\s*.+$/i.test(text)
    || /^\s*[\[{].*[\]}]\s*$/s.test(text);
}

function uniqueResearchItems(values: unknown[], excluded: unknown[] = [], limit = 5): string[] {
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeResearchText(value);
    if (!normalized || isDebugResearchText(normalized)) continue;
    const text = /^[A-Z][A-Z0-9_ ›→-]*$/.test(normalized) || /^[a-z][a-z0-9_]*$/.test(normalized)
      ? formatResearchLabel(normalized)
      : normalized;
    if (excluded.some((item) => isDuplicateResearchText(text, item))) continue;
    if (output.some((item) => isDuplicateResearchText(text, item))) continue;
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function firstUniqueResearchText(values: unknown[], excluded: unknown[], fallback: string): string {
  return uniqueResearchItems(values, excluded, 1)[0] || fallback;
}

function formatResearchLabel(value: unknown): string {
  const text = normalizeResearchText(value);
  if (!text || isDebugResearchText(text)) return '';
  if (/[›→>]/.test(text)) {
    return text
      .split(/\s*[›→>]\s*/)
      .map((part) => formatResearchLabel(part))
      .filter(Boolean)
      .join(' › ');
  }
  const enumKey = text.replace(/[\s-]+/g, '_').toUpperCase();
  if (researchLabelMap[enumKey]) return researchLabelMap[enumKey];
  if (/^[A-Z][A-Z0-9_ -]*$/.test(text) || /^[a-z][a-z0-9_]*$/.test(text)) {
    return text
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => researchLabelMap[part.toUpperCase()] || part.toLocaleLowerCase('zh-TW'))
      .join(' ');
  }
  return text;
}

function uniqueTextList(values: unknown[], limit = 5): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = textValue(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
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
    role: firstText(row.role, row.narrative_role, row.classification, row.group),
    reason: firstText(row.thesis, row.reason, row.narrative, row.rationale, row.transmission_path),
    risk: firstText(row.risk_note, row.risk, row.invalidation, row.stop_condition),
    watchPoint: firstText(row.watch_point, row.observation),
    confirmation: firstText(row.confirmation, row.validation_signal, row.observation, row.catalyst, row.watch_point),
    invalidation: firstText(row.invalidation, row.invalidation_condition, row.risk, row.risk_note, row.stop_condition),
    transmissionPath: firstText(row.transmission_path),
    confidence: numericOrTextValue(row.confidence ?? row.confidence_level ?? row.confidence_score),
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
    role: firstText(row.role, row.narrative_role, row.classification, row.group),
    reason: firstText(row.thesis, row.reason, row.narrative, row.rationale, row.transmission_path),
    risk: firstText(row.risk, row.risk_note, row.invalidation, row.stop_condition),
    watchPoint: firstText(row.watch_point, row.observation),
    confirmation: firstText(row.confirmation, row.validation_signal, row.observation, row.catalyst, row.watch_point),
    invalidation: firstText(row.invalidation, row.invalidation_condition, row.risk, row.risk_note, row.stop_condition),
    transmissionPath: firstText(row.transmission_path),
    confidence: numericOrTextValue(row.confidence ?? row.confidence_level ?? row.confidence_score),
    evidence: Array.isArray(row.evidence) ? row.evidence.map((value) => textValue(value)).filter(Boolean) : undefined,
  };
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
      <div className="ma-card-elevated overflow-hidden md:p-8">

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
        const ds = getMorningAlphaDisplayState(r as unknown as Record<string, unknown> | null);
        setDsState(ds);
        setMarketClosed({ closed: ds.market_status !== 'OPEN', holidayName: ds.holidayName });
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

        const parsed = parseAIStrategy(r);
        setStrategy(parsed);
      } catch {
        setError('研究筆記暫時無法取得，請稍後重新載入。');
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
            <button type="button" onClick={() => window.location.reload()} className="min-h-11 px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10">
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
            <Link to="/" className="mt-2 inline-flex min-h-11 items-center justify-center px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10">
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
            <Link to="/" className="inline-flex min-h-11 items-center justify-center px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10">
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
  );
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
  const closingTaiex = asRecord(closingVerificationRecord.actual_taiex_close);
  const closingTsmc = asRecord(closingVerificationRecord.actual_2330_close);
  const firstBeneficiaryValidation = asRecord(closingVerificationRecord.first_beneficiary_validation);
  const beneficiaryListValidation = asRecord(closingVerificationRecord.beneficiary_list_validation);
  const intradayReplaySignals = asRecordArray(closingVerificationRecord.intraday_validation_signals);
  const intradayReplayTimeWindows = asRecordArray(closingVerificationRecord.intraday_replay_time_windows);
  const sectorPerformance = asRecordArray(closingVerificationRecord.actual_sector_performance);
  const tomorrowAdjustment = asRecord(closingVerificationRecord.tomorrow_adjustment);
  const canViewMemberNoteFull = hasFeature(entitlement, 'member_note_full');
  const scoreDisplay = scoreTone(confidenceScore);
  const canonicalNarrative = buildCanonicalNarrative({
    displayState: dsState,
    ai: rawAI,
    memberResearchNoteV2: memberNoteV2 as unknown as Record<string, unknown> | null,
  });
  const decisionLifecycle = canonicalNarrative.decision_lifecycle;
  const openingThesis = asRecord(memberNoteV2?.opening_thesis);
  const decisionPresentation = buildDecisionPresentation({
    displayState: dsState,
    narrative: canonicalNarrative,
    opportunitySource: hasItems(v2BeneficiaryCandidates)
      ? memberNoteV2?.beneficiary_candidates || []
      : asRecordArray(rawAI.beneficiary_stocks),
    nextCheckpointFallback: decisionLifecycle.validation_plan.next_step,
  });
  const readableMarketDirection = formatResearchLabel(marketBias);
  const readableThesis = formatResearchLabel(decisionLifecycle.current_thesis.summary);
  const heroConclusion = firstUniqueResearchText([
    canonicalNarrative.today_focus.summary,
    decisionPresentation.primaryDecision.headline,
    readableMarketDirection && readableThesis ? `${readableMarketDirection}：${readableThesis}` : '',
    canonicalNarrative.today_focus.headline,
    researcherSummary,
    openingThesis.summary,
    rawAI.daily_sentence,
  ], [], '');
  const todayOneLine = heroConclusion;
  const v10BeneficiaryEnabled = dsState?.v10BeneficiaryEnabled === true || rawAI.v10_beneficiary_enabled === true || rawAI.v10_beneficiary_enabled === 'true';
  const v11ObservationScripts = mapV11ObservationItems(rawAI.v10_observation_watchlist || dsState?.v10ObservationWatchlist, 5);
  const dontDoItems = uniqueResearchItems([
    canonicalNarrative.today_focus.risk,
    canonicalNarrative.failure_triggers[0]?.action,
    ...textList(rawAI.do_not_do_list),
    ...textList(rawAI.avoid_today),
    ...recordList(memberNoteV2?.risk_scenarios).map((item) => firstText(item.response, item.condition, item.risk)),
    ...recordList(memberNoteV2?.invalidation_conditions).map((item) => firstText(item.action_note, item.condition, item.meaning)),
    ...recordList(memberNoteV2?.invalidation_rules).map((item) => firstText(item.action_note, item.condition, item.meaning)),
  ], [heroConclusion], 5);
  const decisionStatusText = humanStatus(decisionLifecycle.decision_status.status);
  const rawChecklistItems = uniqueResearchItems([
    ...decisionLifecycle.validation_plan.steps.map((step) => firstText(step.detail, step.title, step.time)),
    decisionLifecycle.validation_plan.next_step,
    canonicalNarrative.intraday_progress.current_step,
    canonicalNarrative.intraday_progress.next_step,
  ], [heroConclusion], 5);
  const checklistItems = rawChecklistItems;
  const heroValidation = firstUniqueResearchText([
    decisionLifecycle.validation_plan.next_step,
    formatCheckpoint(decisionPresentation.nextCheckpoint),
    ...checklistItems,
  ], [heroConclusion], '');
  const rawStopSignals = uniqueResearchItems([
    decisionLifecycle.failure_condition.trigger,
    decisionLifecycle.failure_condition.meaning,
    decisionLifecycle.failure_condition.action,
    ...canonicalNarrative.failure_triggers.flatMap((item) => [item.trigger, item.meaning, item.action]),
    ...recordList(memberNoteV2?.risk_scenarios).map((item) => firstText(item.condition, item.risk, item.response)),
    ...recordList(memberNoteV2?.invalidation_conditions).map((item) => firstText(item.condition, item.meaning, item.action_note)),
    ...recordList(memberNoteV2?.invalidation_rules).map((item) => firstText(item.condition, item.meaning, item.action_note)),
  ], [heroConclusion, heroValidation], 5);
  const stopSignals = rawStopSignals;
  const whyItems = uniqueResearchItems([
    decisionLifecycle.question.why,
    canonicalNarrative.today_focus.why,
    ...textList(memberNoteV2?.core_reasoning),
    ...textList(openingThesis.signals),
    ...beneficiaryCandidates.flatMap((item) => item.evidence || []),
    ...checklistItems,
    researcherSummary,
  ], [heroConclusion, heroValidation, ...stopSignals], 3);
  const supportItems = whyItems;
  const opposeItems = uniqueResearchItems([
    decisionLifecycle.failure_condition.meaning,
    ...canonicalNarrative.failure_triggers.map((item) => item.meaning),
    ...recordList(memberNoteV2?.risk_scenarios).map((item) => firstText(item.risk, item.condition)),
    ...recordList(memberNoteV2?.invalidation_conditions).map((item) => firstText(item.meaning, item.condition)),
  ], [heroConclusion, heroValidation, ...supportItems], 3);
  const oppositionItems = opposeItems;
  const invalidationItems = uniqueResearchItems([
    decisionLifecycle.failure_condition.trigger,
    decisionLifecycle.failure_condition.action,
    ...canonicalNarrative.failure_triggers.flatMap((item) => [item.trigger, item.action]),
    ...recordList(memberNoteV2?.invalidation_conditions).flatMap((item) => [item.condition, item.action_note]),
    ...recordList(memberNoteV2?.invalidation_rules).flatMap((item) => [item.condition, item.action_note]),
  ], [...supportItems, ...oppositionItems], 3);
  const todayTakeaway = hasCompletedClosingVerification
    ? decisionLifecycle.daily_lesson
    : firstText(
        decisionLifecycle.current_thesis.summary,
        canonicalNarrative.today_focus.summary,
        todayOneLine,
      );
  const primaryCausalChain = causalChains[0] || {};
  const primaryOvernightChain = strategy.overnight_impact_chain[0];
  const capitalRotation = asRecord(rawAI.capital_rotation_path);
  const externalPriority = asRecord(rawAI.external_priority);
  const sectorTransmission = uniqueResearchItems(
    Array.isArray(primaryCausalChain.sector_transmission)
      ? primaryCausalChain.sector_transmission.map(formatResearchLabel)
      : beneficiaryCandidates.map((item) => formatResearchLabel(item.sector)),
    [],
    3,
  ).join('、');
  const representativeStocks = beneficiaryCandidates
    .slice(0, 3)
    .map((item) => `${item.symbol ? `${item.symbol} ` : ''}${item.name}`)
    .join('、');
  const summaryMainline = firstUniqueResearchText([
    sectorTransmission,
    capitalRotation.main_theme,
    capitalRotation.theme,
    externalPriority.theme,
    beneficiaryCandidates.map((item) => formatResearchLabel(item.sector)).filter(Boolean).join('、'),
  ], [heroConclusion], '');
  const summaryRisk = firstUniqueResearchText(stopSignals, [heroConclusion, heroValidation], '');
  const summaryNext = firstUniqueResearchText([
    decisionLifecycle.validation_plan.next_step,
    formatCheckpoint(decisionPresentation.nextCheckpoint),
    ...checklistItems,
  ], [heroConclusion], '');
  const externalEvent = firstUniqueResearchText([
    primaryCausalChain.overseas_trigger,
    primaryOvernightChain?.catalyst,
    externalPriority.event,
    externalPriority.summary,
    strategy.reasoning_chain[0]?.step,
  ], [heroConclusion, heroValidation, summaryMainline], '');
  const capitalIndustryReaction = firstUniqueResearchText([
    capitalRotation.summary,
    capitalRotation.direction,
    capitalRotation.next_role,
    primaryCausalChain.first_order_impact,
    sectorTransmission,
    strategy.reasoning_chain[1]?.step,
  ], [heroConclusion, heroValidation, externalEvent], '');
  const taiwanMapping = firstUniqueResearchText([
    primaryCausalChain.taiwan_market_bridge,
    asRecord(primaryOvernightChain).taiwan_mapping,
    strategy.reasoning_chain[2]?.step,
  ], [heroConclusion, heroValidation, externalEvent, capitalIndustryReaction], '');
  const flowValidation = firstUniqueResearchText([
    ...checklistItems,
    decisionLifecycle.validation_plan.next_step,
  ], [heroConclusion, heroValidation, externalEvent, capitalIndustryReaction, taiwanMapping], '');
  const researchFlow = [
    { label: '外部事件', question: '發生了什麼？', value: externalEvent },
    { label: '資金／產業反應', question: '理論上資金會往哪裡移動？', value: capitalIndustryReaction },
    { label: '台股映射', question: '這件事如何映射到台灣市場？', value: taiwanMapping },
    { label: '代表股票', question: '哪些股票代表這條路徑？', value: representativeStocks },
    { label: '驗證條件', question: '什麼現象出現才算成立？', value: flowValidation },
  ].filter((item) => Boolean(item.value));
  const researchSummaryCards = [
    { label: '市場', value: formatResearchLabel(marketBias) },
    { label: '主線', value: summaryMainline },
    { label: '風險', value: summaryRisk },
    { label: '下一確認', value: summaryNext },
  ].filter((item) => Boolean(item.value));
  const researchStocks = beneficiaryCandidates.slice(0, 3).map((item) => {
    const reason = firstUniqueResearchText(
      [item.reason, item.transmissionPath],
      [heroConclusion, ...researchFlow.map((flow) => flow.value)],
      '',
    );
    const confirmation = firstUniqueResearchText(
      [item.confirmation, item.watchPoint, ...(item.evidence || [])],
      [heroConclusion, reason],
      '',
    );
    const invalidation = firstUniqueResearchText(
      [item.invalidation, item.risk],
      [heroConclusion, reason, confirmation],
      '',
    );
    return {
      ...item,
      displayRole: formatResearchLabel(item.role || item.sector),
      displayReason: reason,
      displayConfirmation: confirmation,
      displayInvalidation: invalidation,
    };
  }).filter((item) => item.displayReason || item.displayConfirmation || item.displayInvalidation);
  const researchGuidance = [
    { label: '先看什麼', value: firstUniqueResearchText([
      canonicalNarrative.intraday_progress.current_step,
      ...checklistItems,
    ], [heroConclusion, heroValidation, summaryNext, flowValidation], '') },
    { label: '避免什麼', value: firstUniqueResearchText(
      [...dontDoItems, decisionLifecycle.failure_condition.action],
      [heroConclusion, summaryRisk, ...oppositionItems],
      '',
    ) },
    { label: '何時回來', value: firstUniqueResearchText([
      canonicalNarrative.intraday_progress.next_step,
      formatCheckpoint(decisionPresentation.nextCheckpoint),
    ], [heroConclusion, heroValidation, summaryNext], '') },
  ].filter((item) => Boolean(item.value));
  const nextConfirmationDetail = firstUniqueResearchText([
    canonicalNarrative.intraday_progress.next_step,
    formatCheckpoint(decisionPresentation.nextCheckpoint),
    decisionLifecycle.validation_plan.next_step,
  ], [heroConclusion, heroValidation, summaryNext, ...researchGuidance.map((item) => item.value)], '');
  return (
    <div className="ma-page ma-pixel-page ma-research-note-page flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        <section className="ma-pixel-hero">
          <div className="ma-pixel-content ma-pixel-hero-grid">
            <div className="ma-pixel-hero-copy">
              <p className="ma-pixel-eyebrow"><i className="ri-book-open-line" aria-hidden="true" />完整研究邏輯 · {reportDate}</p>
              <h1>完整研究筆記</h1>
              <p className="ma-pixel-hero-subtitle">{renderSafeText(heroConclusion)}</p>
            </div>
            <aside className="ma-phase2-status-card ma-research-summary-card">
              <div><span>市場方向</span><strong>{renderSafeText(formatResearchLabel(marketBias) || '資料不足')}</strong></div>
              <div><span>信心</span><p>{confidenceScore != null ? `${confidenceScore}/100 · ${scoreDisplay.label}` : scoreDisplay.label}</p></div>
              <div><span>今天最重要驗證</span><p>{renderSafeText(heroValidation)}</p></div>
            </aside>
          </div>
        </section>

        <div className="ma-pixel-content ma-pixel-page-sections">
          <section>
            <div className="ma-phase2-kpi-grid">{researchSummaryCards.map((item) => <article key={item.label} className="ma-phase2-kpi-card"><p>{item.label}</p><strong>{renderSafeText(item.value)}</strong></article>)}</div>
          </section>

          {canViewMemberNoteFull ? (
            <>
              <section><div className="ma-phase2-section-heading"><i className="ri-links-line" aria-hidden="true" /><div><h2>傳導路徑</h2><p>從外部事件一路驗證到代表股票。</p></div></div><div className="ma-research-flow">{researchFlow.map((item, index) => <article key={item.label} className="ma-research-flow-node"><span>{index + 1}</span><div><p>{item.label} · {item.question}</p><strong>{renderSafeText(item.value)}</strong></div></article>)}</div></section>

              <section className="ma-phase2-signal-grid">
                <div className="ma-phase2-list-panel is-support"><div className="ma-phase2-section-heading"><i className="ri-check-line" aria-hidden="true" /><div><h2>支持證據</h2></div></div>{supportItems.map((item) => <div key={item} className="ma-phase2-signal-row"><i className="ri-check-line" aria-hidden="true" /><span>{renderSafeText(item)}</span></div>)}</div>
                <div className="ma-phase2-list-panel is-oppose"><div className="ma-phase2-section-heading"><i className="ri-close-line" aria-hidden="true" /><div><h2>反對證據</h2></div></div>{oppositionItems.map((item) => <div key={item} className="ma-phase2-signal-row"><i className="ri-close-line" aria-hidden="true" /><span>{renderSafeText(item)}</span></div>)}</div>
              </section>

              {researchStocks.length > 0 && (
                <section>
                  <div className="ma-phase2-section-heading"><i className="ri-stock-line" aria-hidden="true" /><div><h2>代表股票</h2><p>每檔股票只呈現既有劇本角色與可驗證條件。</p></div></div>
                  <div className="ma-research-stock-grid grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {researchStocks.map((stock) => (
                      <article key={`${stock.symbol || 'stock'}-${stock.name}`} className="ma-research-stock-card min-w-0 rounded-[14px] border border-[#20364A] bg-[#0B1A2A] p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>{stock.symbol && <span className="text-xs font-bold text-[#14C982]">{stock.symbol}</span>}<h3 className="mt-1 text-lg font-bold text-[#F4F7FB]">{renderSafeText(stock.name)}</h3></div>
                          {stock.displayRole && <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300">{renderSafeText(stock.displayRole)}</span>}
                        </div>
                        <div className="mt-5 space-y-4">
                          {stock.displayReason && <div><p className="text-xs text-[#6F7F90]">入選原因</p><p className="mt-1 text-sm leading-6 text-[#B5C1CF]">{renderSafeText(stock.displayReason)}</p></div>}
                          {stock.displayConfirmation && <div className="border-t border-[#20364A] pt-4"><p className="text-xs text-[#6F7F90]">成立條件</p><p className="mt-1 text-sm leading-6 text-[#B5C1CF]">{renderSafeText(stock.displayConfirmation)}</p></div>}
                          {stock.displayInvalidation && <div className="border-t border-[#20364A] pt-4"><p className="text-xs text-[#6F7F90]">失效條件</p><p className="mt-1 text-sm leading-6 text-[#B5C1CF]">{renderSafeText(stock.displayInvalidation)}</p></div>}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {researchGuidance.length > 0 && <section><div className="ma-phase2-section-heading"><i className="ri-compass-3-line" aria-hidden="true" /><div><h2>今天如何使用</h2></div></div><div className="ma-research-guidance-grid">{researchGuidance.map((item) => <article key={item.label}><p>{item.label}</p><strong>{renderSafeText(item.value)}</strong></article>)}</div></section>}

              <section className="ma-phase2-signal-grid">
                {invalidationItems.length > 0 && <div className="ma-phase2-list-panel is-oppose"><div className="ma-phase2-section-heading"><i className="ri-error-warning-line" aria-hidden="true" /><div><h2>失效條件</h2><p>出現以下訊號時，停止沿用原劇本。</p></div></div>{invalidationItems.map((item) => <div key={item} className="ma-phase2-signal-row"><i className="ri-close-line" aria-hidden="true" /><span>{renderSafeText(item)}</span></div>)}</div>}
                {nextConfirmationDetail && <div className="ma-phase2-list-panel"><div className="ma-phase2-section-heading"><i className="ri-time-line" aria-hidden="true" /><div><h2>下一次確認</h2><p>回到下一個節點，重新檢查劇本是否成立。</p></div></div><div className="ma-phase2-signal-row"><i className="ri-arrow-right-line" aria-hidden="true" /><span>{renderSafeText(nextConfirmationDetail)}</span></div><Link to="/war-room" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-400/30 px-4 py-2 text-sm font-semibold text-emerald-300">查看盤中追蹤<i className="ri-arrow-right-line" aria-hidden="true" /></Link></div>}
              </section>
            </>
          ) : (
            <PaywallCard title="升級會員查看完整盤前研究筆記" description="完整研究推導、支持與反對證據，以及今日使用方式收在會員版。" requiredTier="member" featureList={['完整研究推導', '支持與反對證據', '今日使用方式']} tone="dark" />
          )}
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
