import test from 'node:test';
import assert from 'node:assert/strict';
import {composeDecisionCard} from '../src/features/line/decisionCard.ts';
import {lineDecisionFixture} from './helpers/lineDecisionFixture.mjs';
const copy=c=>c.sections.flatMap(s=>s.lines.map(l=>l.text)).join('\n');
// Synthetic grammar contracts, NOT claimed as Production captures.
function input(rule){const r=lineDecisionFixture();r.payload.admin_source_report.ai_strategy_json.canonical_market_state.document.sections.executive_summary={text:`TSM ADR -0.72% 對電子權值形成壓力；${rule}，未確認前不追價。`,evidence_refs:['MD001']};return r;}
test('two stages retain date-specific AND conditions, never an immediate buy or stronger-than-market claim',()=>{
 for(const [rule,expected] of [
  ['09:30 先看2330 與半導體族群是否同向','台積電與半導體族群是否同向'],
  ['09:30 先看2330 是否相對加權指數抗跌且電子成交量同步','台積電是否比大盤抗跌、電子成交量是否同步'],
 ]){
  const r=input(rule),before=structuredClone(r),c=composeDecisionCard(r),out=copy(c);
  assert(out.includes('① 09:00｜先觀察：候選族群有沒有多數站上平盤並放量？'));
  assert(out.includes(`③ 09:30｜再確認：${expected}？`));
  assert(out.includes('② 開盤同看：台指期與台積電、候選族群是否同向？'));
  assert(out.includes('先觀察，再確認；條件沒齊就不追。'));
  const entry=c.sections.find(s=>s.title==='什麼時候可以開始找機會？').lines[0];
  assert(entry.text.includes('09:00'));assert(entry.text.includes('09:30'));assert(entry.text.endsWith('才開始找機會。'));
  assert(entry.path.includes('executive_summary'));assert.deepEqual(entry.evidence,['MD001']);
  assert(!/09:00.*直接買|比大盤強|強勢族群/.test(out));assert.deepEqual(r,before);
 }
});
test('no invented second time, no dropped clause, no unverified or out-of-order stage',()=>{
 for(const rule of ['先看2330 是否相對加權指數抗跌且電子成交量同步','08:30 先看2330 是否相對加權指數抗跌且電子成交量同步',
  '09:30 先看2330 是否相對加權指數抗跌且電子成交量同步且其他條件成立']){
  const c=composeDecisionCard(input(rule));assert(!copy(c).includes('｜再確認'));assert(!copy(c).includes('先觀察，再確認'));
  assert(!copy(c).includes('台積電（台積電'));assert(copy(c).includes('台積電（2330）/台指期'));
 }
 const r=input('09:30 先看2330 是否相對加權指數抗跌且電子成交量同步');
 r.payload.admin_source_report.ai_strategy_json.canonical_market_state.document.sections.executive_summary.evidence_refs=['UNVERIFIED'];
 assert(!copy(composeDecisionCard(r)).includes('09:30'));
});
test('cash-only opening keeps cash identity; AVOID remains closed even with two stages',()=>{
 const r=input('09:30 先看2330 與半導體族群是否同向'),s=r.payload.admin_source_report.ai_strategy_json.canonical_market_state.document.sections;
 s.timeline[1].question='開盤確認TAIEX 現貨、2330 與候選族群是否同向。';
 s.timeline[1].failure_condition='開盤反向跳空超過 1% 或 2330/TAIEX 現貨同步轉弱。';
 assert(!copy(composeDecisionCard(r)).includes('台指期'));
 r.payload.canonical_decision.action='AVOID';const out=copy(composeDecisionCard(r));assert(!out.includes('才開始找機會'));assert(out.includes('不增加曝險'));
});
