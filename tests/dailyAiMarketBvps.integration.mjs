// SYNTHETIC raw CSV, quote, action responses and issuers. Disposable PGlite.
// Real calculator -> original-byte admission -> chunks -> references -> packet.
// PGlite has no BIG5 codec: an exact CP950-SHA/decoded-text fixture replaces
// only that private codec. This does not claim production/native-codec testing.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import console from 'node:console';
import process from 'node:process';
import {createMarketOwnerFixture} from './helpers/dailyAiMarketOwnerFixture.mjs';
import {marketSnapshotHash as hash,planTaiwanMarketAnalysis} from '../research/taiwan-market-universe.mjs';
import {marketStageCanonical as canonical,stageDailyAiMarketCapture,stageDailyAiMarketWorkPlan,finishDailyAiMarketEdition} from '../research/daily-ai-market-stage.mjs';
import {prepareDailyAiMarketPriceInputChunks,prepareDailyAiMarketPriceReferenceBatches,stageDailyAiMarketPricePrepared,prepareDailyAiMarketShardWithReferences} from '../research/daily-ai-market-references-stage.mjs';
import {compactTaiwanPriceReference,taiwanResearchReferenceSummary} from '../research/taiwan-market-price-reference.mjs';
import {createTaiwanReportedBvpsContext,calculateTaiwanReportedBvpsPeerReference} from '../research/taiwan-market-bvps.mjs';
import {annualFinancialInputs} from '../research/taiwan-market-financial-inputs.mjs';
import {calculateTaiwanLongPeerReference} from '../research/taiwan-market-long-price.mjs';
import {TPEX_ACTION_SOURCES,taiwanActionUrl,decodeTaiwanActionCapture,buildTaiwanMarketActionCoverage,createTaiwanActionReplayEvidence} from '../research/taiwan-market-actions.mjs';
import {previousMarketTradingDate,isMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

const f=await createMarketOwnerFixture(),{db,rpc,call}=f;
const sha=v=>createHash('sha256').update(v).digest('hex'),clone=v=>JSON.parse(JSON.stringify(v));
const received=new Date(Date.now()-10000).toISOString(),cutoff=new Date(Date.now()-1000).toISOString();
const day=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10),year=Number(day.slice(0,4));
const quoteDay=isMarketTradingDate('TW',day)&&Date.parse(cutoff)>=Date.parse(day+'T17:05:00+08:00')?day:previousMarketTradingDate('TW',day);
const quarter=Math.floor((Number(quoteDay.slice(5,7))-1)/3),periodYear=quarter?year:year-1,periodQuarter=quarter||4;
const period=periodYear+'Q'+periodQuarter,periodEnd=new Date(Date.UTC(periodYear,periodQuarter*3,0)).toISOString().slice(0,10);
const plan=planTaiwanMarketAnalysis({universe:f.universe,cutoff,business_date:day,shard_size:64});
const companies=f.universe.companies.filter(c=>c.market==='TPEX'),issuer=companies[0].security_id;
const securities=[],financialRows=[],receipts=[];let counter=100000,phase=0;
const pass=label=>console.log(JSON.stringify({phase:++phase,state:'PASS',label}));
const admin=()=>db.exec('reset role'),service=()=>f.identity(null,'service_role');
const bindingKeys=['quote_date','current_price','financial_period','financial_period_end','reported_bvps','reported_bvps_raw','reported_bvps_field','derived_pb',
 'issuer_balance_record','issuer_balance_record_hash','issuer_source_captures','issuer_action_proof','issuer_quality','issuer_quality_hash','peer_count','peers','issuer_excluded_from_peer_sample','peer_quantiles'];
function reseal(reference){delete reference.reference_hash;const binding=Object.fromEntries(bindingKeys.map(k=>[k,reference[k]]));
 reference.input_hash=hash({security_id:reference.security_id,horizon:reference.horizon,cutoff:reference.cutoff,policy_hash:reference.policy_hash,unit_proof_hash:reference.unit_proof_hash,...binding});
 reference.reference_hash=hash(reference);return reference;}
function rowBinding(receipt,row,index,extra={}){return{capture_id:hash({source_id:receipt.source_id,url:receipt.url,source_sha256:receipt.sha256,received_at:receipt.received_at}),
 source_id:receipt.source_id,source_url:receipt.url,source_sha256:receipt.sha256,source_bytes:receipt.bytes,received_at:receipt.received_at,
 row_index:index,row_path:[index],symbol_field:'3',source_row_hash:hash(row),...extra};}
async function stageCapture(receipt,bytes){const r=await stageDailyAiMarketCapture({rpc,receipt,bytes});assert.equal(r.state,'STAGED',JSON.stringify(r));receipts.push(receipt);return r;}
const csvCell=v=>'"'+String(v).replaceAll('"','""')+'"';
async function financialCapture(family,financialPeriod,values){
 const header=['出表日期','年度','季別','公司代號','公司名稱',...Object.keys(values(0))];
 const rows=companies.map((c,i)=>[(year-1911)+'/'+Number(day.slice(5,7))+'/'+Number(day.slice(8)),String(Number(financialPeriod.slice(0,4))-1911),financialPeriod.at(-1),c.symbol,c.company,...Object.values(values(i))]);
 const matrix=[header,...rows],text=matrix.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
 const bytes=execFileSync('python3',['-c','import sys;sys.stdout.buffer.write(sys.stdin.read().encode("cp950"))'],{input:text});
 const stamp=String(++counter),filename=(family==='CASHFLOW'?'t163sb20_':'t163sb04_')+day.replaceAll('-','')+'_'+stamp+'.csv';
 const receipt={schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id:'MOPS_'+family+'_TPEX_'+financialPeriod+'_CSV_'+day.replaceAll('-','')+'_'+stamp,
  url:'https://mopsov.twse.com.tw/server-java/t105sb02',format:'csv',encoding:'CP950',row_layout:'HEADER_AND_DATA_ARRAYS_V1',state:'CAPTURED',status:200,
  request_method:'POST',request_form:{firstin:'true',step:'10',filename,saveCSV:'Y'},
  parent_request_url:'https://mopsov.twse.com.tw/mops/web/ajax_'+(family==='INCOME'?'t163sb04':family==='BALANCE'?'t163sb05':'t163sb20'),
  parent_request_form:{TYPEK:'otc',year:String(Number(financialPeriod.slice(0,4))-1911),season:'0'+financialPeriod.at(-1)},
  parent_html_sha256:sha('SYNTHETIC_PARENT_'+family+financialPeriod),started_at:received,received_at:received,bytes:bytes.length,sha256:sha(bytes),
  decoded_text_sha256:sha(text),row_count:matrix.length,data_row_count:rows.length,fixture:'SYNTHETIC_ONLY'};
 await admin();await db.query('insert into fixture_codec.samples values($1,$2)',[sha(bytes),text]);await service();await stageCapture(receipt,bytes);
 rows.forEach((row,i)=>{const c=companies[i],fields=Object.fromEntries(header.slice(3).map((k,j)=>[k,row[j+3]]));
  const source_capture=rowBinding(receipt,row,i+1,{encoding:'CP950',decoded_text_sha256:receipt.decoded_text_sha256,parent_html_sha256:receipt.parent_html_sha256,
   parent_html_record_hash:sha('SYNTHETIC_PARENT_ROW_'+family+financialPeriod+c.symbol),header_row_hash:hash(header),csv_filename:filename});
  const record={security_id:c.security_id,market:'TPEX',symbol:c.symbol,company_as_reported:c.company,period:financialPeriod,family,fields,normalized_fields:fields,
   field_units:Object.fromEntries(Object.keys(fields).map(k=>[k,['公司代號','公司名稱'].includes(k)?'TEXT':k==='每股參考淨值'?'PER_SHARE_UNIT_NOT_EXPLICIT':'TWD_THOUSANDS'])),
   period_basis:family==='BALANCE'?'POINT_IN_TIME_AS_REPORTED':'YTD_AS_REPORTED',period_scope:family==='BALANCE'?'POINT_IN_TIME':financialPeriod.endsWith('Q4')?'FULL_FISCAL_YEAR_AS_REPORTED':'CUMULATIVE_THROUGH_Q'+financialPeriod.at(-1),
   period_definition_source:family==='BALANCE'?null:{url:'https://mopsfin.twse.com.tw/'},period_identity_basis:'CSV_RESPONSE_YEAR_QUARTER_MATCHED_PARENT_REQUEST',
   amount_unit:'TWD_THOUSANDS',amount_unit_basis:'MATCHED_PARENT_HTML_EXPLICIT_UNIT',source_cells_matched_parent_html:true,
   source_capture,source_url:source_capture.source_url,available_at:received,first_seen_at:received,published_at:null,forecast:false,fcfe_inferred:false,single_quarter_inferred:false};
  financialRows.push({...record,record_hash:hash(record)});
 });
}
async function actions({stock=false}={}){
 const eventDay=new Date(Date.parse(quoteDay+'T00:00:00Z')-86400000).toISOString().slice(0,10),roc=(Number(eventDay.slice(0,4))-1911)+'/'+eventDay.slice(5,7)+'/'+eventDay.slice(8);
 const row=[roc,companies[0].symbol,'SYNTHETIC','1000','998.5','0','1.5','1.5',stock?'除權':'除息','1098','900','998.5','998.5',stock?'0':'1.50',stock?'50':'0','0','0','0','0','0','0'];
 const captures=[];
 for(const [source_id,spec]of Object.entries(TPEX_ACTION_SOURCES)){
  const data=source_id==='tpex_ex_right'?[row]:[],url=taiwanActionUrl(source_id,periodEnd,quoteDay);
  const payload={date:periodEnd.replaceAll('-','')+'~'+quoteDay.replaceAll('-',''),stat:'ok',tables:[{title:'',fields:[...spec.fields],totalCount:data.length,data,summary:[]}]};
  const bytes=Buffer.from(JSON.stringify(payload));const receipt={schema:'TAIWAN_HISTORY_SOURCE_RECEIPT_V1',source_id,market:'TPEX',family:spec.family,url,task_id:sha(url),
   date:null,from:periodEnd,through:quoteDay,state:'CAPTURED',status:200,started_at:received,received_at:received,bytes:bytes.length,sha256:sha(bytes),raw_bytes_complete:true,content_encoding:'identity',historical_knowledge:false,fixture:'SYNTHETIC_ONLY'};
  const capture={receipt,bytes},decoded=decodeTaiwanActionCapture(capture);await stageCapture(decoded.public_receipt,decoded.entity_bytes);captures.push(capture);
 }
 return buildTaiwanMarketActionCoverage({universe:f.universe,captures,from:periodEnd,through:quoteDay,cutoff});
}
let poolHash;
function item(reference){const encoded={...reference,input_encoding:'SHARED_PRICE_INPUTS_V1',encoded_hash:hash(reference)};
 return{security_id:issuer,horizon:reference.horizon,reference_text:canonical(encoded),reference_hash:reference.reference_hash,
  summary:taiwanResearchReferenceSummary({security_id:issuer,horizon:reference.horizon,reference,input_pool_hash:poolHash})};}
function args(items){const body={schema:'TAIWAN_MARKET_PRICE_REFERENCE_BATCH_V1',plan_hash:plan.plan_hash,input_pool_hash:poolHash,items},text=canonical(body);
 return{p_plan_hash:plan.plan_hash,p_body_text:text,p_body_hash:sha(text)};}
async function reject(reference,mutate,pattern){const r=clone(reference);mutate(r);reseal(r);await assert.rejects(call('stage_daily_ai_market_price_references_v2',args([item(r)])),pattern);}
function evidence(symbol,kind,body,capture){const content=canonical(body),evidence_hash=sha(content);return{id:'market-'+evidence_hash.slice(0,40),symbol,kind,source:capture.source_url,
 published_at:null,available_at:capture.received_at,time_basis:'OBSERVED_AFTER_RECEIPT',first_seen_at:capture.received_at,as_of:capture.received_at,evidence_hash,content};}

try{
 await admin();
 for(const name of ['daily-ai-market-public-supplements.candidate.sql','daily-ai-market-action-coverage.candidate.sql','daily-ai-market-action-evidence-id.candidate.sql',
  'daily-ai-market-reference-chunks.candidate.sql','daily-ai-market-reference-capacity.candidate.sql','daily-ai-market-bvps.candidate.sql']){
  const sql=readFileSync(new URL('../research/'+name,import.meta.url),'utf8');
  try{await db.exec(sql);}catch(e){throw Error(name+': '+e.message+' '+sql.slice(Number(e.position)-100,Number(e.position)+100));}
 }
 await db.exec(`create schema fixture_codec;create table fixture_codec.samples(raw_hash text primary key,decoded text not null);
  create or replace function vnext_market.decode_big5_exact(p_raw bytea) returns text language plpgsql immutable set search_path='' as $$
  declare value text;begin select decoded into value from fixture_codec.samples where raw_hash=encode(sha256(p_raw),'hex');
   if not found then raise exception 'EXACT_LOCAL_CODEC_FIXTURE_REQUIRED';end if;return value;end $$;`);
 for(const d of ['2026-02-23','2026-07-10','2026-10-23','2026-10-26','2026-11-11'])for(const t of ['T17:04:59+08:00','T17:05:00+08:00']){
  const expected=isMarketTradingDate('TW',d)&&t==='T17:05:00+08:00'?d:previousMarketTradingDate('TW',d);
  const actual=(await db.query('select vnext_market.bvps_completed_session($1)::text d',[d+t])).rows[0].d;assert.equal(actual,expected);
 }
 await service();
 const quoteRows=companies.map((c,i)=>({Date:(year-1911)+quoteDay.slice(5,7)+quoteDay.slice(8),SecuritiesCompanyCode:c.symbol,CompanyName:c.company,
  Close:String(i?i*10:1000),Open:'10',High:'1000',Low:'10',TradingShares:'1000',TransactionAmount:'1000000'}));
 const bytes=Buffer.from(JSON.stringify(quoteRows)),qr={schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id:'tpex_prices',url:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
  format:'json',state:'CAPTURED',status:200,started_at:received,received_at:received,bytes:bytes.length,sha256:sha(bytes),row_count:quoteRows.length};
 await stageCapture(qr,bytes);companies.forEach((c,i)=>securities.push({security_id:c.security_id,company:c,observations:[{family:'PRICE',kind:'DAILY_OHLCVA',market:'TPEX',symbol:c.symbol,
  date:quoteDay,currency:'TWD',close:Number(quoteRows[i].Close),valid_trade:true,available_at:received,source_capture:rowBinding(qr,quoteRows[i],i,{symbol_field:'SecuritiesCompanyCode'})}]}));
 await financialCapture('BALANCE',period,()=>({'資產總計':'2000000000','負債總計':'1000000000','權益總計':'1000000000','每股參考淨值':'10.00'}));
 for(const y of [year-3,year-2,year-1]){
  await financialCapture('INCOME',y+'Q4',()=>({'本期淨利（淨損）':'1000000000','淨利（淨損）歸屬於母公司業主':'800000000','基本每股盈餘（元）':'1.00'}));
  await financialCapture('BALANCE',y+'Q4',()=>({'資產總計':'2000000000','權益總計':'1000000000'}));
  await financialCapture('CASHFLOW',y+'Q4',()=>({'營業活動之淨現金流入（流出）':'120','期初現金及約當現金餘額':String(100+(y-year+3)*50),
   '本期現金及約當現金增加（減少）數':'50','期末現金及約當現金餘額':String(150+(y-year+3)*50)}));
 }
 const corporate_actions=await actions(),shareActions=await actions({stock:true});
 assert.equal((await stageDailyAiMarketWorkPlan({rpc,universe:f.universe,plan})).state,'STAGED');
 const annual_metrics=new Map(securities.map(s=>[s.security_id,annualFinancialInputs(financialRows.filter(r=>r.security_id===s.security_id),cutoff).metrics]));
 const annual_quality=new Map(securities.map(s=>[s.security_id,calculateTaiwanLongPeerReference({security_id:s.security_id,securities:[s],annual_metrics,cutoff}).issuer_quality]));
 const context=createTaiwanReportedBvpsContext({securities,financial_rows:financialRows,corporate_actions,annual_quality,cutoff,expected_quote_date:quoteDay});
 const medium=calculateTaiwanReportedBvpsPeerReference({context,security_id:issuer,horizon:'MEDIUM'}),long=calculateTaiwanReportedBvpsPeerReference({context,security_id:issuer,horizon:'LONG'});
 assert.deepEqual(medium.price_scenarios,[20,30,40]);assert.deepEqual(long.price_scenarios,[20,30,40]);assert.equal(medium.issuer_action_proof.cash_dividend_events.length,1);
 const inputs={},bindings={},compacts=[medium,long].map(r=>compactTaiwanPriceReference(r,inputs,bindings));poolHash=hash(inputs);
 const prepared=prepareDailyAiMarketPriceInputChunks({planHash:plan.plan_hash,inputs,bindings,inputPoolHash:poolHash});
 for(const p of [...prepared.chunks,prepared.finalize])assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:p})).state,'STAGED');
 pass('original CP950 CSV, exact quote and three action tables produce real-calculator 20 / 30 / 40 scenarios through bounded SQL input admission');

 await reject(medium,r=>{r.price_scenarios[1]+=1;},/MARKET_BVPS_ARITHMETIC/);
 await reject(medium,r=>{r.multiple_scenarios[1]+=0.01;},/MARKET_BVPS_ARITHMETIC/);
 await reject(medium,r=>{r.current_price+=0.0000001;r.derived_pb=r.current_price/r.reported_bvps;},/MARKET_BVPS_QUOTE_VALUE/);
 await reject(medium,r=>{r.reported_bvps=20;r.reported_bvps_raw='20.00';r.derived_pb=r.current_price/20;
  r.issuer_balance_record.fields['每股參考淨值']='20.00';delete r.issuer_balance_record.record_hash;r.issuer_balance_record.record_hash=hash(r.issuer_balance_record);r.issuer_balance_record_hash=r.issuer_balance_record.record_hash;},/MARKET_BVPS_BALANCE_VALUE/);
 await reject(medium,r=>{r.unit_proof.raw_value_multiplier=1000;r.unit_proof_hash=hash(r.unit_proof);},/MARKET_BVPS_REFERENCE_SCOPE/);
 await reject(medium,r=>{r.peers[1]=clone(r.peers[0]);},/MARKET_BVPS_PEER_DUPLICATE_OR_ISSUER/);
 await reject(medium,r=>{r.peers[0].industry_code='99';},/MARKET_BVPS_PEER_COHORT/);
 await reject(medium,r=>{r.financial_period=periodYear+'Q'+(periodQuarter===1?2:1);},/MARKET_BVPS_FINANCIAL_SOURCE/);
 await reject(medium,r=>{r.issuer_action_proof.cash_dividend_events=[];},/MARKET_BVPS_CASH_EVENT_BINDING/);
 await reject(medium,r=>{const evidence=createTaiwanActionReplayEvidence(shareActions.corporate_actions[issuer]).map(e=>({...e,id:'market-'+e.evidence_hash.slice(0,40)}));
  r.issuer_action_proof.coverage_evidence=evidence;r.issuer_action_proof.coverage_hashes=evidence.map(e=>JSON.parse(e.content).coverage_hash);r.issuer_action_proof.cash_dividend_events=[];},/MARKET_BVPS_SHARE_CHANGE/);
 await reject(long,r=>{r.issuer_quality.annuals[0].net_profit+=1;r.issuer_quality_hash=hash(r.issuer_quality);},/MARKET_BVPS_QUALITY_RAW_VALUES/);
 await reject(long,r=>{r.peers[0].annual_quality.annuals[0].operating_cashflow=0;r.peers[0].quality_result_hash=hash(r.peers[0].annual_quality);},/MARKET_BVPS_QUALITY_RAW_VALUES/);
 await reject(long,r=>{r.methodology_approved=true;},/MARKET_BVPS_REFERENCE_SCOPE/);
 pass('forged raw values, units, cohort, financial period, cash/share events, annual quality and arithmetic reject atomically');

 const stagedRefs=prepareDailyAiMarketPriceReferenceBatches({planHash:plan.plan_hash,inputPoolHash:poolHash,references:[{security_id:issuer,short:null,medium:compacts[0],long:compacts[1]}]});
 for(const p of stagedRefs.batches){assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:p})).state,'STAGED');assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:p})).state,'STAGED');}
 await admin();const cache=(await db.query('select validation_kind,count(*)::integer n from vnext_market.bvps_verified_inputs where plan_id=$1 group by validation_kind order by validation_kind',[plan.plan_hash])).rows;
 assert.deepEqual(cache,[{validation_kind:'ACTIONS',n:6},{validation_kind:'OBSERVATION',n:6},{validation_kind:'QUALITY',n:6}]);
 await assert.rejects(db.exec('delete from vnext_market.bvps_verified_inputs'),/MARKET_IMMUTABLE/);
 await assert.rejects(db.exec('update vnext_market.bvps_reference_packet_bindings set reference_hash=reference_hash'),/MARKET_IMMUTABLE/);
 for(const role of ['anon','authenticated']){
  await f.identity(f.premium,role);await assert.rejects(call('stage_daily_ai_market_price_references_v2',stagedRefs.batches[0].args),e=>e.code==='42501');
  await assert.rejects(db.query('select * from vnext_market.bvps_verified_inputs'),e=>e.code==='42501');
 }
 await service();await assert.rejects(db.query('select * from vnext_market.bvps_reference_packet_bindings'),e=>e.code==='42501');
 pass('MEDIUM / LONG exact replay shares 18 immutable validations; anonymous, member and direct service table access are denied');

 await admin();const oldRows=(await db.query('select security_id,packet_text,analysis_text from vnext_market.stock_results where plan_id=$1',[f.plan.plan_hash])).rows;await service();
 const results=oldRows.map(old=>{const packet=JSON.parse(old.packet_text),analysis=JSON.parse(old.analysis_text);packet.cutoff=cutoff;packet.data_through=quoteDay;
  if(old.security_id===issuer){const symbol=companies[0].symbol,q=securities[0].observations[0],b=medium.issuer_balance_record;
   packet.evidence.push(evidence(symbol,'PRICE',{kind:'DAILY_OHLCVA',date:quoteDay,close:q.close,source_capture:q.source_capture},q.source_capture),
    evidence(symbol,'FINANCIAL',{kind:'BALANCE_HISTORY',period,fields:b.fields,source_capture:b.source_capture},b.source_capture),...clone(medium.issuer_action_proof.coverage_evidence));}
  analysis.cutoff=cutoff;analysis.input_hash=hash(packet);analysis.sources=packet.evidence.map(({content:unused,...source})=>{void unused;return source;});
  return{security_id:old.security_id,packet,analysis,research_references:stagedRefs.bySecurity[old.security_id]??{SHORT:null,MEDIUM:null,LONG:null}};});
 const work=await call('claim_daily_ai_market_shard_v2',{p_plan_hash:plan.plan_hash,p_worker_ref:'SYNTHETIC_BVPS_SQL',p_request_key:randomUUID()});
 const missing=clone(results),missingIssuer=missing.find(r=>r.security_id===issuer);missingIssuer.packet.evidence=missingIssuer.packet.evidence.filter(e=>JSON.parse(e.content).kind!=='BALANCE_HISTORY');
 missingIssuer.analysis.input_hash=hash(missingIssuer.packet);missingIssuer.analysis.sources=missingIssuer.packet.evidence.map(({content:unused,...source})=>{void unused;return source;});
 const incomplete=prepareDailyAiMarketShardWithReferences({planHash:plan.plan_hash,shard:work.shard,leaseId:work.lease_id,results:missing});
 await assert.rejects(call(incomplete.rpc,incomplete.args),/MARKET_BVPS_PACKET_ISSUER_EVIDENCE/);
 const complete=prepareDailyAiMarketShardWithReferences({planHash:plan.plan_hash,shard:work.shard,leaseId:work.lease_id,results});
 assert.equal((await call(complete.rpc,complete.args)).replayed,false);assert.equal((await call(complete.rpc,complete.args)).replayed,true);
 const finished=await finishDailyAiMarketEdition({rpc,planHash:plan.plan_hash,expiresAt:new Date(Date.now()+3600000).toISOString()});assert.equal(finished.state,'STAGED_REVIEW_REQUIRED');
 await f.identity(f.owner);const owner=await call('get_daily_ai_owner_market_references_v2',{p_plan_hash:plan.plan_hash,p_security_id:issuer});assert.equal(owner.references.length,2);
 await admin();assert.deepEqual((await db.query('select (select count(*)::integer from vnext_market.reviews) reviews,(select count(*)::integer from vnext_market.publication_events) publications')).rows[0],{reviews:0,publications:0});
 await service();for(const p of stagedRefs.batches)assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:p})).state,'STAGED');
 pass('actual shard rejects missing issuer evidence; exact packet finishes as private review-required edition with two Owner references and zero approvals/publications');

 await admin();await f.executeFile('daily-ai-market-bvps.rollback.sql');
 assert.equal((await db.query("select md5(prosrc) h from pg_proc where oid='public.stage_daily_ai_market_price_references_v2(text,text,text)'::regprocedure")).rows[0].h,'c4afbf11bf17d4b418df812d063aa43d');
 assert.equal((await db.query("select md5(prosrc) h from pg_proc where oid='vnext_market.reference_projection(text,text,text,text,text,text)'::regprocedure")).rows[0].h,'780f953c71839db6d80a4fdbbb6be006');
 assert.equal((await db.query('select count(*)::integer n from vnext_market.bvps_reference_packet_bindings where plan_id=$1',[plan.plan_hash])).rows[0].n,2);
 await service();assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:f.preparedRefs.batches[0]})).state,'STAGED');
 await assert.rejects(call('stage_daily_ai_market_price_references_v2',stagedRefs.batches[0].args),/MARKET_REFERENCE_METHOD/);
 pass('guarded rollback restores exact two predecessor bodies, preserves all immutable data and keeps the existing method replay working');
}catch(e){console.error(JSON.stringify({state:'FAIL',phase,code:e.code,message:e.message,where:e.where,stack:e.stack?.split('\n').slice(0,4)}));process.exitCode=1;}
finally{await f.close();}
