import { entryInputFromV2 } from './entry-v2-adapter.ts';
import { evaluateEntry, canonical, type EntryInput } from './entry-opportunity.ts';
import type { V2Input } from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
export interface EntrySource {id:string;input_sha256:string;evidence:V2Input;market:EntryInput['market']}
export async function runEntryResearch(source:EntrySource,mode:EntryInput['mode'],store:(source:string,text:string,result:unknown)=>Promise<{error:unknown;data?:unknown}>,now:string){
  const cutoff=Date.parse(source.evidence.identity.generated_at),clock=Date.parse(now);
  if(!Number.isFinite(clock)||cutoff>clock||(mode==='FORWARD'&&(clock-cutoff>300000||clock<cutoff)))throw Error('ENTRY_NOT_CURRENT');
  const input=await entryInputFromV2(source.evidence,source.input_sha256,source.market,mode,'REAL_RETAINED');
  const result=await evaluateEntry(input);
  const stored=await store(source.id,canonical(input),result);
  if(stored.error)throw Error('ENTRY_PERSISTENCE_REJECTED');
  return {status:'STORED_OR_IDEMPOTENT',counts:result.counts,universe:result.universe,shadow_only:true,business_writes:[],receipt:stored.data};
}
