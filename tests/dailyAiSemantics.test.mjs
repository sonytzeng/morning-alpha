import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStockAnalysisContext,validateStockAnalysisClaim,validateStockAnalysisCondition} from '../research/daily-ai-semantics.ts';

const evidence=(id,kind,period,values,basis='MONTHLY')=>({id,symbol:'1504',kind:'FINANCIAL',source:'https://openapi.twse.com.tw/',published_at:null,
 available_at:'2026-10-31T03:00:00Z',content:JSON.stringify({kind,period,basis,values})});
const packet=()=>({symbol:'1504',company:'測試公司',cutoff:'2026-10-31T04:00:00Z',evidence:[
 evidence('r08','REVENUE','2023-08',{yoy_percent:3}),evidence('r09','REVENUE','2023-09',{yoy_percent:4}),evidence('r10','REVENUE','2023-10',{yoy_percent:5}),
 evidence('eps','EPS_AS_REPORTED','2026-Q2',{value:2.5},'AS_REPORTED'),
 {id:'news',symbol:'1504',kind:'NEWS',source:'https://example.test/',published_at:'2026-10-30T00:00:00Z',available_at:'2026-10-31T03:00:00Z',content:'測試新聞'},
 {id:'macro',symbol:null,kind:'MARKET',source:'https://home.treasury.gov/',published_at:null,available_at:'2026-10-31T03:00:00Z',content:'測試利率背景'},
 ]});
test('latest revenue and recent-three table use actual reported periods without replacing years',()=>{
 const p=packet(),before=JSON.stringify(p),c=buildStockAnalysisContext(p);
 assert.equal(c.latest_revenue_period,'2023-10');assert.deepEqual(c.recent_revenue.map(r=>r.period),['2023-10','2023-09','2023-08']);
 assert.equal(c.recent_revenue[0].values.yoy_percent,5);assert.equal(c.recent_revenue[0].evidence_id,'r10');assert.equal(c.financial_evidence_periods.find(r=>r.evidence_id==='eps').period,'2026-Q2');
 assert.equal(JSON.stringify(p),before);c.recent_revenue[0].values.yoy_percent=999;assert.equal(JSON.parse(p.evidence[2].content).values.yoy_percent,5);
 const empty=buildStockAnalysisContext({...p,evidence:p.evidence.filter(e=>e.kind!=='FINANCIAL')});assert.equal(empty.latest_revenue_period,null);assert.deepEqual(empty.recent_revenue,[]);
});
test('duplicate revenue periods are exposed as conflicts while the three actual months remain distinct',()=>{
 const p=packet();p.evidence.push(evidence('r10-other','REVENUE','2023-10',{yoy_percent:-5}));
 const c=buildStockAnalysisContext(p);assert.equal(c.recent_revenue.length,3);assert.equal(c.revenue_period_conflicts.length,1);assert.equal(c.revenue_period_conflicts[0].observations.length,2);
});
test('wrong year and uncited financial periods reject even when all citation IDs are real',()=>{
 for(const text of ['2026-10營收年增5%。','2026年10月營收年增5%。','2023-09營收年增4%。']){
  assert.throws(()=>validateStockAnalysisClaim(packet(),{text,evidence_ids:['r10']}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 }
});
test('every financial numeric sentence needs its actual period, including repeated sentences',()=>{
 for(const text of ['營收年增5%。','營收年增百分之五。','每股盈餘二點五元。','2023-10營收年增5%。EPS為2.5元。','2026-Q2 EPS為2.5元；毛利率為20%。']){
  assert.throws(()=>validateStockAnalysisClaim(packet(),{text,evidence_ids:['r10','eps']}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 }
 assert.doesNotThrow(()=>validateStockAnalysisClaim(packet(),{text:'2023-10營收年增5%。2026-Q2 EPS為2.5元。',evidence_ids:['r10','eps']}));
 assert.doesNotThrow(()=>validateStockAnalysisClaim(packet(),{text:'2023年10月營收年增5%，後續需核對新公告。2026年第2季EPS為2.5元。',evidence_ids:['r10','eps']}));
});
test('reported historical actuals cannot be described as forecasts',()=>{
 const p=packet();p.evidence.push(evidence('r11','REVENUE','2023-11',{yoy_percent:6}));
 for(const text of ['預估2023-11營收年增6%。','2023-11營收預計年增6%。','2023年11月營收預測年增6%。']){
  assert.throws(()=>validateStockAnalysisClaim(p,{text,evidence_ids:['r11']}),/AI_ANALYSIS_REPORTED_FACT_AS_FORECAST/);
 }
 assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text:'2023-11營收年增6%，是留存實績。',evidence_ids:['r11']}));
 assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text:'2023-11營收年增6%，不是未來預測。',evidence_ids:['r11']}));
 assert.throws(()=>validateStockAnalysisClaim(p,{text:'2023-11營收不是預測，但預估年增6%。',evidence_ids:['r11']}),/AI_ANALYSIS_REPORTED_FACT_AS_FORECAST/);
});
test('news dates, stock codes and macro observations do not require company-financial periods',()=>{
 for(const claim of [{text:'1504將在2026-11-02舉行法說會。',evidence_ids:['news']},{text:'1504公司預計公告營收，身分仍需確認。',evidence_ids:['news']},
  {text:'美債殖利率為4.94%，僅作市場背景。',evidence_ids:['macro']},{text:'2026-10-30盤後期貨下跌1.91%。',evidence_ids:['macro']}]){
  assert.doesNotThrow(()=>validateStockAnalysisClaim(packet(),claim));
 }
});
test('numeric trading conditions are blocked in both digit forms and Chinese price wording',()=>{
 for(const text of ['突破1100元後確認','跌破1050時失效','站上１１００元','上看一千一百元','跌破一千零五十','等待11月2日公告']){
  assert.throws(()=>validateStockAnalysisCondition(text),/AI_ANALYSIS_CONDITION_PRICE/);
 }
 for(const text of ['等待下一次官方公告確認營運改善','若新公告否定獲利假設就重新評估','觀察成交參與是否持續'])assert.doesNotThrow(()=>validateStockAnalysisCondition(text));
});
