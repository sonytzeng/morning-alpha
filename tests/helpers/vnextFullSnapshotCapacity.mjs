// SYNTHETIC capacity fixture only. No real prices, SourceReceipt or authority.
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
import {sessionsBefore} from '../../src/features/vnext/dailyAdapter.ts';
import {RECOMMENDATION_UNIVERSE} from '../../supabase/functions/_shared/recommendation-stock-evidence.ts';
export async function fullCapacityAcquired(date,cutoff){
 const dates=sessionsBefore(date),source='https://example.test/SYNTHETIC-capacity?resource='+('x'.repeat(350));
 const inputs=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'SYNTHETIC capacity '+symbol,cutoff,through:dates.at(-1),next_session:date,expected_sessions:dates,
  bars:dates.map(d=>({id:'SYNTHETIC-'+symbol+'-'+d,symbol,date:d,source,evidence_hash:'a'.repeat(64),published_at:null,first_seen_at:cutoff,available_at:cutoff,
   as_of:d+'T13:30:00+08:00',open:100,high:101,low:99,close:100,volume:10000,amount:1000000,session_scope:'SYNTHETIC'})),
  facts:[],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}}));
 // Match the runtime's existing protocol vocabulary, never its real-data claim.
 // This fixture is only accepted by disposable SQL/test adapters; no live SDK.
 const entry={business_date:date,evaluation_time:cutoff,source_revision:'b'.repeat(64),source_evidence_hash:await snapshotHash(inputs),market:null,
  provenance:'REAL_RETAINED',mode:'FORWARD',stocks:inputs.map(i=>({symbol:i.symbol,name:i.company,bars:i.bars.slice(-20).map(b=>({...b,source_ref:b.source})),
   fundamental:null,relative_strength:null,sector_return:null,events_reviewed:null,v2_status:null}))};
 const body={inputs,entry,evidence_cutoff:cutoff};return {...body,snapshot_hash:await snapshotHash(body)};
}
