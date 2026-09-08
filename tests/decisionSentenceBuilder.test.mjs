import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import {
  buildNoTradeDecisionCopy,
  buildRecommendationDecisionCopy,
  normalizeDecisionCondition,
} from '../supabase/functions/_shared/decision-sentence-builder.ts';
import { evaluateDecisionSentenceValue } from '../supabase/functions/_shared/content-intelligence.ts';
import { isMarketIndicatorStale, dateInTimeZone } from '../supabase/functions/generate-daily-report-v7/market-freshness.ts';
import { sanitizeUnsupportedAbsolutePriceLevels } from '../supabase/functions/generate-daily-report-v7/content-integrity.ts';

const generatorSource = readFileSync(new URL('../supabase/functions/generate-daily-report-v7/index.ts', import.meta.url), 'utf8');
const selectorDependencies = { evaluateDecisionSentenceValue, isMarketIndicatorStale, sanitizeUnsupportedAbsolutePriceLevels };
for (const name of ['hasConditionalPremarketPrefix', 'replacePremarketTemporalPattern', 'sanitizePremarketTemporalLanguage',
  'sanitizeUnsupportedResearchText', 'hasUsableMarketEvidence', 'findIndicator', 'fmtSignedPct',
  'isCoreMarketDataStale', 'isSyntheticDailySentence', 'dailySentenceFingerprint']) {
  selectorDependencies[name] = isolatedFunction(generatorSource, name, selectorDependencies);
}
const selectDailySentence = isolatedFunction(generatorSource, 'resolveEvidenceBackedDailySentence', selectorDependencies);
const freshAt = new Date(Date.now() - 3600000).toISOString();
const sourceDates = {twCoreDate:dateInTimeZone(freshAt,'Asia/Taipei'),usGlobalDate:dateInTimeZone(freshAt,'America/New_York')};
const quote = (symbol, changePercent, updatedAt = freshAt) => ({symbol,value:100,changePercent,updatedAt,hasValue:true,hasChangePercent:true});
const weakLegacySentence = '半導體 是今天的主要觀察方向，原因是「美股 AI 半導體鏈 上漲」；盤中先用「開盤是否反映 偏多觀察，並確認台指期、2330 與候選族群是否同向。」確認，未出現前不升級判斷。';

test('public sentence selector rejects the observed weak V8 alias and uses existing fresh market evidence', () => {
  assert.equal(evaluateDecisionSentenceValue(weakLegacySentence).eligible, false);
  const result = selectDailySentence({v8_daily_sentence:{sentence:weakLegacySentence}}, [quote('TSM',1.23)], sourceDates, '偏多觀察');
  assert.match(result, /TSM ADR \+1\.23%/u);
  assert.match(result, /09:30/u);
  assert.match(result, /未確認前不追價/u);
  assert.equal(evaluateDecisionSentenceValue(result).eligible, true);
});

test('a raw news headline cannot bypass the original action and checkpoint contract', () => {
  const result = selectDailySentence({important_news:[{title:'半導體產業需求上修，台股電子供應鏈開盤仍須驗證量能',taiwan_impact_summary:'影響台灣電子供應鏈風險偏好，沒有任何個股訂單證據。'}]}, [quote('SOX',-2.34)], sourceDates, '偏弱觀察');
  assert.match(result, /SOX -2\.34%/u);
  assert.equal(evaluateDecisionSentenceValue(result).eligible, true);
});

test('complete evidence-backed recommendation sentence retains priority unchanged', () => {
  const sentence = buildRecommendationDecisionCopy({trigger:'NVDA 財測上修',industry:'AI 伺服器',name:'台積電',invalidation:'2330 弱於 TAIEX 且族群量價未同步'}).sentence;
  const result = selectDailySentence({v8_daily_sentence:{sentence}}, [quote('TSM',1.23)], sourceDates, '偏多觀察');
  assert.equal(result, sentence);
});

test('real-quote fallback rejects stale and invalid numeric rows rather than fabricating a value', () => {
  const staleAt = new Date(Date.now()-72*3600000).toISOString();
  const market = [quote('TSM',9.99,staleAt),{...quote('NVDA',7.77),hasValue:false},quote('SOX',0.42)];
  const result = selectDailySentence({v8_daily_sentence:{sentence:weakLegacySentence}}, market, sourceDates, '偏多觀察');
  assert.match(result, /SOX \+0\.42%/u);
  assert.doesNotMatch(result, /9\.99|7\.77/u);
  assert.equal(evaluateDecisionSentenceValue(result).eligible, true);
  const absent = selectDailySentence({}, [], sourceDates, '資料不足');
  assert.doesNotMatch(absent, /[+-]?\d+(?:\.\d+)?%/u);
});

test('recommendation sentence removes duplicate conditional words and never truncates the invalidation clause', () => {
  const result = buildRecommendationDecisionCopy({
    trigger: 'NVDA',
    industry: 'AI Server',
    name: '英業達',
    invalidation: '若 2356 弱於 TAIEX、AI Server 沒有量價同步，或事件來源更新後不再支持原假設，今日受惠判斷失效。',
  });

  assert.doesNotMatch(result.sentence, /若若|不再支[，。；]/u);
  assert.match(result.sentence, /若 2356 弱於 TAIEX、AI Server 沒有量價同步/u);
  assert.match(result.sentence, /今日不追價並撤回受惠假設/u);
  assert.equal(evaluateDecisionSentenceValue(result.sentence).eligible, true);
  assert.equal(evaluateDecisionSentenceValue(result.subscriber_sentence).eligible, true);
});

test('no-trade sentence remains a complete paid decision when positive evidence is insufficient', () => {
  const result = buildNoTradeDecisionCopy({
    sourceDetail: '隔夜市場訊號',
    industry: '半導體',
    name: '台積電',
    stopCondition: '如果台積電與半導體族群沒有同步止跌，停止觀察。',
  });

  assert.doesNotMatch(result.sentence, /若如果|如果如果/u);
  assert.match(result.sentence, /09:30/u);
  assert.match(result.sentence, /今日不建立受惠股/u);
  assert.equal(evaluateDecisionSentenceValue(result.sentence).eligible, true);
});

test('decision condition normalization keeps the first complete observable clause', () => {
  assert.equal(
    normalizeDecisionCondition('若 2330 弱於 TAIEX，今日受惠判斷失效。', '條件未成立'),
    '2330 弱於 TAIEX',
  );
});
