import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {performanceClosingDirection} from '../src/lib/performanceDirectionPresentation.ts';
test('observed down/flat and all existing direction aliases use reader language without changing a verdict',()=>{
 for(const value of ['down','bearish','negative',' DOWN '])assert.equal(performanceClosingDirection(value),'收盤偏空');
 for(const value of ['flat','neutral','sideways'])assert.equal(performanceClosingDirection(value),'收盤震盪');
 for(const value of ['up','bullish','positive'])assert.equal(performanceClosingDirection(value),'收盤偏多');
 for(const value of [null,undefined,'unknown','pending',''])assert.equal(performanceClosingDirection(value),null);
 const page=readFileSync(new URL('../src/pages/performance/page.tsx',import.meta.url),'utf8');
 assert.match(page,/performanceClosingDirection\(closing\?\.actual_direction\)/);assert.match(page,/const valid = entries\.filter\(\(entry\) => entry\.outcome !== 'insufficient'\)/);
});
test('member center retains one page h1 and uses a section heading for the embedded morning card',()=>{
 const source=readFileSync(new URL('../src/pages/account/components/MorningHeroCard.tsx',import.meta.url),'utf8');assert.doesNotMatch(source,/<h1\b/);assert.match(source,/<h2[^>]*>\s*Morning Alpha 觀察中心/);
});
