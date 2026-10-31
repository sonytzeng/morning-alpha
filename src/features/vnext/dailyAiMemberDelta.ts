import {parseDailyAiMember,type DailyAiMemberResearch,type DailyAiMemberEdition} from './dailyAiMember.ts';

export type DailyAiMemberReadScope={identity:string;generation:number;signal:AbortSignal;
 tier:DailyAiMemberResearch['tier'];requestDate:string};
/** One already validated projection, in RAM only. This is never entitlement. */
export type DailyAiMemberCache={scope:DailyAiMemberReadScope;data:DailyAiMemberResearch};
export class DailyAiMemberDeltaError extends Error{
 readonly code:'SCOPE'|'CACHE_MISS'|'CONTRACT';
 constructor(code:'SCOPE'|'CACHE_MISS'|'CONTRACT'){super('AI_MEMBER_DELTA_'+code);this.code=code;}
}
const editionFields=Object.freeze(['id','edition_date','data_through','evidence_cutoff','prepared_at','expires_at','mode','forecast','performance_available'] as const);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const sameEdition=(value:unknown,expected:DailyAiMemberEdition|null)=>expected===null?value===null:
 object(value)&&Object.keys(value).length===editionFields.length&&editionFields.every(key=>value[key]===expected[key]);

export function eligibleDailyAiMemberCache(cache:DailyAiMemberCache|null,scope:DailyAiMemberReadScope,now=Date.now()):cache is DailyAiMemberCache{
 return !!cache&&Number.isFinite(now)&&!scope.signal.aborted&&!cache.scope.signal.aborted
  &&cache.scope.identity===scope.identity&&cache.scope.generation===scope.generation&&cache.scope.signal===scope.signal
  &&cache.scope.tier===scope.tier&&cache.scope.requestDate===scope.requestDate
  &&cache.data.tier===scope.tier&&cache.data.business_date===scope.requestDate
  &&!!cache.data.edition&&Date.parse(cache.data.edition.expires_at)>now;
}
export function dailyAiMemberKnownArgs(cache:DailyAiMemberCache|null,scope:DailyAiMemberReadScope,now=Date.now()){
 return eligibleDailyAiMemberCache(cache,scope,now)
  ?{p_known_edition_id:cache.data.edition!.id,p_known_tier:cache.data.tier}
  :{p_known_edition_id:null,p_known_tier:null};
}
/** FULL always replaces. UNCHANGED is usable only after the server has rerun
 * every publication/rights/entitlement gate and returned this exact scope.
 * Every edition field, including expiry, stays pinned; no freshness is added. */
export function parseDailyAiMemberDelta(value:unknown,scope:DailyAiMemberReadScope,cache:DailyAiMemberCache|null,now=Date.now()):DailyAiMemberResearch{
 if(!object(value))throw new DailyAiMemberDeltaError('CONTRACT');
 const mode=value.mode,bad=():never=>{throw new DailyAiMemberDeltaError(mode==='UNCHANGED'?'CACHE_MISS':'CONTRACT');};
 if(scope.signal.aborted||value.user_id!==scope.identity||value.tier!==scope.tier)throw new DailyAiMemberDeltaError('SCOPE');
 const keys=['schema','mode','user_id','tier','business_date','research_only','edition',...(mode==='FULL'?['payload']:[])].sort();
 if(value.schema!=='VNEXT_AI_MEMBER_DELTA_V1'||value.research_only!==true||value.business_date!==scope.requestDate
  ||!['FULL','UNCHANGED'].includes(String(mode))||Object.keys(value).sort().join('|')!==keys.join('|'))bad();
 if(mode==='FULL'){
  const data=parseDailyAiMember(value.payload,scope.requestDate,now);
  if(data.tier!==scope.tier)throw new DailyAiMemberDeltaError('SCOPE');
  if(!sameEdition(value.edition,data.edition))bad();
  return data;
 }
 if(!eligibleDailyAiMemberCache(cache,scope,now)||!sameEdition(value.edition,cache.data.edition))bad();
 return cache.data;
}
