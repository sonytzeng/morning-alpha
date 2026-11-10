import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {refreshDailyAiFinancials,DAILY_AI_FINANCIAL_URLS as URLS} from '../research/daily-ai-financial-refresh.ts';
import {buildDailyAiPackets} from '../research/daily-ai-packets.ts';
import {bindDailyAiPriceProfile} from '../research/daily-ai-price-profile.ts';
import {calculateDailyAiPricePlan} from '../research/daily-ai-price-calculation.ts';

// Only synthetic local endpoint responses are used. These tests exercise the
// actual refresh, packet builder and profile binder without acquiring data.
const firstAt='2026-11-09T10:00:00Z',secondAt='2026-11-10T10:00:00Z';
const symbols=['2330',...Array.from({length:71},(_,i)=>String(1000+i))];
function baseline(date='2026-11-09'){
 return symbols.map(symbol=>({symbol,company:'合成測試公司'+symbol,cutoff:date+'T09:05:00Z',through:date,next_session:'2026-11-11',
  expected_sessions:[date],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},facts:[],bars:[{
   id:`synthetic-price:${symbol}:${date}`,date,source:'https://www.twse.com.tw/synthetic-test-price',evidence_hash:'a'.repeat(64),
   published_at:null,first_seen_at:date+'T09:05:00Z',available_at:date+'T09:05:00Z',as_of:date+'T09:05:00Z',
   open:100,high:110,low:98,close:date==='2026-11-09'?105:108,volume:1000,amount:105000,session_scope:'SYNTHETIC_COMPLETE_SESSION',
  }]}));
}
function tables(){return {
 [URLS.TWSE_EPS]:[{'出表日期':'1151109','年度':'115','季別':'3','公司代號':'2330','公司名稱':'合成測試公司2330',
  '基本每股盈餘(元)':'10.00','單位':'新臺幣元','來源版本':'original'},
  {'出表日期':'1151109','年度':'115','季別':'3','公司代號':'1000','公司名稱':'合成測試公司1000','基本每股盈餘(元)':'2.00'}],
 [URLS.TWSE_INCOME]:[{'出表日期':'1151109','年度':'115','季別':'3','公司代號':'2330','公司名稱':'合成測試公司2330',
  '營業收入':'1000','營業毛利（毛損）淨額':'400','營業利益（損失）':'250','本期淨利（淨損）':'100'}],
 [URLS.TPEX_EPS]:[],
 [URLS.TWSE_VALUATION]:[{Date:'20261109',Code:'2330',Name:'合成測試公司2330',ClosePrice:'105.00',DividendYield:'2.00',
  DividendYear:'114',PEratio:'10.50',PBratio:'2.50',FiscalYearQuarter:'2026Q3'}],
 [URLS.TPEX_VALUATION]:[],
};}
async function refresh(inputs,at=firstAt,edit=()=>{}){
 const captured=tables();edit(captured);
 return refreshDailyAiFinancials({inputs,businessDate:at.slice(0,10),clock:()=>at,signal:new AbortController().signal,
  fetcher:async url=>{assert(Object.hasOwn(captured,url),'unexpected source');return Response.json(captured[url]);}});
}
const fact=(result,kind='EPS_AS_REPORTED',symbol='2330')=>result.inputs.find(s=>s.symbol===symbol).facts.find(f=>f.kind===kind);
function advanceQuotes(inputs){
 const quotes=baseline('2026-11-10');
 return inputs.map(stock=>({...structuredClone(stock),through:'2026-11-10',expected_sessions:['2026-11-10'],
  bars:quotes.find(q=>q.symbol===stock.symbol).bars,next_session:'2026-11-11'}));
}
const packet=result=>buildDailyAiPackets({inputs:result.inputs,cutoff:result.cutoff,news:[],market:[]}).packets.find(p=>p.symbol==='2330');
function methodProfile(original){
 const cited=original.evidence.find(e=>e.kind==='FINANCIAL'&&JSON.parse(e.content).kind==='EPS_AS_REPORTED').id;
 const template_input={schema:'DAILY_AI_PRICE_CALCULATION_INPUT_V1',symbol:'2330',horizon:'MEDIUM',method_id:'MEDIUM_EPS_PE_SCENARIOS_V1',currency:'TWD',
  cutoff:original.cutoff,data_through:original.data_through,as_of:'2026-11-09T10:01:00Z',expires_at:'2026-11-10T05:30:00Z',
  evidence:original.evidence,quote_evidence_id:original.evidence.find(e=>e.kind==='PRICE').id,
  assumption_basis:{available_at:'2026-11-09T10:00:30Z',description:'Explicit synthetic fixed diluted EPS assumptions; reported basic EPS is source context, never silently converted into a forecast.',evidence_ids:[cited]},
  invalidation:'報告內容、期間、來源或稀釋假設變更時重新建立與審查方法。',
  parameters:{earnings_basis:'FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION',forecast_period:{start:'2027-01-01',end:'2027-12-31'},
   dilution_basis:{description:'Synthetic separately supplied diluted common share assumption for this calculation test only.',evidence_ids:[cited]},
   scenarios:[{name:'conservative',eps:8,pe:10},{name:'base',eps:10,pe:12},{name:'upside',eps:12,pe:14}],
   entry_scenarios:['conservative','base'],margin_of_safety:.2,stop_evidence_ids:[cited]}};
 return {schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',symbol:'2330',horizon:'MEDIUM',
  method_id:template_input.method_id,created_at:'2026-11-09T10:02:00Z',valid_until:'2026-11-20T05:30:00Z',
  revision_note:'Synthetic fixed assumptions exercise persistent financial observations.',template_input};
}
function binding(profile,current){return {profile,packet:current,edition:{id:'b'.repeat(64),evidence_cutoff:current.cutoff,
 prepared_at:'2026-11-10T10:01:00Z',expires_at:'2026-11-11T05:30:00Z',data_through:current.data_through},now:Date.parse('2026-11-10T10:02:00Z')};}

test('identical complete rows preserve original financial observations while recording each new response capture',async()=>{
 const original=baseline(),first=await refresh(original),saved=structuredClone(first.inputs);
 const next=await refresh(first.inputs,secondAt);
 for(const kind of ['EPS_AS_REPORTED','FINANCIAL_AS_REPORTED','VALUATION_AS_REPORTED']){
  assert.deepEqual(fact(next,kind),fact(first,kind));
  assert.equal(fact(next,kind).first_seen_at,firstAt);assert.equal(fact(next,kind).available_at,firstAt);
 }
 assert.equal(next.proof.additions.length,0);assert.equal(next.removed.length,0);
 assert.equal(next.proof.responses.length,5);assert(next.proof.responses.every(r=>r.received_at===secondAt));
 assert(next.proof.responses.every(r=>r.state==='CAPTURED'&&r.response_text!==null));
 assert.deepEqual(first.inputs,saved);assert(original.every(s=>s.facts.length===0));
});

test('another company changing the bulk response does not redate an unchanged company observation',async()=>{
 const first=await refresh(baseline());
 const next=await refresh(first.inputs,secondAt,t=>{t[URLS.TWSE_EPS][1]['基本每股盈餘(元)']='3.00';});
 assert.notEqual(first.proof.responses[0].source_sha256,next.proof.responses[0].source_sha256);
 assert.deepEqual(fact(next),fact(first));
 assert.notEqual(fact(next,'EPS_AS_REPORTED','1000').id,fact(first,'EPS_AS_REPORTED','1000').id);
 assert.equal(next.proof.additions.length,1);assert.equal(next.proof.additions[0].symbol,'1000');
});

test('changes anywhere in a company raw row are new observations even when the numeric EPS is unchanged',async()=>{
 const first=await refresh(baseline()),old=fact(first);
 for(const [field,value] of [['來源版本','restated'],['單位','另一單位'],['出表日期','1151110'],['公司名稱','公司名稱修正']]){
  const next=await refresh(first.inputs,secondAt,t=>{t[URLS.TWSE_EPS][0][field]=value;});
  const revised=fact(next);assert.notEqual(revised.id,old.id,field);assert.notEqual(revised.source_locator.row_sha256,old.source_locator.row_sha256,field);
  assert.equal(revised.values.value,old.values.value);assert.equal(revised.available_at,secondAt);
  assert(next.removed.some(f=>f.id===old.id));assert.equal(next.proof.additions.filter(a=>a.symbol==='2330').length,1);
 }
});

test('payload, quarter and source changes create separately dated observations without silently changing an older quarter',async()=>{
 const first=await refresh(baseline()),old=fact(first);
 const values=await refresh(first.inputs,secondAt,t=>{t[URLS.TWSE_EPS][0]['基本每股盈餘(元)']='11.00';});
 assert.notEqual(fact(values).id,old.id);assert.equal(fact(values).values.value,11);
 const quarter=await refresh(first.inputs,secondAt,t=>{t[URLS.TWSE_EPS][0]['季別']='2';});
 const eps=quarter.inputs.find(s=>s.symbol==='2330').facts.filter(f=>f.kind==='EPS_AS_REPORTED');
 assert.equal(eps.length,2);assert.deepEqual(eps.find(f=>f.period==='2026-Q3'),old);
 assert.equal(eps.find(f=>f.period==='2026-Q2').available_at,secondAt);
 const source=await refresh(first.inputs,secondAt,t=>{t[URLS.TWSE_EPS]=t[URLS.TWSE_EPS].filter(r=>r['公司代號']!=='2330');
  t[URLS.TPEX_EPS]=[{Date:'1151109',Year:'115','季別':'3',SecuritiesCompanyCode:'2330',CompanyName:'合成測試公司2330','基本每股盈餘':'10.00'}];});
 const fromTpex=source.inputs.find(s=>s.symbol==='2330').facts.find(f=>f.source===URLS.TPEX_EPS);
 assert(fromTpex);assert.notEqual(fromTpex.id,old.id);assert.equal(fromTpex.available_at,secondAt);
});

test('an older mapping unit or version cannot be retained merely because its source row hash matches',async()=>{
 const first=await refresh(baseline());
 for(const edit of [f=>{f.values.unit='LEGACY_UNIT';},f=>{f.normalizer_version='LEGACY_MAPPING_V0';}]){
  const changed=structuredClone(first.inputs),old=changed[0].facts.find(f=>f.kind==='EPS_AS_REPORTED');edit(old);
  const {id,evidence_hash,...body}=old;void id;void evidence_hash;
  old.evidence_hash=await snapshotHash(body);old.id=`official-open-api:2330:EPS_AS_REPORTED:2026-Q3:${old.evidence_hash}`;
  const next=await refresh(changed,secondAt),fresh=fact(next);
  assert.notEqual(fresh.id,old.id);assert.equal(fresh.values.unit,'SOURCE_REPORTED_YUAN_PER_SHARE');assert(!Object.hasOwn(fresh,'normalizer_version'));
  assert.equal(fresh.first_seen_at,secondAt);assert(next.removed.some(f=>f.id===old.id));
 }
});

test('the actual refresh and packet builder keep a fixed profile usable the next day; a revised financial row blocks it',async()=>{
 const first=await refresh(baseline()),original=packet(first),profile=methodProfile(original);
 const next=await refresh(advanceQuotes(first.inputs),secondAt),current=packet(next);
 const bound=await bindDailyAiPriceProfile(binding(profile,current));assert.equal(bound.status,'BOUND_REVIEW_REQUIRED');
 assert.deepEqual(bound.calculation_input.parameters,profile.template_input.parameters);
 const calculated=await calculateDailyAiPricePlan(bound.calculation_input,Date.parse('2026-11-10T10:02:00Z'));
 assert.deepEqual(calculated.entry_range,[64,96]);assert.equal(calculated.trace.quote,108);assert.equal(calculated.buy_ready,false);
 assert.equal(calculated.review,null);assert.equal(calculated.status,'CALCULATED_REVIEW_REQUIRED');
 const originalId=profile.template_input.assumption_basis.evidence_ids[0];
 assert.equal(canonical(current.evidence.find(e=>e.id===originalId)),canonical(original.evidence.find(e=>e.id===originalId)));
 const revised=await refresh(advanceQuotes(first.inputs),secondAt,t=>{t[URLS.TWSE_EPS][0]['基本每股盈餘(元)']='11.00';});
 const blocked=await bindDailyAiPriceProfile(binding(profile,packet(revised)));
 assert.equal(blocked.status,'METHOD_UPDATE_REQUIRED');assert.equal(blocked.calculation_input,null);
 assert(blocked.missing.some(m=>m.code==='PROFILE_DEPENDENCY_MISSING'));
});
