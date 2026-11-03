/** Offline, append-only source candidate. No HTTP, database or model calls. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseSecQuarterFinancials,withSecQuarterFinancials} from '../../research/sec-quarter-financials.ts';
import {buildDailyAiSeed,canonical} from '../../research/daily-ai-seed.ts';
import {evaluateResearch} from '../../src/features/vnext/researchFunnel.ts';
const [inputsPath,packetsPath,receiptsPath,evidenceDirectory,outputPrefix]=process.argv.slice(2);
if(!outputPrefix||!evidenceDirectory)throw Error('Expected inputs.json packets.json receipts.json evidence_directory output_prefix');
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const [inputs,packets,receipts]=await Promise.all([read(inputsPath),read(packetsPath),read(receiptsPath)]);
if(inputs.length!==72||packets.length!==72||receipts.length!==8||new Set(inputs.map(s=>s.symbol)).size!==72)throw Error('SEC_SEED_SCOPE');
const cutoff=new Date().toISOString(),facts=[];
for(const period of [...new Set(receipts.map(r=>r.period))].sort()){
 if(!/^20\d\d-Q[1-4]$/.test(period))throw Error('SEC_SEED_PERIOD');
 const documents=await Promise.all(['release','presentation'].map(async kind=>{
  const matches=receipts.filter(r=>r.period===period&&r.kind===kind);if(matches.length!==1||matches[0].error)throw Error('SEC_SEED_RECEIPT');
  return {...matches[0],body:await readFile(join(resolve(evidenceDirectory),`sec-${period}-${kind}.html`),'utf8')};
 }));
 facts.push(...await parseSecQuarterFinancials(documents[0],documents[1],cutoff));
}
const periods=[...new Set(facts.map(f=>f.period))].sort();
const ranks=periods.map(p=>Number(p.slice(0,4))*4+Number(p.slice(-1)));
if(periods.length!==4||facts.length!==12||ranks.some((n,i)=>i>0&&n!==ranks[i-1]+1))throw Error('SEC_SEED_QUARTER_CONTINUITY');
const next=[];let before,after;
for(const input of inputs){
 const fresh={...structuredClone(input),cutoff};
 if(input.symbol==='2330'){
  before=evaluateResearch(fresh,'LONG');const enriched=await withSecQuarterFinancials(fresh,facts);
  after=evaluateResearch(enriched,'LONG');next.push(enriched);
 }else next.push(fresh);
}
if(!before||!after)throw Error('SEC_SEED_ISSUER_MISSING');
const supplements=new Map();
for(const packet of packets)for(const item of packet.evidence.filter(e=>['NEWS','MARKET'].includes(e.kind))){
 const existing=supplements.get(item.id);
 if(existing&&canonical(existing)!==canonical(item))throw Error('SEC_SEED_SUPPLEMENT_CONFLICT');
 supplements.set(item.id,item);
}
const gapsBySymbol=Object.fromEntries(packets.map(p=>[p.symbol,p.data_gaps.slice()]));
gapsBySymbol['2330']=gapsBySymbol['2330'].filter(g=>g!=='FOUR_CONSECUTIVE_SINGLE_QUARTER_EPS_SERIES_NOT_ESTABLISHED_BY_NEW_OPEN_DATA');
gapsBySymbol['2330'].push('SEC_DIRECT_QUARTER_ACTUALS_OBSERVED_AFTER_RECEIPT_NOT_BACKDATED','DEMAND_MOAT_VALUATION_REVIEW_PENDING',
 'SEC_EARNINGS_RELEASE_NOT_BOARD_APPROVED_AT_RELEASE_SUBSEQUENT_REVISIONS_NOT_CHECKED');
const seed=await buildDailyAiSeed({inputs:next,cutoff,news:[...supplements.values()].filter(e=>e.kind==='NEWS'),
 market:[...supplements.values()].filter(e=>e.kind==='MARKET'),gapsBySymbol});
const tsmc=JSON.parse(seed.body.packet_texts['2330']);
const required=new Set(facts.map(f=>'2330:FINANCIAL:'+f.id));
for(const e of tsmc.evidence)required.delete(e.id);
if(required.size)throw Error('SEC_SEED_ACTUALS_TRUNCATED');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest={schema:'SEC_QUARTER_SOURCE_CANDIDATE_V1',cutoff,parent_intake_reference:'e643db43-4d43-47b6-800c-631d8826ce7b',
 input_sha256:sha(await readFile(inputsPath)),packet_sha256:sha(await readFile(packetsPath)),receipts_sha256:sha(await readFile(receiptsPath)),
 metadata:seed.metadata,actuals_in_tsmc_packet:12,source_documents:receipts.map(({body,...r})=>r),
 long_before:{state:before.state,gaps:before.reasons},long_after:{state:after.state,gaps:after.reasons},
 source_admission:false,publication_approval:false,daily_refresh_integration_required:true,
 production_import:false,model_calls:0,production_writes:0,member_published:false};
await writeFile(outputPrefix+'.seed.json',seed.payload_text,{flag:'wx'});
await writeFile(outputPrefix+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
await writeFile(outputPrefix+'.facts.json',JSON.stringify(facts,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({metadata:seed.metadata,actuals_in_packet:12,remaining_long_gaps:after.reasons}));
