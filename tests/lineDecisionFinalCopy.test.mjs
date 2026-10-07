import test from 'node:test';
import assert from 'node:assert/strict';
import {composeDecisionCard,decisionCardFlex,ownerV2Copy} from '../src/features/line/decisionCard.ts';
import {lineDecisionFixture} from './helpers/lineDecisionFixture.mjs';
// Deliberately synthetic contract examples. Not retained Production responses.
function fixture(){
 const r=lineDecisionFixture(),state=r.payload.admin_source_report.ai_strategy_json.canonical_market_state,s=state.document.sections;
 s.executive_summary={text:'TSM ADR -0.72% 對電子權值形成壓力；09:30 先看2330 是否相對加權指數抗跌且電子成交量同步，未確認前不追價。',evidence_refs:['MD001']};
 s.supporting_evidence=[{statement:'TSM DOWN -0.72% 台積電 ADR',evidence_refs:['MD001']},
  {statement:'SOX FLAT -0.01% 半導體',evidence_refs:['MD002']},{statement:'NVDA FLAT 0.14% 供應鏈風向',evidence_refs:['MD003']},
  {statement:'2330 FLAT 0.00% 核心驗證股',evidence_refs:['MD001']}];
 return r;
}
const all=c=>c.sections.flatMap(s=>s.lines.map(l=>l.text)).join('\n');
test('copy gives action first, two non-redundant conclusions, three confirmations and one invalidation',()=>{
 const r=fixture(),before=structuredClone(r),c=composeDecisionCard(r),why=c.sections.find(s=>s.title==='為什麼？');
 assert.equal(c.sections[0].lines[0].text,'先等，不追價。');assert.equal(why.lines.length,2);
 assert(all(c).includes('電子權值承壓：台積電 ADR -0.72%'));
 assert(all(c).includes('費半與 NVIDIA 大致持平'));assert(all(c).includes('09:30｜再確認：台積電是否比大盤抗跌、電子成交量是否同步'));
 assert(!/0\.00%|-0\.01%|0\.14%|核心驗證股|供應鏈風向|Provider|Evidence|BLOCKED|Gate/.test(all(c)));
 assert.equal(c.sections.find(s=>s.title==='開盤後只看 3 件事').lines.length,3);
 assert.equal(c.sections.find(s=>s.title==='什麼情況今天先不要做？').lines.length,1);
 assert(all(c).includes('超過 1%，或台積電與台指期同步轉弱'));
 const flex=decisionCardFlex(c);assert(flex.contents.header.contents[0].text.includes(r.report_date));
 assert.deepEqual(r,before);assert.equal(c.recommendationSource,'PRODUCTION_V1');
});
test('flat synthesis requires BOTH explicit FLAT classifications and verified citations',()=>{
 for(const mutate of [s=>s.supporting_evidence[2].statement='NVDA UP 0.14%',s=>s.supporting_evidence[1].evidence_refs=['UNKNOWN']]){
  const r=fixture();mutate(r.payload.admin_source_report.ai_strategy_json.canonical_market_state.document.sections);
  assert(!all(composeDecisionCard(r)).includes('費半與 NVIDIA 大致持平'));
 }
});
test('no invented futures/relative-strength/time and AVOID never becomes entry permission',()=>{
 const r=fixture(),s=r.payload.admin_source_report.ai_strategy_json.canonical_market_state.document.sections;
 s.timeline[1].question='先看2330 與 TAIEX 現貨、候選族群是否同向。';
 s.timeline[1].failure_condition='開盤反向跳空超過 1% 或 2330/TAIEX 現貨同步轉弱。';
 s.executive_summary.text='未確認前不追價。';
 const c=composeDecisionCard(r);assert(!all(c).includes('台指期'));assert(!all(c).includes('比大盤抗跌'));assert(all(c).includes('加權指數'));
 r.payload.canonical_decision.action='AVOID';assert(!all(composeDecisionCard(r)).includes('才開始找機會'));
 s.timeline[1].question='尚未提供確認規則';assert(!composeDecisionCard(r).sections.some(s=>s.title==='開盤後只看 3 件事'));
});
test('Owner forward samples use explicit read model dates, never infer from 72 candidates',()=>{
 const candidates=Array.from({length:72},(_,i)=>({symbol:String(2000+i),status:'NONE',blockers:[],rejections:[],pending:[],evidence:{}}));
 const data={shadow_only:true,promotion_allowed:false,latest:{business_date:'2026-10-07',candidates}};
 assert.equal(ownerV2Copy(data,'2026-10-07').forwardSample,null);
 assert.equal(ownerV2Copy({...data,forward_dates:[]},'2026-10-07').forwardSample,0);
 assert.equal(ownerV2Copy({...data,forward_dates:['2026-10-07','2026-10-07']},'2026-10-07').forwardSample,1);
});
