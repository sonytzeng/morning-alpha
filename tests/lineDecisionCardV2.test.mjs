import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {composeDecisionCard,decisionCardFlex,linePlainText,ownerV2Copy} from '../src/features/line/decisionCard.ts';
import {lineDecisionFixture} from './helpers/lineDecisionFixture.mjs';
const content = card => card.sections.flatMap(s=>s.lines.map(l=>l.text)).join('\n');
test('canonical direction + action, ordered copy, signed numbers and complete conditions; no delivery',()=>{
 const input=lineDecisionFixture(),before=structuredClone(input),card=composeDecisionCard(input);
 assert.equal(card.headline,'偏多觀察｜先等，不追價');assert.equal(card.deliveryEnabled,false);
 assert.deepEqual(card.sections.map(s=>s.title),['今天怎麼做？','為什麼？','今天先看這些','什麼情況可以開始考慮？','什麼情況今天就不要做？','今天有推薦股票嗎？']);
 assert(content(card).includes('下跌 -0.70%'));assert(content(card).includes('09:00：候選族群多數站上平盤且成交量放大。'));
 assert(content(card).includes('超過 1% 或 台積電（2330）/台指期同步轉弱。'));
 assert(card.sections.every(s=>s.lines.every(l=>l.path)));assert.deepEqual(input,before);
 assert.equal(card.notice,'今日市場判斷以核心市場資料為主，新聞證據較少。');
 assert(!/Atomic|Provider|Revision|DEGRADED|BLOCKED|WAIT|Gate/.test(content(card)));
 for(const [action,expected] of [['ENTER','可以開始找進場機會'],['AVOID','今天先不要增加曝險']]){
  input.payload.canonical_decision.action=action;assert(composeDecisionCard(input).headline.includes(expected));
 }
});
test('unpublished, non-Owner, mixed revision/date, invalid canonical or unknown action fail closed',()=>{
 for(const mutate of [r=>r.tier='vip',r=>r.authenticated=false,r=>r.subscriber_projection.analysisAvailable=false,
  r=>r.subscriber_projection.evidence.status='IDENTITY_MISMATCH',r=>r.revision_id='OTHER',r=>r.report_date='2026-10-06',
  r=>r.payload.admin_source_report.ai_strategy_json.revision_id='OTHER',r=>r.payload.canonical_decision.action='UNKNOWN',
  r=>r.payload.admin_source_report.ai_strategy_json.canonical_market_state.status='INSUFFICIENT_EVIDENCE']){
  const r=lineDecisionFixture();mutate(r);assert.throws(()=>composeDecisionCard(r));
 }
});
test('unknown/missing/long/engineering facts omitted, not fabricated or chopped; reasons max 4, observation max 3',()=>{
 const r=lineDecisionFixture(),s=r.payload.admin_source_report.ai_strategy_json.canonical_market_state.document.sections;
 s.supporting_evidence.push({statement:'沒有來源的故事',evidence_refs:['FAKE']},{statement:'如果'+'長'.repeat(181)+'才進',evidence_refs:['MD001']},
  {statement:'Provider Contract PASS',evidence_refs:['MD001']});
 const c=composeDecisionCard(r);assert(!content(c).includes('故事'));assert(!content(c).includes('…'));assert(!content(c).includes('Provider'));
 assert(c.sections.find(s=>s.title==='為什麼？').lines.length<=4);assert(c.sections.find(s=>s.title==='今天先看這些').lines.length<=3);
 delete s.executive_summary;delete s.timeline;delete s.failure_scenario;
 const missing=composeDecisionCard(r);assert(!missing.sections.some(s=>s.title==='什麼情況可以開始考慮？'));
});
function complete(r,status){r.subscriber_projection.recommendation.status=status;Object.assign(r.payload.recommendation_gate,{status,universe_evaluation_complete:true,screening:{status:'COMPLETE',universe_count:72,evaluated_count:72,rejected:[]}});}
test('NONE requires full V1 evaluation; partial/unknown remains BLOCKED, not no opportunity',()=>{
 const r=lineDecisionFixture();complete(r,'NO_QUALIFIED_OPPORTUNITY');let c=composeDecisionCard(r);
 assert.equal(c.recommendation,'NONE');assert(content(c).includes('今天已完成個股評估'));
 for(const mutation of [g=>g.universe_evaluation_complete=false,g=>g.screening.evaluated_count=71,g=>g.screening.universe_count=0,g=>g.screening.rejected=['MISSING']]){
  const bad=structuredClone(r);mutation(bad.payload.recommendation_gate);c=composeDecisionCard(bad);
  assert.equal(c.recommendation,'BLOCKED');assert(!content(c).includes('今天已完成個股評估'));
 }
});
test('BLOCKED exact stored reason, no invented institutional or consensus diagnosis',()=>{
 const r=lineDecisionFixture(),c=composeDecisionCard(r);assert.equal(c.recommendation,'BLOCKED');
 assert(content(c).includes('原報告未逐項列出缺失資料'));assert(content(c).includes('不是')||content(c).includes('不代表今天市場沒有機會'));
 assert(!content(c).includes('法人'));assert(!content(c).includes('共識'));
 r.payload.recommendation_gate.reason_codes=['UNKNOWN_CODE'];assert(content(composeDecisionCard(r)).includes('沒有可白話對照的詳細原因'));
});
test('formal WATCH separate from READY; qualified V1 identities/reasons/entry/risk/invalidation retained',()=>{
 const r=lineDecisionFixture();complete(r,'PREMARKET_WATCH');assert.equal(composeDecisionCard(r).recommendation,'WATCH');
 complete(r,'QUALIFIED');r.payload.recommendation_gate.eligible=true;r.subscriber_projection.recommendation.available=true;
 r.subscriber_projection.recommendation.items=[{symbol:'2330',name:'台積電',reasons:['同產業成交活絡'],entry_condition:'站穩測試價位且成交量放大',risk:'開盤跳空風險',invalidation_condition:'跌破測試支撐'}];
 const c=composeDecisionCard(r);assert.equal(c.recommendation,'READY');assert(c.sections.some(s=>s.title==='今日正式推薦｜台積電（2330）'));
 for(const s of ['同產業成交活絡','進場條件：','風險：','失效條件：'])assert(content(c).includes(s));
 r.payload.recommendation_gate.eligible=false;assert.equal(composeDecisionCard(r).recommendation,'BLOCKED');
});
test('V2 cannot enter V1 card; near miss is separate, max 3, current selected date only',()=>{
 const r=lineDecisionFixture(),before=composeDecisionCard(r);
 r.payload.v2={status:'READY',symbol:'V2_FAKE'};assert.deepEqual(composeDecisionCard(r),before);
 const candidates=Array.from({length:72},(_,i)=>({symbol:String(2000+i),status:'NONE',blockers:[],rejections:['NEGATIVE_MOMENTUM'],pending:[],evidence:{}}));
 const data={shadow_only:true,promotion_allowed:false,latest:{business_date:r.report_date,candidates}};
 const copy=ownerV2Copy(data,r.report_date);assert.equal(copy.nearMiss.length,3);assert.equal(copy.deliveryEnabled,false);
 assert(copy.banner.includes('尚未對會員發布'));assert.equal(ownerV2Copy(data,'2026-10-06'),null);
 assert.equal(ownerV2Copy({...data,promotion_allowed:true},r.report_date),null);
 assert(!JSON.stringify(decisionCardFlex(before)).includes('2000'));
});
test('one CTA, LINE JSON bound, preview and payload same tree, no external dispatch',()=>{
 const card=composeDecisionCard(lineDecisionFixture()),flex=decisionCardFlex(card),encoded=JSON.stringify(flex);
 assert(Buffer.byteLength(JSON.stringify(flex.contents))<30*1024);assert(flex.altText.length<=400);
 assert.equal(flex.contents.footer.contents.length,1);assert.equal(flex.contents.footer.contents[0].action.uri,'https://morningalphatw.com/report/today');
 for(const s of card.sections)for(const l of s.lines)assert(encoded.includes(l.text));
 assert(!encoded.includes(card.revision));assert(!encoded.includes('PRODUCTION_V1'));assert(!encoded.includes('V2研究'));
 const source=readFileSync('src/features/line/decisionCard.ts','utf8');assert(!/fetch\(|\.invoke\(|\.insert\(/.test(source));
 const ui=readFileSync('src/pages/admin/analysis/LineDecisionPreview.tsx','utf8');assert(ui.includes('get_research_foundation_v1'));assert(ui.includes('if (!active) return'));
 assert(!/\.insert\(|\.update\(|line-daily-push|api\.line\.me/.test(ui));
 const page=readFileSync('src/pages/admin/analysis/page.tsx','utf8');assert(page.indexOf('<LineDecisionPreview')>page.indexOf("state.kind === 'ready'"));
 assert.equal(createHash('sha256').update(readFileSync('supabase/functions/_shared/line-daily-flex-message.mjs')).digest('hex'),
  'ae170ab38e1640c55ed02b93446b94a1911c9f9bf98caf19db5ff58ba84f4f9a');
});
test('literal numeric and logical conditions survive translation',()=>{
 assert.equal(linePlainText('如果 TSM ADR -0.72%，且 TXF 未转強，先不進。'),'如果 台積電 ADR -0.72%，且 台指期 未转強，先不進。');
});
