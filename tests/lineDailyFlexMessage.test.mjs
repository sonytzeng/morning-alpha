import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLineDailyFlexMessage,
  humanizeLineText,
} from '../supabase/functions/_shared/line-daily-flex-message.mjs';

function textValues(value) {
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (!value || typeof value !== 'object') return [];
  return [
    ...(typeof value.text === 'string' ? [value.text] : []),
    ...Object.values(value).flatMap(textValues),
  ];
}

const recommendations = [
  {
    name: '台達電',
    symbol: '2308',
    sector: '電子權值',
    confirmation_condition: '2308 相對 TAIEX 轉強，且電子權值至少兩檔同步放量。',
    invalidation_condition: '若 2308 弱於 TAIEX，盤前假設失效。',
  },
  { name: '鴻海', symbol: '2317', sector: '電子權值' },
  { name: '台光電', symbol: '2383', sector: 'PCB / CCL' },
  { name: '聯詠', symbol: '3034', sector: 'IC 設計' },
  { name: '欣興', symbol: '3037', sector: 'PCB / CCL' },
];

test('LINE daily Flex card exposes the decision hierarchy without raw system metadata', () => {
  const message = buildLineDailyFlexMessage({
    reportDate: '2026-09-04',
    bias: '偏多觀察',
    todayLine: 'NVDA 先傳導至電子權值；09:30 看台達電是否相對 TAIEX 轉強。',
    opportunity: 'SEMICONDUCTOR 與 PCB / CCL 是否同步擴散',
    risk: '開盤方向與盤前判斷相反超過 1%',
    avoid: '避免把盤前偏多當成追價理由，先等量價確認。',
    decisionMode: 'recommendations',
    recommendations,
    siteUrl: 'https://morningalphatw.com/',
  });

  const texts = textValues(message.contents);
  const visibleText = texts.join('\n');
  assert.equal(message.type, 'flex');
  assert.equal(message.contents.type, 'bubble');
  assert.ok(message.altText.length <= 1500);
  assert.match(message.altText, /NVIDIA 先傳導至電子權值/);
  assert.match(visibleText, /今日盤前決策/);
  assert.match(visibleText, /偏多觀察/);
  assert.match(visibleText, /台達電（2308）/);
  assert.match(visibleText, /鴻海（2317）/);
  assert.match(visibleText, /完整報告另有 3 檔/);
  assert.match(visibleText, /成立條件/);
  assert.match(visibleText, /失效條件/);
  assert.match(visibleText, /大盤/);
  assert.doesNotMatch(visibleText, /台光電（2383）/);
  assert.doesNotMatch(visibleText, /NVDA|TAIEX|SEMICONDUCTOR/);
  assert.doesNotMatch(visibleText, /\/100|分析產生|資料截止|https:\/\//);

  const button = message.contents.footer.contents[0];
  assert.equal(button.action.label, '查看今日 5 檔完整分析');
  assert.equal(button.action.uri, 'https://morningalphatw.com/report/today');
  assert.ok(Buffer.byteLength(JSON.stringify(message), 'utf8') < 30 * 1024);
});

test('LINE daily Flex card fails safely to a no-trade presentation', () => {
  const message = buildLineDailyFlexMessage({
    reportDate: '2026-09-04',
    bias: '高風險日',
    todayLine: '',
    opportunity: '',
    risk: '',
    avoid: '',
    decisionMode: 'no_trade',
    recommendations: [],
    siteUrl: 'javascript:alert(1)',
  });

  const visibleText = textValues(message.contents).join('\n');
  assert.match(visibleText, /今日暫不建立推薦股/);
  assert.match(visibleText, /不為了湊數勉強推薦/);
  assert.equal(message.contents.footer.contents[0].action.label, '查看今日完整盤前報告');
  assert.equal(message.contents.footer.contents[0].action.uri, 'https://morningalphatw.com/report/today');
});

test('LINE terminology is localized for Taiwan readers', () => {
  assert.equal(
    humanizeLineText('SEMICONDUCTOR、NVDA、TAIEX、TSM ADR、PCB / CCL'),
    '半導體、NVIDIA、大盤、台積電 ADR、PCB／CCL',
  );
});
