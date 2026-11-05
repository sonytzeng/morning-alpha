/** Build an exact-live-based V2 candidate. No deployment or production calls. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,posix,relative} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {prepareRateLimitRecoveryIndex,rateLimitRecoveryPatchReceipt} from '../daily-ai-rate-limit-recovery-20261031/build-worker-patch.mjs';
const [livePath,outputPath]=process.argv.slice(2);if(!livePath||!outputPath)throw Error('Expected live-files.json output_directory');
const flags=new Set(process.argv.slice(4));if([...flags].some(f=>!['--with-recovery','--deno29-types'].includes(f)))throw Error('V2_WORKER_FLAG');
const live=JSON.parse(await readFile(livePath,'utf8')),out=resolve(outputPath),root=process.cwd(),entry='supabase/functions/daily-stock-analysis-v1/index.ts';
const sha=s=>createHash('sha256').update(s).digest('hex');
if(live.version!==16||live.ezbr_sha256!=='6e51f2d2b4ef2917ef7b7f5eb567e54aa6b39b7bec752cced5689b527abd9fd9'||live.files.length!==48)throw Error('V2_WORKER_LIVE_BASELINE');
const original=new Map(live.files.map(f=>[f.name,f.content])),files=new Map(original);
const baseline=files.get(entry);if(sha(baseline)!=='7d2f3105136411fa480d64bbf0f9155e93553610fdc9666d1e9f0d88a7170e75')throw Error('V2_WORKER_INDEX_BASELINE');
const one=(s,a,b)=>{if(s.split(a).length!==2)throw Error('V2_WORKER_CALLSITE');return s.replace(a,b);};
let candidate=one(baseline,"import {withRetainedSecDailyFinancials} from '../../../research/sec-daily-financial-replay.candidate.ts';",
 "import {withRetainedSecDailyFinancials} from '../../../research/sec-daily-financial-replay.candidate.ts';\nimport {withDocumentedReviewV2Financials,withDocumentedReviewV2SourceRpc} from '../../../research/documented-review-replay-v2.candidate.ts';");
candidate=one(candidate,'   rpc,fetcher:fetch,clock:()=>new Date().toISOString(),',
 '   rpc:withDocumentedReviewV2SourceRpc(rpc,()=>new Date().toISOString()),fetcher:fetch,clock:()=>new Date().toISOString(),');
candidate=one(candidate,"refreshFinancials:withRetainedSecDailyFinancials(refreshDailyAiFinancials,(args,registrySignal)=>rpc('load_daily_stock_ai_sec_replay_v1',args,registrySignal)),",
 "refreshFinancials:withDocumentedReviewV2Financials(withRetainedSecDailyFinancials(refreshDailyAiFinancials,(args,registrySignal)=>rpc('load_daily_stock_ai_sec_replay_v1',args,registrySignal))),");
let recoveryReceipt;
if(flags.has('--with-recovery')){const before=candidate;candidate=prepareRateLimitRecoveryIndex(candidate,{baseSha256:sha(candidate)});recoveryReceipt=rateLimitRecoveryPatchReceipt(before,candidate);}
files.set(entry,candidate);
const modified=new Set([entry]),typeErasures=[];
if(flags.has('--deno29-types'))for(const name of ['research/daily-ai-global-market.ts','research/daily-ai-refresh.ts']){
 const before=files.get(name),after=one(before,"crypto.subtle.digest('SHA-256',bytes)","crypto.subtle.digest('SHA-256',bytes as BufferSource)");
 const emit=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 if(emit(before)!==emit(after))throw Error('V2_BUFFER_ASSERTION_RUNTIME_DRIFT');
 files.set(name,after);modified.add(name);typeErasures.push({name,original_sha256:sha(before),candidate_sha256:sha(after),emitted_js_sha256:sha(emit(after)),emitted_js_byte_identical:true});
}
const imports=(name,content)=>{
 if(name.endsWith('.json'))return [];
 const src=ts.createSourceFile(name,content,ts.ScriptTarget.Latest,true),items=[];
 const add=n=>{if(n&&ts.isStringLiteralLike(n))items.push(n.text);};
 const visit=n=>{if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))add(n.moduleSpecifier);
  if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)add(n.arguments[0]);
  if(ts.isImportTypeNode(n)&&ts.isLiteralTypeNode(n.argument))add(n.argument.literal);ts.forEachChild(n,visit);};
 visit(src);return [...new Set(items)];
};
const queue=[...files.keys()],seen=new Set(),added=[],external=new Set(),edges=[];
while(queue.length){const name=queue.shift();if(seen.has(name))continue;seen.add(name);
 for(const spec of imports(name,files.get(name))){if(!spec.startsWith('.')){external.add(spec);continue;}
  const target=posix.normalize(posix.join(posix.dirname(name),spec));if(target.startsWith('../')||posix.isAbsolute(target))throw Error('V2_WORKER_PATH');
  edges.push({from:name,to:target,specifier:spec});if(files.has(target))continue;
  const local=resolve(root,target);if(relative(root,local).startsWith('..'))throw Error('V2_WORKER_PATH');
  files.set(target,await readFile(local,'utf8'));added.push(target);queue.push(target);
 }}
const expectedAdded=['research/documented-review-replay-v2.candidate.ts','research/documented-review-v2-contract.candidate.ts',...(flags.has('--with-recovery')?['supabase/functions/daily-stock-analysis-v1/rate-limit-recovery-handler.ts','supabase/functions/daily-stock-analysis-v1/rate-limit-recovery-runner.ts']:[])].sort();
if(JSON.stringify(added.toSorted())!==JSON.stringify(expectedAdded))throw Error('V2_WORKER_CLOSURE');
if([...external].some(x=>!x.startsWith('node:')))throw Error('V2_WORKER_EXTERNAL');
for(const[name,content]of original)if(!modified.has(name)&&files.get(name)!==content)throw Error('V2_WORKER_LIVE_OVERWRITE');
const all=[...files].map(([name,content])=>({name,content})).sort((a,b)=>a.name.localeCompare(b.name));
const args={project_id:'cttfzgvhiewfckydcrci',name:'daily-stock-analysis-v1',entrypoint_path:entry,verify_jwt:false,files:all};
const text=JSON.stringify(args),catalog=all.map(f=>({name:f.name,bytes:Buffer.byteLength(f.content),sha256:sha(f.content)}));
const manifest={schema:'DOCUMENTED_REVIEW_V2_EXACT_WORKER_CANDIDATE',live_version:live.version,live_ezbr_sha256:live.ezbr_sha256,
 live_index_sha256:sha(baseline),candidate_index_sha256:sha(candidate),unchanged_live_files:48-modified.size,modified_live_files:[...modified],added_files:added.toSorted(),files:all.length,
 candidate_index_changes:['V2 adapter import','Financial port strips reviews before unchanged V1 refresh','Final SOURCE RPC applies active reviews after the fresh-price merge'],
 deployment_args_sha256:sha(text),file_catalog_sha256:sha(JSON.stringify(catalog)),catalog,import_edges:edges,type_assertion_erasures:typeErasures,recovery_patch:recoveryReceipt??null,
 provider_archive_hash:'AVAILABLE_ONLY_AFTER_DEPLOYMENT',model_calls:0,production_writes:0,deploy:false};
await mkdir(out,{recursive:true});for(const f of all){const path=resolve(out,'source',f.name);await mkdir(dirname(path),{recursive:true});await writeFile(path,f.content);}
await writeFile(resolve(out,'deploy-args.json'),text);await writeFile(resolve(out,'package-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(resolve(out,'worker-index.candidate.txt'),candidate);
console.log(JSON.stringify({files:all.length,added,unchanged_live_files:manifest.unchanged_live_files,candidate_index_sha256:manifest.candidate_index_sha256,
 deployment_args_sha256:manifest.deployment_args_sha256,file_catalog_sha256:manifest.file_catalog_sha256,production_writes:0}));
