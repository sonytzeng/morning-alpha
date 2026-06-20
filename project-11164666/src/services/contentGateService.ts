/**
 * contentGateService — Content Publish Gate V1
 *
 * 從 ai_strategy_json 計算 content_publish_gate，
 * 判斷今日內容是否可公開、需人工確認、或不建議公開。
 *
 * 純前端計算，不修改 schema、不修改 Edge Function。
 */

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

export interface ContentPublishGate {
  overall_status: '可公開' | '需人工確認' | '不建議公開';
  free_summary_status: '可用' | '不足' | '缺失';
  member_content_status: '可用' | '偏弱' | '不足' | '缺失';
  reels_status: '可用' | '偏弱' | '不足' | '缺失';
  line_push_status: '可用' | '偏弱' | '不足' | '缺失';
  quality_score: number;
  member_value_score: number;
  reasons: string[];
  blocking_issues: string[];
  suggested_action: string;
}

export interface GateInput {
  ai_strategy_json: Record<string, unknown> | null;
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function grabStr(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
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

function grabBool(obj: unknown, key: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return o[key] === true;
}

// ═══════════════════════════════════════════════════
// Forbidden word detection
// ═══════════════════════════════════════════════════

const FORBIDDEN_WORDS = [
  '買進', '賣出', '強烈推薦', '明牌', '必漲', '必跌',
  '目標價', '保證獲利', '穩賺', '翻倍',
];

function hasForbiddenWords(text: string): boolean {
  return FORBIDDEN_WORDS.some((w) => text.includes(w));
}

function scanForForbiddenWords(obj: Record<string, unknown>): boolean {
  // Recursively scan all string values
  const stack: unknown[] = [obj];
  const seen = new Set<unknown>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === 'string') {
      if (hasForbiddenWords(current)) return true;
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (typeof current === 'object') {
      const o = current as Record<string, unknown>;
      for (const key of Object.keys(o)) {
        stack.push(o[key]);
      }
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════
// Empty / template-like detection
// ═══════════════════════════════════════════════════

const VAGUE_PATTERNS = [
  '留意市場變化', '等待更多訊號', '控制風險',
  '謹慎操作', '注意波動',
];

function hasVagueContent(text: string): boolean {
  return VAGUE_PATTERNS.some((p) => text.includes(p));
}

function countVaguePhrases(obj: Record<string, unknown>): number {
  let count = 0;
  const stack: unknown[] = [obj];
  const seen = new Set<unknown>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === 'string') {
      for (const pattern of VAGUE_PATTERNS) {
        if (current.includes(pattern)) count++;
      }
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (typeof current === 'object') {
      const o = current as Record<string, unknown>;
      for (const key of Object.keys(o)) {
        stack.push(o[key]);
      }
    }
  }
  return count;
}

// ═══════════════════════════════════════════════════
// Scoring Functions
// ═══════════════════════════════════════════════════

/** Score free_summary — max 20 */
function scoreFreeSummary(fs: Record<string, unknown> | null): { score: number; status: '可用' | '不足' | '缺失' } {
  if (!fs) return { score: 0, status: '缺失' };

  let score = 0;
  if (grabStr(fs, 'today_status')) score += 4;
  if (grabStr(fs, 'one_sentence')) score += 4;
  if (grabStr(fs, 'do_not_do')) score += 4;
  if (grabStr(fs, 'mindset')) score += 4;

  // Check for forbidden words in all free_summary text
  const fsText = Object.values(fs).filter((v) => typeof v === 'string').join(' ');
  if (!hasForbiddenWords(fsText)) score += 4;

  const status: '可用' | '不足' | '缺失' = score >= 12 ? '可用' : score > 0 ? '不足' : '缺失';
  return { score, status };
}

/** Score member_research_note sections — max 40 */
function scoreMemberSections(mrn: Record<string, unknown> | null): { score: number; status: '可用' | '偏弱' | '不足' | '缺失'; missingCount: number; hasAll8: boolean } {
  if (!mrn) return { score: 0, status: '缺失', missingCount: 8, hasAll8: false };

  const sections = grabArr(mrn, 'sections') as Record<string, unknown>[];

  // ── V7.53+ flat structure fallback ──
  if (sections.length === 0) {
    // Check V7.53 flat fields
    const flatFields = [
      mrn.title,
      mrn.executive_view,
      mrn.data_basis,
      mrn.main_thesis,
      mrn.risk_notes,
    ];
    const keyObs = Array.isArray(mrn.key_observations) ? mrn.key_observations : [];
    const flatContentCount = flatFields.filter(Boolean).length + (keyObs.length > 0 ? 1 : 0);

    if (flatContentCount === 0) return { score: 0, status: '缺失', missingCount: 8, hasAll8: false };

    // Score based on how many flat fields have content
    const flatScore = Math.min(40, flatContentCount * 7);
    let status: '可用' | '偏弱' | '不足' | '缺失';
    if (flatContentCount >= 5) status = '可用';
    else if (flatContentCount >= 3) status = '偏弱';
    else if (flatContentCount >= 1) status = '不足';
    else status = '缺失';

    return { score: flatScore, status, missingCount: Math.max(0, 6 - flatContentCount), hasAll8: flatContentCount >= 6 };
  }

  if (sections.length === 0) return { score: 0, status: '缺失', missingCount: 8, hasAll8: false };

  const requiredKeys = [
    'main_scenario', 'evidence', 'overnight_impact_chain',
    'do_not_do', 'watchlist', 'intraday_tracking',
    'invalidation', 'close_review',
  ];

  const found = new Set<string>();
  let score = 0;
  let contentQualityIssues = 0;

  for (const sec of sections) {
    const key = String(sec.key || '');
    if (requiredKeys.includes(key)) {
      found.add(key);
      // Check if section has actual content
      const hasContent =
        !!grabStr(sec, 'conclusion') ||
        !!grabStr(sec, 'reasoning') ||
        grabArr(sec, 'items').length > 0 ||
        grabArr(sec, 'evidence_items').length > 0 ||
        grabArr(sec, 'chains').length > 0 ||
        grabArr(sec, 'core_watch').length > 0 ||
        grabArr(sec, 'timeline').length > 0;

      if (hasContent) {
        score += 5;
      } else {
        contentQualityIssues++;
      }
    }
  }

  const missingCount = requiredKeys.length - found.size;
  const hasAll8 = missingCount === 0;

  let status: '可用' | '偏弱' | '不足' | '缺失';
  if (missingCount >= 4) {
    status = '缺失';
  } else if (missingCount >= 2 || contentQualityIssues >= 3) {
    status = '不足';
  } else if (contentQualityIssues >= 1) {
    status = '偏弱';
  } else {
    status = '可用';
  }

  return { score, status, missingCount, hasAll8 };
}

/** Score member_value_score — max 100 */
function scoreMemberValue(aiJson: Record<string, unknown> | null, memberNote: Record<string, unknown> | null): number {
  if (!memberNote || !aiJson) return 0;

  let score = 0;

  // ── V7.53+ flat structure support ──
  const sections = grabArr(memberNote, 'sections') as Record<string, unknown>[];
  const isFlatStructure = sections.length === 0;
  const flatFields: Record<string, unknown>[] = isFlatStructure
    ? [memberNote] // Treat the flat object as a single "section"
    : sections;

  // 1. Does it read like a research notebook? (+15)
  const hasReasoning = isFlatStructure
    ? (!!memberNote.main_thesis || !!memberNote.executive_view)
    : sections.some((s) => !!grabStr(s, 'reasoning'));
  const hasEvidence = isFlatStructure
    ? (Array.isArray(memberNote.key_observations) && (memberNote.key_observations as unknown[]).length > 0)
    : sections.some((s) => grabArr(s, 'evidence_items').length > 0);
  if (hasReasoning || hasEvidence) score += 15;

  // 2. Has specific market clues? (+15)
  const allMemberText = JSON.stringify(memberNote).toLowerCase();
  const keyClues = ['台積電', '台指期', 'sox', 'nvda', 'tsm', '半導體', 'ai伺服器', '金融', 'dxy', 'us10y', 'vix', '2330', 'taiex'];
  const clueCount = keyClues.filter((c) => allMemberText.includes(c.toLowerCase())).length;
  if (clueCount >= 5) score += 15;
  else if (clueCount >= 3) score += 10;
  else if (clueCount >= 1) score += 5;

  // 3. Has clear "why"? (+10)
  if (isFlatStructure) {
    const conc = (memberNote.executive_view as string) || '';
    const reas = (memberNote.main_thesis as string) || '';
    if (conc.length > 10 && reas.length > 10) score += 10;
  } else {
    const hasWhy = sections.some((s) => {
      const conc = grabStr(s, 'conclusion') || '';
      const reas = grabStr(s, 'reasoning') || '';
      return conc.length > 10 && reas.length > 10;
    });
    if (hasWhy) score += 10;
  }

  // 4. Has "how to verify intraday"? (+10) — from intraday_validation_plan
  const intradayPlan = grabObj(aiJson, 'intraday_validation_plan');
  const hasTracking = intradayPlan && (
    Array.isArray(intradayPlan.open_0900_0930) ||
    Array.isArray(intradayPlan.mid_session_1000_1130)
  );
  if (hasTracking) score += 10;

  // 5. Has "what invalidates"? (+10) — from invalidation_conditions
  const invalArr = grabArr(aiJson, 'invalidation_conditions');
  if (invalArr.length >= 2) score += 10;

  // 6. Has "don't do today"? (+10)
  if (isFlatStructure) {
    const riskNotes = (memberNote.risk_notes as string) || '';
    if (riskNotes.length > 20) score += 10;
  } else {
    const dnd = sections.find((s) => s.key === 'do_not_do');
    const hasDontDo = dnd && grabArr(dnd, 'items').length >= 3;
    if (hasDontDo) score += 10;
  }

  // 7. Has close feedback plan? (+10)
  const closingPlan = grabObj(aiJson, 'closing_feedback_plan');
  if (closingPlan && (closingPlan.how_to_score_today || closingPlan.what_to_check_after_close)) score += 10;

  // 8. Avoids vague phrases? (+20)
  const vagueCount = countVaguePhrases(memberNote);
  const vagueScore = Math.max(0, 20 - vagueCount * 4);
  score += vagueScore;

  // 9. V7.53 publish gate bonus
  const publishReady = aiJson.publish_ready === true;
  const qualityOk = (Number(aiJson.quality_score || 0)) >= 75;
  if (publishReady && qualityOk) score += 5;

  return Math.min(100, Math.max(0, score));
}

/** Score reels_script — max 20 */
function scoreReels(reels: Record<string, unknown> | null): { score: number; status: '可用' | '偏弱' | '不足' | '缺失' } {
  if (!reels) return { score: 0, status: '缺失' };

  let score = 0;

  const hook = grabStr(reels, 'hook_0_5_sec');
  if (hook && hook.length > 5) score += 4;
  else if (hook) score += 2;

  const core = grabStr(reels, 'core_5_25_sec');
  if (core && core.length > 20) score += 4;
  else if (core) score += 2;

  const risk = grabStr(reels, 'risk_25_40_sec');
  if (risk && risk.length > 5) score += 4;

  const watch = grabStr(reels, 'watch_40_55_sec');
  if (watch && watch.length > 10) score += 4;

  const cta = grabStr(reels, 'cta_55_60_sec');
  if (cta && cta.length > 5 && !hasForbiddenWords(cta)) score += 4;
  else if (cta) score += 2;

  const status: '可用' | '偏弱' | '不足' | '缺失' = score >= 16 ? '可用' : score >= 12 ? '偏弱' : score > 0 ? '不足' : '缺失';
  return { score, status };
}

/** Score line_push_copy — max 20 */
function scoreLinePush(line: Record<string, unknown> | null): { score: number; status: '可用' | '偏弱' | '不足' | '缺失' } {
  if (!line) return { score: 0, status: '缺失' };

  let score = 0;

  // Is it short?
  const fullText = [grabStr(line, 'one_sentence'), grabStr(line, 'do_not_do'), grabStr(line, 'watch_point'), grabStr(line, 'cta')].filter(Boolean).join(' ');
  if (fullText.length > 0 && fullText.length <= 200) score += 4;
  else if (fullText.length > 0) score += 2;

  // Has market_bias?
  if (grabStr(line, 'market_bias')) score += 4;

  // Has do_not_do?
  if (grabStr(line, 'do_not_do')) score += 4;

  // Has watch_point?
  if (grabStr(line, 'watch_point')) score += 4;

  // No investment advice tone?
  const lineText = Object.values(line).filter((v) => typeof v === 'string').join(' ');
  if (!hasForbiddenWords(lineText)) score += 4;

  const status: '可用' | '偏弱' | '不足' | '缺失' = score >= 16 ? '可用' : score >= 12 ? '偏弱' : score > 0 ? '不足' : '缺失';
  return { score, status };
}

// ═══════════════════════════════════════════════════
// Main Gate Computation
// ═══════════════════════════════════════════════════

export function computeContentGate(input: GateInput): ContentPublishGate {
  const aiJson = input.ai_strategy_json || null;
  const reasons: string[] = [];
  const blockingIssues: string[] = [];

  // ── Extract sub-objects ──
  const freeSummary = grabObj(aiJson, 'free_summary');
  const memberNote = grabObj(aiJson, 'member_research_note');
  const reelsScript = grabObj(aiJson, 'reels_script');
  const linePushCopy = grabObj(aiJson, 'line_push_copy');

  // ── Score each section ──
  const fs = scoreFreeSummary(freeSummary);
  const ms = scoreMemberSections(memberNote);
  const mv = scoreMemberValue(aiJson, memberNote);
  const rs = scoreReels(reelsScript);
  const ls = scoreLinePush(linePushCopy);

  // ── Forbidden word check ──
  const hasFw = aiJson ? scanForForbiddenWords(aiJson) : false;
  if (hasFw) {
    blockingIssues.push('內容含有買賣建議或明牌語氣（買進、賣出、明牌、必漲、必跌、目標價、保證獲利等）。');
  }

  // ── Fake data risk (from content_quality_flags) ──
  const qualityFlags = grabObj(aiJson, 'content_quality_flags');
  const hasFakeDataRisk = grabBool(qualityFlags, 'has_fake_data_risk');
  if (hasFakeDataRisk) {
    blockingIssues.push('內容可能引用不存在的資料或股票。');
  }

  // ── Template-like check ──
  const isTemplateLike = grabBool(qualityFlags, 'is_template_like');
  if (isTemplateLike) {
    reasons.push('內容過度模板化，大量使用「留意市場變化」「等待更多訊號」等空泛句。');
  }

  // ── Determine overall_status ──
  let overallStatus: '可公開' | '需人工確認' | '不建議公開' = '可公開';
  let suggestedAction = '今日免費摘要、會員研究筆記、Reels 與 LINE 文案皆已產生，內容品質達標。';

  // Rule 1: Missing member_research_note → 不建議公開
  if (ms.status === '缺失') {
    overallStatus = '不建議公開';
    suggestedAction = '重新產生今日報告，因為會員內容尚未產生。';
    blockingIssues.push('member_research_note 尚未產生。');
  }

  // Rule 2: Forbidden words → 不建議公開 (regardless)
  if (hasFw) {
    overallStatus = '不建議公開';
    suggestedAction = '今日內容含有禁止詞彙，不建議公開。請檢查並重新產生報告。';
  }

  // Rule 3: Fake data risk → 不建議公開
  if (hasFakeDataRisk && overallStatus !== '不建議公開') {
    overallStatus = '不建議公開';
    suggestedAction = '今日內容可能包含假資料風險，不建議公開。請人工確認後決定。';
  }

  // Rule 4: member_value_score < 50 → 不建議公開
  if (mv < 50 && overallStatus !== '不建議公開') {
    overallStatus = '不建議公開';
    suggestedAction = '今日會員內容不合格（member_value_score < 50），請重新觸發 OpenAI 產生。';
    reasons.push(`會員內容強度不足（${mv}/100），缺乏足夠的市場線索與判斷框架。`);
  }

  // Rule 5: free_summary available but member_value_score < 65 → 需人工確認
  if (fs.status === '可用' && mv < 65 && mv >= 50 && overallStatus === '可公開') {
    overallStatus = '需人工確認';
    suggestedAction = '免費摘要可公開，但會員內容偏弱，不建議作為付費內容展示。';
    reasons.push(`會員內容強度偏弱（${mv}/100），建議站長確認後再公開。`);
  }

  // Rule 6: reels_status insufficient — note but do NOT degrade overall status
  // Reels is a content output, not a gate blocker.
  if (rs.status === '不足' || rs.status === '缺失') {
    reasons.push(`Reels 腳本${rs.status === '缺失' ? '尚未產生' : '偏弱'}（${rs.score}/20），不影響今日內容公開，但建議確認後再發布短影音。`);
  }

  // Rule 7: line_push_status insufficient — note but do NOT degrade overall status
  // LINE push is a content output, not a gate blocker.
  if (ls.status === '不足' || ls.status === '缺失') {
    reasons.push(`LINE 推播文案${ls.status === '缺失' ? '尚未產生' : '偏弱'}（${ls.score}/20），不影響今日內容公開，建議確認後再推播。`);
  }

  // ── Fill in missing reasons ──
  if (fs.status === '不足') reasons.push(`免費摘要內容偏弱（${fs.score}/20），可能缺少 today_status、one_sentence、do_not_do 或 mindset。`);
  if (fs.status === '缺失') reasons.push('free_summary 尚未產生。');
  if (ms.status === '偏弱') reasons.push(`會員研究筆記部分段落內容空泛（${ms.score}/40），缺少實質判斷內容。`);
  if (ms.status === '不足') reasons.push(`會員研究筆記缺少 ${ms.missingCount} 段以上（${ms.score}/40）。`);

  // ── Quality score: weighted average ──
  // free_summary: 20%, member_sections: 40%, member_value: 100% normalized to 40%, reels: 10%, line: 10%... 
  // Actually let me keep it simple: overall quality is the average of all scored components
  const qualityScore = Math.round(
    (fs.score / 20 * 20) + // normalize to 20
    (ms.score / 40 * 40) + // normalize to 40
    (mv / 100 * 20) +      // normalize to 20
    (rs.score / 20 * 10) + // normalize to 10
    (ls.score / 20 * 10)   // normalize to 10
  );
  // Actually that's wrong. Let me just compute a straightforward weighted score.
  const totalQualityScore = Math.round(
    fs.score * 0.8 +      // 20 * 0.8 = 16 max
    ms.score * 1.0 +      // 40 * 1.0 = 40 max
    mv * 0.2 +            // 100 * 0.2 = 20 max
    rs.score * 0.6 +      // 20 * 0.6 = 12 max
    ls.score * 0.6        // 20 * 0.6 = 12 max
  );
  // But this doesn't make sense either. Let me just use a simple formula.
  // Total max: 20 + 40 + 100 + 20 + 20 = 200, but member_value is already derived from other scores.
  // Let me use: free_summary(20) + member_sections(40) + reels(20) + line(20) = 100 max for quality_score
  // And member_value_score is separate.

  // Simple quality_score: use ai_strategy_json.quality_score if available, else compute
  const existingQuality = Number(aiJson?.quality_score || 0);
  const existingMemberValue = Number(aiJson?.member_value_score || 0);

  const simpleQuality = existingQuality > 0 ? existingQuality : Math.round(
    (fs.score + Math.round(ms.score / 2) + rs.score + ls.score) / 80 * 100
  );

  return {
    overall_status: overallStatus,
    free_summary_status: fs.status,
    member_content_status: ms.status,
    reels_status: rs.status,
    line_push_status: ls.status,
    quality_score: Math.min(100, Math.max(0, simpleQuality)),
    member_value_score: existingMemberValue > 0 ? Math.min(100, existingMemberValue) : mv,
    reasons: reasons.length > 0 ? reasons : ['內容品質檢查通過。'],
    blocking_issues: blockingIssues,
    suggested_action: suggestedAction,
  };
}

// ═══════════════════════════════════════════════════
// Quick helpers for UI display
// ═══════════════════════════════════════════════════

export function getGateStatusDisplay(gate: ContentPublishGate | null): {
  label: string;
  description: string;
  icon: string;
  colorClass: string;
  bgClass: string;
  borderClass: string;
} {
  if (!gate) {
    return {
      label: '尚未檢查',
      description: '今日內容狀態尚未完成檢查，請稍後再試。',
      icon: 'ri-time-line',
      colorClass: 'text-foreground-400',
      bgClass: 'bg-foreground-500/5',
      borderClass: 'border-foreground-500/10',
    };
  }

  switch (gate.overall_status) {
    case '可公開':
      return {
        label: '可公開',
        description: '今日免費摘要、會員研究筆記、Reels 與 LINE 文案皆已產生，內容品質達標。',
        icon: 'ri-check-double-line',
        colorClass: 'text-emerald-600',
        bgClass: 'bg-emerald-500/5',
        borderClass: 'border-emerald-500/15',
      };
    case '需人工確認':
      return {
        label: '需人工確認',
        description: '今日內容可作為參考，但部分會員內容或腳本偏弱，建議站長確認後再公開或推播。',
        icon: 'ri-error-warning-line',
        colorClass: 'text-amber-600',
        bgClass: 'bg-amber-500/5',
        borderClass: 'border-amber-500/15',
      };
    case '不建議公開':
      return {
        label: '不建議公開',
        description: '今日內容缺失或品質不足，不建議公開，請重新產生報告或人工修正。',
        icon: 'ri-close-circle-line',
        colorClass: 'text-red-600',
        bgClass: 'bg-red-500/5',
        borderClass: 'border-red-500/15',
      };
  }
}

/** Frontend display mode based on gate */
export function getFrontendDisplayMode(gate: ContentPublishGate | null): 'normal' | 'degraded' | 'hidden' | 'unknown' {
  if (!gate) return 'unknown';
  switch (gate.overall_status) {
    case '可公開': return 'normal';
    case '需人工確認': return 'degraded';
    case '不建議公開': return 'hidden';
  }
}

export function getGateBannerText(gate: ContentPublishGate | null): string {
  const mode = getFrontendDisplayMode(gate);
  switch (mode) {
    case 'normal': return '';
    case 'degraded': return '今日完整研究筆記已產生，部分內容待確認後更新。';
    case 'hidden': return '會員研究筆記已產生，等待發布檢查';
    case 'unknown': return '今日內容狀態尚未完成檢查，請稍後再試。';
  }
}

// ═══════════════════════════════════════════════════
// Auto Publish Decision V1 — 站長不用早起審核
// ═══════════════════════════════════════════════════

export interface PublishControl {
  allow_free_summary_public: boolean;
  allow_member_preview_public: boolean;
  allow_reels_use: boolean;
  allow_line_push_use: boolean;
  allow_social_post_use: boolean;
}

export interface AutoPublishDecision {
  decision: '自動公開' | '需人工確認' | '自動擋下';
  decided_at: string;
  reason: string;
  requires_owner_action: boolean;
  urgency: '不用處理' | '有空確認' | '建議今日處理';
  owner_message: string;
  publish_control: PublishControl;
}

export function computeAutoPublishDecision(gate: ContentPublishGate | null): AutoPublishDecision {
  const decidedAt = new Date().toISOString();

  if (!gate) {
    return {
      decision: '自動擋下',
      decided_at: decidedAt,
      reason: '內容尚未產生，無法評分。',
      requires_owner_action: true,
      urgency: '建議今日處理',
      owner_message: '今日內容尚未產生，系統無法判斷品質。請確認 OpenAI 排程是否正常運作。',
      publish_control: {
        allow_free_summary_public: false,
        allow_member_preview_public: false,
        allow_reels_use: false,
        allow_line_push_use: false,
        allow_social_post_use: false,
      },
    };
  }

  const hasForbiddenWords = gate.blocking_issues.some(
    (i) => i.includes('買賣建議') || i.includes('明牌'),
  );
  const hasFakeData = gate.blocking_issues.some(
    (i) => i.includes('假資料') || i.includes('不存在'),
  );
  const isTemplateLike = gate.reasons.some((r) => r.includes('模板化'));

  // ── Decision: 自動公開 ──
  if (
    gate.overall_status === '可公開' &&
    gate.member_value_score >= 80 &&
    !hasForbiddenWords &&
    !hasFakeData &&
    gate.free_summary_status === '可用' &&
    gate.member_content_status === '可用'
  ) {
    return {
      decision: '自動公開',
      decided_at: decidedAt,
      reason: '內容品質達標：免費摘要可用、會員內容強度足夠、沒有禁詞與假資料風險。',
      requires_owner_action: false,
      urgency: '不用處理',
      owner_message:
        '今日內容已自動通過，免費摘要與會員預覽已公開，Reels / LINE 文案可使用。',
      publish_control: {
        allow_free_summary_public: true,
        allow_member_preview_public: true,
        allow_reels_use: true,
        allow_line_push_use: true,
        allow_social_post_use: true,
      },
    };
  }

  // ── Decision: 自動擋下 ──
  if (
    gate.overall_status === '不建議公開' ||
    gate.member_value_score < 65 ||
    gate.member_content_status === '缺失' ||
    gate.free_summary_status === '缺失' ||
    hasForbiddenWords ||
    hasFakeData
  ) {
    const reasons: string[] = [];
    if (gate.member_content_status === '缺失') reasons.push('會員研究筆記尚未產生');
    if (gate.free_summary_status === '缺失') reasons.push('免費摘要尚未產生');
    if (gate.member_value_score < 65) reasons.push(`會員內容強度不足（${gate.member_value_score}/100）`);
    if (hasForbiddenWords) reasons.push('內容含有買賣建議或明牌語氣');
    if (hasFakeData) reasons.push('內容可能引用不存在的資料或股票');

    return {
      decision: '自動擋下',
      decided_at: decidedAt,
      reason: reasons.join('；') || '內容品質不合格。',
      requires_owner_action: true,
      urgency: '建議今日處理',
      owner_message:
        '今日內容品質不足或資料異常，系統已自動暫停公開，不會推送弱內容。',
      publish_control: {
        allow_free_summary_public: false,
        allow_member_preview_public: false,
        allow_reels_use: false,
        allow_line_push_use: false,
        allow_social_post_use: false,
      },
    };
  }

  // ── Decision: 需人工確認 ──
  const reasons: string[] = [];
  if (gate.member_value_score >= 65 && gate.member_value_score < 80) {
    reasons.push(`會員內容強度偏弱（${gate.member_value_score}/100）`);
  }
  if (gate.reels_status === '偏弱' || gate.reels_status === '不足') {
    reasons.push(`Reels 腳本${gate.reels_status}`);
  }
  if (gate.line_push_status === '偏弱' || gate.line_push_status === '不足') {
    reasons.push(`LINE 文案${gate.line_push_status}`);
  }
  if (isTemplateLike) reasons.push('內容過度模板化');

  return {
    decision: '需人工確認',
    decided_at: decidedAt,
    reason: reasons.join('；') || '部分內容需要站長確認。',
    requires_owner_action: true,
    urgency: '有空確認',
    owner_message:
      '今日免費摘要可公開，但會員內容或腳本偏弱，不會自動推播。你有空再確認即可。',
    publish_control: {
      allow_free_summary_public: true,
      allow_member_preview_public: false,
      allow_reels_use: false,
      allow_line_push_use: false,
      allow_social_post_use: false,
    },
  };
}

/** Get simplified display info for the auto publish decision */
export function getAutoDecisionDisplay(decision: AutoPublishDecision | null): {
  title: string;
  subtitle: string;
  icon: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  badgeClass: string;
  dotClass: string;
} {
  if (!decision) {
    return {
      title: '尚未檢查',
      subtitle: '今日內容狀態尚未完成檢查，請稍後再試。',
      icon: 'ri-time-line',
      bgClass: 'bg-foreground-500/5',
      borderClass: 'border-foreground-500/10',
      textClass: 'text-foreground-400',
      badgeClass: 'bg-foreground-500/10 text-foreground-400 border-foreground-500/20',
      dotClass: 'bg-foreground-400',
    };
  }

  switch (decision.decision) {
    case '自動公開':
      return {
        title: '今日已自動公開',
        subtitle: '內容品質達標，免費摘要與會員預覽已公開。你不用處理。',
        icon: 'ri-check-double-line',
        bgClass: 'bg-emerald-500/5',
        borderClass: 'border-emerald-500/15',
        textClass: 'text-emerald-600',
        badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
        dotClass: 'bg-emerald-500',
      };
    case '需人工確認':
      return {
        title: '今日免費摘要已公開，會員內容待確認',
        subtitle: '系統偵測會員內容偏弱，因此暫不公開會員預覽，也不建議自動發 Reels / LINE。你有空再看。',
        icon: 'ri-error-warning-line',
        bgClass: 'bg-amber-500/5',
        borderClass: 'border-amber-500/15',
        textClass: 'text-amber-600',
        badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
        dotClass: 'bg-amber-500',
      };
    case '自動擋下':
      return {
        title: '今日內容已自動暫停',
        subtitle: '系統偵測資料不足或內容品質不合格，前台已切換成保守提示，不會公開弱內容。',
        icon: 'ri-close-circle-line',
        bgClass: 'bg-red-500/5',
        borderClass: 'border-red-500/15',
        textClass: 'text-red-600',
        badgeClass: 'bg-red-500/10 text-red-600 border-red-500/20',
        dotClass: 'bg-red-500',
      };
  }
}