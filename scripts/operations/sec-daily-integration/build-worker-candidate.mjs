/** Build review artifacts only. Never deploys, patches the checkout's worker,
 * runs SQL or alters the retained V15 bundle/dependencies. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const LIVE15_INDEX_SHA256='807a4692a08b6d31b04d094c14788370bfe4c4964d9e8dcb567c27e23b811df2';
const sha=s=>createHash('sha256').update(s).digest('hex');
const oneReplace=(text,from,to)=>{
 if(text.split(from).length!==2)throw Error('SEC_WORKER_PATCH_CALLSITE_DRIFT');return text.replace(from,to);
};
export function prepareSecWorkerIndex(liveIndex){
 if(sha(liveIndex)!==LIVE15_INDEX_SHA256)throw Error('SEC_WORKER_PATCH_LIVE15_DRIFT');
 let candidate=oneReplace(liveIndex,
  "import {refreshDailyAiFinancials} from '../../../research/daily-ai-financial-refresh.ts';",
  "import {refreshDailyAiFinancials} from '../../../research/daily-ai-financial-refresh.ts';\nimport {withRetainedSecDailyFinancials} from '../../../research/sec-daily-financial-replay.candidate.ts';");
 candidate=oneReplace(candidate,'refreshFinancials:refreshDailyAiFinancials,',
  "refreshFinancials:withRetainedSecDailyFinancials(refreshDailyAiFinancials,(args,registrySignal)=>rpc('load_daily_stock_ai_sec_replay_v1',args,registrySignal)),");
 // Node's fetch overload can expose an empty Parameters<...>[1] under Deno's
 // checker. The global Web RequestInit retains the real method/body/signal
 // contract. TypeScript erases these two annotations from emitted JavaScript.
 const oldAnnotation='i?:Parameters<typeof fetch>[1]';
 if(candidate.split(oldAnnotation).length!==3)throw Error('SEC_WORKER_PATCH_TYPE_ANNOTATION_DRIFT');
 candidate=candidate.replaceAll(oldAnnotation,'i?:RequestInit');
 return candidate;
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length&&!(args.length===1&&args[0]==='--refresh'))throw Error('Expected no arguments or --refresh');
 const outputFlag=args[0]==='--refresh'?'w':'wx';
 const here=new URL('./',import.meta.url),root=new URL('../../../',here);
 const liveIndex=await readFile(new URL('./live15-baseline/supabase__functions__daily-stock-analysis-v1__index.ts',here),'utf8');
 const candidate=prepareSecWorkerIndex(liveIndex);
 const files=['research/sec-daily-financial-replay.candidate.ts','research/sec-quarter-financials.ts',
  'scripts/operations/sec-daily-integration/retained-sec-daily-v1.candidate.sql'];
 const hashes=Object.fromEntries(await Promise.all(files.map(async name=>[name,sha(await readFile(new URL(name,root)))])));
 const manifest={schema:'SEC_DAILY_SOURCE_INTEGRATION_CANDIDATE_V1',prepared_at:new Date().toISOString(),
  live_function:'daily-stock-analysis-v1',live_version:15,live_bundle_sha256:'32cbe55a0c6512ed4a695fddbce1f0cd324f6dba8eb2b54b47c723c80a9aa8c1',
  live_index_sha256:LIVE15_INDEX_SHA256,candidate_index_sha256:sha(candidate),candidate_files:hashes,
  worker_changes:['One new SOURCE financial adapter import','Wrap existing refreshFinancials with service-only retained SEC loader',
   'Two erased parameter type annotations use the standard Web RequestInit'],
  database_changes:['Fixed-seal private immutable 12-fact registry','Service-only read RPC','New SEC wrapper delegates unchanged V5 non-SEC checks',
   'Fingerprint-guarded single SOURCE validator call-site substitution'],
  deployment_rule:'Re-read live version and hashes first; abort on drift. Preserve all other V15 bundle files and dependencies.',
  validation_limit:'No production migration or deployment executed; authorization and a fresh live-fingerprint check remain required.',
  source_admitted:false,member_publication_approved:false,model_calls:0,production_writes:0,
  commit:false,push:false,deploy:false,migration_executed:false,cron_changed:false,member_published:false};
 await writeFile(new URL('./worker-index.candidate.txt',here),candidate,{flag:outputFlag});
 await writeFile(new URL('./candidate-manifest.json',here),JSON.stringify(manifest,null,2)+'\n',{flag:outputFlag});
 console.log(JSON.stringify({candidate_index_sha256:manifest.candidate_index_sha256,candidate_files:hashes,production_writes:0}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))await main();
