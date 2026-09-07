// Synthetic values in the EXACT audited Production table shapes. Not fixtures
// of a provider delivery, investment backtest, or calibrated forecast.
import { emptyEvidenceData } from '../../supabase/functions/_shared/decision-v1-data.ts';
export const IDENTITY = { report_date: '2026-09-07', today_date: '2026-09-07', revision_id: 'isolated-decision-revision', generated_at: '2026-09-07T02:00:00Z', data_as_of: '2026-09-07T02:00:00Z', is_trading_day: true };
export function evidenceRows({ crash = false, damaged = false, extended = false } = {}) {
  const d = emptyEvidenceData();
  const stocks = ['2330','2317','2382'];
  const dates = []; let date = new Date('2026-09-04T05:30:00Z');
  while (dates.length < 22) { if (![0,6].includes(date.getUTCDay())) dates.unshift(date.toISOString()); date.setUTCDate(date.getUTCDate()-1); }
  const quote = (symbol, at, price, change, volume, phase='close') => ({ id: `${symbol}-${at}`, provider: 'fugle', symbol, asset_type: /^\d/.test(symbol)?'equity':'index', market: 'TW', trading_date:at.slice(0,10),phase,value:price,change_percent:change,captured_at:at,ingested_at:at,quality_status:'verified',freshness_status:'fresh',raw_payload:{source_raw:{total:{tradeVolume:volume}}} });
  for (const symbol of [...stocks,'TAIEX','TXF','SOX','SPX']) {
    dates.forEach((at,i)=>d.quotes.push(quote(symbol,at,100+i*.1,1,1000)));
    const price=crash?90:extended?130:102.3;
    d.quotes.push(quote(symbol,'2026-09-07T01:59:00Z',price,crash?-5:extended?8:1.5,1500,'intraday'));
  }
  d.news.push({id:'event-1',title:'Synthetic manufacturer results reported',source_name:'Fixture official filing',source_url:'https://example.test/filing',published_at:'2026-09-07T00:00:00Z',created_at:'2026-09-07T00:01:00Z',event_type:'earnings',symbols:stocks,sectors:['electronic']});
  d.catalysts.push({id:'catalyst-1',title:'Fixture filing',event_at:d.news[0].published_at,created_at:d.news[0].created_at,source_refs:['event-1']});
  for (const [idx,symbol] of stocks.entries()) {
    d.universe.push({id:'universe-'+symbol,symbol,stock_name:'Synthetic company '+symbol,sector:'electronic',is_active:true,created_at:'2026-08-01T00:00:00Z',updated_at:'2026-08-01T00:00:00Z'});
    for(let quarter=1;quarter<=4;quarter++) {
      const at=['2026-08-10T00:00:00Z','2026-05-10T00:00:00Z','2026-02-10T00:00:00Z','2025-11-10T00:00:00Z'][quarter-1];
      d.earnings.push({id:`earnings-${symbol}-${quarter}`,provider:'fixture-official',symbol,fiscal_period:['2026-Q2','2026-Q1','2025-Q4','2025-Q3'][quarter-1],announced_at:at,created_at:at,revenue_actual:damaged?70:120,revenue_consensus:100,eps_actual:damaged?2:5,eps_consensus:4,guidance_direction:damaged?'down':'stable',source_ref:`https://example.test/earnings/${symbol}/${quarter}`});
    }
    d.mappings.push({id:'mapping-'+symbol,catalyst_id:'catalyst-1',stock_symbol:symbol,company_name:'Synthetic company '+symbol,sector:'electronic',transmission_path:'Fixture event to reported earnings',taiwan_supply_chain_relation:'Fixture documented supplier',invalidation_condition:'Next filing contradicts the reported earnings',source_refs:[`https://example.test/earnings/${symbol}/1`],created_at:'2026-09-07T00:02:00Z'});
    for(const institution_type of ['foreign','investment_trust','dealer']) d.flows.push({id:`flow-${idx}-${institution_type}`,provider:'fixture-official',market:'TW',symbol,trading_date:'2026-09-07',institution_type,buy_amount:200,sell_amount:100,net_amount:100,currency:'TWD',captured_at:'2026-09-07T01:50:00Z',created_at:'2026-09-07T01:50:00Z',source_ref:'https://example.test/flows'});
  }
  // Give stocks modest positive relative return versus benchmark for confirmation.
  for(const institution_type of ['foreign','investment_trust','dealer']) d.flows.push({id:`market-flow-${institution_type}`,provider:'fixture-official',market:'TW',symbol:'TAIEX',trading_date:'2026-09-07',institution_type,buy_amount:200,sell_amount:100,net_amount:100,currency:'TWD',captured_at:'2026-09-07T01:50:00Z',created_at:'2026-09-07T01:50:00Z',source_ref:'https://example.test/flows'});
  if (!crash && !extended) d.quotes.filter(q=>q.phase==='intraday'&&stocks.includes(q.symbol)).forEach(q=>{q.value=102.5;});
  return d;
}
