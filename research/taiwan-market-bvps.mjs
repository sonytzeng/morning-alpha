/** Reported MOPS book value per share and current peer price/book research.
 * No par value, share count, EPS, official multiple or fair value is inferred.
 * A branded immutable context validates source inputs once for the whole run.
 */
import { marketSnapshotHash } from './taiwan-market-universe.mjs';
import { verifiedFinancialRecord, annualFinancialInputs } from './taiwan-market-financial-inputs.mjs';
import { calculateTaiwanLongPeerReference } from './taiwan-market-long-price.mjs';
import { officialNumber } from './taiwan-market-facts.mjs';
import { createTaiwanActionReplayEvidence, TAIWAN_ACTION_KINDS } from './taiwan-market-actions.mjs';
import { validObservationTime, compareTime, sourceSafe } from '../src/features/vnext/contracts.ts';
import { coveredCalendarDate, isMarketTradingDate, previousMarketTradingDate, MARKET_CALENDAR_VERSION } from '../supabase/functions/_shared/market-session-contract.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const copy=v=>JSON.parse(JSON.stringify(v));
const fail=code=>{throw Error('TAIWAN_BVPS_'+code);};
function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}return v;}
const contexts=new WeakMap();
export const TAIWAN_REPORTED_BVPS_POLICY=freeze({version:'TAIWAN_REPORTED_BVPS_PEER_V1',market:'TPEX',
 instruments:['ORDINARY_COMPANY_EQUITY'],minimum_other_peers:5,quantiles:[0.25,0.5,0.75],
 quantile_rule:'R7_LINEAR_INTERPOLATION_AT_(N_MINUS_1)_TIMES_P',maximum_statement_age_days:180,
 cohort:'SAME_MARKET_INDUSTRY_CURRENT_QUOTE_DATE_AND_EXPLICIT_BALANCE_PERIOD',leave_one_out:true,
 long_quality:'EXISTING_LONG_ANNUAL_QUALITY_ELIGIBLE_REQUIRED_FOR_ISSUER_AND_PEERS',long_excluded_industry_codes:['17'],
 share_change_policy:'UNADJUSTED_STOCK_DIVIDEND_SPLIT_RIGHTS_CAPITAL_REDUCTION_AFTER_BALANCE_END_EXCLUDES',
 cash_dividend_policy:'PRESERVE_REPORTED_BVPS_NO_CASH_SUBTRACTION_NOT_CURRENT_BOOK_VALUE',rounding:'NONE_RESEARCH_VALUES_NOT_ORDER_TICKS',
 methodology_approved:false,performance_validation:'NOT_ESTABLISHED'});
export const MOPS_REPORTED_BVPS_UNIT_PROOF=freeze({schema:'MOPS_REPORTED_BVPS_UNIT_PROOF_V1',field_name:'每股參考淨值',
 table_currency:'TWD',table_amount_unit:'TWD_THOUSANDS',per_share_unit:'TWD_PER_SHARE',raw_value_multiplier:1,
 basis:'OFFICIAL_PB_DEFINITION_AND_EXPLICIT_MOPS_PER_SHARE_FIELD',definition_urls:[
  'https://www.tpex.org.tw/web/stock/aftertrading/peratio_analysis/pera_result.php?o=htm',
  'https://www.twse.com.tw/zh/trading/historical/bwibbu-day.html','https://mopsfin.twse.com.tw/'],
 shares_or_par_value_inferred:false});
const unitHash=marketSnapshotHash(MOPS_REPORTED_BVPS_UNIT_PROOF),policyHash=marketSnapshotHash(TAIWAN_REPORTED_BVPS_POLICY);
const shareKinds=new Set(['STOCK_DIVIDEND','SPLIT','RIGHTS','CAPITAL_REDUCTION']);
function completedDate(cutoff){const d=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10);
 return !coveredCalendarDate('TW',d)?null:isMarketTradingDate('TW',d)&&compareTime(cutoff,d+'T17:05:00+08:00')>=0?d:previousMarketTradingDate('TW',d);}
function periodEnd(period){if(!/^20\d\dQ[1-4]$/.test(period??''))return null;return new Date(Date.UTC(Number(period.slice(0,4)),Number(period.at(-1))*3,0)).toISOString().slice(0,10);}
function capture(v,cutoff){if(!object(v)||!hash(v.capture_id)||!hash(v.source_sha256)||!hash(v.source_row_hash)
 ||!sourceSafe(v.source_url)||typeof v.source_id!=='string'||!v.source_id||!Number.isSafeInteger(v.source_bytes)||v.source_bytes<1||v.source_bytes>16000000
 ||!Number.isSafeInteger(v.row_index)||v.row_index<0||!Array.isArray(v.row_path)||!v.row_path.length||v.row_path.length>16
 ||v.row_path.some(x=>typeof x!=='string'&&!(Number.isSafeInteger(x)&&x>=0))||typeof v.symbol_field!=='string'||!v.symbol_field
 ||!validObservationTime(v.received_at)||compareTime(v.received_at,cutoff)>0)fail('CAPTURE_REFERENCE');
 if(v.capture_id!==marketSnapshotHash({source_id:v.source_id,url:v.source_url,source_sha256:v.source_sha256,received_at:v.received_at}))fail('CAPTURE_ID');
 return v;}
function identity(s){if(!object(s)||!object(s.company)||!Array.isArray(s.observations)||!['TWSE','TPEX','EMERGING'].includes(s.company.market)
 ||!/^\d{4,6}$/.test(s.company.symbol)||s.security_id!==s.company.market+':'+s.company.symbol||typeof s.company.industry_code!=='string'||!s.company.industry_code)fail('SECURITY_IDENTITY');}
function quoteFor(s,cutoff,date){const rows=s.observations.filter(o=>o.family==='PRICE'&&!o.invalidated);
 for(const r of rows)if(!validObservationTime(r.available_at)||compareTime(r.available_at,cutoff)>0)fail('QUOTE_TIME');
 rows.sort((a,b)=>(b.date??'').localeCompare(a.date??'')||compareTime(b.available_at,a.available_at));const q=rows[0];
 if(!q||rows.some((r,i)=>i>0&&r.date===q.date))return {reason:'UNAMBIGUOUS_CURRENT_COMPLETED_SESSION_CLOSE_REQUIRED'};
 if(q.market!==s.company.market||q.symbol!==s.company.symbol||q.currency!=='TWD'||q.kind!=='DAILY_OHLCVA'||q.date!==date
  ||!q.valid_trade||!finite(q.close)||q.close<=0||compareTime(q.available_at,date+'T13:30:00+08:00')<0)return {reason:'CURRENT_COMPLETED_SESSION_TWD_CLOSE_REQUIRED'};
 const c=capture(q.source_capture,cutoff);if(q.available_at!==c.received_at)fail('QUOTE_RECEIPT_BINDING');
 const native=c.source_id==='tpex_prices'&&c.source_url==='https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
 const daily=c.source_id==='TPEX_DAILY_'+date.replaceAll('-','')&&c.source_url==='https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date='+date.replaceAll('-','/')+'&response=json';
 if(!native&&!daily)return {reason:'OFFICIAL_TPEX_DAILY_CLOSE_SOURCE_REQUIRED'};return {quote:q};}
function actionFor(row,period_end,date,cutoff){
 if(!row||row.schema!=='TAIWAN_MARKET_ACTION_COVERAGE_V1'||row.complete!==true||row.market!=='TPEX'
  ||row.from>period_end||row.through<date||!validObservationTime(row.available_at)||compareTime(row.available_at,cutoff)>0
  ||TAIWAN_ACTION_KINDS.some(k=>!row.coverage_kinds.includes(k)))return {reason:'COMPLETE_ACTION_COVERAGE_FROM_BALANCE_END_REQUIRED'};
 // The adapter's private context accepts only rows constructed from original
 // official response bytes, never an invented complete:true JSON object.
 const evidence=createTaiwanActionReplayEvidence(row).map(e=>({...e,id:'market-'+e.evidence_hash.slice(0,40)}));
 const selected=evidence.map(e=>({e,row:JSON.parse(e.content)})).filter(x=>x.row.through>=period_end&&x.row.from<=date).sort((a,b)=>a.row.from.localeCompare(b.row.from));
 let next=period_end;for(const {row:r}of selected){if(!r.complete||r.from>next||r.available_at!==row.available_at)fail('ACTION_PROOF_GAP');
  if(r.through>=next)next=new Date(Date.parse(r.through+'T00:00:00Z')+86400000).toISOString().slice(0,10);}
 if(next<=date)return {reason:'COMPLETE_ACTION_COVERAGE_FROM_BALANCE_END_REQUIRED'};
 const events=row.events.filter(e=>e.effective_date>period_end&&e.effective_date<=date);
 if(events.some(e=>e.classification!=='CLASSIFIED'||!TAIWAN_ACTION_KINDS.includes(e.kind)))return {reason:'UNCLASSIFIED_ACTION_AFTER_BALANCE_END'};
 const eventValue=e=>({event_id:e.event_id,effective_date:e.effective_date,source_capture:capture(e.source_capture,cutoff)});
 const proof={coverage_hashes:selected.map(x=>x.row.coverage_hash),window_from:period_end,window_through:date,available_at:row.available_at,
  coverage_evidence:selected.map(x=>x.e),cash_dividend_events:events.filter(e=>e.kind==='CASH_DIVIDEND').map(eventValue),
  share_change_events:events.filter(e=>shareKinds.has(e.kind)).map(e=>({...eventValue(e),kind:e.kind}))};
 return {proof,reason:proof.share_change_events.length?'UNADJUSTED_SHARE_CHANGE_AFTER_BALANCE_END':null};}
function qualityFor(value,security,financialByCapture,financialRows,cutoff){if(value===undefined||value===null)return {value:null,eligible:false,hash:null};
 const sid=security.security_id;
 if(!object(value)||typeof value.eligible!=='boolean'||!Array.isArray(value.annuals)||!Array.isArray(value.reasons))fail('ANNUAL_QUALITY_SHAPE');
 if(value.eligible){const year=Number(new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,4)),years=[year-3,year-2,year-1];
  if(value.reasons.length||value.annuals.length!==3||value.annuals.some((a,i)=>a.year!==years[i]))fail('ANNUAL_QUALITY_PERIODS');
  for(const a of value.annuals)for(const family of ['income','balance','cashflow']){const c=capture(a.source_captures?.[family],cutoff);
   const row=financialByCapture.get(c.capture_id+':'+c.source_row_hash);
   if(!row||row.security_id!==sid||row.period!==a.year+'Q4'||row.family!==family.toUpperCase()||marketSnapshotHash(row.source_capture)!==marketSnapshotHash(c))fail('ANNUAL_QUALITY_SOURCE_BINDING');}
  // Reuse the existing quality method with this issuer's source-bound records.
  // The singleton has no valuation observations: only its annual quality is used.
  // This prevents a caller from changing eligible or profit while retaining valid
  // source references, without adding a second set of financial thresholds.
  const annual_metrics=new Map([[sid,annualFinancialInputs(financialRows,cutoff).metrics]]);
  const expected=calculateTaiwanLongPeerReference({security_id:sid,securities:[{...security,observations:[]}],annual_metrics,cutoff}).issuer_quality;
  if(marketSnapshotHash(value)!==marketSnapshotHash(expected))fail('ANNUAL_QUALITY_VALUES_BINDING');}
 return {value,eligible:value.eligible,hash:marketSnapshotHash(value)};}

export function createTaiwanReportedBvpsContext({securities,financial_rows,corporate_actions,cutoff,expected_quote_date=undefined,annual_quality=new Map()}){
 if(!validObservationTime(cutoff)||!Array.isArray(securities)||!securities.length||securities.length>10000||!Array.isArray(financial_rows)||financial_rows.length>200000
  ||!(annual_quality instanceof Map))fail('CONTEXT_INPUT');
 const date=completedDate(cutoff);if(expected_quote_date!==undefined&&date!==expected_quote_date)fail('EXPECTED_SESSION_MISMATCH');
 if(corporate_actions!==null&&corporate_actions!==undefined){const {coverage_set_hash,...body}=corporate_actions;
  if(corporate_actions.schema!=='TAIWAN_MARKET_ACTION_COVERAGE_SET_V1'||corporate_actions.cutoff!==cutoff||coverage_set_hash!==marketSnapshotHash(body))fail('ACTION_SET_BINDING');}
 const ids=new Set(),companies=new Map(),balances=new Map(),financialByCapture=new Map(),financialBySecurity=new Map();
 for(const s of securities){identity(s);if(ids.has(s.security_id))fail('DUPLICATE_SECURITY');ids.add(s.security_id);
  companies.set(s.security_id,{security_id:s.security_id,company:copy(s.company),observations:s.company.market==='TPEX'?copy(s.observations.filter(o=>o.family==='PRICE')):[]});}
 for(const original of financial_rows){if(original?.market!=='TPEX'||!ids.has(original.security_id))continue;
  const row=copy(original);if(!verifiedFinancialRecord(row))fail('VERIFIED_FINANCIAL_RECORD_REQUIRED');
  if(!validObservationTime(row.available_at)||compareTime(row.available_at,cutoff)>0)fail('FINANCIAL_AFTER_CUTOFF');capture(row.source_capture,cutoff);
  const key=row.source_capture.capture_id+':'+row.source_capture.source_row_hash,prior=financialByCapture.get(key);
  if(prior&&prior.record_hash!==row.record_hash)fail('CONFLICTING_FINANCIAL_ROW');financialByCapture.set(key,freeze(row));
  const issuerRows=financialBySecurity.get(row.security_id)??[];issuerRows.push(row);financialBySecurity.set(row.security_id,issuerRows);
  if(row.family==='BALANCE'){const rows=balances.get(row.security_id)??[];rows.push(row);balances.set(row.security_id,rows);}}
 const inputs=new Map(),groups=new Map();
 for(const [sid,s]of companies){const reasons=[],item={security_id:sid,market:s.company.market,industry_code:s.company.industry_code,instrument_kind:s.company.instrument_kind};
  if(s.company.market!=='TPEX')reasons.push('TPEX_ONLY_METHOD');
  if(s.company.instrument_kind!=='ORDINARY_COMPANY_EQUITY')reasons.push('ORDINARY_COMPANY_EQUITY_REQUIRED');
  if(!date)reasons.push('TRADING_CALENDAR_COVERAGE_REQUIRED');
  if(!reasons.length){const q=quoteFor(s,cutoff,date);if(q.reason)reasons.push(q.reason);else{item.quote=q.quote;item.quote_date=date;item.current_price=q.quote.close;}
   const rows=(balances.get(sid)??[]).sort((a,b)=>b.period.localeCompare(a.period)||compareTime(b.available_at,a.available_at)),b=rows[0];
   if(!b)reasons.push('EXPLICIT_REPORTED_BALANCE_BVPS_REQUIRED');
   else{const end=periodEnd(b.period),age=end?(Date.parse(date+'T00:00:00Z')-Date.parse(end+'T00:00:00Z'))/86400000:null;
    if(end===null||age<0||age>TAIWAN_REPORTED_BVPS_POLICY.maximum_statement_age_days)reasons.push('BALANCE_PERIOD_WITHIN_180_DAYS_REQUIRED');
    if(end&&compareTime(b.available_at,end+'T23:59:59+08:00')<0)fail('BALANCE_RECEIPT_BEFORE_PERIOD_END');
    const fields=Object.keys(b.fields).filter(k=>k.replace(/\s/g,'')==='每股參考淨值');
    if(fields.length!==1)reasons.push('EXPLICIT_UNAMBIGUOUS_REPORTED_BVPS_FIELD_REQUIRED');
    else{const field=fields[0],value=officialNumber(b.fields[field]);
     if(!['PER_SHARE_UNIT_NOT_EXPLICIT','TWD_PER_SHARE'].includes(b.field_units[field]))reasons.push('REPORTED_BVPS_UNIT_MAPPING_REQUIRED');
     if(!finite(value)||value<=0)reasons.push('POSITIVE_REPORTED_BVPS_REQUIRED');
     if(rows.some((r,i)=>i>0&&r.period===b.period&&r.available_at===b.available_at&&officialNumber(r.fields[field])!==value))reasons.push('AMBIGUOUS_LATEST_BALANCE_BVPS');
     Object.assign(item,{financial_period:b.period,financial_period_end:end,reported_bvps:value,reported_bvps_raw:b.fields[field],balance_record:b,balance_record_hash:b.record_hash});
    }
    if(end){const actions=corporate_actions?.corporate_actions?.[sid];if(actions&&(actions.security_id!==sid||actions.symbol!==s.company.symbol))fail('ACTION_ISSUER_BINDING');
     const a=actionFor(actions,end,date,cutoff);item.action_proof=a.proof??null;if(a.reason)reasons.push(a.reason);}
   }
   const quality=qualityFor(copy(annual_quality.get(sid)??null),s,financialByCapture,financialBySecurity.get(sid)??[],cutoff);item.annual_quality=quality.value;item.quality_result_hash=quality.hash;
   item.long_quality_eligible=quality.eligible&&!TAIWAN_REPORTED_BVPS_POLICY.long_excluded_industry_codes.includes(s.company.industry_code);
   if(item.current_price>0&&item.reported_bvps>0){item.derived_pb=item.current_price/item.reported_bvps;if(!finite(item.derived_pb)||item.derived_pb<=0)fail('DERIVED_PB_ARITHMETIC');}
  }
  item.reasons=[...new Set(reasons)];item.eligible=!reasons.length;const frozen=freeze(item);inputs.set(sid,frozen);
  if(frozen.eligible){const key=[frozen.market,frozen.industry_code,frozen.quote_date,frozen.financial_period].join(':');const list=groups.get(key)??[];list.push(frozen);groups.set(key,list);}}
 for(const group of groups.values())group.sort((a,b)=>a.security_id.localeCompare(b.security_id));
 const body={schema:'TAIWAN_REPORTED_BVPS_CONTEXT_V1',cutoff,expected_quote_date:date,policy_hash:policyHash,unit_proof_hash:unitHash,
  securities:inputs.size,eligible_medium:[...inputs.values()].filter(v=>v.eligible).length,eligible_long:[...inputs.values()].filter(v=>v.eligible&&v.long_quality_eligible).length,
  input_hash:marketSnapshotHash([...inputs.values()])};
 const context=freeze({...body,context_hash:marketSnapshotHash(body)});contexts.set(context,{inputs,groups,cutoff,date});return context;
}
function quantile(values,p){const x=(values.length-1)*p,lo=Math.floor(x),hi=Math.ceil(x);return values[lo]+(values[hi]-values[lo])*(x-lo);}
function seal(body){return freeze({...body,reference_hash:marketSnapshotHash(body)});}
export function calculateTaiwanReportedBvpsPeerReference(options){
 const {security_id,horizon}=options;if(!['MEDIUM','LONG'].includes(horizon)||typeof security_id!=='string')fail('REFERENCE_INPUT');
 const context=options.context??createTaiwanReportedBvpsContext(options),data=contexts.get(context);if(!data)fail('BRANDED_CONTEXT_REQUIRED');
 const issuer=data.inputs.get(security_id);if(!issuer)fail('ISSUER_NOT_IN_UNIVERSE');
 const common={schema:'TAIWAN_REPORTED_BVPS_PEER_REFERENCE_V1',method_version:TAIWAN_REPORTED_BVPS_POLICY.version,
  method:horizon==='LONG'?'CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB':'CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB',
  security_id,horizon,market:issuer.market,industry_code:issuer.industry_code,cutoff:data.cutoff,expected_quote_date:data.date,calendar_version:MARKET_CALENDAR_VERSION,
  currency:'TWD',policy:TAIWAN_REPORTED_BVPS_POLICY,policy_hash:policyHash,unit_proof:MOPS_REPORTED_BVPS_UNIT_PROOF,unit_proof_hash:unitHash,
  research_only:true,methodology_approved:false,production_eligible:false,buy_ready:false,member_published:false,forecast:false,performance_available:false,review:null,source_use_review:null,
  range_meaning:'REPORTED_BVPS_PEER_DERIVED_PB_SENSITIVITY_NOT_FAIR_VALUE_OR_TRADE_TARGET',
  limitations:['BVPS is the unmodified reported quarter-end field, not current book value; later cash dividends are listed without automatic subtraction.',
   'Only the five verified official action classes are covered; this is not a complete private-issuance or ownership ledger.',
   'Peer multiples are derived from actual closes and explicit same-period reported BVPS, not official published P/B or forecast values.',
   'Quantiles are sample ranks, not probability bounds or expected returns; prices are not rounded to verified exchange ticks.']};
 const reasons=[...issuer.reasons];if(horizon==='LONG'&&!issuer.long_quality_eligible)reasons.push(issuer.industry_code==='17'?'FINANCIAL_SECTOR_QUALITY_METHOD_REQUIRED':'EXISTING_LONG_ANNUAL_QUALITY_ELIGIBLE_REQUIRED');
 if(reasons.length)return seal({...common,state:'UNAVAILABLE',reason:'ISSUER_REPORTED_BVPS_REQUIREMENTS_NOT_MET',reasons:[...new Set(reasons)],peer_count:0});
 const candidates=data.groups.get([issuer.market,issuer.industry_code,issuer.quote_date,issuer.financial_period].join(':'))??[];
 const peerInputs=candidates.filter(p=>p.security_id!==security_id&&(horizon==='MEDIUM'||p.long_quality_eligible));
 const peer=p=>({security_id:p.security_id,market:p.market,industry_code:p.industry_code,quote_date:p.quote_date,current_price:p.current_price,
  financial_period:p.financial_period,financial_period_end:p.financial_period_end,reported_bvps:p.reported_bvps,reported_bvps_raw:p.reported_bvps_raw,derived_pb:p.derived_pb,
  balance_record:p.balance_record,balance_record_hash:p.balance_record_hash,source_captures:{quote:p.quote.source_capture,balance:p.balance_record.source_capture},
  action_proof:p.action_proof,annual_quality:horizon==='LONG'?p.annual_quality:null,quality_result_hash:horizon==='LONG'?p.quality_result_hash:null});
 const peers=peerInputs.map(peer),binding={quote_date:issuer.quote_date,current_price:issuer.current_price,financial_period:issuer.financial_period,financial_period_end:issuer.financial_period_end,
  reported_bvps:issuer.reported_bvps,reported_bvps_raw:issuer.reported_bvps_raw,reported_bvps_field:'每股參考淨值',derived_pb:issuer.derived_pb,
  issuer_balance_record:issuer.balance_record,issuer_balance_record_hash:issuer.balance_record_hash,issuer_source_captures:{quote:issuer.quote.source_capture,balance:issuer.balance_record.source_capture},
  issuer_action_proof:issuer.action_proof,issuer_quality:horizon==='LONG'?issuer.annual_quality:null,issuer_quality_hash:horizon==='LONG'?issuer.quality_result_hash:null,
  peer_count:peers.length,peers,issuer_excluded_from_peer_sample:true,peer_quantiles:[...TAIWAN_REPORTED_BVPS_POLICY.quantiles]};
 const input_hash=marketSnapshotHash({security_id,horizon,cutoff:data.cutoff,policy_hash:policyHash,unit_proof_hash:unitHash,...binding});
 if(peers.length<TAIWAN_REPORTED_BVPS_POLICY.minimum_other_peers)return seal({...common,...binding,input_hash,state:'UNAVAILABLE',reason:'AT_LEAST_FIVE_OTHER_COMPARABLE_BVPS_PEERS_REQUIRED'});
 const sorted=peers.map(p=>p.derived_pb).sort((a,b)=>a-b),multiple_scenarios=binding.peer_quantiles.map(p=>quantile(sorted,p)),price_scenarios=multiple_scenarios.map(v=>issuer.reported_bvps*v);
 if(price_scenarios.some(v=>!finite(v)||v<=0))fail('PRICE_ARITHMETIC');
 return seal({...common,...binding,input_hash,state:'CALCULATED_RESEARCH_ONLY',metric:'DERIVED_PB',multiple_scenarios,price_scenarios,
  arithmetic:{peer_pb:'peer_current_close / peer_reported_bvps',price:'issuer_reported_bvps * peer_derived_pb_quantile',rounding:TAIWAN_REPORTED_BVPS_POLICY.rounding}});
}
