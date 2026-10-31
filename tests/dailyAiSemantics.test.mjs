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
test('daily AS_REPORTED valuation keeps its observation date without changing revenue periods',()=>{
 const p=packet();p.evidence.push(evidence('valuation','VALUATION_AS_REPORTED','2026-10-30',{pe_ratio:27,pb_ratio:3.1,dividend_yield_percent:2,
  financial_year_quarter_as_reported:'2026Q2',dividend_year_as_reported:'114'},'AS_REPORTED'));
 const c=buildStockAnalysisContext(p);assert.equal(c.latest_revenue_period,'2023-10');assert.deepEqual(c.recent_revenue.map(r=>r.period),['2023-10','2023-09','2023-08']);
 assert.equal(c.financial_evidence_periods.find(r=>r.evidence_id==='valuation').period,'2026-10-30');
 for(const text of ['2026-10-30本益比為27倍，股價淨值比為3.1倍，殖利率為2%。','2026年10月30日本益比為27倍。','2026-10-30 PB為3.1，屬原始觀察。']){
  assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text,evidence_ids:['valuation']}));
 }
 for(const text of ['2026-10-31本益比為27倍。','2026年10月31日殖利率為2%。','2026-Q2股價淨值比為3.1倍。',
  '2026-10-31 PB為3.1。','本益比為27倍。','PB為3.1。','殖利率為2%。']){
  assert.throws(()=>validateStockAnalysisClaim(p,{text,evidence_ids:['valuation']}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 }
 assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text:'美債殖利率為4.94%，僅作市場背景。',evidence_ids:['macro']}));
});
function mediatekOfficialReport(){
 // Exact title and bounded passages from the retained official 2454 MOPS row;
 // this semantic fixture is not a new acquisition or a publication proof.
 const receipt='2026-10-31T03:00:00Z',provider='TWSE_MOPS_OPEN_DATA';
 const report={schema:'DAILY_AI_OFFICIAL_NEWS_FACT_V1',provider,coverage:'OFFICIAL_ANNOUNCEMENT_EXCERPT',title:'本公司2026年第3季合併財務報告',
  excerpt:'聯發科技公佈2026年第三季合併財務報告\n本季合併本期淨利為新台幣281億9仟9佰萬元，較前季增加14.6%，較去年同期\n增加10.8%；每股盈餘為新台幣17.50元\n2026年第四季營運展望\n合併營收: 約新台幣 2,101億 ~ 2,218 億元',
  source_received_at:receipt,source_metadata:{company_code:'2454',company_name:'聯發科',publication_timezone:'NOT_DECLARED_BY_SOURCE',window_basis:'SOURCE_DECLARED_DAY_COORDINATE_NOT_EXACT_PUBLICATION_TIME'}};
 const news={id:'official-news:'+provider+':bc7ef105538f4fd14f10ede5299bc3c7a9b359997563e8734eea7d9a5caa8b94',symbol:'2454',kind:'NEWS',
  source:'https://openapi.twse.com.tw/v1/opendata/t187ap04_L',published_at:null,available_at:receipt,first_seen_at:receipt,as_of:receipt,time_basis:'OBSERVED_AFTER_RECEIPT',content:JSON.stringify(report)};
 const revenue={...evidence('mediatek-r09','REVENUE','2026-09',{yoy_percent:1.9684131750496783}),symbol:'2454'};
 return {symbol:'2454',company:'聯發科',cutoff:'2026-10-31T04:00:00Z',evidence:[news,revenue]};
}
test('cited official MOPS report actual quarters coexist with monthly financial periods without promoting excerpt guidance',()=>{
 const p=mediatekOfficialReport(),ids=p.evidence.map(e=>e.id),before=JSON.stringify(p);
 const actual='2026年第3季每股盈餘為17.50元，2026年9月營收年增約1.97%。';
 assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text:actual,evidence_ids:ids}));
 assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text:'2026-Q3每股盈餘為17.50元。',evidence_ids:[ids[0]]}));
 assert.throws(()=>validateStockAnalysisClaim(p,{text:actual,evidence_ids:[ids[1]]}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 assert.throws(()=>validateStockAnalysisClaim(p,{text:'2026年第4季營收為2101億元。',evidence_ids:ids}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 assert.throws(()=>validateStockAnalysisClaim(p,{text:'預估2026年第3季每股盈餘為17.50元。',evidence_ids:[ids[0]]}),/AI_ANALYSIS_REPORTED_FACT_AS_FORECAST/);
 assert.equal(JSON.stringify(p),before);
});
test('quarter admission requires cited issuer identity, fixed source, actual report title and a completed quarter',()=>{
 for(const change of [
  p=>{p.evidence[0].symbol='2330';},
  p=>{p.evidence[0].source='https://example.test/mops';},
  p=>{const c=JSON.parse(p.evidence[0].content);c.source_metadata.company_code='2330';p.evidence[0].content=JSON.stringify(c);},
  p=>{const c=JSON.parse(p.evidence[0].content);c.provider='GNEWS';p.evidence[0].content=JSON.stringify(c);},
  p=>{const c=JSON.parse(p.evidence[0].content);c.schema='UNVERIFIED_NEWS';p.evidence[0].content=JSON.stringify(c);},
  p=>{const c=JSON.parse(p.evidence[0].content);c.title='2026年第3季營運展望';p.evidence[0].content=JSON.stringify(c);},
  p=>{const c=JSON.parse(p.evidence[0].content);c.title='子公司2026年第3季合併財務報告';p.evidence[0].content=JSON.stringify(c);},
  p=>{const c=JSON.parse(p.evidence[0].content);c.title='本公司2026年第4季合併財務報告';p.evidence[0].content=JSON.stringify(c);},
  p=>{const c=JSON.parse(p.evidence[0].content);c.title='本公司2115年第3季合併財務報告';p.evidence[0].content=JSON.stringify(c);},
 ]){
  const p=mediatekOfficialReport();change(p);assert.throws(()=>validateStockAnalysisClaim(p,{text:'2026年第3季每股盈餘為17.50元。',evidence_ids:p.evidence.map(e=>e.id)}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 }
 const future=mediatekOfficialReport(),futureContent=JSON.parse(future.evidence[0].content);futureContent.title='本公司2026年第4季合併財務報告';future.evidence[0].content=JSON.stringify(futureContent);
 assert.throws(()=>validateStockAnalysisClaim(future,{text:'2026年第4季每股盈餘為17.50元。',evidence_ids:future.evidence.map(e=>e.id)}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 const p=mediatekOfficialReport(),c=JSON.parse(p.evidence[0].content);c.title='公告本公司115年第3季合併財務報告業經董事會決議通過';
 c.excerpt='3.財務報告或年度自結財務資訊報導期間\n起訖日期(XXX/XX/XX~XXX/XX/XX):115/01/01~115/09/30\n10.1月1日累計至本期止基本每股盈餘(損失) (元):47.94';p.evidence[0].content=JSON.stringify(c);
 assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text:'2026年第3季累計每股盈餘為47.94元。',evidence_ids:p.evidence.map(e=>e.id)}));
});

test('official guidance quarter is admitted only as company guidance in its own clause',()=>{
 const p=mediatekOfficialReport(),ids=p.evidence.map(e=>e.id);
 assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text:'2026-Q3每股盈餘為17.50元。2026-Q4公司營收展望為2101至2218億元。',evidence_ids:ids}));
 assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text:'公司公告2026-Q3每股盈餘17.50元，並提供營收擴張的2026-Q4展望。',evidence_ids:ids}));
 for(const text of ['2026-Q4營收為2101億元。','2026-Q4公司已報營收展望為2101億元。',
  '2027-Q1公司營收展望為2101億元。','2026-Q4營收為2101億元，公司展望仍待核對。']){
  assert.throws(()=>validateStockAnalysisClaim(p,{text,evidence_ids:ids}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 }
 assert.throws(()=>validateStockAnalysisClaim(p,{text:'2026-Q4公司營收展望為2101億元。',evidence_ids:[ids[1]]}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 const c=JSON.parse(p.evidence[0].content);c.excerpt=c.excerpt.replace('2026年第四季營運展望','媒體預期第四季');p.evidence[0].content=JSON.stringify(c);
 assert.throws(()=>validateStockAnalysisClaim(p,{text:'2026-Q4公司營收展望為2101億元。',evidence_ids:ids}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
});

test('cumulative source endpoints require an explicit range and cumulative label without becoming monthly actuals',()=>{
 const p=mediatekOfficialReport(),c=JSON.parse(p.evidence[0].content);
 c.excerpt='3.財務報告或年度自結財務資訊報導期間\n起訖日期(XXX/XX/XX~XXX/XX/XX):115/01/01~115/09/30\n10.1月1日累計至本期止基本每股盈餘(損失) (元):47.94';p.evidence[0].content=JSON.stringify(c);
 const ids=[p.evidence[0].id];
 assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text:'2026-Q3公告列示2026-01至2026-09累計每股盈餘47.94元。',evidence_ids:ids}));
 for(const text of ['2026-01每股盈餘47.94元。','2026-01至2026-09每股盈餘47.94元。',
  '2026-02至2026-09累計每股盈餘47.94元。','2026-01累計每股盈餘47.94元。']){
  assert.throws(()=>validateStockAnalysisClaim(p,{text,evidence_ids:ids}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 }
 c.excerpt=c.excerpt.replace('115/09/30','115/12/31');p.evidence[0].content=JSON.stringify(c);
 assert.throws(()=>validateStockAnalysisClaim(p,{text:'2026-01至2026-12累計每股盈餘47.94元。',evidence_ids:ids}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
});

test('deployed valuation month label still requires its exact observed day in the same sentence',()=>{
 const p=packet();p.evidence.push(evidence('v','VALUATION_AS_REPORTED','2026-10-30',{pe:25.53},'AS_REPORTED'));
 assert.doesNotThrow(()=>validateStockAnalysisClaim(p,{text:'2026-10估值資料於2026-10-30列本益比25.53倍。',evidence_ids:['v']}));
 for(const text of ['2026-10估值快照列本益比25.53倍。','2026-10營收年增25.53%。2026-10-30本益比25.53倍。',
  '2026-09估值資料於2026-10-30列本益比25.53倍。']){
  assert.throws(()=>validateStockAnalysisClaim(p,{text,evidence_ids:['v']}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 }
});

test('guidance and cumulative admission cannot bypass official report identity and receipt checks',()=>{
 for(const mutate of [p=>{p.evidence[0].symbol='2330';},p=>{p.evidence[0].source='https://example.test';},
  p=>{p.evidence[0].first_seen_at='2026-10-30T03:00:00Z';},
  p=>{const c=JSON.parse(p.evidence[0].content);c.source_metadata.company_code='2330';p.evidence[0].content=JSON.stringify(c);}]){
  const p=mediatekOfficialReport();mutate(p);
  assert.throws(()=>validateStockAnalysisClaim(p,{text:'2026-Q4公司營收展望為2101億元。',evidence_ids:p.evidence.map(e=>e.id)}),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 }
});
