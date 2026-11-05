/** New-cutoff offline candidate; never rewrites an intake, invokes a model or
 * imports/publishes a batch. Original receipts and 71 other issuers stay exact. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildDailyAiSeed,canonical} from '../../../research/daily-ai-seed.ts';
import {buildDailyAiPackets} from '../../../research/daily-ai-packets.ts';
import {mergeRetainedSecDailyFacts,SEC_RETAINED_FACTS_SHA256} from '../../../research/sec-daily-financial-replay.candidate.ts';
import {parseDocumentedReviewRegistry,stripVerifiedDocumentedReviews,applyDocumentedReviews} from '../../../research/documented-review-replay-v2.candidate.ts';
import {DOCUMENTED_REVIEW_V2_CONTRACT as C} from '../../../research/documented-review-v2-contract.candidate.ts';
import {snapshotHash,compareTime,validObservationTime} from '../../../src/features/vnext/contracts.ts';
import {evaluateResearch} from '../../../src/features/vnext/researchFunnel.ts';
const [inputsPath,baseSeedPath,financialPath,registryPath,expectedBaseSha,outputPrefix]=process.argv.slice(2);
if(!outputPrefix||!/^[a-f0-9]{64}$/.test(expectedBaseSha??''))throw Error('Expected inputs.json baseline.seed.json v1.facts.json registry.json expected_base_sha256 output_prefix');
const sha=b=>createHash('sha256').update(b).digest('hex');
const [inputRaw,baseRaw,financialRaw,registryRaw]=await Promise.all([inputsPath,baseSeedPath,financialPath,registryPath].map(p=>readFile(p)));
if(sha(baseRaw)!==expectedBaseSha)throw Error('REVIEW_V2_BASELINE_SEAL');
const base=JSON.parse(baseRaw),rawInputs=JSON.parse(inputRaw),financial=JSON.parse(financialRaw),registry=JSON.parse(registryRaw);
if(base.schema!=='DAILY_AI_BATCH_INPUT_V1'||Object.keys(base.packet_texts??{}).length!==72||!validObservationTime(base.cutoff)
 ||await snapshotHash(financial)!==SEC_RETAINED_FACTS_SHA256)throw Error('REVIEW_V2_BASELINE_SCOPE');
const packets=Object.entries(base.packet_texts).map(([symbol,text])=>{
 if(sha(text)!==base.packet_hashes[symbol])throw Error('REVIEW_V2_BASELINE_PACKET_HASH');return JSON.parse(text);
});
const pool=new Map();
for(const p of packets)for(const e of p.evidence.filter(e=>['NEWS','MARKET'].includes(e.kind))){
 const prior=pool.get(e.id);if(prior&&canonical(prior)!==canonical(e))throw Error('REVIEW_V2_BASELINE_SUPPLEMENT_DRIFT');pool.set(e.id,e);
}
const supplements=[...pool.values()],news=supplements.filter(e=>e.kind==='NEWS'),market=supplements.filter(e=>e.kind==='MARKET');
const cleaned=await stripVerifiedDocumentedReviews(rawInputs),baseline=[];
for(const input of cleaned)baseline.push(await mergeRetainedSecDailyFacts({...input,cutoff:base.cutoff},financial));
const reconstructed=buildDailyAiPackets({inputs:baseline,cutoff:base.cutoff,news,market});
for(const p of reconstructed.packets){
 const retained=packets.find(b=>b.symbol===p.symbol);
 if(!retained||canonical(retained.evidence)!==canonical(p.evidence))throw Error('REVIEW_V2_BASELINE_EVIDENCE_MISMATCH:'+p.symbol);
}
// Sample a new receipt-aware cutoff only after all retained sources were loaded.
const cutoff=new Date().toISOString();if(compareTime(cutoff,base.cutoff)<=0)throw Error('REVIEW_V2_CUTOFF_NOT_NEW');
const facts=await parseDocumentedReviewRegistry(registry,cutoff),working=baseline.map(i=>({...i,cutoff}));
const reviewed=await applyDocumentedReviews(working,facts,cutoff);
if(reviewed.proof.state!=='ACTIVE')throw Error('REVIEW_V2_ONE_SHOT_NOT_ACTIVE:'+reviewed.proof.state);
const omitted=[];
const stock=reviewed.inputs.find(s=>s.symbol==='2330');
for(const kind of ['EPS_AS_REPORTED','FINANCIAL_AS_REPORTED','VALUATION_AS_REPORTED']){
 const matches=stock.facts.filter(f=>f.kind===kind).sort((a,b)=>(b.period??'').localeCompare(a.period??'')
  ||compareTime(b.available_at,a.available_at)||(a.id<b.id?1:a.id>b.id?-1:0));
 const discard=matches.slice(1);omitted.push(...discard.map(f=>({id:f.id,kind:f.kind,source:f.source,available_at:f.available_at,reason:'ACTIVE_REVIEW_BUDGET_LATEST_ONE_AS_REPORTED_PER_KIND'})));
 stock.facts=stock.facts.filter(f=>!discard.includes(f));
}
const reviewCodes=['OWN_REVIEW_NOT_SEC_VERDICT_BOUND_QUOTE_EXPIRY_ASSUMPTIONS_NOT_FCFE_OR_DIVIDENDS',
 'VALUATION_NOT_SUPPORTED_ONLY_AT_BOUND_PRICE_AND_REVIEWED_25_PERCENT_DISCOUNT_POLICY',
 'ASSUMED_PAYOUT_NOT_FCFE_OR_DECLARED_DIVIDENDS_TERMINAL_VALUE_AND_EPS_NORMALIZATION_UNCERTAIN'];
const gapsBySymbol=Object.fromEntries(packets.map(p=>[p.symbol,p.symbol==='2330'?[...new Set([
 ...reviewCodes,...p.data_gaps.filter(g=>!['DEMAND_MOAT_VALUATION_REVIEW_PENDING','CAPEX_DEMAND_MOAT_VALUATION_REQUIRE_SEPARATE_EVIDENCE',
  'SEC_RELEASE_NOT_BOARD_APPROVED_AT_RELEASE_REVISIONS_AND_QUALITATIVE_REVIEW_PENDING'].includes(g)),
])]:p.data_gaps.slice()]));
const seed=await buildDailyAiSeed({inputs:reviewed.inputs,cutoff,news,market,gapsBySymbol});
const target=JSON.parse(seed.body.packet_texts['2330']),required=[...financial,...facts].map(f=>'2330:FINANCIAL:'+f.id);
if(required.some(id=>target.evidence.filter(e=>e.id===id).length!==1))throw Error('REVIEW_V2_FULL_15_EVIDENCE_NOT_RETAINED');
if(reviewCodes.some(g=>!target.data_gaps.includes(g)))throw Error('REVIEW_V2_SCOPE_GAPS_OMITTED');
for(const packet of packets){
 if(packet.symbol==='2330')continue;
 const next=JSON.parse(seed.body.packet_texts[packet.symbol]);
 if(canonical(next.evidence)!==canonical(packet.evidence)||next.company!==packet.company||next.data_through!==packet.data_through)
  throw Error('REVIEW_V2_OTHER_ISSUER_DRIFT:'+packet.symbol);
 const original=rawInputs.find(i=>i.symbol===packet.symbol),copy=reviewed.inputs.find(i=>i.symbol===packet.symbol);
 if(canonical({...original,cutoff})!==canonical(copy))throw Error('REVIEW_V2_OTHER_INPUT_DRIFT:'+packet.symbol);
}
const long=evaluateResearch(stock,'LONG');
if(!long.evaluated||long.state!=='REJECTED'||long.reasons.join('|')!=='VALUATION:NOT_SUPPORTED')throw Error('REVIEW_V2_LONG_SCOPE_DRIFT');
const manifest={schema:'DOCUMENTED_REVIEW_NEW_CUTOFF_SEED_CANDIDATE_V2',cutoff,base_batch_sha256:expectedBaseSha,
 base_cutoff:base.cutoff,baseline_input_sha256:sha(inputRaw),source_seal_sha256:C.source_seal_sha256,facts_sha256:C.facts_sha256,
 registry_file_sha256:sha(registryRaw),financial_facts_file_sha256:sha(financialRaw),metadata:seed.metadata,
 full_15_evidence_retained:true,other_71_inputs_and_packet_evidence_unchanged:true,raw_receipts_rewritten:false,
 projection_omissions:omitted,documented_review_replay:reviewed.proof,long:{state:long.state,evaluated:long.evaluated,reasons:long.reasons},
 research_product_state:'WAIT_AT_BOUND_QUOTE_NOT_CERTAIN_OVERVALUATION',source_intake_binding:false,
 source_admitted:false,member_publication_approved:false,model_calls:0,production_writes:0,member_published:false};
await writeFile(outputPrefix+'.seed.json',seed.payload_text,{flag:'wx'});
await writeFile(outputPrefix+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
await writeFile(outputPrefix+'.inputs.json',JSON.stringify(reviewed.inputs)+'\n',{flag:'wx'});
await writeFile(outputPrefix+'.2330-packet.json',JSON.stringify(target,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({metadata:seed.metadata,source_seal_sha256:C.source_seal_sha256,full_15_evidence_retained:true,long:manifest.long,production_writes:0}));
