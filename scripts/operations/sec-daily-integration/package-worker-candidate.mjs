/** Materialize a complete offline candidate from exact live bytes. This script
 * never deploys and never substitutes a repo copy for an existing live file. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,posix,relative} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {prepareSecWorkerIndex} from './build-worker-candidate.mjs';
const [livePath,outputPath]=process.argv.slice(2);
if(!livePath||!outputPath)throw Error('Expected exact-live-files.json output_directory');
const root=process.cwd(),output=resolve(outputPath),live=JSON.parse(await readFile(livePath,'utf8'));
const entry='supabase/functions/daily-stock-analysis-v1/index.ts';
const sha=s=>createHash('sha256').update(s).digest('hex');
if(live.version!==15||live.ezbr_sha256!=='32cbe55a0c6512ed4a695fddbce1f0cd324f6dba8eb2b54b47c723c80a9aa8c1'
 ||!Array.isArray(live.files)||live.files.length!==41||new Set(live.files.map(f=>f.name)).size!==41)throw Error('SEC_BUNDLE_LIVE_BASELINE');
const originals=new Map(live.files.map(f=>[f.name,f.content])),files=new Map(originals),added=[];
files.set(entry,prepareSecWorkerIndex(files.get(entry)));
const scan=(name,body)=>{
 if(name.endsWith('.json'))return [];
 const imports=[],file=ts.createSourceFile(name,body,ts.ScriptTarget.Latest,true);
 const add=n=>{if(n&&ts.isStringLiteralLike(n))imports.push(n.text);};
 const visit=node=>{
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))add(node.moduleSpecifier);
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)add(node.arguments[0]);
  if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))add(node.argument.literal);
  ts.forEachChild(node,visit);
 };
 visit(file);
 imports.push(...ts.preProcessFile(body).referencedFiles.map(f=>f.fileName));
 return [...new Set(imports)];
};
const queued=[...files.keys()],scanned=new Set(),external=new Set(),edges=[];
while(queued.length){
 const name=queued.shift();if(scanned.has(name))continue;scanned.add(name);
 for(const specifier of scan(name,files.get(name))){
  if(!specifier.startsWith('.')){external.add(specifier);continue;}
  const target=posix.normalize(posix.join(posix.dirname(name),specifier));
  if(target.startsWith('../')||posix.isAbsolute(target)||target.includes('\\'))throw Error('SEC_BUNDLE_PATH_ESCAPE');
  edges.push({from:name,specifier,to:target});
  if(!files.has(target)){
   // All accepted relative imports are explicit file paths. Deno check below
   // remains authoritative for imports, including type-only dependencies.
   const local=resolve(root,target);
   if(relative(root,local).startsWith('..'))throw Error('SEC_BUNDLE_PATH_ESCAPE');
   files.set(target,await readFile(local,'utf8'));added.push(target);queued.push(target);
  }
 }
}
const expectedAdded=['research/sec-daily-financial-replay.candidate.ts','research/sec-quarter-financials.ts',
 'src/features/vnext/projection.ts','src/features/vnext/publicationReadiness.ts','src/features/vnext/realResearch.ts',
 'src/features/vnext/researchFunnel.ts','src/features/vnext/stockResearch.ts'].sort();
if(JSON.stringify(added.toSorted())!==JSON.stringify(expectedAdded))throw Error('SEC_BUNDLE_UNEXPECTED_CLOSURE');
for(const[name,content]of originals)if(name!==entry&&files.get(name)!==content)throw Error('SEC_BUNDLE_LIVE_FILE_OVERWRITTEN');
if([...external].some(s=>!s.startsWith('node:')))throw Error('SEC_BUNDLE_EXTERNAL_IMPORT');
const deploymentFiles=[...files].map(([name,content])=>({name,content})).sort((a,b)=>a.name.localeCompare(b.name));
const catalog=deploymentFiles.map(f=>({name:f.name,bytes:Buffer.byteLength(f.content),sha256:sha(f.content)}));
const args={project_id:'cttfzgvhiewfckydcrci',name:'daily-stock-analysis-v1',entrypoint_path:entry,verify_jwt:false,files:deploymentFiles};
await mkdir(output,{recursive:true});
for(const f of deploymentFiles){const path=resolve(output,'source',f.name);await mkdir(dirname(path),{recursive:true});await writeFile(path,f.content);}
const serialized=JSON.stringify(args),manifest={schema:'SEC_DAILY_COMPLETE_WORKER_PACKAGE_V1',
 baseline_version:live.version,baseline_ezbr_sha256:live.ezbr_sha256,baseline_files:41,files:deploymentFiles.length,
 added_files:added.toSorted(),unchanged_live_files:40,modified_live_files:[entry],external_imports:[...external].sort(),
 deployment_args_sha256:sha(serialized),file_catalog_sha256:sha(JSON.stringify(catalog)),
 hash_definition:'deployment_args_sha256 hashes exact deploy-args.json UTF-8 bytes; file_catalog_sha256 hashes JSON.stringify(sorted name/bytes/sha256 catalog). Provider ezbr archive hash is available only after deployment.',
 catalog,import_edges:edges,model_calls:0,production_writes:0,deploy:false};
await writeFile(resolve(output,'deploy-args.json'),serialized);
await writeFile(resolve(output,'package-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({files:manifest.files,added:manifest.added_files,unchanged_live_files:40,
 deployment_args_sha256:manifest.deployment_args_sha256,file_catalog_sha256:manifest.file_catalog_sha256,external_imports:manifest.external_imports,production_writes:0}));
