import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {performanceClosingDirection} from '../src/lib/performanceDirectionPresentation.ts';
import vm from 'node:vm';import ts from 'typescript';
import {getSubscriberReportProjection} from '../src/lib/subscriberReportContract.ts';
import {subscriberProjectionFixture} from './fixtures/subscriber-projection-v1.mjs';
test('observed down/flat and all existing direction aliases use reader language without changing a verdict',()=>{
 for(const value of ['down','bearish','negative',' DOWN '])assert.equal(performanceClosingDirection(value),'收盤偏空');
 for(const value of ['flat','neutral','sideways'])assert.equal(performanceClosingDirection(value),'收盤震盪');
 for(const value of ['up','bullish','positive'])assert.equal(performanceClosingDirection(value),'收盤偏多');
 for(const value of [null,undefined,'unknown','pending',''])assert.equal(performanceClosingDirection(value),null);
 const page=readFileSync(new URL('../src/pages/performance/page.tsx',import.meta.url),'utf8');
 assert.match(page,/performanceClosingDirection\(closing\?\.actual_direction\)/);assert.match(page,/const valid = entries\.filter\(\(entry\) => entry\.outcome !== 'insufficient'\)/);
});
test('history card direction is independent of a trimmed action; missing publication is not upgraded',()=>{
 const source=readFileSync(new URL('../src/lib/historicalReportCardPresentation.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,exports={};
 vm.runInNewContext(compiled,{exports,require:name=>{assert.equal(name,'@/utils/publicRuntimeCopy');return {humanizePublicRuntimeText:value=>value};}});
 const wire=subscriberProjectionFixture('READY');delete wire.canonical_decision.action;wire.canonical_decision.market_bias='偏弱觀察';wire.market_bias='偏弱觀察';
 const projection=getSubscriberReportProjection(wire,{historical:true});assert.equal(projection.analysisAvailable,true);assert.equal(projection.marketDecision.action,'INSUFFICIENT_DATA');
 const card=exports.historicalReportCardPresentation(projection);assert.equal(card.direction,projection.marketDecision.bias);assert.equal(card.title,'Morning Alpha 市場判讀');
 const unknown=exports.historicalReportCardPresentation(getSubscriberReportProjection(subscriberProjectionFixture('BLOCKED'),{historical:true}));assert.equal(unknown.direction,'此份歷史分析資料不足');assert.equal(unknown.title,'尚無完整歷史分析');
});
test('home avoids repeating the identical formal sentence and publisher does not misreport LINE transport',()=>{
 const home=readFileSync(new URL('../src/pages/home/page.tsx',import.meta.url),'utf8');assert.match(home,/morningBrief === heroDecisionSentence/);assert.match(home,/最新市場資料時間/);
 const publisher=readFileSync(new URL('../src/pages/admin/scripts/page.tsx',import.meta.url),'utf8');assert.doesNotMatch(publisher,/LINE 尚未接入|ai_strategy_json/);assert.match(publisher,/不是正式會員 LINE 每日發送狀態/);assert.match(publisher,/ma\.reportId/);
});
test('member center retains one page h1 and uses a section heading for the embedded morning card',()=>{
 const source=readFileSync(new URL('../src/pages/account/components/MorningHeroCard.tsx',import.meta.url),'utf8');assert.doesNotMatch(source,/<h1\b/);assert.match(source,/<h2[^>]*>\s*Morning Alpha 觀察中心/);
});
