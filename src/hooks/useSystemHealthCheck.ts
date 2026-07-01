import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Report } from '@/types/report';
import { mapRowToReport } from '@/services/reportService';
import { normalizeMorningAlphaReport, type MorningAlphaNormalizedReport } from '@/lib/morningAlphaReportAdapter';

// ===== Types =====

export type ItemStatus = 'normal' | 'warning' | 'error' | 'not_connected';

export interface HealthCheckItem {
  module: string;
  status: ItemStatus;
  result: string;
  dataSource: string;
  latestTime: string;
  suggestion: string;
}

export interface SymbolStatusEntry {
  display: string;
  has: boolean;
  matchedAlias: string | null;
  matchedName: string | null;
}

export interface DailyCheckItem {
  seq: number;
  name: string;
  status: ItemStatus;
  statusText: string;
  dataSource: string;
  passCriteria: string;
  suggestion: string;
}

// ════════════════════════════════════════════
// PM Acceptance Mode (V50)
// ════════════════════════════════════════════

export interface PMCheckDetail {
  label: string;
  name: string;
  passed: boolean;
  detail: string;
  items: { label: string; ok: boolean; detail: string }[];
}

export type PMConclusion = 'can_publish' | 'can_publish_with_caution' | 'not_recommended' | 'blocked';

export interface PMAcceptance {
  conclusion: PMConclusion;
  conclusionLabel: string;
  conclusionColor: 'green' | 'yellow' | 'red';
  conclusionReason: string;
  checks: PMCheckDetail[];
  passedCount: number;
  totalCount: number;
}

export interface SystemHealthCheckResult {
  loading: boolean;
  error: string | null;
  taipeiDate: string;
  healthCheckDate: string;
  isUsingLatestTradingDay: boolean;
  report: Report | null;
  marketDataCount: number;
  marketNewsCount: number;
  marketDataLatestTime: string | null;
  marketNewsLatestTime: string | null;
  missingSymbols: string[];
  presentSymbols: string[];
  symbolStatuses: SymbolStatusEntry[];
  healthItems: HealthCheckItem[];
  systemHealthScore: number;
  contentQualityScore: number | null;
  directionConfidenceScore: number | null;
  authenticityStatus: '真資料報告' | '資料需確認';
  impactChainCount: number;
  memberReadingLength: number | null;
  reportVersion: string | null;
  reportSource: string | null;
  validationStatus: string | null;
  noFakeFallback: boolean | null;
  repairedBySystem: boolean | null;
  openingRadarStatus: string | null;
  openingRadarDate: string | null;
  closeReviewResult: string | null;
  closeReviewTaiexChange: number | null;
  closeReviewDate: string | null;
  closeReviewDataQuality: string | null;
  forbiddenWordsPassed: boolean | null;
  forbiddenWordsDetails: string[];
  twCoreSymbolsAllPresent: boolean;
  pmAcceptance: PMAcceptance | null;
  // ── V7.54+ ──
  hasMemberResearchNote: boolean;
  publishReady: boolean;
  fakeFallbackUsed: boolean | null;
  dataDateAligned: boolean | null;
  marketDataBasisDate: string | null;
  memberValueScore: number | null;
  reelsAvailable: boolean;
  socialPostAvailable: boolean;
  lineAvailable: boolean;
  /** V7.55: Morning Alpha Normalized Report */
  morningAlpha: MorningAlphaNormalizedReport;
  refresh: () => Promise<void>;
}

// ===== Taipei date helpers =====

function getTaipeiDateString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatTaipeiTime(isoStr: string | null): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

// ===== Symbol alias groups =====

interface AliasGroup {
  display: string;
  isTWCore: boolean;
  aliases: string[];
}

const SYMBOL_ALIAS_GROUPS: AliasGroup[] = [
  {
    display: 'TAIEX',
    isTWCore: true,
    aliases: ['TAIEX', 'TWSE', '^TWII', '加權指數', '台股加權', '台灣加權'],
  },
  {
    display: 'TXF',
    isTWCore: true,
    aliases: ['TXF', 'TX', 'TXF1', '台指期', '台股期貨'],
  },
  {
    display: '2330',
    isTWCore: true,
    aliases: ['2330', '2330.TW', 'TSMC_TW', '台積電'],
  },
  {
    display: 'SPX',
    isTWCore: false,
    aliases: ['SPX', '^GSPC', 'S&P 500'],
  },
  {
    display: 'SOX',
    isTWCore: false,
    aliases: ['SOX', '^SOX', '費半', '費城半導體'],
  },
  {
    display: 'NVDA',
    isTWCore: false,
    aliases: ['NVDA', 'NVIDIA', 'Nvidia'],
  },
  {
    display: 'TSM',
    isTWCore: false,
    aliases: ['TSM', 'TSM ADR', '台積電 ADR'],
  },
  {
    display: 'VIX',
    isTWCore: false,
    aliases: ['VIX', '^VIX'],
  },
  {
    display: 'DXY',
    isTWCore: false,
    aliases: ['DXY', 'USDX', '美元指數'],
  },
  {
    display: 'US10Y',
    isTWCore: false,
    aliases: ['US10Y', 'TNX', 'US10Y_YIELD', '美國10年債', '美債10年'],
  },
];

const TW_CORE_DISPLAYS = ['TAIEX', 'TXF', '2330'];

function matchAliasGroup(group: AliasGroup, symbols: Set<string>): string | null {
  for (const alias of group.aliases) {
    if (symbols.has(alias)) return alias;
  }
  return null;
}

// ===== Safe accessors =====

function safeBoolean(val: unknown): boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    if (val === 'true') return true;
    if (val === 'false') return false;
  }
  return null;
}

function safeString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

// ===== Forbidden words check =====

const FORBIDDEN_WORDS = [
  '盤前劇本命中',
  '偏多觀察方向一致',
  '劇本成立',
  '盤前偏多假設成立',
];

function checkForbiddenWords(textSources: string[]): { passed: boolean; found: string[] } {
  const found: string[] = [];
  for (const source of textSources) {
    if (!source) continue;
    for (const word of FORBIDDEN_WORDS) {
      if (source.includes(word) && !found.includes(word)) {
        found.push(word);
      }
    }
  }
  return { passed: found.length === 0, found };
}

// ===== Sanitize data_quality =====

function sanitizeDataQuality(raw: string | null): string {
  if (!raw) return '—';
  return raw
    .replace(/[（(]\s*手動修正[^）)]*[）)]/g, '')
    .replace(/[（(]\s*還原收盤資料[^）)]*[）)]/g, '')
    .replace(/[（(]\s*人工修正[^）)]*[）)]/g, '')
    .replace(/[（(]\s*forced update[^）)]*[）)]/gi, '')
    .replace(/[（(]\s*manual correction[^）)]*[）)]/gi, '')
    .replace(/\s*[（(]\s*[）)]/g, '')
    .trim();
}

// ===== Main hook =====

export function useSystemHealthCheck(): SystemHealthCheckResult {
  const taipeiDate = getTaipeiDateString();

  // Core states
  const [report, setReport] = useState<Report | null>(null);
  const [healthCheckDate, setHealthCheckDate] = useState<string>(taipeiDate);
  const [isUsingLatestTradingDay, setIsUsingLatestTradingDay] = useState(false);
  const [marketDataCount, setMarketDataCount] = useState(0);
  const [marketNewsCount, setMarketNewsCount] = useState(0);
  const [marketDataLatestTime, setMarketDataLatestTime] = useState<string | null>(null);
  const [marketNewsLatestTime, setMarketNewsLatestTime] = useState<string | null>(null);
  const [missingSymbols, setMissingSymbols] = useState<string[]>([]);
  const [presentSymbols, setPresentSymbols] = useState<string[]>([]);
  const [symbolStatuses, setSymbolStatuses] = useState<SymbolStatusEntry[]>([]);
  const [healthItems, setHealthItems] = useState<HealthCheckItem[]>([]);
  const [systemHealthScore, setSystemHealthScore] = useState(0);
  const [contentQualityScore, setContentQualityScore] = useState<number | null>(null);
  const [directionConfidenceScore, setDirectionConfidenceScore] = useState<number | null>(null);
  const [authenticityStatus, setAuthenticityStatus] = useState<'真資料報告' | '資料需確認'>('資料需確認');
  const [impactChainCount, setImpactChainCount] = useState(0);
  const [memberReadingLength, setMemberReadingLength] = useState<number | null>(null);
  const [reportVersion, setReportVersion] = useState<string | null>(null);
  const [reportSource, setReportSource] = useState<string | null>(null);
  const [validationStatus, setValidationStatus] = useState<string | null>(null);
  const [noFakeFallback, setNoFakeFallback] = useState<boolean | null>(null);
  const [repairedBySystem, setRepairedBySystem] = useState<boolean | null>(null);
  const [openingRadarStatus, setOpeningRadarStatus] = useState<string | null>(null);
  const [openingRadarDate, setOpeningRadarDate] = useState<string | null>(null);
  const [closeReviewResult, setCloseReviewResult] = useState<string | null>(null);
  const [closeReviewTaiexChange, setCloseReviewTaiexChange] = useState<number | null>(null);
  const [closeReviewDate, setCloseReviewDate] = useState<string | null>(null);
  const [closeReviewDataQuality, setCloseReviewDataQuality] = useState<string | null>(null);
  const [forbiddenWordsPassed, setForbiddenWordsPassed] = useState<boolean | null>(null);
  const [forbiddenWordsDetails, setForbiddenWordsDetails] = useState<string[]>([]);
  const [twCoreSymbolsAllPresent, setTwCoreSymbolsAllPresent] = useState(false);
  const [pmAcceptance, setPMAcceptance] = useState<PMAcceptance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ── V7.54+ state additions ──
  const [hasMemberResearchNote, setHasMemberResearchNote] = useState(false);
  const [publishReady, setPublishReady] = useState(false);
  const [fakeFallbackUsed, setFakeFallbackUsed] = useState<boolean | null>(null);
  const [dataDateAligned, setDataDateAligned] = useState<boolean | null>(null);
  const [marketDataBasisDate, setMarketDataBasisDate] = useState<string | null>(null);
  const [memberValueScore, setMemberValueScore] = useState<number | null>(null);
  const [reelsAvailable, setReelsAvailable] = useState(false);
  const [socialPostAvailable, setSocialPostAvailable] = useState(false);
  const [lineAvailable, setLineAvailable] = useState(false);
  const [morningAlpha, setMorningAlpha] = useState<MorningAlphaNormalizedReport>(
    normalizeMorningAlphaReport(null)
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // ═══════════════════════════════════════
      // STEP 1: Determine healthCheckDate
      // ═══════════════════════════════════════

      // V7.54: Always use today Taipei date for display.
      // The check date is always today. If today is a weekday, the
      // report display date IS today. The market_data_basis_date
      // (e.g. 2026-06-12) may differ from the display date — that's
      // normal for pre-market reports using the latest complete
      // trading day data.
      const checkDate = taipeiDate;

      // Determine if today is a weekend (actual non-trading day)
      const taipeiDow = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' })
      ).getDay();
      const isActualWeekend = taipeiDow === 0 || taipeiDow === 6;

      // Always fetch the latest report by created_at (most recent)
      const { data: latestReportRow, error: latestErr } = await supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestErr) {
        console.error('Health check: latest report query error:', latestErr.message);
      }

      let rpt: Report | null = null;
      let aiJson: Record<string, unknown> | null = null;
      let rptCreatedAt: string | null = null;
      const rawRow = latestReportRow as Record<string, unknown> | null;

      if (rawRow) {
        rpt = mapRowToReport(rawRow);
        aiJson = (rawRow.ai_strategy_json as Record<string, unknown>) || null;
        rptCreatedAt = safeString(rawRow.created_at);
      }

      setReport(rpt);
      setHealthCheckDate(checkDate);
      setIsUsingLatestTradingDay(isActualWeekend);

      // V7.55: Normalize report through the adapter
      if (rawRow) {
        setMorningAlpha(normalizeMorningAlphaReport({
          id: String(rawRow.id || ''),
          report_date: String(rawRow.report_date || ''),
          market_bias: rawRow.market_bias ? String(rawRow.market_bias) : null,
          confidence_score: rawRow.confidence_score != null ? Number(rawRow.confidence_score) : null,
          created_at: String(rawRow.created_at || ''),
          ai_strategy_json: (rawRow.ai_strategy_json as Record<string, unknown>) || null,
          summary: rawRow.summary ? String(rawRow.summary) : null,
        }));
      }

      // ═══════════════════════════════════════
      // STEP 2: (REMOVED — report already fetched in STEP 1)
      // ═══════════════════════════════════════

      // ═══════════════════════════════════════
      // STEP 3: Fetch market_data by healthCheckDate
      // ═══════════════════════════════════════

      const checkStart = `${checkDate}T00:00:00+08:00`;
      const checkEnd = `${checkDate}T23:59:59+08:00`;

      const { data: mdData, error: mdErr } = await supabase
        .from('market_data')
        .select('symbol, captured_at')
        .gte('captured_at', checkStart)
        .lte('captured_at', checkEnd);

      let mdCount = 0;
      let mdLatest: string | null = null;
      const mdSymbols = new Set<string>();
      if (!mdErr && mdData) {
        const rows = mdData as Array<{ symbol: string; captured_at: string }>;
        mdCount = rows.length;
        for (const r of rows) {
          mdSymbols.add(r.symbol);
          if (!mdLatest || r.captured_at > mdLatest) {
            mdLatest = r.captured_at;
          }
        }
      }

      setMarketDataCount(mdCount);
      setMarketDataLatestTime(mdLatest);

      // ═══════════════════════════════════════
      // STEP 4: Fetch market_news by healthCheckDate
      // ═══════════════════════════════════════

      const { data: mnData, error: mnErr } = await supabase
        .from('market_news')
        .select('created_at')
        .gte('created_at', checkStart)
        .lte('created_at', checkEnd);

      let mnCount = 0;
      let mnLatest: string | null = null;
      if (!mnErr && mnData) {
        const rows = mnData as Array<{ created_at: string }>;
        mnCount = rows.length;
        for (const r of rows) {
          if (!mnLatest || r.created_at > mnLatest) {
            mnLatest = r.created_at;
          }
        }
      }

      setMarketNewsCount(mnCount);
      setMarketNewsLatestTime(mnLatest);

      // ═══════════════════════════════════════
      // STEP 5: Core symbols check — query ALL market_data
      //         (no date filter, because TW core snapshots
      //          may predate healthCheckDate but are still
      //          valid records)
      // ═══════════════════════════════════════

      const { data: allMdRows, error: allMdErr } = await supabase
        .from('market_data')
        .select('symbol, name');

      const allMdSymbols = new Set<string>();
      const allMdNames = new Set<string>();
      // symbol → name map for display
      const symbolNameMap = new Map<string, string>();

      if (!allMdErr && allMdRows) {
        for (const row of allMdRows as Array<{ symbol: string; name: string }>) {
          allMdSymbols.add(row.symbol);
          if (row.name) {
            allMdNames.add(row.name);
            if (!symbolNameMap.has(row.symbol)) {
              symbolNameMap.set(row.symbol, row.name);
            }
          }
        }
      }

      const symbolStats: SymbolStatusEntry[] = [];
      const presentDisp: string[] = [];
      const missingDisp: string[] = [];
      let twCoreMissing = 0;

      for (const group of SYMBOL_ALIAS_GROUPS) {
        let matched: string | null = matchAliasGroup(group, allMdSymbols);
        let matchedName: string | null = matched ? (symbolNameMap.get(matched) || null) : null;

        // TW core fallback: if no exact symbol alias match,
        // also try name-based matching (e.g. 台股加權指數 → TAIEX)
        if (!matched && group.isTWCore) {
          if (group.display === 'TAIEX') {
            for (const n of allMdNames) {
              if (n.includes('加權') || n.includes('台股加權')) {
                // find the symbol that has this name
                for (const [sym, nm] of symbolNameMap) {
                  if (nm === n) { matched = sym; matchedName = nm; break; }
                }
                if (matched) break;
              }
            }
          } else if (group.display === 'TXF') {
            for (const n of allMdNames) {
              if (n.includes('台指期') || n.includes('台指')) {
                for (const [sym, nm] of symbolNameMap) {
                  if (nm === n) { matched = sym; matchedName = nm; break; }
                }
                if (matched) break;
              }
            }
          } else if (group.display === '2330') {
            // check symbol contains '2330'
            for (const sym of allMdSymbols) {
              if (sym.includes('2330')) { matched = sym; matchedName = symbolNameMap.get(sym) || null; break; }
            }
            // check name contains '台積電'
            if (!matched) {
              for (const n of allMdNames) {
                if (n.includes('台積電')) {
                  for (const [sym, nm] of symbolNameMap) {
                    if (nm === n) { matched = sym; matchedName = nm; break; }
                  }
                  if (matched) break;
                }
              }
            }
          }
        }

        symbolStats.push({
          display: group.display,
          has: matched !== null,
          matchedAlias: matched,
          matchedName,
        });

        if (matched !== null) {
          presentDisp.push(group.display);
        } else {
          missingDisp.push(group.display);
          if (group.isTWCore) {
            twCoreMissing++;
          }
        }
      }

      setSymbolStatuses(symbolStats);
      setPresentSymbols(presentDisp);
      setMissingSymbols(missingDisp);
      setTwCoreSymbolsAllPresent(twCoreMissing === 0);

      // ═══════════════════════════════════════
      // STEP 6: Read ai_strategy_json fields (V7.54+)
      // ═══════════════════════════════════════

      const version = safeString(aiJson?.version);
      const source = safeString(aiJson?.source);
      const valStatus = safeString(aiJson?.validation_status);
      const qualityScoreRaw = aiJson?.quality_score != null ? Number(aiJson.quality_score) : null;
      const mvScoreRaw = aiJson?.member_value_score != null ? Number(aiJson.member_value_score) : null;
      const nff = safeBoolean(aiJson?.no_fake_fallback);
      const rbs = safeBoolean(aiJson?.repaired_by_system);
      const pr = safeBoolean(aiJson?.publish_ready);
      const ffu = safeBoolean(aiJson?.fake_fallback_used);
      const dda = safeBoolean(aiJson?.data_date_aligned);
      const basisDate = safeString(aiJson?.market_data_latest_date);

      // ── overnight_impact_chain (singular in V7.53+) ──
      const chains = Array.isArray(aiJson?.overnight_impact_chain)
        ? (aiJson!.overnight_impact_chain as unknown[])
        : Array.isArray(aiJson?.overnight_impact_chains)
          ? (aiJson!.overnight_impact_chains as unknown[])
          : [];
      const chainCount = chains.length;

      // ── member_research_note (flat object in V7.53+) ──
      const memberNote = (aiJson?.member_research_note as Record<string, unknown>) || {};
      const mnTitle = safeString(memberNote.title);
      const mnExecView = safeString(memberNote.executive_view);
      const mnDataBasis = safeString(memberNote.data_basis);
      const mnKeyObs = Array.isArray(memberNote.key_observations) ? memberNote.key_observations : [];
      const mnMainThesis = safeString(memberNote.main_thesis);
      const mnRiskNotes = safeString(memberNote.risk_notes);

      const mnHasContent = !!mnTitle || !!mnExecView || !!mnDataBasis || mnKeyObs.length > 0 || !!mnMainThesis || !!mnRiskNotes;

      // ── member reading length (fallback: member_research_note text) ──
      let mrLen: number | null = null;
      // First try old member_reading
      const mrOld = aiJson?.member_reading;
      if (mrOld && typeof mrOld === 'object') {
        const mrObj = mrOld as Record<string, unknown>;
        const coreScript = safeString(mrObj.core_script);
        if (coreScript) mrLen = coreScript.length;
      } else if (typeof mrOld === 'string' && mrOld.trim()) {
        mrLen = mrOld.trim().length;
      }
      // Fallback: measure member_research_note text length
      if (mrLen === null && mnHasContent) {
        const mnText = [mnTitle, mnExecView, mnDataBasis, ...mnKeyObs, mnMainThesis, mnRiskNotes]
          .filter(Boolean).join(' ');
        if (mnText.length > 0) mrLen = mnText.length;
      }

      // ── reels_script ──
      const reelsObj = (aiJson?.reels_script as Record<string, unknown>) || {};
      const reelsOk = !!reelsObj.hook_0_5_sec || !!reelsObj.core_5_25_sec;

      // ── social_post ──
      const socialObj = (aiJson?.social_post as Record<string, unknown>) || {};
      const socialOk = !!socialObj.title || !!socialObj.full_post;

      // ── line_push_copy ──
      const lineObj = (aiJson?.line_push_copy as Record<string, unknown>) || {};
      const lineOk = !!lineObj.one_sentence || !!lineObj.market_bias || !!lineObj.do_not_do;

      setReportVersion(version);
      setReportSource(source);
      setValidationStatus(valStatus);
      setContentQualityScore(qualityScoreRaw);
      setNoFakeFallback(nff);
      setRepairedBySystem(rbs);
      setImpactChainCount(chainCount);
      setMemberReadingLength(mrLen);
      setDirectionConfidenceScore(rpt?.confidence_score ?? null);
      setHasMemberResearchNote(mnHasContent);
      setPublishReady(pr === true);
      setFakeFallbackUsed(ffu);
      setDataDateAligned(dda);
      setMarketDataBasisDate(basisDate);
      setMemberValueScore(mvScoreRaw);
      setReelsAvailable(reelsOk);
      setSocialPostAvailable(socialOk);
      setLineAvailable(lineOk);

      // ═══════════════════════════════════════
      // STEP 7: Fetch opening_market_radar
      // ═══════════════════════════════════════

      const { data: omrRow, error: omrErr } = await supabase
        .from('opening_market_radar')
        .select('report_date, radar_status')
        .eq('report_date', checkDate)
        .maybeSingle();

      let omrStatus: string | null = null;
      let omrDate: string | null = null;
      if (!omrErr && omrRow) {
        const omr = omrRow as Record<string, unknown>;
        omrDate = safeString(omr.report_date);
        omrStatus = safeString(omr.radar_status);
      }

      setOpeningRadarDate(omrDate);
      setOpeningRadarStatus(omrStatus);

      // ═══════════════════════════════════════
      // STEP 8: Fetch close_market_reviews
      // ═══════════════════════════════════════

      const { data: cmrRow, error: cmrErr } = await supabase
        .from('close_market_reviews')
        .select('report_date, verification_result, taiex_change, data_quality, opening_radar_status')
        .eq('report_date', checkDate)
        .maybeSingle();

      let cmrResult: string | null = null;
      let cmrTaiex: number | null = null;
      let cmrDate: string | null = null;
      let cmrDataQuality: string | null = null;
      let cmrOpeningRadarStatus: string | null = null;

      if (!cmrErr && cmrRow) {
        const cmr = cmrRow as Record<string, unknown>;
        cmrDate = safeString(cmr.report_date);
        cmrResult = safeString(cmr.verification_result);
        cmrTaiex = cmr.taiex_change != null ? Number(cmr.taiex_change) : null;
        cmrDataQuality = sanitizeDataQuality(safeString(cmr.data_quality));
        cmrOpeningRadarStatus = safeString(cmr.opening_radar_status);
      }

      setCloseReviewDate(cmrDate);
      setCloseReviewResult(cmrResult);
      setCloseReviewTaiexChange(cmrTaiex);
      setCloseReviewDataQuality(cmrDataQuality);

      // ═══════════════════════════════════════
      // STEP 8b: Fetch sector_rotation_scores (V25)
      // ═══════════════════════════════════════

      const { data: secRow, error: secErr } = await supabase
        .from('sector_rotation_scores')
        .select('id, score_date')
        .eq('score_date', checkDate)
        .limit(1);

      let secDate: string | null = null;
      let secHasToday = false;
      if (!secErr && secRow && secRow.length > 0) {
        secDate = safeString((secRow[0] as Record<string, unknown>).score_date);
        secHasToday = true;
      }

      // ═══════════════════════════════════════
      // STEP 9: Forbidden words check
      // ═══════════════════════════════════════

      const textSources: string[] = [];

      if (rpt?.summary) textSources.push(rpt.summary);
      if (rpt?.market_bias) textSources.push(rpt.market_bias);
      if (aiJson) textSources.push(JSON.stringify(aiJson));

      if (omrStatus) textSources.push(omrStatus);

      if (cmrResult) textSources.push(cmrResult);

      const fwResult = checkForbiddenWords(textSources);
      setForbiddenWordsPassed(fwResult.passed);
      setForbiddenWordsDetails(fwResult.found);

      // ═══════════════════════════════════════
      // STEP 10: Build health items
      // ═══════════════════════════════════════

      const items: HealthCheckItem[] = [];
      const now = new Date().toISOString();

      const dateLabel = isActualWeekend ? `非交易日，使用 ${checkDate} 最近資料` : `交易日 ${checkDate}`;

      // --- Item 1: 主報告 ---
      const basisLabel = basisDate ? `｜資料基準 ${basisDate}` : '';
      if (rpt) {
        items.push({
          module: '主報告',
          status: 'normal',
          result: `報告已生成，market_bias=${rpt.market_bias || '—'}${basisLabel}`,
          dataSource: 'public.reports',
          latestTime: formatTaipeiTime(rpt.created_at),
          suggestion: '—',
        });
      } else {
        items.push({
          module: '主報告',
          status: 'error',
          result: `報告尚未生成`,
          dataSource: 'public.reports',
          latestTime: '—',
          suggestion: '請檢查 Daily Report cron 或 Edge Function',
        });
      }

      // --- Item 2: 市場資料 ---
      const mdLabel = '市場資料';
      if (mdCount >= 8) {
        items.push({
          module: mdLabel,
          status: 'normal',
          result: `${dateLabel}：已更新（${mdCount} 筆）`,
          dataSource: 'public.market_data',
          latestTime: formatTaipeiTime(mdLatest),
          suggestion: '—',
        });
      } else if (mdCount >= 1) {
        items.push({
          module: mdLabel,
          status: 'warning',
          result: `${dateLabel}：資料偏少（${mdCount} 筆）`,
          dataSource: 'public.market_data',
          latestTime: formatTaipeiTime(mdLatest),
          suggestion: '請確認 Market Data cron 或 API',
        });
      } else {
        items.push({
          module: mdLabel,
          status: 'error',
          result: `${dateLabel}：尚未更新`,
          dataSource: 'public.market_data',
          latestTime: '—',
          suggestion: '請檢查 fetch-market-data cron 是否正常執行',
        });
      }

      // --- Item 3: 新聞資料 ---
      const mnLabel = '新聞資料';
      if (mnCount >= 20) {
        items.push({
          module: mnLabel,
          status: 'normal',
          result: `${dateLabel}：已更新（${mnCount} 筆）`,
          dataSource: 'public.market_news',
          latestTime: formatTaipeiTime(mnLatest),
          suggestion: '—',
        });
      } else if (mnCount >= 1) {
        items.push({
          module: mnLabel,
          status: 'warning',
          result: `${dateLabel}：資料偏少（${mnCount} 筆）`,
          dataSource: 'public.market_news',
          latestTime: formatTaipeiTime(mnLatest),
          suggestion: '請確認 fetch-global-market-news cron 是否正常執行',
        });
      } else {
        items.push({
          module: mnLabel,
          status: 'error',
          result: `${dateLabel}：尚未更新`,
          dataSource: 'public.market_news',
          latestTime: '—',
          suggestion: '請檢查 fetch-global-market-news cron 是否正常執行',
        });
      }

      // --- Item 4: OpenAI 報告來源 ---
      const isOpenAISource = source ? source.startsWith('openai') : false;
      if (isOpenAISource) {
        items.push({
          module: 'OpenAI 報告來源',
          status: 'normal',
          result: `報告為 OpenAI 真實生成（${source}）`,
          dataSource: 'reports.ai_strategy_json.source',
          latestTime: now,
          suggestion: '—',
        });
      } else {
        items.push({
          module: 'OpenAI 報告來源',
          status: 'error',
          result: `報告來源需確認（目前：${source || '無'})`,
          dataSource: 'reports.ai_strategy_json.source',
          latestTime: now,
          suggestion: '檢查 Edge Function 是否正確使用 OpenAI API',
        });
      }

      // --- Item 5: 品質狀態 ---
      if (valStatus === 'passed' || valStatus === 'soft_passed') {
        items.push({
          module: '品質狀態',
          status: 'normal',
          result: 'AI 報告品質檢查通過',
          dataSource: 'reports.ai_strategy_json.validation_status',
          latestTime: now,
          suggestion: '—',
        });
      } else {
        items.push({
          module: '品質狀態',
          status: 'error',
          result: `AI 報告未通過正式品質檢查（目前：${valStatus || '無'}）`,
          dataSource: 'reports.ai_strategy_json.validation_status',
          latestTime: now,
          suggestion: '不應作為正式內容，請重新生成報告',
        });
      }

      // --- Item 6: 內容品質分數 ---
      if (qualityScoreRaw !== null && qualityScoreRaw >= 88) {
        items.push({
          module: '內容品質分數',
          status: 'normal',
          result: `內容品質 ${qualityScoreRaw}/100`,
          dataSource: 'reports.ai_strategy_json.quality_score',
          latestTime: now,
          suggestion: '—',
        });
      } else if (qualityScoreRaw !== null && qualityScoreRaw >= 70) {
        items.push({
          module: '內容品質分數',
          status: 'warning',
          result: `內容品質 ${qualityScoreRaw}/100，建議觀察`,
          dataSource: 'reports.ai_strategy_json.quality_score',
          latestTime: now,
          suggestion: '品質偏低，建議檢查 AI 生成參數',
        });
      } else {
        items.push({
          module: '內容品質分數',
          status: 'error',
          result: qualityScoreRaw !== null ? `內容品質過低（${qualityScoreRaw}/100）` : '內容品質分數不存在',
          dataSource: 'reports.ai_strategy_json.quality_score',
          latestTime: now,
          suggestion: '報告品質不合格，不應公開為正式內容',
        });
      }

      // --- Item 7: 假資料防線 ---
      if (nff === true) {
        items.push({
          module: '假資料防線',
          status: 'normal',
          result: '未使用假資料 fallback',
          dataSource: 'reports.ai_strategy_json.no_fake_fallback',
          latestTime: now,
          suggestion: '—',
        });
      } else {
        items.push({
          module: '假資料防線',
          status: 'error',
          result: '疑似使用 fallback，請勿公開為正式報告',
          dataSource: 'reports.ai_strategy_json.no_fake_fallback',
          latestTime: now,
          suggestion: '請重新生成報告，確保 AI 正常回應',
        });
      }

      // --- Item 8: 系統修補防線 ---
      if (rbs === false) {
        items.push({
          module: '系統修補防線',
          status: 'normal',
          result: '非系統修補報告',
          dataSource: 'reports.ai_strategy_json.repaired_by_system',
          latestTime: now,
          suggestion: '—',
        });
      } else {
        items.push({
          module: '系統修補防線',
          status: 'error',
          result: '報告可能由系統修補生成',
          dataSource: 'reports.ai_strategy_json.repaired_by_system',
          latestTime: now,
          suggestion: '請檢查 Edge Function 修補邏輯',
        });
      }

      // --- Item 9: 隔夜影響鏈 ---
      if (chainCount === 3) {
        items.push({
          module: '隔夜影響鏈',
          status: 'normal',
          result: '三條隔夜影響鏈完整',
          dataSource: 'reports.ai_strategy_json.overnight_impact_chains',
          latestTime: now,
          suggestion: '—',
        });
      } else if (chainCount >= 1) {
        items.push({
          module: '隔夜影響鏈',
          status: 'warning',
          result: `影響鏈不足 3 條（目前 ${chainCount} 條）`,
          dataSource: 'reports.ai_strategy_json.overnight_impact_chains',
          latestTime: now,
          suggestion: '檢查 AI 是否完整生成三條影響鏈',
        });
      } else {
        items.push({
          module: '隔夜影響鏈',
          status: 'error',
          result: '影響鏈尚未生成',
          dataSource: 'reports.ai_strategy_json.overnight_impact_chains',
          latestTime: now,
          suggestion: '請檢查 Edge Function 影響鏈生成邏輯',
        });
      }

      // --- Item 10: 會員判讀 ---
      if (mnHasContent && mrLen !== null && mrLen >= 120) {
        items.push({
          module: '會員判讀',
          status: 'normal',
          result: `會員研究筆記已生成（${mrLen} 字）`,
          dataSource: 'reports.ai_strategy_json.member_research_note',
          latestTime: now,
          suggestion: '—',
        });
      } else if (mnHasContent && mrLen !== null && mrLen >= 1) {
        items.push({
          module: '會員判讀',
          status: 'warning',
          result: `會員研究筆記偏短（${mrLen} 字）`,
          dataSource: 'reports.ai_strategy_json.member_research_note',
          latestTime: now,
          suggestion: '內容過短，可能資訊不完整',
        });
      } else {
        items.push({
          module: '會員判讀',
          status: mnHasContent ? 'warning' : 'error',
          result: mnHasContent ? '會員研究筆記已產生但長度計算異常' : '會員研究筆記尚未生成',
          dataSource: 'reports.ai_strategy_json.member_research_note',
          latestTime: now,
          suggestion: mnHasContent ? '檢查字數計算邏輯' : '檢查 Edge Function 是否正確生成 member_research_note',
        });
      }

      // --- Item 11: 主要市場 Symbol ---
      const totalSymbols = SYMBOL_ALIAS_GROUPS.length;
      if (presentDisp.length >= 7) {
        items.push({
          module: '主要市場 Symbol',
          status: 'normal',
          result: `已取得 ${presentDisp.length}/${totalSymbols} 個核心指標`,
          dataSource: 'public.market_data',
          latestTime: formatTaipeiTime(mdLatest),
          suggestion: missingDisp.length > 0 ? `缺少：${missingDisp.join('、')}` : '—',
        });
      } else if (presentDisp.length >= 4) {
        items.push({
          module: '主要市場 Symbol',
          status: 'warning',
          result: `僅取得 ${presentDisp.length}/${totalSymbols} 個核心指標`,
          dataSource: 'public.market_data',
          latestTime: formatTaipeiTime(mdLatest),
          suggestion: `缺少：${missingDisp.join('、')}`,
        });
      } else {
        items.push({
          module: '主要市場 Symbol',
          status: 'error',
          result: `核心指標嚴重不足（${presentDisp.length}/${totalSymbols}）`,
          dataSource: 'public.market_data',
          latestTime: formatTaipeiTime(mdLatest),
          suggestion: `缺少：${missingDisp.join('、')}`,
        });
      }

      // --- Item 12: 台股核心 Symbol ---
      if (twCoreMissing === 0) {
        items.push({
          module: '台股核心 Symbol',
          status: 'normal',
          result: `TAIEX / TXF / 2330 全部取得`,
          dataSource: 'public.market_data',
          latestTime: formatTaipeiTime(mdLatest),
          suggestion: '—',
        });
      } else if (twCoreMissing === 1) {
        items.push({
          module: '台股核心 Symbol',
          status: 'warning',
          result: `台股三核心缺少 1 個（${missingDisp.filter((s: string) => TW_CORE_DISPLAYS.includes(s)).join('、')}）`,
          dataSource: 'public.market_data',
          latestTime: formatTaipeiTime(mdLatest),
          suggestion: '請檢查台股 market_data 擷取排程',
        });
      } else if (twCoreMissing === 2) {
        items.push({
          module: '台股核心 Symbol',
          status: 'error',
          result: `台股三核心缺少 2 個（${missingDisp.filter((s: string) => TW_CORE_DISPLAYS.includes(s)).join('、')}）`,
          dataSource: 'public.market_data',
          latestTime: formatTaipeiTime(mdLatest),
          suggestion: '台股核心 Symbol 需補齊',
        });
      } else {
        items.push({
          module: '台股核心 Symbol',
          status: 'error',
          result: '台股三核心 TAIEX / TXF / 2330 全部缺少',
          dataSource: 'public.market_data',
          latestTime: formatTaipeiTime(mdLatest),
          suggestion: '台股核心 Symbol 需補齊，請檢查 fetch-market-data 排程',
        });
      }

      // --- Item 13: 盤中追蹤雷達 ---
      if (omrRow) {
        const displayStatus = cmrOpeningRadarStatus || omrStatus || '—';
        items.push({
          module: '盤中追蹤雷達',
          status: 'normal',
          result: `${dateLabel}：已完成，狀態：${displayStatus}`,
          dataSource: 'public.opening_market_radar',
          latestTime: formatTaipeiTime(omrDate ? `${omrDate}T09:15:00+08:00` : null),
          suggestion: '—',
        });
      } else {
        items.push({
          module: '盤中追蹤雷達',
          status: 'warning',
          result: `${dateLabel}：尚未執行`,
          dataSource: 'public.opening_market_radar',
          latestTime: '—',
          suggestion: '請檢查 opening-market-radar cron 排程',
        });
      }

      // --- Item 14: 收盤驗證 ---
      if (cmrRow && cmrResult) {
        const taiexStr = cmrTaiex !== null ? `，TAIEX ${cmrTaiex >= 0 ? '+' : ''}${cmrTaiex}%` : '';
        items.push({
          module: '收盤驗證',
          status: 'normal',
          result: `${dateLabel}：已完成，驗證結果：${cmrResult}${taiexStr}`,
          dataSource: 'public.close_market_reviews',
          latestTime: formatTaipeiTime(cmrDate ? `${cmrDate}T13:30:00+08:00` : null),
          suggestion: '—',
        });
      } else {
        items.push({
          module: '收盤驗證',
          status: 'warning',
          result: `${dateLabel}：尚未完成收盤驗證`,
          dataSource: 'public.close_market_reviews',
          latestTime: '—',
          suggestion: '請檢查 close-market-review cron 排程',
        });
      }

      // --- Item 14b: 類股輪動 (V25) ---
      if (secHasToday && secDate) {
        items.push({
          module: '類股輪動',
          status: 'normal',
          result: `${dateLabel}：已更新（${secDate}）`,
          dataSource: 'public.sector_rotation_scores',
          latestTime: formatTaipeiTime(secDate ? `${secDate}T14:20:00+08:00` : null),
          suggestion: '—',
        });
      } else if (isActualWeekend) {
        items.push({
          module: '類股輪動',
          status: 'normal',
          result: '非交易日，不要求今日類股資料。',
          dataSource: 'public.sector_rotation_scores',
          latestTime: '—',
          suggestion: '—',
        });
      } else {
        // Check if there's any sector data at all
        const { data: altSec } = await supabase
          .from('sector_rotation_scores')
          .select('score_date')
          .order('score_date', { ascending: false })
          .limit(1);
        if (altSec && altSec.length > 0) {
          const altDate = safeString((altSec[0] as Record<string, unknown>).score_date);
          items.push({
            module: '類股輪動',
            status: 'warning',
            result: `今日尚無資料，最新為 ${altDate || '—'}（上一交易日參考）`,
            dataSource: 'public.sector_rotation_scores',
            latestTime: '—',
            suggestion: '請檢查 generate-sector-rotation cron 排程',
          });
        } else {
          items.push({
            module: '類股輪動',
            status: 'warning',
            result: `${dateLabel}：尚未產生類股輪動資料`,
            dataSource: 'public.sector_rotation_scores',
            latestTime: '—',
            suggestion: '請檢查 generate-sector-rotation cron 排程',
          });
        }
      }

      // --- Item 15: 禁詞檢查 ---
      if (fwResult.passed) {
        items.push({
          module: '禁詞檢查',
          status: 'normal',
          result: '通過 — 無禁止用語',
          dataSource: 'reports + opening_market_radar + close_market_reviews',
          latestTime: now,
          suggestion: '—',
        });
      } else {
        items.push({
          module: '禁詞檢查',
          status: 'warning',
          result: `發現 ${fwResult.found.length} 個禁止用語：${fwResult.found.join('、')}`,
          dataSource: 'reports + opening_market_radar + close_market_reviews',
          latestTime: now,
          suggestion: '請檢查報告文案，移除禁止用語',
        });
      }

      // --- Item 16: 前台資料真實性 ---
      const isAuthentic =
        isOpenAISource &&
        nff === true &&
        ffu === false &&
        dda === true &&
        pr === true;

      const authStatus: '真資料報告' | '資料需確認' = isAuthentic ? '真資料報告' : '資料需確認';

      items.push({
        module: '前台資料真實性',
        status: isAuthentic ? 'normal' : 'error',
        result: authStatus,
        dataSource: '綜合判斷',
        latestTime: now,
        suggestion: isAuthentic ? '—' : '不滿足真資料條件',
      });

      setHealthItems(items);
      setAuthenticityStatus(authStatus);

      // ═══════════════════════════════════════
      // STEP 11: Compute health score
      // V7.54: Updated criteria for V7.53 ai_strategy_json structure
      // ═══════════════════════════════════════

      let passedChecks = 0;
      const totalChecks = 12;

      if (rpt) passedChecks++;
      if (isOpenAISource) passedChecks++;
      if (pr === true) passedChecks++;
      if (nff === true) passedChecks++;
      if (qualityScoreRaw !== null) passedChecks++;
      if (rpt?.confidence_score != null) passedChecks++;
      if (chainCount >= 1) passedChecks++;  // V7.53: relaxed to >= 1
      if (mdCount >= 1) passedChecks++;
      if (mnCount >= 1) passedChecks++;
      if (omrRow) passedChecks++;
      if (cmrRow) passedChecks++;
      if (cmrResult) passedChecks++;

      const ratioScore = Math.round((passedChecks / totalChecks) * 100);

      setSystemHealthScore(ratioScore);

      // ═══════════════════════════════════════
      // STEP 12: PM Acceptance Mode (V50)
      // ═══════════════════════════════════════

      const isDataCompleteForPM =
        rpt !== null &&
        mdCount >= 1 &&
        mnCount >= 1 &&
        openingRadarStatus !== null &&
        closeReviewResult !== null;

      // ── Check 1: Data Completeness ──
      const mdDate = mdLatest?.slice(0, 10) || null;
      const mnDate = mnLatest?.slice(0, 10) || null;
      const reportDateCheck = rpt?.report_date || null;

      const c1ReportsOk = rpt !== null;
      const c1MarketDataOk = mdCount >= 1;
      const c1MarketNewsOk = mnCount >= 1;
      const c1OpeningRadarOk = openingRadarStatus !== null;
      const c1CloseReviewOk = closeReviewResult !== null;

      // Date match: all data sources must refer to the same checkDate
      const allDates: (string | null)[] = [
        reportDateCheck,
        mdDate,
        mnDate,
        openingRadarDate,
        closeReviewDate,
      ].filter(Boolean);
      const allDatesMatch = allDates.length >= 2
        ? allDates.every((d) => d === checkDate)
        : allDates.length === 1
          ? allDates[0] === checkDate
          : false;

      const check1Passed =
        c1ReportsOk && c1MarketDataOk && c1MarketNewsOk &&
        c1OpeningRadarOk && c1CloseReviewOk && allDatesMatch;

      const check1Detail = check1Passed
        ? `五項資料來源均已就緒，日期一致為 ${checkDate}`
        : [
            !c1ReportsOk ? 'reports 缺少' : '',
            !c1MarketDataOk ? 'market_data 缺少' : '',
            !c1MarketNewsOk ? 'market_news 缺少' : '',
            !c1OpeningRadarOk ? 'opening_market_radar 缺少' : '',
            !c1CloseReviewOk ? 'close_market_reviews 缺少' : '',
            (!allDatesMatch && c1ReportsOk && c1OpeningRadarOk && c1CloseReviewOk)
              ? '日期不一致'
              : '',
          ].filter(Boolean).join('、') || '部分資料缺少';

      const check1: PMCheckDetail = {
        label: '1',
        name: '資料是否完整',
        passed: check1Passed,
        detail: check1Detail,
        items: [
          { label: 'reports', ok: c1ReportsOk, detail: reportDateCheck || '缺少' },
          { label: 'market_data', ok: c1MarketDataOk, detail: mdCount > 0 ? `${mdCount} 筆（${mdDate || '—'}）` : '缺少' },
          { label: 'market_news', ok: c1MarketNewsOk, detail: mnCount > 0 ? `${mnCount} 筆（${mnDate || '—'}）` : '缺少' },
          { label: 'opening_market_radar', ok: c1OpeningRadarOk, detail: openingRadarDate || '缺少' },
          { label: 'close_market_reviews', ok: c1CloseReviewOk, detail: closeReviewDate || '缺少' },
          { label: '日期一致性', ok: allDatesMatch, detail: allDatesMatch ? `全部為 ${checkDate}` : '日期不一致' },
        ],
      };

      // ── Check 2: Frontend Copy Consistency ──
      // Since buildMarketState is the single source of truth,
      // consistency = all three data layers exist for the same date.
      const hasAllThreeForSameDate =
        rpt !== null && openingRadarStatus !== null && closeReviewResult !== null &&
        reportDateCheck === checkDate && openingRadarDate === checkDate && closeReviewDate === checkDate;

      const check2Passed = hasAllThreeForSameDate;
      const check2Detail = check2Passed
        ? `三層資料（reports / opening_market_radar / close_market_reviews）均使用 ${checkDate}，前台 marketState 一致`
        : '部分資料層缺少或日期不一致，前台可能出現矛盾文案';

      const check2: PMCheckDetail = {
        label: '2',
        name: '前台文案是否一致',
        passed: check2Passed,
        detail: check2Detail,
        items: [
          { label: '首頁 / 今日判斷', ok: rpt !== null, detail: rpt ? `market_bias=${rpt.market_bias || '—'}` : '缺少' },
          { label: '盤中追蹤', ok: openingRadarStatus !== null, detail: openingRadarStatus || '缺少' },
          { label: '收盤驗證', ok: closeReviewResult !== null, detail: closeReviewResult || '缺少' },
          { label: '三層同日', ok: hasAllThreeForSameDate, detail: hasAllThreeForSameDate ? checkDate : '日期不一致' },
        ],
      };

      // ── Check 3: Forbidden Words (PM-level expanded) ──
      const PM_FORBIDDEN_WORDS = [
        '資料不足', '收盤資料不足', '觀察中', '盤前等待',
        '劇本成立', '盤前劇本命中', '偏多觀察方向一致',
      ];

      const pmTextSources: string[] = [...textSources];
      // Also check market_bias display text
      if (rpt?.market_bias) pmTextSources.push(rpt.market_bias);

      const pmForbiddenFound: string[] = [];
      for (const source of pmTextSources) {
        if (!source) continue;
        for (const word of PM_FORBIDDEN_WORDS) {
          if (source.includes(word) && !pmForbiddenFound.includes(word)) {
            pmForbiddenFound.push(word);
          }
        }
      }

      // Rule: If data IS complete, NO forbidden words allowed.
      // If data IS incomplete, 「資料不足」「收盤資料不足」are acceptable.
      const wordsAlwaysBad = ['劇本成立', '盤前劇本命中', '偏多觀察方向一致'];
      let check3Passed: boolean;
      let check3EffectiveFound: string[];

      if (isDataCompleteForPM) {
        check3Passed = pmForbiddenFound.length === 0;
        check3EffectiveFound = pmForbiddenFound;
      } else {
        const badOnes = pmForbiddenFound.filter((w) => wordsAlwaysBad.includes(w));
        check3Passed = badOnes.length === 0;
        check3EffectiveFound = badOnes;
      }

      const check3Detail = check3Passed
        ? '未發現任何禁用錯誤詞'
        : `發現 ${check3EffectiveFound.length} 個禁用詞：${check3EffectiveFound.join('、')}`;

      const check3: PMCheckDetail = {
        label: '3',
        name: '禁用錯誤詞檢查',
        passed: check3Passed,
        detail: check3Detail,
        items: [
          { label: '資料不足', ok: !check3EffectiveFound.includes('資料不足'), detail: check3EffectiveFound.includes('資料不足') ? '⚠ 出現' : '—' },
          { label: '收盤資料不足', ok: !check3EffectiveFound.includes('收盤資料不足'), detail: check3EffectiveFound.includes('收盤資料不足') ? '⚠ 出現' : '—' },
          { label: '觀察中', ok: !check3EffectiveFound.includes('觀察中'), detail: check3EffectiveFound.includes('觀察中') ? '⚠ 出現' : '—' },
          { label: '盤前等待', ok: !check3EffectiveFound.includes('盤前等待'), detail: check3EffectiveFound.includes('盤前等待') ? '⚠ 出現' : '—' },
          { label: '劇本成立', ok: !check3EffectiveFound.includes('劇本成立'), detail: check3EffectiveFound.includes('劇本成立') ? '⚠ 出現' : '—' },
          { label: '盤前劇本命中', ok: !check3EffectiveFound.includes('盤前劇本命中'), detail: check3EffectiveFound.includes('盤前劇本命中') ? '⚠ 出現' : '—' },
          { label: '偏多觀察方向一致', ok: !check3EffectiveFound.includes('偏多觀察方向一致'), detail: check3EffectiveFound.includes('偏多觀察方向一致') ? '⚠ 出現' : '—' },
          { label: '資料完整時不出現禁用詞', ok: !(isDataCompleteForPM && pmForbiddenFound.length > 0), detail: isDataCompleteForPM ? (pmForbiddenFound.length === 0 ? '—' : '⚠ 資料完整卻有禁用詞') : '資料不完整，部分詞可接受' },
        ],
      };

      // ── Check 4: Three-stage Consistency ──
      const stage0730Ok = rpt !== null && (rpt.market_bias || '').trim().length > 0;
      const stage0915Ok = openingRadarStatus !== null;
      const stage1330Ok = closeReviewResult !== null;

      // 09:15 must NOT rewrite premarket assumption
      const stage0915NotRewriting = stage0915Ok
        ? !(openingRadarStatus || '').includes('劇本成立') &&
          !(openingRadarStatus || '').includes('盤前劇本')
        : true;

      const allThreeSameDate =
        reportDateCheck === checkDate &&
        openingRadarDate === checkDate &&
        closeReviewDate === checkDate;

      const check4Passed =
        stage0730Ok && stage0915Ok && stage1330Ok && stage0915NotRewriting && allThreeSameDate;

      const check4DetailParts: string[] = [];
      if (!stage0730Ok) check4DetailParts.push('07:30 盤前劇本缺少 market_bias');
      if (!stage0915Ok) check4DetailParts.push('09:15 盤中追蹤缺少');
      if (!stage1330Ok) check4DetailParts.push('13:30 收盤驗證缺少');
      if (!stage0915NotRewriting) check4DetailParts.push('09:15 不應改寫盤前假設');
      if (!allThreeSameDate) check4DetailParts.push('三段日期不一致');
      const check4Detail = check4Passed
        ? `三段時間軸（07:30 / 09:15 / 13:30）均使用 ${checkDate}，同一套邏輯`
        : check4DetailParts.join('；');

      const check4: PMCheckDetail = {
        label: '4',
        name: '三階段一致性',
        passed: check4Passed,
        detail: check4Detail,
        items: [
          { label: '07:30 盤前劇本', ok: stage0730Ok, detail: rpt?.market_bias || '缺少' },
          { label: '09:15 盤中追蹤', ok: stage0915Ok, detail: openingRadarStatus || '缺少' },
          { label: '09:15 未改寫盤前', ok: stage0915NotRewriting, detail: stage0915NotRewriting ? '—' : '⚠ 可能改寫盤前假設' },
          { label: '13:30 收盤驗證', ok: stage1330Ok, detail: closeReviewResult || '缺少' },
          { label: '三段同日', ok: allThreeSameDate, detail: allThreeSameDate ? checkDate : '日期不一致' },
        ],
      };

      // ── Check 5: Conclusion ──
      const allChecks = [check1, check2, check3, check4];
      const passedCount = allChecks.filter((c) => c.passed).length;
      const totalCount = allChecks.length;

      let conclusion: PMConclusion;
      let conclusionLabel: string;
      let conclusionColor: 'green' | 'yellow' | 'red';
      let conclusionReason: string;

      if (passedCount === 4) {
        conclusion = 'can_publish';
        conclusionLabel = '可以公開';
        conclusionColor = 'green';
        conclusionReason = '資料完整、三階段一致、前台文案一致、無禁用錯誤詞、最近交易日資料正常。';
      } else if (passedCount === 3) {
        conclusion = 'can_publish_with_caution';
        conclusionLabel = '可公開但需觀察';
        conclusionColor = 'yellow';
        const failedNames = allChecks.filter((c) => !c.passed).map((c) => c.name);
        conclusionReason = `大部分檢查通過，但 ${failedNames.join('、')} 需人工確認。`;
      } else if (passedCount >= 1) {
        conclusion = 'not_recommended';
        conclusionLabel = '不建議公開';
        conclusionColor = 'red';
        const failedNames = allChecks.filter((c) => !c.passed).map((c) => c.name);
        conclusionReason = `多項檢查未通過（${failedNames.join('、')}），建議修復後再公開。`;
      } else {
        conclusion = 'blocked';
        conclusionLabel = '阻擋公開';
        conclusionColor = 'red';
        conclusionReason = '所有檢查項目均未通過，資料嚴重不足，不可公開。';
      }

      const pmResult: PMAcceptance = {
        conclusion,
        conclusionLabel,
        conclusionColor,
        conclusionReason,
        checks: allChecks,
        passedCount,
        totalCount,
      };

      setPMAcceptance(pmResult);

    } catch (err) {
      setError(err instanceof Error ? err.message : '資料讀取失敗');
    } finally {
      setLoading(false);
    }
  }, [taipeiDate]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    error,
    taipeiDate,
    healthCheckDate,
    isUsingLatestTradingDay,
    report,
    marketDataCount,
    marketNewsCount,
    marketDataLatestTime,
    marketNewsLatestTime,
    missingSymbols,
    presentSymbols,
    symbolStatuses,
    healthItems,
    systemHealthScore,
    contentQualityScore,
    directionConfidenceScore,
    authenticityStatus,
    impactChainCount,
    memberReadingLength,
    reportVersion,
    reportSource,
    validationStatus,
    noFakeFallback,
    repairedBySystem,
    openingRadarStatus,
    openingRadarDate,
    closeReviewResult,
    closeReviewTaiexChange,
    closeReviewDate,
    closeReviewDataQuality,
    forbiddenWordsPassed,
    forbiddenWordsDetails,
    twCoreSymbolsAllPresent,
    pmAcceptance,
    // ── V7.54+ additions ──
    hasMemberResearchNote,
    publishReady,
    fakeFallbackUsed,
    dataDateAligned,
    marketDataBasisDate,
    memberValueScore,
    reelsAvailable,
    socialPostAvailable,
    lineAvailable,
    morningAlpha,
    refresh: load,
  };
}