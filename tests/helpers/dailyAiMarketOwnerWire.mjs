// Deterministic SYNTHETIC wire projections for actual React tests. This is not
// a source/rights approval fixture for production; SQL integration is separate.
import {createHash}from'node:crypto';
import {marketStageCanonical as canonical}from'../../research/daily-ai-market-stage.mjs';
import {marketSnapshotHash as hash}from'../../research/taiwan-market-universe.mjs';
import {taiwanResearchReferenceSummary}from'../../research/taiwan-market-price-reference.mjs';
export const WIRE_OWNER='00000000-0000-0000-0000-000000000001';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function ownerMarketWire(now,{ready=false,rights=false,total=21,expiry=now+3600000,firstSymbol=1000,companyNames={}}={}){
 const at=new Date(now-7200000).toISOString(),cutoff=new Date(now-3600000).toISOString(),prepared=new Date(now-1800000).toISOString(),quote='2026-11-10',eid='a'.repeat(64),plan='b'.repeat(64);
 const edition={id:eid,plan_hash:plan,edition_date:new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10),evidence_cutoff:cutoff,prepared_at:prepared,expires_at:new Date(expiry).toISOString(),analysis_origin:'DETERMINISTIC_SCREENING',method_version:'TAIWAN_MARKET_RESEARCH_V1',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false};
 const source='https://www.twse.com.tw/SYNTHETIC_ONLY',binding=symbol=>({capture_id:'c'.repeat(64),source_url:source,source_row_hash:hash({symbol}),received_at:at});
 function stock(index){const symbol=String(firstSymbol+index),content=canonical({schema:'SYNTHETIC_ONLY',symbol,source_capture:binding(symbol)}),digest=sha(content),evidence={id:'market-'+digest.slice(0,40),symbol,kind:'MARKET',source,published_at:null,available_at:at,time_basis:'OBSERVED_AFTER_RECEIPT',first_seen_at:at,as_of:at,evidence_hash:digest,content};
  const packet={symbol,company:companyNames[symbol]??'合成測試公司'+index,cutoff,data_through:quote,data_gaps:['SYNTHETIC_ONLY'],evidence:[evidence]},packet_text=canonical(packet),packet_hash=sha(packet_text);
  const {content:ignored,symbol:ignoredSymbol,...sourceMetadata}=evidence;void ignored;void ignoredSymbol;
  const horizons=['LONG','MEDIUM','SHORT'].map(horizon=>({horizon,status:'WAIT',reason:{text:'合成測試用觀察理由，不是投資結論',evidence_ids:[evidence.id]},counter_evidence:[],confirmation:'合成測試等待條件',invalidation:'合成測試重評條件',gaps:[]}));
  const analysis={schema:'DAILY_AI_STOCK_ANALYSIS_V2',symbol,cutoff,input_hash:packet_hash,analysis_origin:'DETERMINISTIC_SCREENING',method_version:'TAIWAN_MARKET_RESEARCH_V1',model_generated:false,member_published:false,sources:[sourceMetadata],horizons},analysis_text=canonical(analysis);
  return {packet,packet_text,packet_hash,analysis_text,analysis_hash:sha(analysis_text),cards:horizons.map(h=>({market:'TWSE',symbol,company:packet.company,...h,gaps:packet.data_gaps,sources:[sourceMetadata],classification:'INFERENCE',price:null,research_reference:null}))};
 }
 const issuer='TWSE:'+firstSymbol,stocks=Array.from({length:total},(_,i)=>stock(i)),fullBody={schema:'TAIWAN_PEER_RERATING_SCENARIO_V1',security_id:issuer,state:'CALCULATED_RESEARCH_ONLY',method:'CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE',
  quote_date:quote,current_price:100,peer_count:5,price_scenarios:[80,100,120],current_multiple:10,multiple_scenarios:[8,10,12],issuer_source_captures:[binding(String(firstSymbol))],
  peers:Array.from({length:5},(_,i)=>({security_id:'TWSE:'+String(firstSymbol+1+i),source_capture:binding(String(firstSymbol+1+i))})),forecast:false,buy_ready:false,production_eligible:false,review:null};
 const reference={...fullBody,reference_hash:hash(fullBody)},input_pool_hash='d'.repeat(64),summary=taiwanResearchReferenceSummary({security_id:issuer,horizon:'MEDIUM',reference,input_pool_hash});stocks[0].cards.find(c=>c.horizon==='MEDIUM').research_reference=summary;
 const documents=ready?['QUALITY','TIME','SOURCE_USE','METHODOLOGY'].map(kind=>{const text=canonical({schema:'DAILY_AI_MARKET_OWNER_REVIEW_DOCUMENT_V1',edition_id:eid,kind,status:'PASS',reviewer_user_id:WIRE_OWNER,request_key:'22222222-2222-4222-8222-222222222222',document_url:'https://example.com/SYNTHETIC/'+kind,notes:'這是合成測試文件說明，不是實際審查核准。',submitted_at:prepared});return{kind,text,hash:sha(text)};}):[];
 const reviewBody=ready?{schema:'DAILY_AI_MARKET_REVIEW_V2',edition_id:eid,snapshot_hash:eid,reviewer_ref:'OWNER:'+WIRE_OWNER,quality:'PASS',time_status:'PASS',licensing:'PASS',methodology:'PASS',document_hashes:Object.fromEntries(documents.map(d=>[d.kind,d.hash])),reason:'合成測試四項審查，不是實際投資核准。',expires_at:edition.expires_at}:null;
 const rawReview=reviewBody?{id:'11111111-1111-4111-8111-111111111111',review_hash:sha(canonical(reviewBody)),review:reviewBody,review_text:canonical(reviewBody)}:null;
 const catalog={schema:'VNEXT_AI_OWNER_MARKET_CATALOG_V2',subject_user_id:WIRE_OWNER,preview_only:true,research_only:true,checked_at:new Date(now).toISOString(),editions:[edition],next_cursor:null};
 const page=(start=0)=>({schema:'VNEXT_AI_OWNER_MARKET_PAGE_V2',subject_user_id:WIRE_OWNER,preview_only:true,research_only:true,edition,cards:stocks.flatMap(s=>s.cards).slice(start,start+30),total:total*3,start,review:rawReview,publication:null,rights_ready:rights,checked_at:new Date(now).toISOString(),
  coverage:['TWSE','TPEX','EMERGING'].map((market,i)=>({market,universe_count:i?0:total,analysed_count:i?0:total,card_count:i?0:total*3,roster_as_of:i?null:edition.edition_date,price_date:i?null:quote,financial_available_at:null,news_available_at:null})),
  source_use:{total:1,approved:rights?1:0,blocked_sources:rights?[]:[source]},review_documents:documents});
 const input={schema:'VNEXT_AI_OWNER_MARKET_INPUT_V2',subject_user_id:WIRE_OWNER,edition_id:eid,security_id:issuer,preview_only:true,research_only:true,...Object.fromEntries(['packet_text','packet_hash','analysis_text','analysis_hash'].map(k=>[k,stocks[0][k]]))};
 const refs={plan_hash:plan,security_id:issuer,input_pool_hash,references:[{horizon:'MEDIUM',summary,reference}]};
 return{catalog,page,input,refs,edition,review:rawReview};
}
