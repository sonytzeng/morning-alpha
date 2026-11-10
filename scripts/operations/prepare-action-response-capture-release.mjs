/** Offline packaging only. Exact deployed v18 baseline; no deploy/network port. */
import {readFileSync,writeFileSync,mkdirSync,lstatSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const expected={name:'vnext-daily-research-v1',version:18,id:'90674cf6-e250-4c56-85b2-6f5ae41c4a44',
 updated_at:1793862996191,ezbr_sha256:'5010f08a7122a740f43a6ddce11cc8b53932cc394e03dcfe8c9a354892b21982'};
const replacements=new Map([
 ['src/features/vnext/dailyAdapter.ts','41d8193f34dc7d98c3098065d5320148a9acd81122ae706c0798467275e04521'],
 ['src/features/vnext/dailyParsers.mjs','ecbcad9b2b85db2c10e1bc50cb1901ab21e6c477b81c599c08da4013300bcb02'],
]);
const additions=new Set(['src/features/vnext/dailyActionCapture.ts']);
const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){if(!['--baseline','--output'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('ACTION_RELEASE_ARGUMENTS');options[args[i]]=args[i+1];}
for(const key of ['--baseline','--output'])if(!isAbsolute(options[key]??''))throw Error('ACTION_RELEASE_ABSOLUTE_PATH');
const baseline=JSON.parse(readFileSync(options['--baseline'],'utf8'));
if(baseline.slug!==expected.name||baseline.name!==expected.name||baseline.version!==expected.version||baseline.id!==expected.id
 ||baseline.updated_at!==expected.updated_at||baseline.ezbr_sha256!==expected.ezbr_sha256||baseline.verify_jwt!==true
 ||baseline.import_map!==false||!Array.isArray(baseline.files)||baseline.files.length!==55
 ||new Set(baseline.files.map(f=>f.name)).size!==baseline.files.length)throw Error('ACTION_RELEASE_BASELINE_IDENTITY');
function pathName(name){const local=relative(root,resolve(root,name)).split('\\').join('/');if(!local||local!==name||local.startsWith('..')||isAbsolute(local))throw Error('ACTION_RELEASE_SOURCE_PATH');return local;}
const originals=new Map(baseline.files.map(f=>{pathName(f.name);if(typeof f.content!=='string')throw Error('ACTION_RELEASE_SOURCE_CONTENT');return [f.name,f.content];}));
for(const [name,hash] of replacements)if(!originals.has(name)||sha(originals.get(name))!==hash)throw Error('ACTION_RELEASE_BASELINE_SOURCE_HASH');
for(const name of additions)if(originals.has(name))throw Error('ACTION_RELEASE_NEW_FILE_EXISTS');
const files=new Map(originals),localNames=new Set([...replacements.keys(),...additions]);
for(const name of localNames){const path=resolve(root,pathName(name));if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile())throw Error('ACTION_RELEASE_LOCAL_FILE');
 const bytes=readFileSync(path),content=bytes.toString('utf8');if(!bytes.equals(Buffer.from(content)))throw Error('ACTION_RELEASE_ENCODING');files.set(name,content);}
const visited=new Set(),external=new Set(),erasedTypeImports=new Set(),entry='supabase/functions/'+expected.name+'/index.ts';
function visit(name){
 pathName(name);if(visited.has(name))return;if(!files.has(name))throw Error('ACTION_RELEASE_DEPENDENCY_MISSING:'+name);visited.add(name);
 const content=files.get(name);if(name.endsWith('.json')){JSON.parse(content);return;}
 const tree=ts.createSourceFile(name,content,ts.ScriptTarget.Latest,true);
 function link(specifier){if(specifier.startsWith('node:')){external.add(specifier);return;}if(!specifier.startsWith('.'))throw Error('ACTION_RELEASE_UNPINNED_IMPORT:'+specifier);
  visit(relative(root,resolve(root,dirname(name),specifier)).split('\\').join('/'));}
 function walk(node){
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
   const clause=ts.isImportDeclaration(node)?node.importClause:undefined;
   const bindings=clause?.namedBindings;
   const typeOnly=clause?.isTypeOnly||ts.isExportDeclaration(node)&&node.isTypeOnly
    ||bindings&&ts.isNamedImports(bindings)&&!clause.name&&bindings.elements.length>0&&bindings.elements.every(item=>item.isTypeOnly)
    ||ts.isExportDeclaration(node)&&node.exportClause&&ts.isNamedExports(node.exportClause)&&node.exportClause.elements.length>0&&node.exportClause.elements.every(item=>item.isTypeOnly);
   if(typeOnly)erasedTypeImports.add(name+':'+node.moduleSpecifier.text);else link(node.moduleSpecifier.text);
  }
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){if(node.arguments.length<1||!ts.isStringLiteral(node.arguments[0]))throw Error('ACTION_RELEASE_DYNAMIC_IMPORT');link(node.arguments[0].text);}
  ts.forEachChild(node,walk);
 }walk(tree);
}
visit(entry);for(const name of localNames)if(!visited.has(name))throw Error('ACTION_RELEASE_OVERRIDE_NOT_REACHABLE');
const rows=[...files].sort(([a],[b])=>a.localeCompare(b)).map(([name,content])=>({name,content}));
const actualChanged=rows.filter(f=>originals.get(f.name)!==f.content).map(f=>f.name).sort();
if(JSON.stringify(actualChanged)!==JSON.stringify([...localNames].sort()))throw Error('ACTION_RELEASE_CHANGE_SCOPE');
const meta={project_id:'cttfzgvhiewfckydcrci',name:expected.name,entrypoint_path:entry,verify_jwt:true};
const candidate={...meta,files:rows},rollback={...meta,files:baseline.files.map(({name,content})=>({name,content}))};
mkdirSync(options['--output'],{recursive:false});const artifacts=[];
function save(name,value){const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');writeFileSync(resolve(options['--output'],name),bytes,{flag:'wx'});artifacts.push({name,bytes:bytes.length,sha256:sha(bytes)});}
save(expected.name+'.candidate.json',candidate);save(expected.name+'.rollback.json',rollback);
const catalog={schema:'VNEXT_ACTION_RESPONSE_CAPTURE_RELEASE_V1',created_at:new Date().toISOString(),runtime:process.version,
 project_id:meta.project_id,expected_deployed:expected,production_authorized:false,production_actions_performed:0,
 candidate_file_count:rows.length,rollback_file_count:rollback.files.length,reachable_files:visited.size,external_modules:[...external].sort(),
 erased_type_imports:[...erasedTypeImports].sort(),
 changed_runtime_files:actualChanged,files:rows.map(f=>({name:f.name,bytes:Buffer.byteLength(f.content),sha256:sha(f.content),
  baseline_sha256:originals.has(f.name)?sha(originals.get(f.name)):null,source:replacements.has(f.name)?'EXPLICIT_OVERRIDE':additions.has(f.name)?'EXPLICIT_NEW_DEPENDENCY':'DEPLOYED_V18_BYTES'})),
 artifacts,database_prerequisite:{signature:'public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb)',definition_md5:'781d27ab8c7e9fead92634c0c5be227b',new_sql_required:false},
 scope:{future_action_only:true,old_receipts_unchanged:true,other_source_receipts_unchanged:true,complete_remains_false:true,
  original_availability_unchanged:true,raw_hash_scheme:'SNAPSHOT_HASH_CANONICAL_JSON_STRING_SHA256',utf8_bom_explicit:true,
  max_response_bytes:8_000_000,max_canonical_receipt_bytes:12_000_000,truncate:false,
  twse_cash:'Only an explicitly named per-share cash field; never inferred from reference-price differences.',
  source_receipts_private:true,review_or_publication_approval_created:false,cron_changed:false,price_bundle_modified:false},
 sequence:['Recheck vnext-daily-research-v1 v18 identity and the existing source RPC fingerprint.',
  'Deploy only this reviewed function candidate under separate authorization; no SQL or cron change is needed.',
  'Observe the next already scheduled ACTION acquisition; do not backfill, retry an access refusal, or upgrade old receipts.',
  'Confirm retained text hash/size/time, pending action completeness, and the existing SOURCE_SAVE receipt.'],
 rollback:'Deploy the complete saved v18 rollback JSON. Keep any newly retained immutable receipts; v18 ignores the optional field. No deletion or migration.'};
save('catalog.json',catalog);
console.log(JSON.stringify({output:options['--output'],changed_runtime_files:actualChanged,candidate_files:rows.length,rollback_files:rollback.files.length,
 reachable_files:visited.size,artifacts,new_sql_required:false,production_actions_performed:0},null,2));
