const DEFAULT_SITE_URL = 'https://morningalphatw.com';

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。；：、])/g, '$1')
    .trim();
}

export function humanizeLineText(value) {
  return cleanText(value)
    .replace(/\bTSMC?\s+ADR\b/gi, '台積電 ADR')
    .replace(/\bSEMICONDUCTOR\b/gi, '半導體')
    .replace(/\bNVDA\b/gi, 'NVIDIA')
    .replace(/\bTAIEX\b/gi, '大盤')
    .replace(/\bPCB\s*\/\s*CCL\b/gi, 'PCB／CCL');
}

function clipText(value, maxLength) {
  const text = humanizeLineText(value);
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

function firstText(...values) {
  for (const value of values) {
    const text = humanizeLineText(value);
    if (text) return text;
  }
  return '';
}

function firstClause(value) {
  return firstText(...humanizeLineText(value).split(/[；;。\n]/));
}

function normalizeSiteUrl(value) {
  const candidate = String(value || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(candidate)
    ? candidate
    : DEFAULT_SITE_URL;
}

function formatReportDate(value) {
  const match = String(value || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return '07:30 盤前';
  return `${Number(match[1])}/${Number(match[2])} 盤前`;
}

function biasColor(value) {
  const bias = String(value || '');
  if (bias.includes('弱') || bias.includes('風險')) return '#D95C5C';
  if (bias.includes('多')) return '#13A88A';
  return '#B8872F';
}

function normalizeRecommendations(value) {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item) => firstText(item.name, item.stock_name, item.symbol, item.stock_code));
}

function recommendationLabel(item) {
  const name = firstText(item.name, item.stock_name);
  const symbol = firstText(item.symbol, item.stock_code);
  const identity = name && symbol ? `${name}（${symbol}）` : firstText(name, symbol, '觀察標的');
  const sector = firstText(item.sector, item.industry_name);
  return clipText(sector ? `${identity}｜${sector}` : identity, 42);
}

function sectionCard(label, text, colors) {
  return {
    type: 'box',
    layout: 'vertical',
    margin: 'md',
    paddingAll: '12px',
    backgroundColor: colors.background,
    cornerRadius: 'md',
    contents: [
      { type: 'text', text: label, size: 'xs', weight: 'bold', color: colors.label },
      { type: 'text', text: clipText(text, 84), size: 'sm', color: '#263746', wrap: true, margin: 'xs' },
    ],
  };
}

export function buildLineDailyFlexMessage(input) {
  const recommendations = normalizeRecommendations(input.recommendations);
  const focus = recommendations.slice(0, 2);
  const firstRecommendation = focus[0] || {};
  const decisionMode = firstText(input.decisionMode);
  const bias = clipText(firstText(input.bias, '中性觀察'), 16);
  const headline = clipText(firstClause(input.todayLine) || '先看開盤量價是否支持盤前假設', 42);
  const theme = clipText(firstText(input.opportunity, firstRecommendation.sector, firstRecommendation.industry_name, '等待市場主線確認'), 52);
  const confirmation = firstText(
    firstRecommendation.confirmation_condition,
    firstRecommendation.entry_condition,
    firstRecommendation.validation_signal,
    input.confirmation,
    '09:30 後確認個股相對大盤轉強，且族群量價同步。',
  );
  const invalidation = firstText(
    firstRecommendation.invalidation_condition,
    input.risk,
    '個股弱於大盤或族群沒有同步，盤前假設失效。',
  );
  const avoid = firstText(input.avoid, '條件成立才觀察，開高不追價。');
  const reportUrl = `${normalizeSiteUrl(input.siteUrl)}/report/today`;
  const focusLabel = decisionMode === 'no_trade'
    ? '今日暫不建立推薦股'
    : focus.length > 0
      ? `焦點觀察｜先看 ${focus.length} 檔`
      : '今日觀察重點';
  const focusContents = focus.length > 0
    ? focus.map((item, index) => ({
      type: 'text',
      text: `${index + 1}. ${recommendationLabel(item)}`,
      size: 'sm',
      weight: 'bold',
      color: '#12263A',
      wrap: true,
      margin: index === 0 ? 'sm' : 'xs',
    }))
    : [{
      type: 'text',
      text: decisionMode === 'no_trade' ? '先驗證盤面，不為了湊數勉強推薦。' : clipText(theme, 52),
      size: 'sm',
      color: '#425466',
      wrap: true,
      margin: 'sm',
    }];
  const ctaLabel = recommendations.length > 0
    ? `查看今日 ${recommendations.length} 檔完整分析`
    : '查看今日完整盤前報告';
  const altText = clipText(`Morning Alpha 盤前｜${bias}｜${headline}`, 180);

  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#071D33',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'MORNING ALPHA', size: 'sm', weight: 'bold', color: '#70E1CF', flex: 1 },
              { type: 'text', text: formatReportDate(input.reportDate), size: 'xs', color: '#B8C6D6', align: 'end' },
            ],
          },
          { type: 'text', text: '今日盤前決策', size: 'xl', weight: 'bold', color: '#FFFFFF', margin: 'md' },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                flex: 0,
                paddingAll: '6px',
                backgroundColor: biasColor(bias),
                cornerRadius: 'sm',
                contents: [{ type: 'text', text: bias, size: 'xs', weight: 'bold', color: '#FFFFFF' }],
              },
              { type: 'text', text: '條件成立才觀察', size: 'xs', color: '#B8C6D6', gravity: 'center', margin: 'sm' },
            ],
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: headline, size: 'xl', weight: 'bold', color: '#12263A', wrap: true },
          { type: 'text', text: '今日主線', size: 'xs', weight: 'bold', color: '#13A88A', margin: 'lg' },
          { type: 'text', text: theme, size: 'sm', color: '#425466', wrap: true, margin: 'xs' },
          { type: 'separator', color: '#DDE6ED', margin: 'lg' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            contents: [
              { type: 'text', text: focusLabel, size: 'xs', weight: 'bold', color: '#647789' },
              ...focusContents,
              ...(recommendations.length > focus.length ? [{
                type: 'text',
                text: `完整報告另有 ${recommendations.length - focus.length} 檔與全部證據`,
                size: 'xs',
                color: '#7A8B99',
                margin: 'sm',
              }] : []),
            ],
          },
          sectionCard('成立條件', confirmation, { background: '#EAF8F5', label: '#087A68' }),
          sectionCard('失效條件', invalidation, { background: '#FFF1F1', label: '#B84343' }),
          { type: 'text', text: `操作原則｜${clipText(avoid, 54)}`, size: 'xs', color: '#647789', wrap: true, margin: 'lg' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            color: '#0B7F72',
            action: { type: 'uri', label: ctaLabel, uri: reportUrl },
          },
          { type: 'text', text: '完整證據、5 檔排序與盤中驗證都在報告內', size: 'xxs', color: '#8B99A6', align: 'center', wrap: true, margin: 'sm' },
        ],
      },
    },
  };
}
