import {buildDailyAiPackets} from './daily-ai-packets.ts';
import type {AnalysisEvidence} from './daily-ai-analysis.ts';
import type {FunnelInput} from '../src/features/vnext/researchFunnel.ts';
import {canonical} from './entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';

export {canonical,snapshotHash};
export type DailyAiSeedSourceHandoff={handoff_id:string;source_run_id:string;source_revision:string;
 source_cutoff:string;source_business_date:string;projection?:'DAILY_AI_RETAINED_INPUT_PROJECTION_V1'};
export type DailyAiSeedSourceIntake={intake_id:string;source_kind:'VNEXT_ACQUIRED'|'ASOF_INTAKE';source_id:string;
 source_revision:string;source_cutoff:string;source_business_date:string;snapshot_hash:string;projection:'DAILY_AI_RETAINED_INPUT_PROJECTION_V1'};
/** Pure canonical compiler shared by the local CLI and the server intake.
 * Optional limitations become part of every hashed packet, never a side note. */
export async function buildDailyAiSeed(input:{inputs:FunnelInput[];cutoff:string;news?:AnalysisEvidence[];market?:AnalysisEvidence[];
 additionalGaps?:string[];gapsBySymbol?:Record<string,string[]>;sourceHandoff?:DailyAiSeedSourceHandoff;sourceIntake?:DailyAiSeedSourceIntake;signal?:AbortSignal}){
 if(input.signal?.aborted)throw Error('AI_SEED_ABORTED');
 const additional=input.additionalGaps??[];
 if(additional.length>2048||additional.some(g=>typeof g!=='string'||!g.trim()||g.length>1500))throw Error('AI_SEED_GAPS');
 const built=buildDailyAiPackets({inputs:input.inputs,cutoff:input.cutoff,news:input.news??[],market:input.market??[]});
 const symbols=new Set(built.packets.map(p=>p.symbol));
 if(input.gapsBySymbol&&(Object.keys(input.gapsBySymbol).length>72||Object.entries(input.gapsBySymbol).some(([symbol,gaps])=>!symbols.has(symbol)
  ||!Array.isArray(gaps)||gaps.length>100||gaps.some(g=>typeof g!=='string'||!g.trim()||g.length>1500))))throw Error('AI_SEED_SYMBOL_GAPS');
 const packet_texts:Record<string,string>={},packet_hashes:Record<string,string>={};
 for(const packet of built.packets.slice().sort((a,b)=>a.symbol.localeCompare(b.symbol))){
  if(input.signal?.aborted)throw Error('AI_SEED_ABORTED');
  if(additional.length||input.gapsBySymbol?.[packet.symbol]?.length){
   const required=additional.filter(g=>!g.startsWith('SOURCE_INGEST_')),details=additional.filter(g=>g.startsWith('SOURCE_INGEST_'));
   const gaps=[...new Set([...(packet.data_gaps??[]),...required,...(input.gapsBySymbol?.[packet.symbol]??[]),...details])];
   packet.data_gaps=gaps.length>100?[...gaps.slice(0,99),'SOURCE_ISSUE_LIMIT_DETAILS_NOT_INCLUDED']:gaps;
   built.gaps[packet.symbol]=packet.data_gaps.slice();
  }
  packet_texts[packet.symbol]=canonical(packet);packet_hashes[packet.symbol]=await snapshotHash(packet);
 }
 if(input.signal?.aborted)throw Error('AI_SEED_ABORTED');
 const body={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff:built.cutoff,through:built.through,packet_texts,packet_hashes,gaps:built.gaps,
  ...(input.sourceHandoff?{source_handoff:{...input.sourceHandoff}}:{}),...(input.sourceIntake?{source_intake:{...input.sourceIntake}}:{})};
 const payload_text=canonical(body),payload_hash=await snapshotHash(body),bytes=new TextEncoder().encode(payload_text).byteLength;
 if(input.signal?.aborted)throw Error('AI_SEED_ABORTED');
 if(bytes>12000000)throw Error('AI_SEED_DATABASE_LIMIT');
 return {body,payload_text,metadata:{schema:body.schema,payload_hash,bytes,cutoff:built.cutoff,through:built.through,
  packets:built.packets.length,evidence:built.packets.reduce((n,p)=>n+p.evidence.length,0),
  published_time_unknown:built.packets.reduce((n,p)=>n+p.evidence.filter(e=>e.published_at===null).length,0),
  model_calls:0,production_writes:0,member_published:false}};
}
