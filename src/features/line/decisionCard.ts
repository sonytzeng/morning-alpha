/** Pure, deterministic OWNER PREVIEW. Not imported by the live LINE sender.
 * V1 publication remains the authority; this module neither evaluates nor sends.
 * Raw Owner diagnostics may supply cited market prose only after identity and
 * publication checks. They can NEVER supply the recommendation list/status. */
import type { ServerReportPayloadResponse } from '../../types/subscription.ts';
import { v2DailySnapshot } from '../research/recommendation-v2-forward.ts';

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const texts = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())) : [];
export type CardLine = { text: string; path: string; evidence: string[]; secondary?: boolean };
export type CardSection = { title: string; lines: CardLine[] };
export type DecisionCard = {
  version: 'LINE_DECISION_CARD_V2_PREVIEW'; date: string; revision: string; generatedAt: string;
  direction: string; action: string; headline: string; sections: CardSection[];
  recommendation: 'READY' | 'WATCH' | 'NONE' | 'BLOCKED'; recommendationSource: 'PRODUCTION_V1';
  notice: string; recommendationReasons: string[]; cta: { label: string; url: string }; deliveryEnabled: false;
};

const actions: Record<string, string> = { ENTER: '可以開始找進場機會', WAIT: '先等，不追價', AVOID: '今天先不要增加曝險' };
/** Dictionary only: preserves signs, numbers, negation, and conjunctions.
 * Never truncate a condition mid-sentence or invent a missing market cause. */
export function linePlainText(value: unknown): string {
  return text(value).replace(/\s+/g, ' ')
    .replace(/\bTSMC?\s*ADR\b/g, '台積電 ADR').replace(/\bTSM\b/g, '台積電 ADR')
    .replace(/\bSOX\b/g, '費城半導體指數').replace(/\bNVDA\b/g, 'NVIDIA')
    .replace(/\bNASDAQ\b/g, '那斯達克指數').replace(/\bSPX\b/g, '標普 500 指數')
    .replace(/\bTAIEX\b/g, '加權指數').replace(/\bTXF\b/g, '台指期')
    .replace(/(?<!\d)2330(?!\d|\s*台積電)/g, '台積電（2330）')
    .replace(/\bUP\b/g, '上漲').replace(/\bDOWN\b/g, '下跌').replace(/\bFLAT\b/g, '變動不大');
}
const internal = /\b(?:Atomic|Provider|Coverage|Revision|Dispatch|Recorder|Schema|Gate|DEGRADED|ENTER|WAIT|AVOID)\b|[A-Z]{2,}_[A-Z_]{2,}/i;
const readable = (value: unknown): string => {
  const out = linePlainText(value);
  return out && out.length <= 180 && !internal.test(out) ? out : '';
};
const incompleteReasons = new Set(['recommendation_evaluation_evidence_insufficient', 'recommendation_evaluation_incomplete',
  'stock_evidence_incomplete', 'missing_institutional_flow', 'missing_consensus']);
const line = (value: unknown, path: string, evidence: string[] = []): CardLine | null => {
  const content = readable(value); return content ? { text: content, path, evidence } : null;
};
const present = (v: CardLine | null): v is CardLine => v !== null;

export function composeDecisionCard(response: ServerReportPayloadResponse): DecisionCard {
  const p = response.payload || {}, projection = response.subscriber_projection;
  const raw = row(row(p.admin_source_report).ai_strategy_json), state = row(raw.canonical_market_state);
  const document = row(state.document), sections = row(document.sections), decision = row(p.canonical_decision);
  const id = projection?.identity;
  if (response.tier !== 'admin' || response.authenticated !== true || !projection?.analysisAvailable
    || projection.evidence.status !== 'SUFFICIENT' || !id?.revisionId || !id.generatedAt
    || response.report_date !== id.reportDate || response.revision_id !== id.revisionId
    || p.revision_id !== id.revisionId || decision.id !== id.revisionId || raw.revision_id !== id.revisionId
    || state.schema_version !== 'CANONICAL_MARKET_STATE_V1' || state.status !== 'READY'
    || state.report_date !== id.reportDate || document.report_date !== id.reportDate
    || state.generated_at !== row(document.provenance).generated_at) throw Error('LINE_PREVIEW_SOURCE_UNVERIFIED');
  const action = text(decision.action);
  if (!actions[action] || !readable(projection.marketDecision.bias)) throw Error('LINE_PREVIEW_DECISION_UNAVAILABLE');
  const knownIds = new Set(texts(state.evidence_ids));
  const claims = rows(row(row(document.quality).coverage_audit).claims);
  const verifiedIds = new Set(claims.filter(c => c.supported === true && c.scope === 'market')
    .flatMap(c => texts(c.evidence_ids)).filter(ref => knownIds.has(ref)));
  const cited = (value: unknown, path: string, refs: unknown) => {
    const ids = texts(refs);
    return ids.length && ids.every(ref => verifiedIds.has(ref)) ? line(value, path, ids) : null;
  };
  const body: CardSection[] = [];
  const add = (title: string, lines: (CardLine | null)[]) => {
    const valid = lines.filter(present).filter((l, i, all) => all.findIndex(x => x.text === l.text) === i);
    if (valid.length) body.push({ title, lines: valid });
  };
  const summary = row(sections.executive_summary);
  const supported = rows(sections.supporting_evidence);
  // Template selection uses explicit canonical words/classifications, not a new
  // signal threshold. Unknown facts are omitted, never converted into a story.
  const why: CardLine[] = [];
  const summaryFact = text(summary.text).split('；')[0];
  const lead = summaryFact.match(/^(SOX|TSM ADR) ([+-]?\d+(?:\.\d+)?%) 對(半導體|電子權值)(提供支撐|形成壓力)$/);
  if (lead) {
    const translated = `${lead[3]}${lead[4] === '提供支撐' ? '有海外支撐' : '承壓'}：${lead[1] === 'SOX' ? '費半' : '台積電 ADR'} ${lead[2]}。`;
    const result = cited(translated, 'sections.executive_summary.text', summary.evidence_refs);
    if (result) why.push(result);
  }
  const flat = (symbol: string) => supported.find(c => text(c.statement).startsWith(`${symbol} FLAT `)
    && cited(c.statement, 'sections.supporting_evidence', c.evidence_refs));
  const sox = flat('SOX'), nvidia = flat('NVDA');
  if (sox && nvidia) {
    const result = cited('海外科技方向未明：費半與 NVIDIA 大致持平。', 'sections.supporting_evidence:SOX+NVDA',
      [...texts(sox.evidence_refs), ...texts(nvidia.evidence_refs)]);
    if (result) why.push(result);
  } else {
    for (const [i, c] of supported.entries()) {
      const match = text(c.statement).match(/^(TSM(?: ADR)?|SOX|NVDA) (UP|DOWN) ([+-]?\d+(?:\.\d+)?%)(?: |$)/);
      if (!match || (lead && match[1].replace(' ADR', '') === lead[1].replace(' ADR', ''))) continue;
      const name = match[1].startsWith('TSM') ? '台積電 ADR' : match[1] === 'SOX' ? '費半' : 'NVIDIA';
      const result = cited(`${name}${match[2] === 'UP' ? '走強，提供海外支撐' : '走弱，需留意開盤壓力'}（${match[3]}）。`,
        `sections.supporting_evidence[${i}].statement`, c.evidence_refs);
      if (result) why.push(result);
      if (why.length >= 2) break;
    }
  }
  // Checkpoint conditions are canonical rules, not observed market facts. Their
  // producer has no evidence_refs field; retain the exact canonical path instead
  // of inventing citations or falsely treating a planned signal as observed.
  const timeline = rows(sections.timeline);
  const first = timeline.find(c => readable(c.success_condition) && !/資料不足|尚未|未提供/.test(text(c.success_condition)));
  const firstPath = `sections.timeline[${timeline.indexOf(first || {})}]`;
  const confirmsVolume = first && text(first.success_condition) === '候選族群多數站上平盤且成交量放大。';
  // A second stage exists only when the cited canonical summary supplies its
  // time AND complete condition. Keep conjunctions; never move futures to 09:30.
  const summaryRule = cited(summary.text, 'sections.executive_summary.text', summary.evidence_refs)
    && text(summary.text).match(/；(\d{2}:\d{2}) 先看2330 (是否相對加權指數抗跌且電子成交量同步|與半導體族群是否同向)，未確認前不追價。$/);
  const second = first && summaryRule && summaryRule[1] > text(first.time) ? {
    time: summaryRule[1],
    question: summaryRule[2].startsWith('是否') ? '台積電是否比大盤抗跌、電子成交量是否同步' : '台積電與半導體族群是否同向',
    condition: summaryRule[2].startsWith('是否') ? '台積電抗跌且電子成交量同步' : '台積電與半導體族群同向',
  } : null;
  const observations: (CardLine | null)[] = [];
  if (first && confirmsVolume && /2330/.test(text(first.question)) && /是否同向/.test(text(first.question))) {
    observations.push(line(`① ${text(first.time)}｜先觀察：候選族群有沒有多數站上平盤並放量？`, `${firstPath}.success_condition`));
    if (/台指期|TXF/.test(text(first.question))) observations.push(line('② 開盤同看：台指期與台積電、候選族群是否同向？', `${firstPath}.question`));
    else if (/TAIEX|加權指數/.test(text(first.question))) observations.push(line('② 開盤同看：加權指數與台積電、候選族群是否同向？', `${firstPath}.question`));
    observations.push(second
      ? line(`③ ${second.time}｜再確認：${second.question}？`, 'sections.executive_summary.text', texts(summary.evidence_refs))
      : line(`③ 開盤風險：${linePlainText(first.failure_condition)}`, `${firstPath}.failure_condition`));
  }
  add('今天怎麼做？', [line(`${actions[action]}。`, 'payload.canonical_decision.action'),
    confirmsVolume && action !== 'AVOID' ? line(second ? '先觀察，再確認；條件沒齊就不追。' : '開盤先看族群有沒有站上平盤並放量，沒有就不追。', `${firstPath}.success_condition${second ? '+sections.executive_summary.text' : ''}`) : null]);
  if (confirmsVolume && action === 'WAIT' && why.length < 2) why.push(line('台股方向仍待開盤量價確認。', `${firstPath}.question+success_condition`)!);
  add('為什麼？', why.slice(0, 3).map(l => ({ ...l, text: `• ${l.text}` })));
  if (first) {
    if (observations.filter(present).length === 3) add('開盤後只看 3 件事', observations);
    // AVOID cannot be turned into permission to enter by a copy template.
    add('什麼時候可以開始找機會？', [line(action === 'AVOID'
      ? '今天先不增加曝險，等待正式市場判斷更新。'
      : second && confirmsVolume
        ? `${text(first.time)} 後，候選族群多數站上平盤並放量、走勢同向；${second.time} 再確認${second.condition}，才開始找機會。`
        : `${text(first.time) ? `${text(first.time)} 起，` : ''}${text(first.success_condition).replace(/。$/, '')}，才開始找機會。`,
    `${firstPath}.success_condition+payload.canonical_decision.action${second ? '+sections.executive_summary.text' : ''}`,
    second ? texts(summary.evidence_refs) : [])]);
  }
  const failure = row(sections.failure_scenario);
  const primaryFailure = first && text(first.failure_condition).match(/^開盤反向跳空超過 (\d+(?:\.\d+)?)% 或 2330\/(台指期|TXF|TAIEX 現貨)同步轉弱。$/);
  add('什麼情況今天先不要做？', [
    ...(first ? [line(primaryFailure
      ? `反向跳空超過 ${primaryFailure[1]}%，或台積電與${primaryFailure[2].startsWith('TAIEX') ? '加權指數' : '台指期'}同步轉弱，就取消今天計畫、先觀望。`
      : first.failure_condition, `${firstPath}.failure_condition`)] : []),
    ...rows(failure.triggers).map((t, i) => cited(t.condition, `sections.failure_scenario.triggers[${i}].condition`, t.evidence_required)),
  ].filter(present).slice(0, 1));

  const gate = row(p.recommendation_gate), screening = row(gate.screening), rec = projection.recommendation;
  if (gate.contract_version !== 'STOCK_RECOMMENDATION_GATE_V1') throw Error('LINE_PREVIEW_V1_REQUIRED');
  const complete = gate.universe_evaluation_complete === true && screening.status === 'COMPLETE'
    && Number.isInteger(screening.universe_count) && Number(screening.universe_count) > 0
    && screening.universe_count === screening.evaluated_count
    && Array.isArray(screening.rejected) && screening.rejected.length === 0;
  let status: DecisionCard['recommendation'] = 'BLOCKED';
  if (rec.status === 'QUALIFIED' && rec.available && gate.status === 'QUALIFIED' && gate.eligible === true && rec.items.length) status = 'READY';
  else if (rec.status === 'PREMARKET_WATCH' && gate.status === 'PREMARKET_WATCH' && complete) status = 'WATCH';
  else if (rec.status === 'NO_QUALIFIED_OPPORTUNITY' && gate.status === 'NO_QUALIFIED_OPPORTUNITY' && complete) status = 'NONE';
  if (status === 'READY') {
    add('今天有推薦股票嗎？', [line('有。以下為正式推薦。', 'recommendation_gate.status')]);
    for (const [i, stock] of rows(rec.items).slice(0, 3).entries()) {
      const symbol = text(stock.symbol || stock.stock_code), name = text(stock.name || stock.stock_name);
      if (!symbol) throw Error('LINE_PREVIEW_STOCK_IDENTITY_MISSING');
      const reasons = texts(stock.reasons).length ? texts(stock.reasons) : [text(stock.reason)];
      add(`今日正式推薦｜${name ? `${name}（${symbol}）` : symbol}`, [
        ...reasons.slice(0, 3).map(reason => line(reason, `subscriber_projection.recommendation.items[${i}].reasons`)),
        ...[['進場條件', stock.entry_condition || stock.confirmation_condition, 'entry_condition'],
          ['風險', stock.risk || stock.risk_warning, 'risk'], ['失效條件', stock.invalidation_condition, 'invalidation_condition']]
          .map(([label, value, key]) => readable(value) ? line(`${label}：${readable(value)}`, `subscriber_projection.recommendation.items[${i}].${key}`) : null),
      ]);
    }
  } else if (status === 'NONE') add('今天有推薦股票嗎？', [line('目前沒有正式推薦。今天已完成個股評估，但沒有股票同時達到正式推薦條件，不勉強湊股票。', 'recommendation_gate.screening')]);
  else if (status === 'WATCH') add('今天有推薦股票嗎？', [line('目前先觀察，等待正式進場條件確認；觀察名單不是正式推薦。', 'recommendation_gate.phase_evaluation')]);
  else {
    const reasons = texts(gate.reason_codes);
    add('今天有推薦股票嗎？', [
      line(reasons.some(r => incompleteReasons.has(r))
        ? '目前沒有正式推薦。今天的正式個股評估資料尚未完整，因此暫不發布推薦。'
        : '目前沒有正式推薦。正式評估尚未通過，詳細原因請見完整分析。', 'recommendation_gate.reason_codes'),
      { text: '這是評估限制，不代表市場沒有機會。', path: 'recommendation_gate.status', evidence: [], secondary: true },
    ]);
  }
  const operation = row(raw.operational_market), missing = texts(operation.missing_evidence);
  const notice = projection.reportLevel === 'DEGRADED' || operation.report_level === 'DEGRADED'
    ? missing.length === 1 && missing[0] === 'NEWS_CONTEXT' ? '今日市場判斷以核心市場資料為主，新聞證據較少。'
      : '核心市場判斷正常，部分研究資料不足。' : '';
  return { version: 'LINE_DECISION_CARD_V2_PREVIEW', date: id.reportDate, revision: id.revisionId, generatedAt: id.generatedAt,
    direction: readable(projection.marketDecision.bias), action,
    headline: `${readable(projection.marketDecision.bias)}｜${actions[action]}`,
    sections: body, recommendation: status, recommendationSource: 'PRODUCTION_V1', notice, recommendationReasons: texts(gate.reason_codes),
    cta: { label: '查看今日完整分析', url: 'https://morningalphatw.com/report/today' }, deliveryEnabled: false };
}

/** A separate type/output channel. It is never accepted by the member card composer. */
export function ownerV2Copy(data: unknown, date: string) {
  const root = row(data), latest = row(root.latest);
  if (root.shadow_only !== true || root.promotion_allowed !== false || latest.business_date !== date) return null;
  const snapshot = v2DailySnapshot(latest);
  const gateNames: Record<string, string> = { liquidity: '流動性', market: '市場環境', sector: '產業配合', relative_strength: '相對大盤表現',
    momentum: '價格趨勢', volume_price: '量價確認', institutional: '法人方向', fundamental: '實際財務趨勢', catalyst: '公司事件', risk: '風險', entry: '進場條件' };
  const forwardDates = texts(root.forward_dates);
  const forwardSample = Array.isArray(root.forward_dates) && forwardDates.length === root.forward_dates.length
    && forwardDates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) ? new Set(forwardDates).size : null;
  return { banner: 'V2研究觀察｜尚未對會員發布', date, counts: snapshot.counts, forwardSample,
    candidates: rows(latest.candidates).filter(c => ['READY', 'WATCH'].includes(text(c.status))).slice(0, 3)
      .map(c => ({ symbol: text(c.symbol), state: c.status === 'WATCH' ? '待確認，不是正式推薦' : '研究條件齊全，不是正式推薦' })),
    nearMiss: snapshot.counts.READY === 0 && snapshot.counts.WATCH === 0 ? snapshot.near_miss.slice(0, 3).map(c => ({
      symbol: String(c.symbol), passed: c.passed.map(g => gateNames[g]), missing: c.missing.map(g => gateNames[g]),
    })) : [], deliveryEnabled: false as const };
}

export type FlexText = { type: 'text'; text: string; size: 'xs' | 'sm' | 'lg'; color: string; wrap: true; weight?: 'bold'; margin?: 'sm' };
export type FlexBox = { type: 'box'; layout: 'vertical'; paddingAll: string; spacing: 'sm' | 'md'; backgroundColor: string; contents: (FlexText | FlexBox)[] };
export function decisionCardFlex(card: DecisionCard) {
  const t = (s: string, color = '#263746', size: FlexText['size'] = 'sm', bold = false): FlexText => ({ type: 'text', text: s, color, size, wrap: true, ...(bold ? { weight: 'bold' as const } : {}) });
  const body: FlexBox = { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', backgroundColor: '#FFFFFF',
    contents: card.sections.map(section => ({ type: 'box', layout: 'vertical', paddingAll: '0px', spacing: 'sm', backgroundColor: '#FFFFFF',
      contents: [t(section.title, '#087A68', 'sm', true), ...section.lines.map(l => t(l.text, l.secondary ? '#425466' : '#263746', l.secondary ? 'xs' : 'sm'))] })) };
  return { type: 'flex' as const, altText: `Morning Alpha｜${card.headline}`,
    contents: { type: 'bubble' as const, size: 'mega' as const,
      header: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'sm', backgroundColor: '#071D33',
        contents: [t(`Morning Alpha｜${card.date}`, '#70E1CF', 'xs', true), t('今日策略', '#FFFFFF', 'sm', true), t(card.headline, '#FFFFFF', 'lg', true)] } as FlexBox,
      body, footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#087A68',
        action: { type: 'uri', label: card.cta.label, uri: card.cta.url } }] } } };
}
