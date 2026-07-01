/**
 * normalizeReport — 統一從 reports 原始列 + ai_strategy_json 提取所有欄位。
 *
 * 規則：所有不存在於 reports top-level 的欄位（source, validation_status,
 * quality_score, no_fake_fallback, repaired_by_system）都從 ai_strategy_json 讀取。
 *
 * 使用方式：所有讀取 reports 的頁面 / hook / service 統一用此函式加工資料，不要各自亂讀。
 */
import type { Report } from '@/types/report';

export interface NormalizedReport {
  id: string;
  report_date: string;
  market_bias: string | null;
  confidence_score: number | null;
  summary: string | null;
  created_at: string;

  /** 資料來源，取自 ai_strategy_json.source */
  source: string;
  /** 品質驗證狀態，取自 ai_strategy_json.validation_status */
  validation_status: string;
  /** 內容品質分數，取自 ai_strategy_json.quality_score */
  quality_score: number | null;
  /** 假資料防線，取自 ai_strategy_json.no_fake_fallback */
  no_fake_fallback: boolean | null;
  /** 系統修補標記，取自 ai_strategy_json.repaired_by_system */
  repaired_by_system: boolean | null;

  /** 隔夜影響鏈，取自 ai_strategy_json.overnight_impact_chains */
  overnight_impact_chains: Record<string, unknown>[];
  /** 會員閱讀摘要，取自 ai_strategy_json.member_reading */
  member_reading: string;

  /** 原始 ai_strategy_json 全文（型別保留給下游使用） */
  ai_strategy_json: Record<string, unknown> | null;
}

/**
 * 只 select 確定存在的 columns，絕不 select source / validation_status /
 * quality_score / no_fake_fallback / repaired_by_system 這些不存在欄位。
 */
export const REPORTS_STABLE_COLUMNS =
  'id, report_date, market_bias, confidence_score, summary, ai_strategy_json, created_at';

/**
 * 從 Supabase row（Record<string, unknown>）建立 NormalizedReport。
 */
export function normalizeReport(
  row: Record<string, unknown>,
  existingReport?: Report | null,
): NormalizedReport {
  const aiRaw = row.ai_strategy_json as Record<string, unknown> | null;
  const ai = aiRaw || {};

  // Use existingReport values as fallback for summary / bias / score
  // if the row has them already, row values win
  const summary =
    typeof row.summary === 'string' && row.summary.trim()
      ? row.summary
      : (existingReport?.summary ?? null);

  const marketBias =
    typeof row.market_bias === 'string' && row.market_bias.trim()
      ? row.market_bias
      : (existingReport?.market_bias ?? null);

  const confidenceScore =
    row.confidence_score != null
      ? Number(row.confidence_score)
      : (existingReport?.confidence_score ?? null);

  return {
    id: String(row.id || existingReport?.id || ''),
    report_date: String(row.report_date || existingReport?.report_date || ''),
    market_bias: marketBias,
    confidence_score: Number.isNaN(confidenceScore) ? null : confidenceScore,
    summary,
    created_at: String(row.created_at || existingReport?.created_at || ''),

    source: typeof ai.source === 'string' ? ai.source : '未提供',
    validation_status:
      typeof ai.validation_status === 'string' ? ai.validation_status : '未提供',
    quality_score: ai.quality_score != null ? Number(ai.quality_score) : null,
    no_fake_fallback:
      typeof ai.no_fake_fallback === 'boolean' ? ai.no_fake_fallback : null,
    repaired_by_system:
      typeof ai.repaired_by_system === 'boolean' ? ai.repaired_by_system : null,

    overnight_impact_chains: Array.isArray(ai.overnight_impact_chains)
      ? (ai.overnight_impact_chains as Record<string, unknown>[])
      : [],
    member_reading:
      typeof ai.member_reading === 'string' ? ai.member_reading : '',

    ai_strategy_json: aiRaw,
  };
}

/**
 * 從 NormalizedReport 取一句話摘要（前台免費區用）。
 * Fallback: member_reading → summary → 固定提示
 */
export function getOneLiner(nr: NormalizedReport): string {
  if (nr.member_reading) return nr.member_reading;
  if (nr.summary) return nr.summary;
  return '今日報告已產生，請查看完整判讀。';
}

/**
 * 從 NormalizedReport 取內容品質分數。
 */
export function getQualityScore(nr: NormalizedReport): number | null {
  return nr.quality_score;
}