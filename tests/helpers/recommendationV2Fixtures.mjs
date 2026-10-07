import {emptyEvidenceData} from '../../supabase/functions/_shared/decision-v1-data.ts';
import {RECOMMENDATION_UNIVERSE} from '../../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {previousMarketTradingDate} from '../../supabase/functions/_shared/market-session-contract.mjs';
export function v2Fixture(at='2026-10-06T23:30:00.000Z'){
 const today=new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
 const data=emptyEvidenceData(),identity={report_date:today,today_date:today,generated_at:at,data_as_of:at,revision_id:'SYNTHETIC_TEST_ONLY',is_trading_day:true};
 const last=previousMarketTradingDate('TW',today),days=[];let d=last;for(let i=0;i<20;i++){days.unshift(d);d=previousMarketTradingDate('TW',d);}
 const captures=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,endpoint:'historical/candles',received_at:at,status:'PASS',payload_hash:'a'.repeat(64),rows:days.map((date,i)=>({id:`SYNTHETIC:${symbol}:${date}`,symbol,trading_date:date,captured_at:date+'T13:30:00+08:00',ingested_at:at,raw_payload:{contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',volume_unit:'SHARES',amount_unit:'TWD',open:100+i,high:101+i,low:99+i,close:100+i,volume_shares:1000000+i*1000,amount_twd:100000000}}))}));
 data.universe=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,is_active:true,sector:'SYNTHETIC_SECTOR'}));
 data.quotes=days.map(date=>({id:'SYNTHETIC:TAIEX:'+date,symbol:'TAIEX',trading_date:date,phase:'close',provider:'fugle',value:20000,change_percent:0,captured_at:date+'T13:30:00+08:00',ingested_at:date+'T13:31:00+08:00'}));
 const sources=[{kind:'shares',source:'SYNTHETIC',status:'PASS',received_at:at,http:200,rows:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,session:last,source:'SYNTHETIC',available_at:at,unit:'SHARES',foreign:{buy:20,sell:10,net:10},trust:{buy:20,sell:10,net:10},dealer:{buy:20,sell:10,net:10}}))},
 {kind:'growth',source:'SYNTHETIC',status:'PASS',received_at:at,http:200,rows:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,period:'2026-08',source:'SYNTHETIC',available_at:at,source_date:'2026-09-10',revenue_yoy:.1,revenue_mom:.1,actual_only:true,consensus:null}))}];
 return {data,identity,captures,sources,events:[],events_complete:true,v1:{report_date:identity.report_date,generated_at:at,phase_evaluation:{candidates:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,status:'BLOCKED',reasons:['CONSENSUS_UNAVAILABLE']}))}}};
}
