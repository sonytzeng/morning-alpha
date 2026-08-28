const CORE_INSTRUMENTS = Object.freeze([
  { key: 'spx', symbol: 'SPX', market: 'US', session: 'previous_close', expectedDate: 'us_global_date', timeZone: 'America/New_York', allowedAgeHours: 36 },
  { key: 'nasdaq', symbol: 'IXIC', market: 'US', session: 'previous_close', expectedDate: 'us_global_date', timeZone: 'America/New_York', allowedAgeHours: 36 },
  { key: 'sox', symbol: 'SOX', market: 'US', session: 'previous_close', expectedDate: 'us_global_date', timeZone: 'America/New_York', allowedAgeHours: 36 },
  { key: 'nvda', symbol: 'NVDA', market: 'US', session: 'previous_close', expectedDate: 'us_global_date', timeZone: 'America/New_York', allowedAgeHours: 36 },
  { key: 'tsm_adr', symbol: 'TSM', market: 'US', session: 'previous_close', expectedDate: 'us_global_date', timeZone: 'America/New_York', allowedAgeHours: 36 },
  { key: 'vix', symbol: 'VIX', market: 'US', session: 'previous_close', expectedDate: 'us_global_date', timeZone: 'America/New_York', allowedAgeHours: 36 },
  { key: 'dxy', symbol: 'DXY', market: 'US', session: 'previous_close', expectedDate: 'us_global_date', timeZone: 'America/New_York', allowedAgeHours: 36 },
  { key: 'us10y', symbol: 'US10Y', market: 'US', session: 'previous_close', expectedDate: 'us_global_date', timeZone: 'America/New_York', allowedAgeHours: 36 },
  { key: 'taiex', symbol: 'TAIEX', market: 'TW', session: 'previous_close', expectedDate: 'tw_core_date', timeZone: 'Asia/Taipei', allowedAgeHours: 36 },
  { key: '2330', symbol: '2330', market: 'TW', session: 'previous_close', expectedDate: 'tw_core_date', timeZone: 'Asia/Taipei', allowedAgeHours: 36 },
  { key: 'txf', symbol: 'TXF', market: 'TW', session: 'preopen_futures', expectedDate: 'report_or_tw_core_date', timeZone: 'Asia/Taipei', allowedAgeHours: 18 },
]);

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asRecords(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localDate(timestamp, timeZone) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function reportReferenceTimestamp(reportDate) {
  return new Date(`${reportDate}T07:30:00+08:00`).getTime();
}

function isNonTradingReport(input) {
  return input.is_trading_day === false ||
    ['weekend_digest', 'holiday_digest', 'non_trading_day'].includes(String(input.report_mode || ''));
}

export function evaluateCoreDataGate(input) {
  const reportDate = validDate(input.report_date);
  if (!reportDate) {
    return { status: 'BLOCKED', eligible: false, reason_codes: ['report_date_invalid'], freshness_policy: [] };
  }
  if (isNonTradingReport(input)) {
    return {
      status: 'NOT_APPLICABLE',
      eligible: true,
      reason_codes: ['market_session_not_applicable'],
      freshness_policy: [],
    };
  }

  const ai = asRecord(input.ai);
  const debug = asRecord(ai.v10_analysis_debug);
  const evidencePack = asRecord(debug.evidence_pack);
  const marketSnapshot = asRecord(evidencePack.market_snapshot);
  const twCoreDate = validDate(ai.tw_core_date);
  const usGlobalDate = validDate(ai.us_global_date);
  const referenceMs = reportReferenceTimestamp(reportDate);
  const reasonCodes = [];
  const freshnessPolicy = CORE_INSTRUMENTS.map((policy) => {
    const row = asRecord(marketSnapshot[policy.key]);
    const value = numeric(row.value);
    const changePercent = numeric(row.change_percent);
    const actualTimestamp = typeof row.captured_at === 'string' && row.captured_at
      ? row.captured_at : typeof row.updated_at === 'string' ? row.updated_at : '';
    const actualMs = Date.parse(actualTimestamp);
    const actualLocalDate = actualTimestamp ? localDate(actualTimestamp, policy.timeZone) : '';
    const expectedDates = policy.expectedDate === 'us_global_date'
      ? [usGlobalDate]
      : policy.expectedDate === 'tw_core_date'
        ? [twCoreDate]
        : unique([reportDate, twCoreDate]);
    const ageHours = Number.isFinite(actualMs) ? Math.max(0, (referenceMs - actualMs) / 3_600_000) : null;
    let freshnessStatus = 'PASS';
    let reason = 'market_session_expected_observation';
    if (!Object.keys(row).length) {
      freshnessStatus = 'MISSING';
      reason = 'snapshot_missing';
    } else if (value === null || changePercent === null || !actualTimestamp || !Number.isFinite(actualMs)) {
      freshnessStatus = 'INVALID';
      reason = 'required_numeric_or_timestamp_missing';
    } else if (!expectedDates.filter(Boolean).includes(actualLocalDate)) {
      freshnessStatus = 'STALE';
      reason = 'market_local_date_mismatch';
    } else if (ageHours !== null && ageHours > policy.allowedAgeHours) {
      freshnessStatus = 'STALE';
      reason = 'session_age_exceeded';
    }
    if (freshnessStatus !== 'PASS') reasonCodes.push(`core_${freshnessStatus.toLowerCase()}:${policy.symbol}`);
    return {
      instrument: policy.symbol,
      market: policy.market,
      session: policy.session,
      expected_latest_timestamp: expectedDates.filter(Boolean),
      actual_timestamp: actualTimestamp || null,
      age_hours: ageHours === null ? null : Number(ageHours.toFixed(2)),
      allowed_age_hours: policy.allowedAgeHours,
      freshness_status: freshnessStatus,
      reason,
    };
  });
  return {
    status: reasonCodes.length === 0 ? 'PASS' : 'BLOCKED',
    eligible: reasonCodes.length === 0,
    reason_codes: unique(reasonCodes),
    freshness_policy: freshnessPolicy,
  };
}

export function evaluatePublishedClaimEvidence(claims) {
  const published = asRecords(claims);
  const unsupported = published.filter((claim) => {
    const refs = Array.isArray(claim.evidence_refs) ? claim.evidence_refs.filter(Boolean) : [];
    return typeof claim.text !== 'string' || !claim.text.trim() || refs.length < 1;
  }).map((claim) => String(claim.claim_id || 'published_claim'));
  const supportedCount = published.length - unsupported.length;
  return {
    published_claim_count: published.length,
    supported_published_claim_count: supportedCount,
    published_claim_evidence_coverage: published.length === 0 ? 100 : Math.round((supportedCount / published.length) * 100),
    unsupported_published_claims: unsupported,
  };
}

function verifiedNewsAvailable(ai, importantNewsCount) {
  const quality = asRecord(ai.content_evidence_quality);
  return importantNewsCount > 0 && Number(quality.verified_news_count || 0) > 0 && quality.all_news_traceable === true;
}

function buildDataOnlySentence() {
  return '目前缺乏足夠可驗證的新事件催化，本次盤前以市場價格與風險指標為主；09:30 驗證 TAIEX、2330 與台指期是否同向。';
}

function evidenceRefsForCore(coreGate) {
  return coreGate.freshness_policy
    .filter((item) => item.freshness_status === 'PASS')
    .map((item) => `market_snapshot.${String(item.instrument).toLowerCase()}`);
}

export function projectLayeredDelivery(input) {
  const ai = { ...asRecord(input.ai) };
  const coreGate = evaluateCoreDataGate({ ...input, ai });
  const premium = asRecord(input.premium_gate);
  const premiumGate = {
    status: premium.eligible === true ? 'PASS' : 'BLOCKED',
    eligible: premium.eligible === true,
    reason_codes: Array.isArray(premium.reason_codes) ? unique(premium.reason_codes.map(String)) : [],
    content_score: numeric(premium.content_score),
  };
  const newsAvailable = verifiedNewsAvailable(ai, Number(input.important_news_count || 0));
  const daily = asRecord(ai.v8_daily_sentence);
  const originalSentence = typeof ai.today_quote === 'string' && ai.today_quote.trim()
    ? ai.today_quote.trim() : typeof daily.sentence === 'string' ? daily.sentence.trim() : '';
  const dailyRefs = Array.isArray(daily.logic_source) ? daily.logic_source.map(String).filter(Boolean) : [];
  const publicMode = newsAvailable && originalSentence && dailyRefs.length > 0 ? 'full' : 'data_only';
  const publicSentence = publicMode === 'full' ? originalSentence : buildDataOnlySentence();
  const coreRefs = evidenceRefsForCore(coreGate);
  const claims = coreGate.eligible ? [
    {
      claim_id: 'daily_sentence',
      text: publicSentence,
      evidence_refs: publicMode === 'full' ? dailyRefs : coreRefs,
    },
    {
      claim_id: 'market_bias',
      text: typeof input.market_bias === 'string' && input.market_bias.trim() ? input.market_bias.trim() : '盤前市場判斷',
      evidence_refs: coreRefs,
    },
  ] : [];
  const evidence = evaluatePublishedClaimEvidence(input.public_published_claims ?? claims);
  const reportDateMatches = validDate(input.report_date) &&
    (!validDate(ai.report_date) || ai.report_date === input.report_date) &&
    (!validDate(ai.today_date) || ai.today_date === input.report_date);
  const reasonCodes = unique([
    ...coreGate.reason_codes,
    ...(reportDateMatches ? [] : ['report_date_mismatch']),
    ...(evidence.published_claim_evidence_coverage === 100 ? [] : ['published_claim_evidence_incomplete']),
    ...evidence.unsupported_published_claims.map((claim) => `unsupported_published_claim:${claim}`),
  ]);
  const publicEligible = coreGate.eligible && reportDateMatches &&
    evidence.published_claim_evidence_coverage === 100 && evidence.unsupported_published_claims.length === 0;
  const sectorRotation = asRecord(ai.sector_rotation_status);
  const sectorReady = sectorRotation.status === 'ready' && sectorRotation.source === 'sector_rotation_scores';
  const normalizedSectorStatus = sectorReady ? sectorRotation : {
    score_date: sectorRotation.score_date ?? ai.tw_core_date ?? input.report_date,
    status: 'unavailable',
    source: 'unavailable',
    row_count: 0,
    is_today: false,
    warning: '類股輪動資料未達可驗證標準；公開內容不使用類股輪動推論。',
  };
  const publicGate = {
    status: publicEligible ? 'PASS' : 'BLOCKED',
    eligible: publicEligible,
    mode: publicMode,
    reason_codes: reasonCodes,
    published_claim_evidence_coverage: evidence.published_claim_evidence_coverage,
    unsupported_published_claims: evidence.unsupported_published_claims,
    published_claims: claims,
    news_provider_quorum: newsAvailable ? 'PASS' : 'DATA_ONLY',
    sector_rotation_status: sectorReady ? 'ready' : 'unavailable',
  };
  const nextDaily = { ...daily, status: publicEligible ? 'ready' : 'blocked', sentence: publicSentence,
    logic_source: publicMode === 'full' ? dailyRefs : coreRefs, decision_mode: publicEligible ? daily.decision_mode ?? 'no_trade' : 'blocked' };
  const freeSummary = { ...asRecord(ai.free_summary), one_sentence: publicSentence };
  const projected = {
    ...ai,
    report_date: input.report_date,
    today_date: input.report_date,
    today_quote: publicSentence,
    v8_daily_sentence: nextDaily,
    free_summary: freeSummary,
    sector_rotation_status: normalizedSectorStatus,
    core_data_gate: coreGate,
    public_delivery_gate: publicGate,
    premium_quality_gate: premiumGate,
    core_data_status: coreGate.status,
    public_delivery_status: publicGate.status,
    premium_status: premiumGate.status,
    published_claim_evidence_coverage: evidence.published_claim_evidence_coverage,
    unsupported_published_claims: evidence.unsupported_published_claims,
    public_delivery_projection: {
      mode: publicMode,
      daily_sentence: publicSentence,
      preferred_sectors: sectorReady && Array.isArray(ai.preferred_sectors) ? ai.preferred_sectors : [],
      published_claims: claims,
    },
  };
  return { ai: projected, core_gate: coreGate, public_gate: publicGate, premium_gate: premiumGate };
}

export { CORE_INSTRUMENTS };
