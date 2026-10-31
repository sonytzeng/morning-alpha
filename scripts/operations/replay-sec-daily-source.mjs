/** Offline candidate for the post-acquisition SEC stage. No RPC, HTTP, model,
 * scheduling or publication side effects. Daily SOURCE cannot consume this
 * result until a separate SEC proof validator is added to its DB contract.
 *
 * node scripts/operations/replay-sec-daily-source.mjs approved.seed.json \
 *   daily-inputs.json daily-packets.json receipts.json evidence_directory out
 *
 * The exact approved source batch seals the retained SEC evidence, not today's
 * price/news input. Each replay requires a baseline acquired on the same Taipei
 * day as its cutoff. Original SEC receipt times are never refreshed by replay.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseSecQuarterFinancials,withSecQuarterFinancials} from '../../research/sec-quarter-financials.ts';
import {buildDailyAiSeed,canonical} from '../../research/daily-ai-seed.ts';
import {buildDailyAiPackets} from '../../research/daily-ai-packets.ts';
import {removeRestrictedFinancialFacts} from '../../research/daily-ai-financial-refresh.ts';
import {compareTime,validObservationTime} from '../../src/features/vnext/contracts.ts';

export const SEC_DAILY_APPROVED_SEED_SHA256='a4398990a8bf63580efae7afee918613783249573f78e1ca7a11fd70de0f6edb';
export const SEC_DAILY_REPLAY_GAPS=[
 'SEC_SOURCE_RETAINED_REPLAY_NOT_REFRESHED',
 'SEC_DIRECT_QUARTER_ACTUALS_OBSERVED_AFTER_RECEIPT_NOT_BACKDATED',
 'SEC_LATER_FILINGS_AND_SUBSEQUENT_REVISIONS_NOT_CHECKED',
 'SEC_TIFRS_QUARTERS_NOT_RECONCILED_TO_IASB_ANNUAL_IFRS',
 'SEC_EARNINGS_RELEASE_NOT_BOARD_APPROVED_AT_RELEASE_SUBSEQUENT_REVISIONS_NOT_CHECKED',
 'DEMAND_MOAT_VALUATION_REVIEW_PENDING',
];
const sha=s=>createHash('sha256').update(s).digest('hex');
const fail=code=>{throw Error('SEC_DAILY_REPLAY_'+code);};
const taipeiDay=s=>new Date(Date.parse(s)+8*3600000).toISOString().slice(0,10);
const secId=id=>typeof id==='string'&&id.startsWith('2330:FINANCIAL:sec-quarter:2330:');
const stockSecId=id=>typeof id==='string'&&id.startsWith('sec-quarter:2330:');

/** Exact-byte seal is deliberately fixed to the reviewed four-quarter source.
 * A new filing/revision needs a new reviewed seal, never an automatic grant. */
export function loadApprovedSecDailySeed(raw){
 if(sha(raw)!==SEC_DAILY_APPROVED_SEED_SHA256)fail('APPROVED_SEAL');
 const approved=JSON.parse(raw);
 if(approved.schema!=='DAILY_AI_BATCH_INPUT_V1'||Object.keys(approved.packet_texts??{}).length!==72
  ||Object.keys(approved.packet_hashes??{}).length!==72)fail('APPROVED_SEED');
 for(const [symbol,packet] of Object.entries(approved.packet_texts))
  if(sha(packet)!==approved.packet_hashes[symbol])fail('APPROVED_PACKET_HASH');
 return approved;
}

/** Validate and merge the sealed facts idempotently. Any same-period changed
 * observation, extra SEC observation, or altered retained fact requires review. */
export async function replaySecDailyFacts(input,facts){
 const own=facts.filter(f=>f.symbol===input.symbol),keys=new Set(own.map(f=>f.kind+':'+f.period));
 if(input.symbol!=='2330')return {input:structuredClone(input),added:0,retained:0};
 if(own.length!==12||keys.size!==12)fail('FACT_SCOPE');
 // Reuse the existing provenance/hash/time checks even when all facts exist.
 await withSecQuarterFinancials({...input,facts:[]},own);
 const known=new Map(own.map(f=>[f.id,f]));
 if(input.facts.some(f=>stockSecId(f.id)&&!known.has(f.id)))fail('UNREVIEWED_SEC_FACT');
 const missing=[];let retained=0;
 for(const fact of own){
  const matches=input.facts.filter(f=>f.kind===fact.kind&&f.period===fact.period);
  if(!matches.length){missing.push(fact);continue;}
  if(matches.length!==1||canonical(matches[0])!==canonical(fact))fail('FACT_CONFLICT');
  retained++;
 }
 return {input:await withSecQuarterFinancials(input,missing),added:missing.length,retained};
}

const safeSupplements=packets=>{
 const pool=new Map();
 for(const packet of packets)for(const e of packet.evidence){
  if(!['NEWS','MARKET'].includes(e.kind))continue;
  let host;try{host=new URL(e.source).hostname;}catch{fail('SUPPLEMENT_SOURCE');}
  if(e.kind==='NEWS'){
   let content;try{content=JSON.parse(e.content);}catch{fail('NEWS_CONTENT');}
   if(host==='udn.com'||host.endsWith('.udn.com')||String(content.provider??'').toUpperCase()==='GNEWS')fail('RESTRICTED_NEWS_SOURCE');
  }
  if(e.kind==='MARKET'&&(host==='yahoo.com'||host.endsWith('.yahoo.com')))fail('RESTRICTED_MARKET_SOURCE');
  const previous=pool.get(e.id);
  if(previous&&canonical(previous)!==canonical(e))fail('SUPPLEMENT_CONFLICT');
  pool.set(e.id,e);
 }
 return [...pool.values()];
};

/** Reusable local post-acquisition stage. It cannot claim the changed inputs
 * belong to the old immutable intake: its parent reference is audit-only. */
export async function prepareSecDailyReplay({inputs,packets,documents,approvedSeed,cutoff}){
 if(!validObservationTime(cutoff)||!Array.isArray(inputs)||inputs.length!==72||!Array.isArray(packets)||packets.length!==72
  ||new Set(inputs.map(s=>s.symbol)).size!==72||new Set(packets.map(s=>s.symbol)).size!==72)fail('BASELINE_SCOPE');
 // Do not let a caller bypass the exact-byte seal by passing an arbitrary object.
 const approved=loadApprovedSecDailySeed(approvedSeed),baselineCutoff=inputs[0].cutoff;
 if(!validObservationTime(baselineCutoff)||compareTime(baselineCutoff,cutoff)>0||taipeiDay(baselineCutoff)!==taipeiDay(cutoff))fail('BASELINE_DAY');
 for(const input of inputs){
  const packet=packets.find(p=>p.symbol===input.symbol);
  if(input.cutoff!==baselineCutoff||!packet||packet.cutoff!==baselineCutoff||packet.company!==input.company
   ||packet.data_through!==input.through||!Array.isArray(packet.evidence)||!Array.isArray(packet.data_gaps))fail('BASELINE_BINDING');
 }
 const supplements=safeSupplements(packets);
 const baseline=buildDailyAiPackets({inputs,cutoff:baselineCutoff,news:supplements.filter(e=>e.kind==='NEWS'),market:supplements.filter(e=>e.kind==='MARKET')});
 for(const packet of baseline.packets){
  const retained=packets.find(p=>p.symbol===packet.symbol);
  const companyEvidence=p=>p.evidence.filter(e=>['PRICE','FINANCIAL'].includes(e.kind)).slice().sort((a,b)=>a.id.localeCompare(b.id));
  if(canonical(companyEvidence(packet))!==canonical(companyEvidence(retained)))fail('BASELINE_EVIDENCE_BINDING');
 }
 if(!Array.isArray(documents)||documents.length!==8)fail('DOCUMENT_SCOPE');
 const periods=[...new Set(documents.map(d=>d.period))].sort(),facts=[];
 if(periods.length!==4)fail('DOCUMENT_SCOPE');
 const ranks=periods.map(p=>/^20\d\d-Q[1-4]$/.test(p)?Number(p.slice(0,4))*4+Number(p.slice(-1)):NaN);
 if(ranks.some((r,i)=>!Number.isFinite(r)||i>0&&r!==ranks[i-1]+1))fail('QUARTER_CONTINUITY');
 for(const period of periods){
  const release=documents.filter(d=>d.period===period&&d.kind==='release');
  const presentation=documents.filter(d=>d.period===period&&d.kind==='presentation');
  if(release.length!==1||presentation.length!==1)fail('DOCUMENT_PAIR');
  facts.push(...await parseSecQuarterFinancials(release[0],presentation[0],cutoff));
 }
 const approvedPacket=JSON.parse(approved.packet_texts['2330']);
 const sealedEvidence=approvedPacket.evidence.filter(e=>secId(e.id));
 if(sealedEvidence.length!==12)fail('APPROVED_FACT_SCOPE');
 const clean=removeRestrictedFinancialFacts(inputs),next=[];let added=0,retained=0;
 for(const input of clean.inputs){
  const merged=await replaySecDailyFacts({...input,cutoff},facts);
  next.push(merged.input);added+=merged.added;retained+=merged.retained;
 }
 const gapsBySymbol=Object.fromEntries(packets.map(p=>[p.symbol,[...new Set([
  ...(p.symbol==='2330'?SEC_DAILY_REPLAY_GAPS:[]),
  ...p.data_gaps.filter(g=>p.symbol!=='2330'||g!=='FOUR_CONSECUTIVE_SINGLE_QUARTER_EPS_SERIES_NOT_ESTABLISHED_BY_NEW_OPEN_DATA'),
  ...(clean.removed.some(r=>r.symbol===p.symbol)?['RESTRICTED_COMPANY_WEBSITE_FACTS_REMOVED_NOT_RELABELLED_OR_RELICENSED']:[]),
 ])]]));
 const seed=await buildDailyAiSeed({inputs:next,cutoff,news:supplements.filter(e=>e.kind==='NEWS'),market:supplements.filter(e=>e.kind==='MARKET'),gapsBySymbol});
 const actualPacket=JSON.parse(seed.body.packet_texts['2330']),actualEvidence=actualPacket.evidence.filter(e=>secId(e.id));
 if(canonical(actualEvidence.slice().sort((a,b)=>a.id.localeCompare(b.id)))!==canonical(sealedEvidence.slice().sort((a,b)=>a.id.localeCompare(b.id))))fail('SEALED_EVIDENCE_DRIFT_OR_TRUNCATION');
 if(SEC_DAILY_REPLAY_GAPS.some(g=>!actualPacket.data_gaps.includes(g)))fail('REPLAY_LIMITATIONS_OMITTED');
 const proof={schema:'SEC_DAILY_RETAINED_REPLAY_CANDIDATE_V1',cutoff,baseline_cutoff:baselineCutoff,
  baseline_inputs_sha256:sha(canonical(inputs)),baseline_packets_sha256:sha(canonical(packets)),
  source_seal_sha256:SEC_DAILY_APPROVED_SEED_SHA256,source_window:periods,
  source_documents:documents.map(({body,...receipt})=>receipt),facts_added:added,facts_retained:retained,
  removals:clean.removed,source_refetched:false,source_original_receipts_preserved:true,
  subsequent_filings_and_revisions_checked:false,source_admitted:false,member_publication_approved:false,
  source_intake_binding:false,daily_source_db_integration:'NOT_INSTALLED_REQUIRES_SEPARATE_SEC_PROOF_VALIDATOR',
  target_hook:'prepareDailyStockAiSource after financial refresh before SOURCE',
  model_calls:0,production_writes:0,member_published:false,metadata:seed.metadata};
 return {seed,inputs:next,facts,proof};
}

async function main(){
 const [approvedPath,inputsPath,packetsPath,receiptsPath,evidenceDirectory,outputPrefix]=process.argv.slice(2);
 if(!outputPrefix)throw Error('Expected approved.seed.json inputs.json packets.json receipts.json evidence_directory output_prefix');
 const [approvedSeed,inputRaw,packetRaw,receiptRaw]=await Promise.all([approvedPath,inputsPath,packetsPath,receiptsPath].map(p=>readFile(p,'utf8')));
 const receipts=JSON.parse(receiptRaw);
 if(!Array.isArray(receipts)||receipts.length!==8)fail('DOCUMENT_SCOPE');
 const documents=await Promise.all(receipts.map(async receipt=>{
  if(!/^20\d\d-Q[1-4]$/.test(receipt.period)||!['release','presentation'].includes(receipt.kind)||receipt.error)fail('DOCUMENT_SCOPE');
  return {...receipt,body:await readFile(join(resolve(evidenceDirectory),`sec-${receipt.period}-${receipt.kind}.html`),'utf8')};
 }));
 const result=await prepareSecDailyReplay({inputs:JSON.parse(inputRaw),packets:JSON.parse(packetRaw),documents,approvedSeed,cutoff:new Date().toISOString()});
 // Exclusive outputs prevent accidental replacement of a reviewed candidate.
 await writeFile(outputPrefix+'.seed.json',result.seed.payload_text,{flag:'wx'});
 await writeFile(outputPrefix+'.replay-proof.json',JSON.stringify(result.proof,null,2)+'\n',{flag:'wx'});
 await writeFile(outputPrefix+'.inputs.json',JSON.stringify(result.inputs)+'\n',{flag:'wx'});
 console.log(JSON.stringify({metadata:result.seed.metadata,facts_added:result.proof.facts_added,facts_retained:result.proof.facts_retained,
  daily_source_db_integration:result.proof.daily_source_db_integration}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
