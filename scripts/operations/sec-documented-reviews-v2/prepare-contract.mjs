/** Verify the newly sealed review bundle and write local candidate inputs only. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {snapshotHash,compareTime,validObservationTime} from '../../../src/features/vnext/contracts.ts';
import {canonical} from '../../../research/entry-opportunity.ts';
const [manifestPath,outputDirectory]=process.argv.slice(2);
if(!manifestPath||!outputDirectory)throw Error('Expected sealed.manifest.json output_directory');
const source=resolve(manifestPath),directory=dirname(source),out=resolve(outputDirectory);
const sha=s=>createHash('sha256').update(s).digest('hex');
const manifest=JSON.parse(await readFile(source,'utf8')),{source_seal_hash,...preimage}=manifest;
if(!/^[a-f0-9]{64}$/.test(source_seal_hash)||await snapshotHash(preimage)!==source_seal_hash)throw Error('REVIEW_V2_SOURCE_SEAL');
const load=async entry=>{
 const raw=await readFile(resolve(directory,basename(entry.path)));
 if(raw.length!==entry.bytes||sha(raw)!==entry.sha256)throw Error('REVIEW_V2_FILE_SEAL');return JSON.parse(raw);
};
const [facts,review,receipt]=await Promise.all([load(manifest.facts_file),load(manifest.review_file),load(manifest.receipt_file)]);
const {receipt_hash,...receiptPreimage}=receipt;
if(await snapshotHash(review)!==manifest.review_canonical_hash||receipt_hash!==manifest.receipt_hash
 ||await snapshotHash(receiptPreimage)!==receipt_hash||facts.length!==3)throw Error('REVIEW_V2_REVIEW_RECEIPT');
const ordered=facts.slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),binding=ordered[0].review_price_basis,until=ordered[0].review_valid_until;
if(!validObservationTime(until)||!binding||binding.symbol!=='2330'||binding.session_date!=='2026-10-30'||binding.close_twd!==2370
 ||binding.unit!=='TWD_PER_COMMON_SHARE'||binding.scope!=='RETAINED_CLOSE_AS_OF_REVIEW_NOT_CURRENT_QUOTE')throw Error('REVIEW_V2_BINDING');
if(ordered.map(f=>f.kind).join('|')!=='DEMAND|MOAT|VALUATION'||ordered.map(f=>f.values.verdict).join('|')!=='SUPPORTED|SUPPORTED|NOT_SUPPORTED')throw Error('REVIEW_V2_SCOPE');
for(const fact of ordered){
 const {evidence_hash,...body}=fact;
 if(fact.symbol!=='2330'||fact.basis!=='DOCUMENTED_REVIEW'||fact.source_admitted!==false||fact.member_publication_approved!==false
  ||fact.review_valid_until!==until||canonical(fact.review_price_basis)!==canonical(binding)||await snapshotHash(body)!==evidence_hash
  ||!validObservationTime(fact.available_at)||compareTime(fact.available_at,until)>=0
  ||fact.values.review_valid_until!==until||fact.values.review_price_session_date!==binding.session_date
  ||fact.values.review_price_close_twd!==binding.close_twd)throw Error('REVIEW_V2_FACT_SEAL');
}
const contract={source_seal_sha256:source_seal_hash,facts_sha256:await snapshotHash(ordered),source_review_sha256:manifest.review_file.sha256,
 review_receipt_sha256:manifest.receipt_file.sha256,review_valid_until:until,review_price_basis:binding,review_fact_ids:ordered.map(f=>f.id)};
const registry={schema:'DOCUMENTED_REVIEW_REGISTRY_V2',...contract,facts:ordered,source_admitted:false,member_publication_approved:false};
delete registry.review_fact_ids;
const ts=`/** Fixed newly received review seal. No admission/publication grant. */\nexport const DOCUMENTED_REVIEW_V2_CONTRACT:Readonly<{source_seal_sha256:string;facts_sha256:string;source_review_sha256:string;review_receipt_sha256:string;review_valid_until:string;review_price_basis:Readonly<{symbol:string;session_date:string;close_twd:number;unit:string;scope:string}>;review_fact_ids:readonly string[]}>=Object.freeze(${JSON.stringify(contract,null,2)});\n`;
await mkdir(out,{recursive:true});
await writeFile(resolve(out,'sealed-registry.json'),JSON.stringify(registry,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(out,'source-contract.json'),JSON.stringify(contract,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(process.cwd(),'research/documented-review-v2-contract.candidate.ts'),ts,{flag:'wx'});
console.log(JSON.stringify({source_seal_sha256:source_seal_hash,facts_sha256:contract.facts_sha256,review_valid_until:until,production_writes:0}));
