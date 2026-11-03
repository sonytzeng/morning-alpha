/** Prepare canonical, mechanically validated RPC inputs; no database/network. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonical} from '../../research/entry-opportunity.ts';
import {validateReviewedAnalysisSnapshot} from '../../research/reviewed-snapshot-validator.mjs';
const [batchFile,bodyFile,directory]=process.argv.slice(2);
if(!batchFile||!bodyFile||!directory)throw Error('Expected exact-batch.payload-text snapshot-body.json output-directory');
const batchText=await readFile(resolve(batchFile),'utf8'),body=JSON.parse(await readFile(resolve(bodyFile),'utf8'));
const report=await validateReviewedAnalysisSnapshot(batchText,body),text=canonical(body);
const sha=s=>createHash('sha256').update(s).digest('hex'),snapshotHash=sha(text);
if(snapshotHash!==report.snapshot_hash)throw Error('VALIDATOR_SNAPSHOT_COMMITMENT');
const reportText=JSON.stringify(report,null,2)+'\n',out=resolve(directory);await mkdir(out,{recursive:true});
await writeFile(join(out,'VALIDATION.json'),reportText,{flag:'wx'});
await writeFile(join(out,'PREPARED_REQUEST.json'),JSON.stringify({schema:'OFFLINE_REVIEWED_SNAPSHOT_PREPARED_REQUEST_V1',
 status:'READY_FOR_PRIVATE_STAGING_FULL_REVIEW_REQUIRED',rpc:'stage_offline_reviewed_analysis_snapshot_v1',
 args:{p_body_text:text,p_snapshot_hash:snapshotHash,p_validator_document_hash:sha(reportText)},
 report_hash:sha(reportText),model_calls:0,production_writes:0,member_published:false,full_paid_release_ready:false,
 remaining_gates:['Independent full semantic and numeric review','Current source-use rights and timing review',
  'Complete original paid-product specifications and price plans','Actual Owner approval','Current Premium member E2E']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({snapshot_hash:snapshotHash,cards:report.counts.cards,numeric_review_required:report.numeric_review_required,
 model_calls:0,production_writes:0,full_paid_release_ready:false}));
