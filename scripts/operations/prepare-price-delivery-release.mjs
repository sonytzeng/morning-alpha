// Offline packaging only. No deployment, database, network or credentials port.
// Capture every local import, exact SQL and the previously retrieved rollback
// sources so a production decision can refer to concrete immutable bytes.
import {readFileSync,writeFileSync,mkdirSync,lstatSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){
 if(!['--output','--draft-baseline','--financial-baseline'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('RELEASE_ARGUMENTS');
 options[args[i]]=args[i+1];
}
for(const name of ['--output','--draft-baseline','--financial-baseline'])if(!isAbsolute(options[name]??''))throw Error('ABSOLUTE_RELEASE_PATH_REQUIRED');
const output=options['--output'];
const definitions=[
 {name:'daily-stock-draft-v1',version:2,baseline:options['--draft-baseline'],sha:'5d62ef7bc6f06cf803318ccd290460a4ac573583d47a595b2f3d652e89f45176'},
 {name:'daily-stock-source-financial-v1',version:1,baseline:options['--financial-baseline'],sha:'c6dd30e1198b4719512a5cf71acd4026153e3a50e4f9f65392bd85e3488559e3'},
];
function regularFile(name){
 const path=resolve(repository,name),local=relative(repository,path);
 if(!local||local.startsWith('..')||isAbsolute(local)||lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile())throw Error('RELEASE_SOURCE_PATH');
 const bytes=readFileSync(path),content=bytes.toString('utf8');
 if(!bytes.equals(Buffer.from(content)))throw Error('RELEASE_SOURCE_ENCODING');
 return {name:local.split('\\').join('/'),content,bytes:bytes.length,sha256:sha(bytes)};
}
function closure(entry,baselineFiles,overrides){
 const files=new Map(),external=new Set();
 function visit(name){
  const local=relative(repository,resolve(repository,name)).split('\\').join('/');
  if(!local||local.startsWith('..')||isAbsolute(local))throw Error('RELEASE_SOURCE_PATH');
  const saved=baselineFiles.get(local),file=saved&&!overrides.has(local)
   ?{name:local,content:saved,bytes:Buffer.byteLength(saved),sha256:sha(saved),source:'DEPLOYED_BASELINE'}
   :{...regularFile(local),source:saved?'EXPLICIT_LOCAL_OVERRIDE':'NEW_LOCAL_DEPENDENCY'};
  if(files.has(file.name))return;files.set(file.name,file);
  if(file.name.endsWith('.json')){JSON.parse(file.content);return;}
  const source=ts.createSourceFile(file.name,file.content,ts.ScriptTarget.Latest,true);
  function link(specifier){
   if(specifier.startsWith('node:')){external.add(specifier);return;}
   if(!specifier.startsWith('.'))throw Error('UNPINNED_RUNTIME_IMPORT:'+file.name+':'+specifier);
   visit(relative(repository,resolve(repository,dirname(file.name),specifier)));
  }
  function walk(node){
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))link(node.moduleSpecifier.text);
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){
    if(node.arguments.length<1||!ts.isStringLiteral(node.arguments[0]))throw Error('DYNAMIC_RUNTIME_IMPORT:'+file.name);
    link(node.arguments[0].text);
   }
   ts.forEachChild(node,walk);
  }
  walk(source);
 }
 visit(entry);return {files:[...files.values()].sort((a,b)=>a.name.localeCompare(b.name)),external:[...external].sort()};
}
const bundles=definitions.map(d=>{
 const baseline=JSON.parse(readFileSync(d.baseline,'utf8'));
 if(baseline.slug!==d.name||baseline.version!==d.version||baseline.sha!==d.sha||baseline.verify_jwt!==false||!Array.isArray(baseline.files)
  ||new Set(baseline.files.map(f=>f.name)).size!==baseline.files.length)throw Error('RELEASE_BASELINE_IDENTITY');
 const overrides=new Set(d.name==='daily-stock-draft-v1'
  ?['supabase/functions/daily-stock-analysis-v1/zero-paid-draft.ts','src/features/vnext/publicationReadiness.ts']
  :['research/daily-ai-financial-refresh.ts','supabase/functions/daily-stock-analysis-v1/financial-stage.ts']);
 const baselineFiles=new Map(baseline.files.map(f=>[f.name,f.content]));
 const entry='supabase/functions/'+d.name+'/index.ts',current=closure(entry,baselineFiles,overrides);
 const meta={project_id:'cttfzgvhiewfckydcrci',name:d.name,entrypoint_path:entry,verify_jwt:false};
 const candidate={...meta,files:current.files.map(({name,content})=>({name,content}))};
 const rollback={...meta,files:baseline.files.map(({name,content})=>({name,content}))};
 return {name:d.name,expected_deployed_version:d.version,expected_deployed_ezbr_sha256:d.sha,external_modules:current.external,
  candidate,rollback,files:current.files.map(({name,sha256,bytes,source})=>({name,sha256,bytes,source}))};
});
const sqlNames=['daily-ai-price-workflow.candidate.sql','daily-ai-long-preparations.candidate.sql','daily-ai-price-resume.candidate.sql',
 'daily-ai-price-resume.rollback.sql','member-price-set-read.candidate.sql','member-price-set-read.rollback.sql'];
const sql=sqlNames.map(name=>regularFile('research/'+name));
mkdirSync(output,{recursive:false});
const artifacts=[];
function save(name,value){const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
 writeFileSync(resolve(output,name),bytes,{flag:'wx'});artifacts.push({name,bytes:bytes.length,sha256:sha(bytes)});}
for(const b of bundles){save(b.name+'.candidate.json',b.candidate);save(b.name+'.rollback.json',b.rollback);}
for(const f of sql)save(f.name.split('/').at(-1),f.content);
const catalog={schema:'DAILY_PRICE_DELIVERY_RELEASE_CANDIDATE_V1',created_at:new Date().toISOString(),runtime:process.version,
 project_id:'cttfzgvhiewfckydcrci',production_authorized:false,production_actions_performed:0,
 functions:bundles.map(({candidate,rollback,...rest})=>{void candidate;void rollback;return rest;}),artifacts,
 startup_behavior:{proposal_version:'MA_2330_VALUATION_PROPOSAL_20261110_1',proposal_symbol:'2330',
  condition:'Only when the current card has no registered calculation input and no method profile; four reported diluted EPS quarters are required.',
  medium:'Reported four-quarter diluted EPS sum × PE 16/20/24; 25% entry discount on the conservative/base scenarios.',
  long:'Five-year EPS growth 6%/12%/18%; payout 25%; required returns 12%/10%/9%; terminal PE 12/16/20; 25% conservative/base entry discount.',
  status:'Explicit internal assumptions for independent review. No method approval, investment-performance claim or member publication is created.',
  existing_profiles:'Existing or expired profiles are never replaced by this initial proposal.',
  other_symbols:'Require their own explicit company-specific parameters.'},
 sequence:['Recheck deployed identities and SQL prerequisite guards against the saved baselines.',
  'Apply workflow and LONG preparation SQL in separate reviewed transactions.',
  'Deploy daily-stock-draft-v1; verify authenticated private workflow and confirmed checkpoints.',
  'Apply the guarded existing-resumer fallback, keeping its current trading-day schedule.',
  'Deploy daily-stock-source-financial-v1 separately to preserve unchanged source observations.',
  'Apply the independent member price set-reader change and verify entitlement/expiry/revoke behavior.',
  'Release the matching Owner UI from the reviewed Git revision.'],
 review_requirements:['Independent production deployment/migration approval under repository AGENTS.md.',
  'Company-specific parameter justification and independent source/method/content review remain necessary for member prices.',
  'No performance calibration or ten-thousand-subscriber load certification is implied.'],
 rollback:'Restore the original resumer and member reader with their guarded rollback SQL, then restore the affected function source bundle. Keep immutable research data; no destructive SQL is provided.'};
save('catalog.json',catalog);
console.log(JSON.stringify({output,functions:catalog.functions.map(f=>({name:f.name,files:f.files.length,external_modules:f.external_modules})),
 artifacts,production_actions_performed:0},null,2));
