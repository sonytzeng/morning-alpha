import { evaluateV2Shadow, v2Bars, v2Hash, type V2Input } from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import { evaluateEntry, type EntryInput, type Observation } from './entry-opportunity.ts';
type Row=Record<string,unknown>;
const obj=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
/** No producer call and no replacement of frozen V2. Reuses its as-of validated
 * normalized facts; Canonical market direction/regime must be supplied verbatim. */
export async function entryInputFromV2(input:V2Input, sourceHash:string, market:EntryInput['market'], mode:EntryInput['mode'],provenance:EntryInput['provenance']):Promise<EntryInput>{
  if(await v2Hash(input)!==sourceHash)throw Error('ENTRY_SOURCE_HASH_MISMATCH');
  const baseline=await evaluateV2Shadow(input),at=input.identity.generated_at;
  const fact=baseline.candidates[0]?.evidence.market;
  const quote=fact?.status==='AVAILABLE'?input.data.quotes.find(q=>fact.source_refs.includes(String(q.id))):null;
  // Use the frozen V2 phase/as-of/conflict validator, never a latest-row fallback.
  // Composite availability is the later of Canonical publication and quote availability.
  market=market&&quote?{...market,source_ref:market.source_ref+'|'+String(quote.id),
    observed_at:new Date(Math.max(Date.parse(market.observed_at),Date.parse(String(quote.captured_at)))).toISOString(),
    available_at:new Date(Math.max(Date.parse(market.available_at),Date.parse(String(quote.ingested_at)))).toISOString(),
    value:{...market.value,change_percent:Number(quote.change_percent)}}:null;
  return {business_date:input.identity.report_date,evaluation_time:at,source_revision:input.identity.revision_id,
    source_evidence_hash:sourceHash,market,mode,provenance,stocks:baseline.candidates.map(c=>{
      const e=c.evidence,f=obj(e.fundamental?.value);
      const ref=(key:string)=>e[key]?.source_refs.join('|')||(key==='catalyst'&&input.events_complete?input.identity.revision_id+'#complete-event-feed':'');
      const observation=<T>(value:T,key:string):Observation<T>=>({value,source_ref:ref(key),observed_at:at,available_at:at});
      // at is a conservative availability upper bound from a capsule already
      // validated at that cutoff; original per-bar availability is unchanged.
      return {symbol:c.symbol,name:typeof input.data.universe.find(r=>r.symbol===c.symbol)?.stock_name==='string'?String(input.data.universe.find(r=>r.symbol===c.symbol)?.stock_name):null,
        bars:v2Bars(input,c.symbol).slice(-20),
        fundamental:typeof f.revenue_yoy==='number'&&typeof f.revenue_mom==='number'?observation({revenue_yoy:f.revenue_yoy,revenue_mom:f.revenue_mom,eps_actual:typeof f.eps_actual_as_reported==='number'?f.eps_actual_as_reported:null},'fundamental'):null,
        relative_strength:typeof e.relative_strength?.value==='number'?observation(e.relative_strength.value,'relative_strength'):null,
        sector_return:typeof e.sector?.value==='number'?observation(e.sector.value,'sector'):null,
        events_reviewed:e.catalyst?.status==='AVAILABLE'?observation(Array.isArray(obj(e.catalyst.value).events)&&((obj(e.catalyst.value).events as unknown[]).length===0),'catalyst'):null,
        v2_status:c.status};
    })};
}
export async function compareEntryWithV2(input:V2Input,sourceHash:string,market:EntryInput['market'],provenance:EntryInput['provenance']){
  const normalized=await entryInputFromV2(input,sourceHash,market,'HISTORICAL_REPLAY',provenance);
  return {input:normalized,result:await evaluateEntry(normalized),comparison:'SAME_SAVED_UNIVERSE_AND_CUTOFF',forward_sample:0};
}
