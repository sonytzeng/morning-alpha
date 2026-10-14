import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {performanceClosingDirection} from '../src/lib/performanceDirectionPresentation.ts';
import vm from 'node:vm';import ts from 'typescript';
import {getSubscriberReportProjection} from '../src/lib/subscriberReportContract.ts';
import {subscriberProjectionFixture} from './fixtures/subscriber-projection-v1.mjs';
import {execFileSync} from 'node:child_process';
const ctoPrior=path=>execFileSync('git',['show','4348efaff4514a43473d111950083799a23c79c2:'+path]);
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
test('footer improves only opacity, preserving every word, link, feature flag and interaction',()=>{
 const path='src/components/feature/Footer.tsx',before=ctoPrior(path).toString(),after=readFileSync(new URL('../'+path,import.meta.url),'utf8');
 assert.equal(after,before.replaceAll('text-white/45','text-white/60').replaceAll('text-white/25','text-white/60').replaceAll('text-white/20','text-white/60'));
 const css=readFileSync(new URL('../src/index.css',import.meta.url),'utf8'),start=css.indexOf('/* :root is DARK, .light overrides to light */'),end=css.indexOf('/* light mode override');
 assert.ok(start>=0&&end>start);const token=css.slice(start,end).match(/--background-50:\s*([^;]+);/)[1];
 const [L,C,H]=token.trim().split(/\s+/).map(Number),a=C*Math.cos(H*Math.PI/180),b=C*Math.sin(H*Math.PI/180);
 const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
 const linear=[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];
 const encoded=linear.map(x=>Math.max(0,Math.min(1,x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055)));
 const luminance=rgb=>rgb.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
 const ratio=alpha=>(luminance(encoded.map(x=>alpha+(1-alpha)*x))+.05)/(luminance(encoded)+.05);
 assert.ok(ratio(.2)<4.5);assert.ok(ratio(.25)<4.5);assert.ok(ratio(.6)>=4.5,'actual dark background token with 60% white meets AA');
});
