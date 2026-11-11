// Offline source-overlay packaging. No fetch, credentials, Git mutation,
// migration, workflow activation, seed import, review or deployment.
import {readFileSync,writeFileSync,mkdirSync,lstatSync,existsSync,renameSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {createReadStream} from 'node:fs';
import {resolve,dirname,relative,isAbsolute,posix,basename,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {Buffer} from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import ts from 'typescript';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const SELF='scripts/operations/prepare-taiwan-market-release.mjs';
const DOC='research/taiwan-market-release.md';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,path='')=>{throw Error('TAIWAN_MARKET_RELEASE_'+code+(path?':'+path:''));};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'
 ?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);

// Ordered prerequisites. Existing V1 policy candidates and the independent TXF
// patch are intentionally absent. This array is also the install-order source.
export const MARKET_DATABASE_STEPS=Object.freeze([
 ['daily-ai-market-v2','Private source/universe/plan/shard/edition and member gates'],
 ['daily-ai-market-financial-csv','Original CP950 financial CSV and lossless decoded-row binding'],
 ['daily-ai-market-revenue-csv','Original UTF8 monthly-revenue CSV matrix'],
 ['daily-ai-market-public-supplements','Dated valuation and original TPEx action tables'],
 ['daily-ai-market-action-coverage','Auditable full-table action coverage and absence proof'],
 ['daily-ai-market-action-evidence-id','Guarded content-derived IDs; unchanged receipt-time checks'],
 ['daily-ai-market-references','Shared inputs, calculated research references and edition-bound projection'],
 ['daily-ai-market-reference-chunks','Bounded input chunks and exact whole-pool finalization'],
 ['daily-ai-market-reference-capacity','Guarded 64 MB assembled pool; unchanged 1 MB chunks and 32 MB legacy RPC'],
 ['daily-ai-market-bvps','Official reported BVPS, peer-derived PB and source-bound arithmetic guards'],
 ['daily-ai-market-reference-performance','Equivalent container traversal and one pool-map extraction per reference request'],
 ['daily-ai-market-short-scope','Exact TWSE/TPEx complete-session identity for observed short ranges'],
 ['daily-ai-market-owner-review','Private Owner catalog, explicit human review and outcome readback'],
 ['daily-ai-market-owner-search','Owner-only bounded company/symbol search in the fixed edition universe'],
 ['daily-ai-market-seed','Immutable private bootstrap seed; separate import and read capabilities'],
 ['daily-ai-market-checkpoints','Private random keys, immutable encrypted archive bindings and atomic pending/head pointer'],
].map(([name,purpose],index)=>({order:index+1,name,purpose,candidate:'research/'+name+'.candidate.sql',rollback:'research/'+name+'.rollback.sql'})));

const GROUPS={
 database:MARKET_DATABASE_STEPS.flatMap(s=>[s.candidate,s.rollback]),
 runtime:[
  'research/daily-ai-market-stage.mjs','research/daily-ai-market-references-stage.mjs',
  'research/taiwan-market-universe.mjs','research/taiwan-market-facts.mjs','research/taiwan-market-history.mjs',
  'research/taiwan-market-financial-history.py','research/taiwan-market-financial-csv.py','research/taiwan-market-financial-export-links.py',
  'research/taiwan-market-financial-inputs.mjs','research/taiwan-market-actions.mjs','research/taiwan-market-postclose.mjs',
  'research/taiwan-market-long-price.mjs','research/taiwan-market-bvps.mjs','research/taiwan-market-price-reference.mjs','research/taiwan-market-research.mjs',
  'research/taiwan-market-input-cache.mjs','research/taiwan-market-seed.mjs','research/taiwan-market-checkpoint.mjs','research/taiwan-market-sources.json',
  'scripts/operations/acquire-taiwan-market.py','scripts/operations/acquire-taiwan-history.py',
  'scripts/operations/acquire-taiwan-financial-history.py','scripts/operations/acquire-taiwan-financial-csv.py',
  'scripts/operations/refresh-taiwan-market-sources.py','scripts/operations/refresh-taiwan-market-inputs.mjs',
  'scripts/operations/run-taiwan-market-daily.mjs','scripts/operations/taiwan-market-oidc-rpc.mjs',
  'scripts/operations/bootstrap-taiwan-market-seed.mjs','scripts/operations/taiwan-market-checkpoint.mjs','scripts/operations/taiwan-market-checkpoint-archive.py',
  'supabase/functions/taiwan-market-worker-v2/index.ts','supabase/functions/_shared/taiwan-market-worker-gateway.mjs',
 ],
 frontend:[
  'src/features/vnext/dailyAiMarketPageV2.ts','src/features/vnext/dailyAiMarketOwner.ts','src/features/vnext/dailyAiCopy.ts',
  'src/pages/vnext/DailyAiMarketMemberEntry.tsx','src/pages/vnext/DailyAiMarketResearch.tsx','src/pages/vnext/OwnerMarketReview.tsx',
  'src/pages/vnext/daily-ai-market.css','src/pages/vnext/owner-market-review.css',
  'src/pages/vnext/MemberPage.tsx','src/pages/vnext/DailyAiMemberResearch.tsx','src/pages/vnext/daily-ai-member.css','src/router/config.tsx',
 ],
 operations:[
  'scripts/operations/build-taiwan-market.mjs','scripts/operations/normalize-taiwan-market.mjs','scripts/operations/analyze-taiwan-market.mjs',
  'scripts/operations/prepare-taiwan-market-seed.py','scripts/operations/verify-market-v2-local.mjs',
  'scripts/operations/verify-taiwan-market-workbench.mjs','scripts/operations/export-taiwan-market-workbench.mjs',
  'scripts/operations/verify-taiwan-market-owner-real.mjs','scripts/operations/verify-taiwan-market-arithmetic.py',
  'scripts/operations/verify-market-reference-chunks-local.mjs',SELF,DOC,
  'research/taiwan-market-daily-orchestration.md','research/taiwan-market-daily.workflow.candidate.yml',
 ],
 tests:[
  'tests/dailyAiMarketV2.integration.mjs','tests/dailyAiMarketFinancialCsv.integration.mjs','tests/dailyAiMarketRevenueCsv.integration.mjs',
  'tests/dailyAiMarketActions.integration.mjs','tests/dailyAiMarketReferences.integration.mjs','tests/dailyAiMarketReferenceChunks.integration.mjs',
  'tests/dailyAiMarketReferenceCapacity.integration.mjs','tests/dailyAiMarketBvps.integration.mjs','tests/dailyAiMarketReferencePerformance.integration.mjs',
  'tests/dailyAiMarketShortScope.integration.mjs','tests/dailyAiMarketCheckpoints.integration.mjs','tests/dailyAiMarketOwnerCleanup.integration.mjs',
  'tests/dailyAiMarketOwner.integration.mjs','tests/dailyAiMarketOwnerSearch.integration.mjs','tests/dailyAiMarketOwnerSearch.test.mjs','tests/dailyAiMarketSeed.integration.mjs',
  'tests/dailyAiMarketPageV2.test.mjs','tests/dailyAiMarketUiV2.test.mjs','tests/dailyAiMarketOwnerUi.test.mjs',
  'tests/dailyAiMember.test.mjs','tests/dailyAiMemberComparison.test.mjs','tests/dailyAiMemberExpiry.test.mjs','tests/vnextMemberContinuity.test.mjs',
  'tests/taiwanMarketUniverse.test.mjs','tests/taiwanMarketFacts.test.mjs','tests/taiwanMarketHistory.test.mjs',
  'tests/taiwanMarketActions.test.mjs','tests/taiwanMarketLongPrice.test.mjs','tests/taiwanMarketBvps.test.mjs','tests/taiwanMarketResearch.test.mjs',
  'tests/taiwanMarketDaily.test.mjs','tests/taiwanMarketInputCache.test.mjs','tests/taiwanMarketInputIntegration.test.mjs',
  'tests/taiwanMarketWorkerGateway.test.mjs','tests/taiwanMarketSeed.test.mjs','tests/taiwanMarketCheckpoint.test.mjs',
  'tests/taiwanMarketSourceRefresh.test.mjs','tests/taiwanMarketSourceRefresh.test.py',
  'tests/taiwanFinancialAcquisition.test.mjs','tests/taiwanFinancialHistory.test.mjs','tests/taiwanFinancialCsv.test.mjs','tests/taiwanFinancialExportLinks.test.mjs',
  'tests/helpers/dailyAiMarketOwnerFixture.mjs','tests/helpers/dailyAiMarketOwnerWire.mjs','tests/helpers/taiwanMarketSeedFixture.mjs','tests/helpers/taiwanMarketBvpsFixture.mjs',
  'tests/priceDeliveryUiHarness.mjs',
 ],
 build_context:['.nvmrc','package.json','package-lock.json','supabase/config.toml'],
};
export const MARKET_RELEASE_FILES=Object.freeze(Object.entries(GROUPS).flatMap(([role,paths])=>paths.map(path=>({path,role}))));
if(new Set(MARKET_RELEASE_FILES.map(f=>f.path)).size!==MARKET_RELEASE_FILES.length)fail('DUPLICATE_ALLOWLIST');
const INCLUDED=new Set(MARKET_RELEASE_FILES.map(f=>f.path));
const EDGE_FILES=['supabase/functions/taiwan-market-worker-v2/index.ts','supabase/functions/_shared/taiwan-market-worker-gateway.mjs'];
const RUNTIME_ROOTS=[
 'scripts/operations/run-taiwan-market-daily.mjs','scripts/operations/refresh-taiwan-market-inputs.mjs',
 'scripts/operations/bootstrap-taiwan-market-seed.mjs','scripts/operations/taiwan-market-checkpoint.mjs',...EDGE_FILES,
 'src/pages/vnext/DailyAiMarketMemberEntry.tsx','src/pages/vnext/OwnerMarketReview.tsx',
];
const PYTHON_EDGES={
 'research/taiwan-market-checkpoint.mjs':['scripts/operations/taiwan-market-checkpoint-archive.py'],
 'scripts/operations/refresh-taiwan-market-sources.py':[
  'scripts/operations/acquire-taiwan-history.py','scripts/operations/acquire-taiwan-financial-history.py',
  'scripts/operations/acquire-taiwan-financial-csv.py','research/taiwan-market-financial-csv.py','research/taiwan-market-sources.json'],
 'research/taiwan-market-financial-csv.py':['research/taiwan-market-financial-history.py','scripts/operations/acquire-taiwan-financial-csv.py'],
};
const DENIED=/(?:^|\/)(?:\.git|node_modules|__pycache__|\.env(?:\.[^/]*)?|credentials?|secrets?|raw|objects|input-cache|data)(?:\/|$)|\.(?:pyc|pem|key|p12|pfx)$/i;
function checkedPath(name){
 if(typeof name!=='string'||!name||isAbsolute(name)||posix.normalize(name)!==name||name.startsWith('../')||name.includes('\\')||DENIED.test(name)
  ||/taifex|fetch-market-data-v10|production-evidence-recorder|prepare-txf-stream-release/i.test(name))fail('PATH_SCOPE',name);
 const path=resolve(ROOT,name),rel=relative(ROOT,path);if(rel.startsWith('..')||isAbsolute(rel))fail('PATH_SCOPE',name);
 return path;
}
function sourceBytes(name){
 const path=checkedPath(name),parts=name.split('/');
 for(let i=1;i<=parts.length;i++){const stat=lstatSync(resolve(ROOT,...parts.slice(0,i)));if(stat.isSymbolicLink())fail('SYMLINK',name);}
 const stat=lstatSync(path);if(!stat.isFile()||stat.size>16000000)fail('SOURCE_FILE_SIZE',name);
 const bytes=readFileSync(path),text=bytes.toString('utf8');
 if(!bytes.equals(Buffer.from(text)))fail('SOURCE_ENCODING',name);
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsb_secret_[A-Za-z0-9_-]{16,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/.test(text))fail('CREDENTIAL_CONTENT',name);
 return {bytes,mode:stat.mode&0o777};
}
function git(args,{optional=false}={}){
 try{return execFileSync('git',args,{cwd:ROOT,encoding:null,stdio:['ignore','pipe','pipe'],maxBuffer:32000000});}
 catch(error){if(optional&&error.status===128)return null;throw error;}
}
function baselineFile(head,path){
 const tree=git(['ls-tree','-z',head,'--',path]);if(!tree.length)return null;
 const match=/^(\d+) blob ([a-f0-9]{40,64})\t([^\0]+)\0$/.exec(tree.toString('utf8'));
 if(!match||match[3]!==path||match[1]==='120000')fail('BASELINE_PATH',path);
 const bytes=git(['show',head+':'+path]);return {bytes,mode:parseInt(match[1],8)&0o777,git_blob:match[2]};
}
function resolveImport(from,specifier){
 const target=specifier.startsWith('@/')?'src/'+specifier.slice(2):specifier.startsWith('.')?posix.normalize(posix.join(posix.dirname(from),specifier)):null;
 if(target===null)return null;
 for(const name of [target,...['.ts','.tsx','.mjs','.js','.jsx','.json'].map(ext=>target+ext),...['.ts','.tsx','.js','.mjs'].map(ext=>posix.join(target,'index'+ext))]){
  const path=checkedPath(name);if(existsSync(path)&&lstatSync(path).isFile())return name;
 }fail('MISSING_IMPORT',from+' -> '+specifier);
}
function imports(name,text){
 if(!/\.(?:m?[jt]sx?)$/.test(name))return [];
 const parsed=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);if(parsed.parseDiagnostics.length)fail('SOURCE_PARSE',name);
 const result=[];function walk(node){
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))result.push(node.moduleSpecifier.text);
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){
   if(ts.isStringLiteral(node.arguments[0]))result.push(node.arguments[0].text);
   else if(name!=='scripts/operations/run-taiwan-market-daily.mjs')fail('NONLITERAL_IMPORT',name);
  }
  if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.length
   &&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text.startsWith('.'))result.push(node.arguments[0].text);
  ts.forEachChild(node,walk);
 }walk(parsed);return [...new Set(result)];
}
function runtimeClosure(head,cache){
 const visited=new Set(),dependencies=[],edges=[],external=new Set();
 const packageJson=JSON.parse(cache.get('package.json').bytes.toString()),packages={...packageJson.dependencies,...packageJson.devDependencies};
 function visit(name){
  if(visited.has(name))return;visited.add(name);if(visited.size>1000)fail('CLOSURE_LIMIT');
  const item=cache.get(name)??sourceBytes(name);cache.set(name,item);
  if(!INCLUDED.has(name)){
   const base=baselineFile(head,name);if(!base||!base.bytes.equals(item.bytes))fail('UNSCOPED_CHANGED_DEPENDENCY',name);
   dependencies.push({path:name,bytes:item.bytes.length,sha256:sha(item.bytes),git_blob:base.git_blob,source:'UNCHANGED_GIT_BASELINE'});
  }
  for(const specifier of imports(name,item.bytes.toString('utf8'))){
   const resolved=resolveImport(name,specifier);
   if(resolved){edges.push({from:name,to:resolved});visit(resolved);}
   else{const pkg=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
    if(!specifier.startsWith('node:')&&!Object.hasOwn(packages,pkg))fail('UNDECLARED_EXTERNAL',name+' -> '+specifier);external.add(specifier);}
  }
 }
 for(const path of RUNTIME_ROOTS)visit(path);
 for(const [from,targets]of Object.entries(PYTHON_EDGES))for(const to of targets){
  if(!cache.has(from)||!cache.has(to))fail('PYTHON_DEPENDENCY',from+' -> '+to);edges.push({from,to,kind:'EXPLICIT_PYTHON_LOADER'});
 }
 return {baseline_files:dependencies.sort((a,b)=>a.path.localeCompare(b.path)),edges,external_modules:[...external].sort(),
  injected_rpc_module:'scripts/operations/taiwan-market-oidc-rpc.mjs',python_external_dependencies:['Python 3.12','lxml==6.1.1']};
}
async function hashFile(path){
 const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())fail('ATTACHMENT_FILE',basename(path));
 const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);
 return {bytes:stat.size,sha256:hash.digest('hex')};
}
async function mainTreeReview(path,head){
 if(!path)return null;
 const value=JSON.parse(readFileSync(path,'utf8'));
 if(value.schema!=='MORNING_ALPHA_MAIN_CANDIDATE_TREE_REVIEW_V1'||value.head!==head
  ||!/^[a-f0-9]{40}$/.test(value.base??'')||!Number.isSafeInteger(value.files)||value.files<0
  ||!Number.isSafeInteger(value.ancestry?.ahead)||value.ancestry.ahead<0
  ||!Number.isSafeInteger(value.ancestry?.behind)||value.ancestry.behind<0
  ||value.ancestry.merge_base!==value.base||value.assessment?.reviewed_every_commit!==false)fail('MAIN_TREE_REVIEW_SCOPE');
 return {file:basename(path),...await hashFile(path),base:value.base,head:value.head,changed_files:value.files,
  status_counts:value.status_counts,ancestry:value.ancestry,
  scope:'SAVED_MAIN_TO_FEATURE_TREE_REVIEW_EXCLUDING_THIS_UNCOMMITTED_SOURCE_OVERLAY',
  incorporated_as_readonly_evidence:true,reviewed_every_commit:false,merge_authorized_by_packager:false};
}
async function seedAttachments(directory){
 if(!directory)return null;
 const manifestPath=resolve(directory,'seed-manifest.json'),m=JSON.parse(readFileSync(manifestPath,'utf8'));
 if(m.schema!=='DAILY_AI_MARKET_PRIVATE_SEED_V1'||m.format!=='ZIP'||m.root_directory!=='input-cache'
  ||!/^[a-f0-9]{64}$/.test(m.seed_id??'')||m.archive_sha256!==m.seed_id||m.chunk_bytes!==1048576
  ||!Number.isSafeInteger(m.archive_bytes)||m.archive_bytes<22||m.archive_bytes>268435456
  ||!Array.isArray(m.chunks)||m.chunks.length!==m.chunk_count||m.chunk_count!==Math.ceil(m.archive_bytes/1048576))fail('SEED_MANIFEST');
 const zipNames=readdirSync(directory).filter(n=>/^Morning_Alpha_Taiwan_Private_Seed_\d{8}\.zip$/.test(n));
 if(zipNames.length!==1)fail('SEED_ARCHIVE_SET');
 const zip=await hashFile(resolve(directory,zipNames[0]));if(zip.bytes!==m.archive_bytes||zip.sha256!==m.seed_id)fail('SEED_ARCHIVE_HASH');
 const names=[zipNames[0],'seed-manifest.json','seed-file-manifest.json','preparation-receipt.json','private-import-sql/000-manifest.sql'];
 for(let i=0;i<m.chunk_count;i++){
  const item=m.chunks[i];if(item.index!==i||item.bytes!==Math.min(1048576,m.archive_bytes-i*1048576)||!/^[a-f0-9]{64}$/.test(item.sha256??''))fail('SEED_CHUNK_MANIFEST');
  names.push('private-import-sql/'+String(i+1).padStart(3,'0')+'-chunk-'+String(i).padStart(3,'0')+'.sql');
 }
 names.push('private-import-sql/999-finalize.sql');
 const actual=readdirSync(resolve(directory,'private-import-sql')).sort(),expected=names.filter(n=>n.startsWith('private-import-sql/')).map(n=>basename(n)).sort();
 if(canonical(actual)!==canonical(expected))fail('SEED_IMPORT_SQL_SET');
 const fileManifest=JSON.parse(readFileSync(resolve(directory,'seed-file-manifest.json'),'utf8'));
 if(fileManifest.seed_id!==m.seed_id||!Array.isArray(fileManifest.files)||fileManifest.files.length!==m.entry_count)fail('SEED_FILE_MANIFEST');
 const files=[];for(const name of names)files.push({file:name,...await hashFile(resolve(directory,name)),private:true,included_in_code_zip:false});
 return {seed_id:m.seed_id,archive_bytes:m.archive_bytes,chunk_count:m.chunk_count,entry_count:m.entry_count,
  uncompressed_bytes:m.uncompressed_bytes,cache_state_sha256:m.cache_state_sha256,latest_manifest_sha256:m.latest_manifest_sha256,files,
  import_performed:false,source_rights_granted:false,research_review_created:false};
}

const ZIP_PYTHON=String.raw`import sys,json,base64,hashlib,zipfile,stat
request=json.load(sys.stdin)
items=sorted(request['entries'],key=lambda item:item['name'])
names=[item['name'] for item in items]
if len(set(names))!=len(names): raise ValueError('DUPLICATE_ZIP_ENTRY')
with zipfile.ZipFile(request['path'],'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9,allowZip64=False) as archive:
 for item in items:
  name=item['name']
  if name.startswith('/') or '\\' in name or any(x in ('','.','..') for x in name.split('/')): raise ValueError('ZIP_PATH')
  data=base64.b64decode(item['base64'],validate=True)
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3
  info.external_attr=(stat.S_IFREG|item['mode'])<<16;info.compress_type=zipfile.ZIP_DEFLATED
  archive.writestr(info,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(request['path']) as archive:
 if archive.namelist()!=names or archive.testzip() is not None: raise ValueError('ZIP_READBACK')
 for item in items:
  if archive.read(item['name'])!=base64.b64decode(item['base64']): raise ValueError('ZIP_BYTES_CHANGED')
print(json.dumps({'entries':len(items)}))`;
function writeZip(path,entries){
 const request={path,entries:entries.map(({name,bytes,mode=0o644})=>({name,base64:bytes.toString('base64'),mode}))};
 return JSON.parse(execFileSync('python3',['-c',ZIP_PYTHON],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:1000000,timeout:60000}));
}
function textEntry(name,value){return {name,bytes:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'),mode:0o644};}
function brief(manifest){
 const lines=['# Morning Alpha 全市場發版範圍','',
  '**狀態：'+(manifest.mode==='freeze'?'已凍結、待部署核准的程式包':'來源清單快照；尚未封裝最終 ZIP')+'。本產生器沒有執行任何正式操作。**','',
  '- Source overlay 基線：`'+manifest.git.head+'`。這是本輪明列檔案的變更，不是 feature 分支全部 ahead commits 的審查。',
  ...(manifest.git.main_tree_review?['- 已保存的 main → feature 差異：'+manifest.git.main_tree_review.ancestry.ahead+' 個 ahead commits、'+manifest.git.main_tree_review.changed_files+' 份檔案；此數量不含尚未提交的本輪 overlay，也不是逐 commit 審查通過。']:[]),
  '- Source snapshot SHA-256：`'+manifest.source_snapshot_hash+'`。',
  '- 明列檔案 '+manifest.files.length+' 份；另有 '+manifest.runtime_closure.baseline_files.length+' 份未變更 Git 基線依賴。',
  '- Main 合併、Readdy／正式前端部署、資料庫套用、gateway 部署、workflow 啟用、私人 seed 匯入及 Owner 發布均未執行。','',
  '## 安裝順序','',...manifest.database.install.map(s=>s.order+'. `'+s.candidate+'` — '+s.purpose),'',
  '依已核准的範圍完成 SQL 後，匯入並確認固定 seed，再部署及確認 gateway；前端合併與部署範圍另行核對，workflow 最後啟用。Workflow 必須使用固定 main workflow path；程式入庫完成只會產生待審版。','',
  '## 權限邊界','',
  '- AGENTS.md 的原文 hash 已保存；打包不構成 commit／push／migration／deploy／排程啟用授權。各項已有明確授權時沿用該範圍，不把未授權動作併入執行。',
  '- OIDC：限定既定 repository／main／workflow／event，只有明列 staging RPC、兩個已完成 seed 的私人 reader 與三個 checkpoint RPC；不含審查、發布或 seed 匯入。',
  '- Seed 匯入：三個 service-only 寫入 RPC，不在 OIDC allowlist；seed ID 必須是受審 ZIP 原 SHA-256。',
  '- Owner：登入、會員 Owner 身分及研究 Owner 三層檢查；四項人工審查及獨立發布動作。',
  '- 會員：既有付費／試用／到期及來源權利檢查；free 固定三檔後篩選；每頁最多 60 張。',
  '- 研究參考價仍標 CALCULATED_RESEARCH_ONLY，不會產生自動 PASS 或自動會員發布。','',
  'BVPS SQL 核對提交樣本各 peer 的原件、資格、期間、公司行動與完整公式；完整候選組由凍結 JS context 建立，SQL 未另外重建全市場同業集合。方法及績效均未批准。','',
  '## 回復','',
  '先停止新 workflow 與 gateway，再依 rollback ZIP 的逆向 SQL 順序關閉功能；SHORT scope、performance 必須依逆序先於 BVPS 回復，base rollback 最後執行。這個順序與 stage 函式的精確 MD5 接續一致。保留 immutable 原件、結果、審查與發布紀錄。',
  'Source restore 只還原本輪明列檔案到上述 Git 基線；正式前端須另外保留並核對實際部署的完整回復版本，不能把 feature HEAD 當成 main 已部署版本。','',
  '## 尚未由本產生器驗證','',
  '- `.nvmrc` 要求 Node '+manifest.runtime_requirements.node_version+'；目前打包程序為 '+manifest.runtime_requirements.packager_node_version+'。',
  '- Node 22 實際 daily job、Supabase Deno／OIDC 自然執行、正式 PostgreSQL 完整流程與一萬會員負載都需要各自的實測證據。',
  '- 本地 PGlite 與有限負載測試不能替代正式環境或 10,000 人容量驗證。',
  '- Workflow 目前的完整 job 上限為 '+manifest.activation.timeout_minutes+' 分鐘；尚未驗證 native 每日全程能在此上限內完成。第一個步驟設定單一 88 分鐘安全 deadline；所有 setup／restore 都扣同一預算，工作開始前保留 20 分鐘給加密／上傳／seal，最多兩段。90 分鐘不代表已驗證完整自然執行。',
  '- Main 的完整合併差異與正式前端 rollback 基線須另行核對；此 source overlay 包沒有審核先前所有 feature commits。','',
  '## 本輪驗證版本','',
  '- 新 Q3 工作台 run `e3cef91f68874bf9ce54bb06e59a39bbaa6173cdd6a78c453fb5fe85d0cd422b`：2,365 股／7,095 卡／37 shards、4,544 references；HTML 與獨立算術已核對，尚未全批 stage 到 DB。',
  '- r5 本地 SQL run `99e8d8261bd4114440a1abfe386e2cdc2136278e8d0397af936b6ff84b7c5fee`：4,576 references／37 shards 入庫、Owner 完整 237 頁；不是新版 Q3 的 DB 驗證。兩版均未產生本輪人工 PASS 或會員發布，正式環境未寫入。','',
  '## 私人 seed 附件','',manifest.private_seed
   ?'固定 seed ID：`'+manifest.private_seed.seed_id+'`；'+manifest.private_seed.archive_bytes+' bytes、'+manifest.private_seed.chunk_count+' 片；'+(manifest.private_seed.chunk_count+2)+' 份匯入 SQL 尚未執行。原件與匯入 SQL 留在獨立私人附件；程式 ZIP 只記錄其 hash／size。'
   :'尚未綁定私人 seed 附件；inventory 可繼續，freeze 需要完整 seed preparation 目錄。','',
  '## 操作清單','',
  '完整檔案 hash、SQL 順序、rollback、來源基線及附件 hash 以同目錄 manifest.json 為準。原始實作說明見 `research/taiwan-market-release.md`。',''];
 return lines.join('\n');
}

export async function prepareTaiwanMarketRelease(options){
 const mode=options.mode??'inventory';if(!['inventory','freeze'].includes(mode))fail('MODE');
 if(!isAbsolute(options.output??''))fail('ABSOLUTE_OUTPUT');
 const out=resolve(options.output);if(existsSync(out))fail('OUTPUT_EXISTS');
 if(relative(ROOT,out)===''||!relative(ROOT,out).startsWith('..'))fail('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
 const head=git(['rev-parse','HEAD']).toString().trim();if(!/^[a-f0-9]{40}$/.test(head))fail('GIT_HEAD');
 if(options.expectedHead&&options.expectedHead!==head)fail('HEAD_CHANGED');
 if(mode==='freeze'&&(!options.expectedHead||!options.expectedInventory||!options.seedDirectory))fail('FREEZE_REQUIRES_REVIEWED_INVENTORY_HEAD_AND_SEED');
 const cache=new Map(),baselines=new Map(),files=[];
 for(const spec of MARKET_RELEASE_FILES){
  const current=sourceBytes(spec.path),base=baselineFile(head,spec.path);cache.set(spec.path,current);if(base)baselines.set(spec.path,base);
  files.push({...spec,bytes:current.bytes.length,sha256:sha(current.bytes),mode:current.mode,
   change:!base?'ADDED':base.bytes.equals(current.bytes)&&base.mode===current.mode?'UNCHANGED_CONTEXT':'MODIFIED',
   baseline:base?{git_blob:base.git_blob,bytes:base.bytes.length,sha256:sha(base.bytes),mode:base.mode}:null});
 }
 const runtime_closure=runtimeClosure(head,cache),private_seed=await seedAttachments(options.seedDirectory);
 const rules=sourceBytes('AGENTS.md');
 const repository_instructions={file:'AGENTS.md',bytes:rules.bytes.length,sha256:sha(rules.bytes),
  packager_grants_authorization:false,existing_explicit_authorization_preserved:true,
  explicit_action_scopes:['COMMIT','PUSH','MIGRATION','DEPLOY','WORKFLOW_ACTIVATION']};
 const workflowSource=cache.get('research/taiwan-market-daily.workflow.candidate.yml').bytes.toString('utf8');
 const checkpointSource=cache.get('scripts/operations/taiwan-market-checkpoint.mjs').bytes.toString('utf8');
 const seedPins=[...checkpointSource.matchAll(/^export const REVIEWED_INPUT_SEED_ID='([a-f0-9]{64})';$/gm)];
 if(!workflowSource.includes('node scripts/operations/taiwan-market-checkpoint.mjs start')||workflowSource.includes('actions/cache/'))fail('WORKFLOW_PRIVATE_CHECKPOINT_REQUIRED');
 if(seedPins.length!==1||private_seed&&seedPins[0][1]!==private_seed.seed_id)fail('WORKFLOW_PINNED_SEED_MISMATCH');
 const pinnedSeedId=seedPins[0][1];
 const timeouts=[...workflowSource.matchAll(/^\s{4}timeout-minutes:\s*(\d+)\s*$/gm)];
 if(timeouts.length!==1||Number(timeouts[0][1])<1||Number(timeouts[0][1])>360)fail('WORKFLOW_JOB_TIMEOUT');
 let comparison=null;
 if(options.remoteComparison){
  const value=JSON.parse(readFileSync(options.remoteComparison,'utf8'));
  if(value.schema!=='MORNING_ALPHA_REMOTE_GIT_COMPARISON_V1'||value.head!==head||!/^[a-f0-9]{40}$/.test(value.base??'')
   ||!Number.isSafeInteger(value.ahead_by)||value.ahead_by<0||!Number.isSafeInteger(value.behind_by)||value.behind_by<0)fail('REMOTE_COMPARISON_SCOPE');
  comparison={file:basename(options.remoteComparison),...await hashFile(options.remoteComparison),base:value.base,head:value.head,
   ahead:value.ahead_by,behind:value.behind_by,incorporated_as_readonly_evidence:true,merge_scope_reviewed_by_packager:false};
 }
 const main_tree_review=await mainTreeReview(options.mainTreeReview,head);
 if(main_tree_review&&comparison&&(main_tree_review.base!==comparison.base||main_tree_review.ancestry.ahead!==comparison.ahead
  ||main_tree_review.ancestry.behind!==comparison.behind))fail('GIT_EVIDENCE_SCOPE_MISMATCH');
 const branch=git(['branch','--show-current']).toString().trim()||null;
 const gitStatus=git(['status','--porcelain=v1','--untracked-files=all','--',...MARKET_RELEASE_FILES.map(f=>f.path)]).toString();
 if(/^(?:UU|AA|DD|AU|UA|DU|UD|R.|.R|C.|.C) /m.test(gitStatus))fail('UNMERGED_OR_RENAMED_SOURCE');
 const source_snapshot_hash=sha(canonical({head,files:files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256,mode:f.mode,baseline:f.baseline})),
  dependency_files:runtime_closure.baseline_files,private_seed,remote_comparison:comparison,main_tree_review,repository_instructions}));
 if(options.expectedInventory){
  const prior=JSON.parse(readFileSync(options.expectedInventory,'utf8'));
  if(prior.schema!=='TAIWAN_MARKET_RELEASE_V1'||prior.mode!=='inventory'||prior.source_snapshot_hash!==source_snapshot_hash||prior.git.head!==head)fail('INVENTORY_DRIFT');
 }
 const database={install:MARKET_DATABASE_STEPS.map(s=>({...s,candidate_sha256:files.find(f=>f.path===s.candidate).sha256,rollback_sha256:files.find(f=>f.path===s.rollback).sha256})),
  rollback:MARKET_DATABASE_STEPS.toReversed().map((s,index)=>({order:index+1,file:s.rollback,sha256:files.find(f=>f.path===s.rollback).sha256})),
  apply_performed:false,immutable_data_deletion_permitted:false,prerequisite:'Existing authenticated/member/Owner functions and source-license table must match the candidate prerequisites.'};
 const manifest={schema:'TAIWAN_MARKET_RELEASE_V1',mode,prepared_at:new Date().toISOString(),source_snapshot_hash,
  repository:'sonytzeng/morning-alpha',project_id:'cttfzgvhiewfckydcrci',
  git:{head,branch,scoped_status:gitStatus.trimEnd().split('\n').filter(Boolean),tracked_worktree_dirty:git(['status','--porcelain=v1','--untracked-files=no']).length>0,
   source_overlay_only:true,all_feature_commits_reviewed:false,main_merge_performed:false,remote_comparison:comparison,main_tree_review},
  files,runtime_closure,database,private_seed,repository_instructions,
  runtime_requirements:{node_version:cache.get('.nvmrc').bytes.toString().trim(),node_flags:['--experimental-strip-types'],python:'3.12',python_packages:['lxml==6.1.1'],
   packager_node_version:process.version,deno_edge_runtime_verified_by_packager:false,node22_runtime_verified_by_packager:false,ten_thousand_member_load_verified_by_packager:false,
   local_pglite_is_not_production:true},
  edge_function:{name:'taiwan-market-worker-v2',entrypoint:'functions/taiwan-market-worker-v2/index.ts',verify_jwt:false,
   authentication:'Pinned GitHub OIDC RS256 signature and exact repository/main/workflow/event claims',
   files:EDGE_FILES.map(path=>({path,sha256:files.find(f=>f.path===path).sha256})),
   expected_previous_state:'Must verify absent; an existing function requires its own exact saved rollback baseline before replacement.'},
  activation:{source:'research/taiwan-market-daily.workflow.candidate.yml',destination:'.github/workflows/taiwan-market-daily.yml',
   source_sha256:files.find(f=>f.path==='research/taiwan-market-daily.workflow.candidate.yml').sha256,
   timeout_minutes:Number(timeouts[0][1]),full_native_job_duration_verified:false,
   first_step_deadline_minutes:88,checkpoint_reserve_minutes:20,maximum_work_segments:2,unknown_ack_auto_resume:false,
   public_artifact_content:'AUTHENTICATED_AES_256_GCM_CIPHERTEXT_ONLY',plaintext_cache_enabled:false,
   seed_pin_source:'scripts/operations/taiwan-market-checkpoint.mjs',
   schedules_utc:['40 22 * * 0-4','30 10 * * 1-5'],schedules_taipei:['06:40 Monday-Friday','18:30 Monday-Friday'],
   pinned_seed_id:pinnedSeedId,seed_id:private_seed?.seed_id??null,enabled:false,
   changed_existing_v1_cron:false,new_supabase_secret_distributed_to_actions:false},
  authorization_scopes:['SCOPED_GIT_COMMIT','SCOPED_GIT_PUSH','DATABASE_CANDIDATES','NEW_OIDC_GATEWAY','ONE_TIME_PRIVATE_SEED_IMPORT','FRONTEND_MERGE_AND_DEPLOY','NEW_WORKFLOW_ACTIVATION'],
  separate_human_actions:['SOURCE_USE_REVIEW','QUALITY_REVIEW','TIME_REVIEW','METHODOLOGY_REVIEW','OWNER_EDITION_APPROVAL_OR_REVOCATION'],
  rollback:{kind:'FEATURE_STOP_AND_SCOPED_GIT_SOURCE_RESTORE',source_baseline:head,deployed_frontend_baseline_verified:false,
   restore_files:files.filter(f=>f.baseline).map(f=>({path:f.path,...f.baseline,expected_candidate_sha256:f.sha256})),
   added_files_to_remove_only_after_matching_candidate_hash:files.filter(f=>!f.baseline).map(f=>({path:f.path,sha256:f.sha256})),
   execution_order:['Disable/cancel the new workflow and stop the new gateway. Reconcile unknown mutation receipts. Preserve private checkpoint keys/archive pointers for retained ciphertext.',
    'Apply extension rollback files in the listed reverse order; base V2 rollback is last. Preserve every immutable row.',
    'Restore only matching scoped source files. Restore the actual approved previous frontend deployment separately.',
    'Remove the new workflow only if its bytes match the activated candidate; retain private seed and source evidence.']},
  excluded:['TXF function patch','Existing V1 market-policy candidate','Raw source datasets and private seed bytes','Credentials and environment files','node_modules and Python bytecode','Unrelated feature-branch commits'],
  production_actions_performed:0,commit_performed:false,push_performed:false,deployment_authorized:false,member_published:false,artifacts:[],
 };
 // Source files must still be exactly those inspected before any package is
 // emitted. Do not silently include a teammate's concurrent write.
 for(const [path,current]of cache){const checked=sourceBytes(path);
  if(!checked.bytes.equals(current.bytes)||checked.mode!==current.mode)fail('SOURCE_CHANGED_DURING_PREPARATION',path);}
 if(!sourceBytes('AGENTS.md').bytes.equals(rules.bytes))fail('REPOSITORY_INSTRUCTIONS_CHANGED_DURING_PREPARATION');
 if(git(['rev-parse','HEAD']).toString().trim()!==head)fail('HEAD_CHANGED_DURING_PREPARATION');
 const temporary=out+'.preparing-'+randomUUID();mkdirSync(dirname(out),{recursive:true});mkdirSync(temporary);
 const save=(name,bytes)=>{writeFileSync(resolve(temporary,name),bytes,{flag:'wx'});return {file:name,bytes:bytes.length,sha256:sha(bytes)};};
 try{
  const releaseBrief=brief(manifest);
  if(mode==='freeze'){
   const functionBundle={project_id:manifest.project_id,name:manifest.edge_function.name,entrypoint_path:manifest.edge_function.entrypoint,verify_jwt:false,
    files:EDGE_FILES.map(path=>({name:path.replace(/^supabase\//,''),content:cache.get(path).bytes.toString('utf8')}))};
   const sourceManifest={...manifest,artifacts:undefined};
   const candidate=files.map(f=>({name:'repository/'+f.path,bytes:cache.get(f.path).bytes,mode:f.mode}));
   candidate.push(textEntry('release-source-manifest.json',sourceManifest),textEntry('release-brief.md',releaseBrief),
    textEntry('database/install-order.json',database.install),textEntry('operations/workflow-activation.json',manifest.activation),
    textEntry('functions/taiwan-market-worker-v2.candidate.json',functionBundle));
   const rollback=files.filter(f=>f.baseline).map(f=>({name:'repository/'+f.path,bytes:baselines.get(f.path).bytes,mode:f.baseline.mode}));
   for(const step of database.rollback)rollback.push({name:'database/'+String(step.order).padStart(2,'0')+'-'+basename(step.file),bytes:cache.get(step.file).bytes,mode:0o644});
   rollback.push(textEntry('rollback-plan.json',{schema:'TAIWAN_MARKET_RELEASE_ROLLBACK_V1',source_snapshot_hash,...manifest.rollback,database:database.rollback}),
    textEntry('STOP_AND_RESTORE.md',releaseBrief));
   for(const [name,entries]of [['taiwan-market-candidate.zip',candidate],['taiwan-market-rollback.zip',rollback]]){
    writeZip(resolve(temporary,name),entries);manifest.artifacts.push({file:name,...await hashFile(resolve(temporary,name)),entries:entries.length});
   }
  }
  const briefFile=save('release-brief.md',Buffer.from(releaseBrief));manifest.artifacts.push(briefFile);
  const manifestFile=save('manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  save('checksums.sha256',Buffer.from([...manifest.artifacts,manifestFile].map(a=>a.sha256+'  '+a.file).join('\n')+'\n'));
  renameSync(temporary,out);return {output:out,mode,source_snapshot_hash,files:files.length,baseline_dependencies:runtime_closure.baseline_files.length,
   artifacts:[...manifest.artifacts,manifestFile],production_actions_performed:0,main_merge_performed:false};
 }catch(error){rmSync(temporary,{recursive:true,force:true});throw error;}
}

async function selfTest(){
 const directory=mkdtempSync(join(tmpdir(),'market-release-selftest-'));
 try{
  const entries=[textEntry('source/example.mjs','export const synthetic=true;\n'),textEntry('notes/utf8.md','合成封裝測試\n')];
  writeZip(join(directory,'first.zip'),entries);writeZip(join(directory,'second.zip'),entries);
  if(!readFileSync(join(directory,'first.zip')).equals(readFileSync(join(directory,'second.zip'))))fail('SELF_TEST_ZIP_DETERMINISM');
  for(const path of ['../secret','raw/receipt.json','.env','node_modules/a.js','supabase/functions/_shared/taifex-stream-reader.mjs']){
   let rejected=false;try{checkedPath(path);}catch{rejected=true;}if(!rejected)fail('SELF_TEST_SCOPE');
  }
  console.log(JSON.stringify({state:'SYNTHETIC_PACKAGER_SELF_TEST_PASS',source_files_packaged:0,production_actions_performed:0}));
 }finally{rmSync(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length===3&&process.argv[2]==='--self-test')await selfTest();
 else{
  const args=process.argv.slice(2),options={},names={'--mode':'mode','--output':'output','--expected-head':'expectedHead',
   '--expected-inventory':'expectedInventory','--seed-directory':'seedDirectory','--remote-comparison':'remoteComparison','--main-tree-review':'mainTreeReview'};
  for(let i=0;i<args.length;i+=2){if(!names[args[i]]||!args[i+1]||Object.hasOwn(options,names[args[i]]))fail('ARGUMENTS');options[names[args[i]]]=args[i+1];}
  for(const key of ['expectedInventory','seedDirectory','remoteComparison','mainTreeReview'])if(options[key]&&!isAbsolute(options[key]))fail('ABSOLUTE_ATTACHMENT',key);
  console.log(JSON.stringify(await prepareTaiwanMarketRelease(options),null,2));
 }
}
