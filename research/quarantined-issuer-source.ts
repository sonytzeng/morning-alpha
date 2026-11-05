/** Internal SOURCE-only retained research binding. No model or member grant.
 * Default model/batch readers must keep their commercial-source restrictions. */
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import type {FunnelInput,ResearchFact} from '../src/features/vnext/researchFunnel.ts';
import type {AnalysisEvidence} from './daily-ai-analysis.ts';
import {parseIssuerIrDailyRegistry} from './issuer-ir-daily-financial-replay.ts';
import {parseUmcIrDailyRegistry} from './umc-ir-daily-financial-replay.ts';

export const ISSUER_QUARANTINE_GAP='QUARANTINED_ISSUER_RESEARCH_NOT_LICENSED_FOR_MODEL_OR_MEMBER_USE';
export type QuarantinedIssuerSourcePolicy={scope:'PRIVATE_SOURCE_RESEARCH_ONLY';issuer_registry:unknown;umc_registry:unknown;
 source_admitted:false;member_publication_approved:false};
const brand=Symbol('PRIVATE_SOURCE_ISSUER_BINDING');
export type QuarantinedIssuerSourceBinding={readonly [brand]:true;readonly restrictedIds:ReadonlySet<string>;
 readonly evidence:ReadonlyMap<string,{symbol:string;hash:string}>};
const fail=():never=>{throw Error('AI_INTAKE_QUARANTINED_ISSUER_BINDING_INVALID');};
const own=(f:{id:string})=>f.id.startsWith('issuer-ir-direct:')||f.id.startsWith('umc-ir-direct:');
export function isQuarantinedIssuerFactId(id:unknown){return typeof id==='string'&&(id.startsWith('issuer-ir-direct:')||id.startsWith('umc-ir-direct:'));}
export function restrictedIssuerFinancialSource(source:string){
 try{const host=new URL(source).hostname;return ['tsmc.com','mediatek.com','honhai.com'].some(root=>host===root||host.endsWith('.'+root));}
 catch{return false;}
}
export function hasQuarantinedIssuerFacts(inputs:unknown){
 return Array.isArray(inputs)&&inputs.some(i=>i&&typeof i==='object'&&Array.isArray(i.facts)
  &&i.facts.some((f:unknown)=>f&&typeof f==='object'&&isQuarantinedIssuerFactId((f as {id?:unknown}).id)));
}
/** Model readers reject the marker and the underlying identity independently.
 * Renaming an evidence ID or dropping the display gap cannot erase quarantine. */
export function hasQuarantinedIssuerEvidence(e:unknown){
 if(!e||typeof e!=='object'||(e as {kind?:unknown}).kind!=='FINANCIAL')return false;
 const value=e as {id?:unknown;content?:unknown};
 if(typeof value.id==='string'&&(value.id.includes(':FINANCIAL:issuer-ir-direct:')||value.id.includes(':FINANCIAL:umc-ir-direct:')))return true;
 if(typeof value.content==='string'){
  try{return isQuarantinedIssuerFactId((JSON.parse(value.content) as {original_id?:unknown}).original_id);}catch{/* Normal evidence validation handles malformed JSON. */}
 }
 return false;
}
const ordered=(facts:ResearchFact[])=>facts.slice().sort((a,b)=>a.id.localeCompare(b.id));

/** Input and registry snapshots are owned before the first asynchronous hash.
 * Only complete exact fixed sets can receive this internal research binding. */
export async function bindQuarantinedIssuerSource(inputs:FunnelInput[],cutoff:string,raw:QuarantinedIssuerSourcePolicy):Promise<QuarantinedIssuerSourceBinding>{
 const capturedInputs=structuredClone(inputs),p=structuredClone(raw);
 if(p.scope!=='PRIVATE_SOURCE_RESEARCH_ONLY'||p.source_admitted!==false||p.member_publication_approved!==false
  ||!Array.isArray(capturedInputs)||capturedInputs.length!==72||new Set(capturedInputs.map(i=>i.symbol)).size!==72
  ||capturedInputs.some(i=>!Array.isArray(i.facts)))fail();
 const expectedIssuer=await parseIssuerIrDailyRegistry(p.issuer_registry,cutoff);
 const expectedUmc=await parseUmcIrDailyRegistry(p.umc_registry,cutoff);
 const incoming=capturedInputs.flatMap(i=>i.facts.filter(own).map(f=>({symbol:i.symbol,fact:f})));
 if(!incoming.length||incoming.some(({symbol,fact})=>symbol!==(fact as {symbol?:string}).symbol))fail();
 const actualIssuer=incoming.filter(x=>x.fact.id.startsWith('issuer-ir-direct:')).map(x=>x.fact);
 const actualUmc=incoming.filter(x=>x.fact.id.startsWith('umc-ir-direct:')).map(x=>x.fact);
 if(actualIssuer.length&&await snapshotHash(ordered(actualIssuer))!==await snapshotHash(ordered(expectedIssuer)))fail();
 if(actualUmc.length&&await snapshotHash(ordered(actualUmc))!==await snapshotHash(ordered(expectedUmc)))fail();
 const evidence=new Map<string,{symbol:string;hash:string}>(),restrictedIds=new Set<string>();
 for(const {symbol,fact:f} of incoming){
  if(evidence.has(symbol+':FINANCIAL:'+f.id))fail();
  const e:AnalysisEvidence={id:symbol+':FINANCIAL:'+f.id,symbol,kind:'FINANCIAL',source:f.source,
   published_at:f.published_at,first_seen_at:f.first_seen_at!,available_at:f.available_at!,as_of:f.as_of!,
   evidence_hash:f.evidence_hash,time_basis:f.published_at===null?'OBSERVED_AFTER_RECEIPT':'PUBLISHED',
   content:JSON.stringify({kind:f.kind,period:f.period,basis:f.basis,values:f.values,original_id:f.id})};
  evidence.set(e.id,{symbol,hash:await snapshotHash(e)});
  if(restrictedIssuerFinancialSource(f.source))restrictedIds.add(f.id);
 }
 return {[brand]:true,restrictedIds,evidence};
}

/** The compiler may retain quarantined facts, never alter their packet fields
 * or silently truncate one from the fixed set. The quarantine gap is mandatory. */
export async function verifyQuarantinedIssuerSeed(body:{packet_texts:Record<string,string>},binding:QuarantinedIssuerSourceBinding){
 if(binding[brand]!==true)fail();
 const captured=structuredClone(body),expectedEvidence=structuredClone(new Map(binding.evidence)),seen=new Set<string>();
 for(const [symbol,text] of Object.entries(captured.packet_texts)){
  const p=JSON.parse(text) as {symbol:string;evidence:AnalysisEvidence[];data_gaps:string[]};
  if(p.symbol!==symbol||!Array.isArray(p.evidence)||!Array.isArray(p.data_gaps)||!p.data_gaps.includes(ISSUER_QUARANTINE_GAP))fail();
  for(const e of p.evidence){
   const expected=expectedEvidence.get(e.id),fixed=e.id.includes(':FINANCIAL:issuer-ir-direct:')||e.id.includes(':FINANCIAL:umc-ir-direct:');
   if(expected){if(seen.has(e.id)||expected.symbol!==symbol||await snapshotHash(e)!==expected.hash)fail();seen.add(e.id);}
   else if(fixed||e.kind==='FINANCIAL'&&restrictedIssuerFinancialSource(e.source))fail();
  }
 }
 if(seen.size!==expectedEvidence.size)fail();
}
