/** Portable, source-bound daily research inputs. The cache preserves old
 * observations on a failed refresh and never manufactures approval or history.
 * Network work is delegated to one bounded official-source worker per task. */
import {createHash,randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import process from 'node:process';
import {setTimeout} from 'node:timers';
import {readFile,writeFile,mkdir,rename,stat,open,unlink,readdir,link} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hostname} from 'node:os';
import {marketSnapshotHash} from './taiwan-market-universe.mjs';
import {loadTaiwanFinancialHistory,loadTaiwanResearchHistory,verifiedFinancialRecord} from './taiwan-market-financial-inputs.mjs';
import {decodeTaiwanHistoryCapture,normalizeTaiwanHistoryCapture} from './taiwan-market-history.mjs';
import {decodeTaiwanActionCapture} from './taiwan-market-actions.mjs';
import {coveredCalendarDate,isMarketTradingDate,previousMarketTradingDate,MARKET_CALENDAR_VERSION} from '../supabase/functions/_shared/market-session-contract.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),executeFile=promisify(execFile);
const sha=v=>createHash('sha256').update(v).digest('hex');
const fail=code=>{throw Error('TAIWAN_INPUT_CACHE_'+code);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const day=v=>new Date(Date.parse(v)+8*3600000).toISOString().slice(0,10);
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const captureId=r=>marketSnapshotHash({source_id:r.source_id,url:r.url,source_sha256:r.sha256,received_at:r.received_at});
export const TAIWAN_INPUT_CACHE_POLICY=Object.freeze({history_sessions:62,action_lookback_days:180,catchup_sessions:5,maximum_tasks:16,
 maximum_provider_requests:64,maximum_transient_attempts:2,transient_cooldown_ms:24*3600000,
 source_bytes:16000000,input_bytes:256000000,invocation_ms:25*60*1000,worker_ms:10*60*1000,
 request_gap_ms:2000,monthly_probe_day:11,version:'TAIWAN_DAILY_INPUT_CACHE_20261111_V3',
 report_content_basis:'ALL_PERIOD_COMPANY_ROWS_EXCLUDING_ONLY_EXPORT_DATE',
 current_cashflow_cadence:'ONCE_PER_ACTUAL_TAIPEI_WEEKDAY_OR_CHANGED_SOURCE_CONTENT'});
const actionSources=['tpex_ex_right','tpex_capital_reduction','tpex_par_value_change'];
const allowedScopes=new Set(['tpex_daily','twse_valuation',...actionSources,'mops_revenue_twse','mops_financial',
 'twse_daily','twse_ex_right','twse_capital_reduction','twse_par_value_change']);
const schema='TAIWAN_DAILY_INPUT_MANIFEST_V1';
const classificationVersion='RETAINED_FAILURE_BYTES_20261111_V2';
function transientReceipt(r){if(r?.source_halted||[403,429].includes(r?.status))return false;
 return [502,503,504].includes(r?.status)||r?.status==null&&/^HTTPError: HTTP Error (?:502|503|504):/.test(r?.error??'')
  ||[null,undefined,200].includes(r?.status)&&/Timeout|TRANSPORT/.test(r?.error??'');}
function receiptScope(r){const id=r.source_id??'';return /^mops_(income|balance|cashflow)_|^MOPS_(INCOME|BALANCE|CASHFLOW)_/.test(id)?'mops_financial':
 /^MOPS_REVENUE_TWSE_/.test(id)?'mops_revenue_twse':/^TWSE_VALUATION_/.test(id)?'twse_valuation':id;}

async function json(file,limit=TAIWAN_INPUT_CACHE_POLICY.input_bytes){const bytes=await bounded(file,limit);return JSON.parse(bytes.toString('utf8'));}
async function bounded(file,limit){const size=(await stat(file)).size;if(size<1||size>limit)fail('FILE_SIZE');const b=await readFile(file);if(b.length!==size)fail('FILE_CHANGED');return b;}
function local(root,file){if(typeof file!=='string'||!file||isAbsolute(file))fail('RELATIVE_PATH');const p=resolve(root,file),r=relative(root,p);
 if(r==='..'||r.startsWith('../')||isAbsolute(r))fail('RELATIVE_PATH');return p;}
async function immutable(file,bytes){await mkdir(dirname(file),{recursive:true});try{await writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||!(await readFile(file)).equals(bytes))fail('IMMUTABLE_BYTES');}}
async function atomic(file,value){const temp=file+'.'+randomUUID()+'.tmp';await mkdir(dirname(file),{recursive:true});await writeFile(temp,JSON.stringify(value)+'\n',{flag:'wx'});await rename(temp,file);}
async function put(root,bytes,suffix='bin'){if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);const descriptor={file:'objects/'+sha(bytes)+'.'+suffix,sha256:sha(bytes),bytes:bytes.length};
 await immutable(local(root,descriptor.file),bytes);return descriptor;}
async function putJson(root,value){return put(root,Buffer.from(JSON.stringify(value)+'\n'),'json');}
async function readObject(root,descriptor){if(!object(descriptor)||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<1||descriptor.bytes>TAIWAN_INPUT_CACHE_POLICY.input_bytes||!/^[a-f0-9]{64}$/.test(descriptor.sha256??''))fail('OBJECT_DESCRIPTOR');
 const b=await bounded(local(root,descriptor.file),TAIWAN_INPUT_CACHE_POLICY.input_bytes);if(b.length!==descriptor.bytes||sha(b)!==descriptor.sha256)fail('OBJECT_HASH');return b;}
async function objectJson(root,descriptor){return JSON.parse((await readObject(root,descriptor)).toString('utf8'));}
async function reconcileFailureClassifications(root,state){if(state.failure_classification_version===classificationVersion)return;
 for(const archive of Object.values(state.receipt_archives??{})){const r=await objectJson(root,archive.receipt),scope=receiptScope(r);
  let denial=r.source_halted===true||[403,429].includes(r.status);
  if(!denial&&archive.raw){const raw=await readObject(root,archive.raw);denial=raw.includes(Buffer.from('FOR SECURITY REASONS'))||raw.includes(Buffer.from('因為安全性考量'));}
  if(denial&&allowedScopes.has(scope))state.source_halts[scope]={receipt:archive.receipt,raw:archive.raw??null,observed_at:r.received_at??r.started_at,basis:'ORIGINAL_ACCESS_DENIAL_RECEIPT_OR_BYTES'};
 }
 for(const entries of Object.values(state.attempts))for(const entry of entries)if(entry.seed_receipt){const r=await objectJson(root,entry.seed_receipt);entry.transient=transientReceipt(r);}
 state.failure_classification_version=classificationVersion;
}
function verifyUniverse(universe){const {universe_hash,...body}=universe??{};if(universe?.schema!=='TAIWAN_MARKET_UNIVERSE_V1'||universe_hash!==marketSnapshotHash(body)||!Array.isArray(universe.companies))fail('UNIVERSE');}
function validatePublic(receipt,bytes,now){if(receipt?.schema!=='TAIWAN_PUBLIC_SOURCE_RECEIPT_V1'||receipt.state!=='CAPTURED'||receipt.status!==200
 ||!['json','csv'].includes(receipt.format)||!time(receipt.started_at)||!time(receipt.received_at)||Date.parse(receipt.started_at)>Date.parse(receipt.received_at)
 ||Date.parse(receipt.received_at)>Date.parse(now)||receipt.bytes!==bytes.length||receipt.sha256!==sha(bytes))fail('SOURCE_CAPTURE');}
async function retainPublic(root,state,receipt,bytes,now){validatePublic(receipt,bytes,now);const id=captureId(receipt),raw=await put(root,bytes,receipt.format);
 const prior=state.captures[id];if(prior&&marketSnapshotHash(prior.receipt)!==marketSnapshotHash(receipt))fail('CAPTURE_ID_CONFLICT');
 state.captures[id]={receipt,raw};return id;}
async function retainFinancial(root,state,entry,base,now){
 const documentBytes=await bounded(resolve(base,entry.file),TAIWAN_INPUT_CACHE_POLICY.input_bytes),doc=JSON.parse(documentBytes);
 const {financial_history_hash,...body}=doc;if(doc.schema!=='TAIWAN_MARKET_FINANCIAL_CSV_V1'||financial_history_hash!==marketSnapshotHash(body)
  ||doc.company_count!==doc.records?.length||doc.all_cells_matched_parent!==true||doc.records.some(row=>!verifiedFinancialRecord(row)))fail('FINANCIAL_DOCUMENT');
 const receiptBytes=await bounded(resolve(base,entry.public_receipt_file),16000000),receipt=JSON.parse(receiptBytes),raw=await bounded(resolve(base,entry.raw_csv_file),TAIWAN_INPUT_CACHE_POLICY.source_bytes);
 if(marketSnapshotHash(receipt)!==marketSnapshotHash(doc.source_receipt))fail('FINANCIAL_RECEIPT');
 await retainPublic(root,state,receipt,raw,now);const document=await put(root,documentBytes,'json'),public_receipt=await put(root,receiptBytes,'json');
 state.financial_documents[doc.source_id]={source_id:doc.source_id,parent_source_id:doc.parent_source_id,market:doc.market,family:doc.family,period:doc.period,
  company_count:doc.company_count,financial_history_hash,document,public_receipt,raw:state.captures[captureId(receipt)].raw};
 // Parent originals are audit provenance. Their immutable embedded local paths
 // are not used to find raw bytes after this content-addressed copy is made.
 const parentPath=entry.parent_receipt_file??doc.original_source_receipt?.parent_receipt_path;
 if(parentPath){const parent=await json(resolve(base,parentPath)),parentRaw=await bounded(resolve(base,entry.parent_raw_file??parent.raw_path),TAIWAN_INPUT_CACHE_POLICY.source_bytes);
  if(parent.sha256!==sha(parentRaw)||parent.bytes!==parentRaw.length||parent.sha256!==receipt.parent_html_sha256)fail('FINANCIAL_PARENT');
  state.parent_provenance[parent.sha256]={receipt:await put(root,await bounded(resolve(base,parentPath),16000000),'json'),raw:await put(root,parentRaw,'html')};}
 return doc;
}
async function retainAction(root,state,receipt,bytes,now){const decoded=decodeTaiwanActionCapture({receipt,bytes});
 await retainPublic(root,state,decoded.public_receipt,decoded.entity_bytes,now);
 const prior=state.action_originals[receipt.source_id];if(!prior||Date.parse(receipt.received_at)>Date.parse(prior.receipt.received_at))
  state.action_originals[receipt.source_id]={receipt,raw:await put(root,bytes,'bin')};}
function newState(now){return {schema:'TAIWAN_INPUT_CACHE_STATE_V1',policy_version:TAIWAN_INPUT_CACHE_POLICY.version,created_at:now,updated_at:now,
 captures:{},financial_documents:{},financial_document_history:{},report_coverage:{},report_requests:{},report_refresh:{},report_attempt_scopes:{},
 parent_provenance:{},receipt_archives:{},history_stocks:{},action_originals:{},source_halts:{},attempts:{},runs:{},seed_provenance:null,base_acquisition_files:[]};}
const reportScope=task=>[task.market,task.family,task.period].join(':');
function reportFields(state){for(const key of ['financial_document_history','report_refresh','report_attempt_scopes'])state[key]??={};}
function taskIdentity(task){const keys={TPEX_DAY:['date'],TWSE_VALUATION_DAY:['date'],TPEX_ACTION_SET:['from','through'],MOPS_REVENUE_MONTH:['market','period'],MOPS_REPORT:['market','family','period']}[task.kind];
 if(!keys)fail('TASK_KIND');return {kind:task.kind,...Object.fromEntries(keys.map(k=>[k,task[k]])),
  ...(task.kind==='MOPS_REPORT'&&task.report_content_version?{report_content_version:task.report_content_version}:{}),
  ...(task.kind==='MOPS_REPORT'&&task.report_refresh_date?{report_refresh_date:task.report_refresh_date}:{})};}
export const taiwanInputRefreshTaskHash=task=>marketSnapshotHash(taskIdentity(task));
const reportBaseHash=task=>taiwanInputRefreshTaskHash({kind:'MOPS_REPORT',market:task.market,family:task.family,period:task.period});
function workerTask(task){if(task.kind!=='MOPS_REPORT')return task;const keys=['schema','kind','market','family','period','period_trigger_basis','publication_evidence','retained_request_evidence'];
 return Object.fromEntries(keys.filter(key=>task[key]!==undefined).map(key=>[key,task[key]]));}
function reportAttempts(state,task){const scope=reportScope(task),base=reportBaseHash(task),entries=[];
 for(const [key,attempts]of Object.entries(state.attempts))if(key===base||state.report_attempt_scopes?.[key]===scope)
  for(const attempt of attempts)entries.push(attempt);
 return entries.sort((a,b)=>Date.parse(a.finished_at??a.started_at??0)-Date.parse(b.finished_at??b.started_at??0));}
function activeReportFailures(state,task){const checked=state.report_refresh?.[reportScope(task)];return reportAttempts(state,task).filter(a=>a.state!=='CAPTURED'&&(
 a.report_generation_id!==undefined?a.report_generation_id===(checked?.generation_id??null):!time(checked?.checked_at)||!time(a.finished_at??a.started_at)||Date.parse(a.finished_at??a.started_at)>=Date.parse(checked.checked_at)));}
function reportAttemptNumber(state,task){const entries=activeReportFailures(state,task);return Math.max(entries.length,0,...entries.map(a=>a.report_attempt_ordinal??a.ordinal??1));}
function scopes(task){return task.kind==='TPEX_DAY'?['tpex_daily']:task.kind==='TWSE_VALUATION_DAY'?['twse_valuation']:task.kind==='TPEX_ACTION_SET'?actionSources:
 task.kind==='MOPS_REVENUE_MONTH'?['mops_revenue_twse']:['mops_financial'];}
function expectedDate(now){const d=day(now);if(!coveredCalendarDate('TW',d))fail('CALENDAR_UNCOVERED');return isMarketTradingDate('TW',d)&&Date.parse(now)>=Date.parse(d+'T17:05:00+08:00')?d:previousMarketTradingDate('TW',d);}
function tradingDates(through,count){const dates=[];let current=through;for(let i=0;i<500&&dates.length<count;i++){
 if(!coveredCalendarDate('TW',current))break;if(isMarketTradingDate('TW',current))dates.push(current);current=new Date(Date.parse(current+'T00:00:00Z')-86400000).toISOString().slice(0,10);}
 if(!dates.length)fail('CALENDAR_EMPTY');return dates.reverse();}
function emptyIssues(state){return Object.keys(state.source_halts).sort().map(source_scope=>({code:'SOURCE_ACCESS_HALT_RETAINED',source_scope}));}

/** Bootstrap is explicit and offline. A missing cache cannot silently become
 * an empty financial/history input for tomorrow's analysis. */
export async function seedTaiwanMarketInputCache({cacheDir,seedManifestFile,now=new Date().toISOString()}){
 if(!time(now))fail('CLOCK');const root=resolve(cacheDir);await mkdir(root,{recursive:true});
 try{await stat(join(root,'cache-state.json'));fail('SEED_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 const seedBytes=await bounded(seedManifestFile,8000000),seed=JSON.parse(seedBytes),base=dirname(resolve(seedManifestFile));
 if(seed.schema!=='TAIWAN_INPUT_CACHE_SEED_V1'||typeof seed.history_manifest_file!=='string'||typeof seed.financial_manifest_file!=='string'
  ||typeof seed.history_source_directory!=='string')fail('SEED_REQUIRED');
 const state=newState(now),history=await loadTaiwanResearchHistory(resolve(base,seed.history_manifest_file));
 const ids=new Set();for(const stock of history.stocks){const {history_hash,...body}=stock;if(stock.schema!=='TAIWAN_SECURITY_HISTORY_V1'||history_hash!==marketSnapshotHash(body)||ids.has(stock.security_id))fail('SEED_HISTORY');
  ids.add(stock.security_id);state.history_stocks[stock.security_id]=await putJson(root,stock);}
 const required=new Set(history.stocks.flatMap(s=>s.bars.map(b=>b.source_capture.capture_id))),sourceDir=resolve(base,seed.history_source_directory);
 for(const name of (await readdir(join(sourceDir,'public-receipts'))).filter(x=>x.endsWith('.json'))){const receipt=await json(join(sourceDir,'public-receipts',name));
  if(required.has(captureId(receipt)))await retainPublic(root,state,receipt,await bounded(join(sourceDir,'http-entity',name),TAIWAN_INPUT_CACHE_POLICY.source_bytes),now);}
 if([...required].some(id=>!state.captures[id]))fail('SEED_HISTORY_RAW_PROOF');
 const financialFile=resolve(base,seed.financial_manifest_file),manifest=await json(financialFile);await loadTaiwanFinancialHistory(financialFile);
 if(manifest.schema!=='TAIWAN_FINANCIAL_CSV_MANIFEST_V1')fail('SEED_FINANCIAL_MANIFEST');
 for(const entry of manifest.documents)await retainFinancial(root,state,entry,dirname(financialFile),now);
 for(const item of manifest.logical_report_coverage??[])state.report_coverage[[item.market,item.family,item.period].join(':')]=item.complete===true;
 if(seed.retained_captures_file){const file=resolve(base,seed.retained_captures_file),r=await json(file);if(r.schema!=='TAIWAN_RETAINED_CAPTURES_V1'||!Array.isArray(r.captures))fail('SEED_RETAINED');
  for(const item of r.captures)await retainPublic(root,state,item.receipt,await bounded(resolve(dirname(file),item.raw_path),TAIWAN_INPUT_CACHE_POLICY.source_bytes),now);}
 for(const file of seed.supplement_receipt_files??[]){const p=resolve(base,file),r=await json(p);await retainPublic(root,state,r,await bounded(resolve(dirname(p),r.raw_path),TAIWAN_INPUT_CACHE_POLICY.source_bytes),now);}
 if(seed.base_acquisition_directory){const directory=resolve(base,seed.base_acquisition_directory);await mkdir(join(root,'seed-acquisition','raw'),{recursive:true});
  for(const name of (await readdir(directory)).filter(n=>/^acquisition-.*\.json$/.test(n))){const bytes=await bounded(join(directory,name),16000000),acquisition=JSON.parse(bytes);
   if(acquisition.schema!=='TAIWAN_PUBLIC_ACQUISITION_V1'||!Array.isArray(acquisition.receipts))fail('SEED_BASE_ACQUISITION');
   const file='seed-acquisition/'+name;await immutable(local(root,file),bytes);state.base_acquisition_files.push({file,sha256:sha(bytes),bytes:bytes.length});
   for(const receipt of acquisition.receipts){if(receipt.state!=='CAPTURED')continue;const raw=await bounded(resolve(directory,receipt.raw_path),TAIWAN_INPUT_CACHE_POLICY.source_bytes);
    const id=await retainPublic(root,state,receipt,raw,now),destination=join(root,'seed-acquisition','raw',basename(receipt.raw_path));
    try{await link(local(root,state.captures[id].raw.file),destination);}catch(e){if(e.code==='EXDEV')await immutable(destination,raw);else if(e.code!=='EEXIST'||!(await readFile(destination)).equals(raw))throw e;}
   }}}
 if(seed.actions_source_manifest_file){const file=resolve(base,seed.actions_source_manifest_file),actions=await json(file);
  if(actions.schema!=='TAIWAN_ACTION_ORIGINAL_CAPTURE_SET_V1'||actions.captures?.length!==3)fail('SEED_ACTIONS');
  for(const item of actions.captures)await retainAction(root,state,item.receipt,await bounded(resolve(dirname(file),item.raw_path),TAIWAN_INPUT_CACHE_POLICY.source_bytes),now);}
 for(const file of seed.attempt_receipt_files??[]){const p=resolve(base,file),bytes=await bounded(p,16000000),r=JSON.parse(bytes);const receipt=await put(root,bytes,'json');
  const archive={receipt};if(r.state!=='CAPTURED'&&r.raw_path&&r.sha256&&r.bytes){const raw=await bounded(resolve(dirname(p),r.raw_path),TAIWAN_INPUT_CACHE_POLICY.source_bytes);
   if(sha(raw)!==r.sha256||raw.length!==r.bytes)fail('SEED_FAILED_RECEIPT_RAW_HASH');archive.raw=await put(root,raw,'bin');}
  state.receipt_archives[receipt.sha256]=archive;
  let scope=r.source_id;if(/^mops_(income|balance|cashflow)_/.test(scope??''))scope='mops_financial';
  if(r.source_halted&&allowedScopes.has(scope))state.source_halts[scope]={receipt,observed_at:r.received_at??r.started_at};
  let task=null;if(r.source_id==='tpex_daily'&&r.date)task={kind:'TPEX_DAY',date:r.date};
  const financial=/^mops_(income|balance|cashflow)_(TWSE|TPEX|EMERGING)_(20\d\dQ[1-4])$/.exec(r.source_id??'');
  if(financial)task={kind:'MOPS_REPORT',family:financial[1].toUpperCase(),market:financial[2],period:financial[3]};
  if(task&&r.state!=='CAPTURED'){const key=taiwanInputRefreshTaskHash(task),entry={ordinal:r.attempts??1,started_at:r.started_at,finished_at:r.received_at??r.started_at,
    state:'UNAVAILABLE',transient:transientReceipt(r),seed_receipt:receipt};
   state.attempts[key]??=[];if(!state.attempts[key].some(x=>x.ordinal===entry.ordinal))state.attempts[key].push(entry);state.attempts[key].sort((a,b)=>a.ordinal-b.ordinal);}}
 state.seed_provenance={seed_sha256:sha(seedBytes),history_manifest:await put(root,await bounded(resolve(base,seed.history_manifest_file),TAIWAN_INPUT_CACHE_POLICY.input_bytes),'json'),
  financial_manifest:await put(root,await bounded(financialFile,TAIWAN_INPUT_CACHE_POLICY.input_bytes),'json'),imported_at:now};
 await reconcileFailureClassifications(root,state);
 await atomic(join(root,'cache-state.json'),state);return {schema:'TAIWAN_INPUT_CACHE_SEEDED_V1',cache_dir:root,financial_documents:Object.keys(state.financial_documents).length,
  history_securities:Object.keys(state.history_stocks).length,retained_captures:Object.keys(state.captures).length,source_halts:Object.keys(state.source_halts),provider_requests:0};
}

async function financialSourceSpecs(){const catalog=await json(join(ROOT,'research/taiwan-market-sources.json'));
 return new Map(catalog.sources.filter(s=>['INCOME','BALANCE','CASHFLOW'].includes(s.family)).map(s=>[s.id,s]));}
function publicationPeriod(row,now){const ys=String(row['年度']??''),qs=String(row['季別']??'');if(!/^\d{3,4}$/.test(ys)||!/^0?[1-4]$/.test(qs))return null;
 const year=Number(ys)+(ys.length===3?1911:0),quarter=Number(qs),end=new Date(Date.UTC(year,quarter*3,0)).toISOString().slice(0,10);
 return year>=2020&&end<=day(now)?year+'Q'+quarter:null;}
const withoutExportDate=row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='出表日期'));
/** Receipt identity proves where a row came from; this independent content
 * version compares the whole reported period, not its first company or date. */
async function publicationProofsFromRetained(root,state,now,specs,{before=now,allPeriods=false}={}){
 const selected=new Map();for(const capture of Object.values(state.captures)){const r=capture.receipt,spec=specs.get(r.source_id);
  if(!spec||r.state!=='CAPTURED'||Date.parse(r.received_at)>Date.parse(before))continue;
  if(r.url!==spec.url||r.format!=='json')fail('PUBLICATION_SOURCE');
  const old=selected.get(r.source_id);if(old&&Date.parse(r.received_at)===Date.parse(old.receipt.received_at)&&r.sha256!==old.receipt.sha256)fail('PUBLICATION_CAPTURE_TIME_CONFLICT');
  if(!old||Date.parse(r.received_at)>Date.parse(old.receipt.received_at))selected.set(r.source_id,capture);}
 const sources=[];for(const capture of [...selected.values()].sort((a,b)=>a.receipt.source_id.localeCompare(b.receipt.source_id))){
  const {receipt,raw}=capture,bytes=await readObject(root,raw);validatePublic(receipt,bytes,now);const rows=JSON.parse(bytes),periods=new Map();
  if(!Array.isArray(rows))fail('PUBLICATION_ROWS');
  for(let row_index=0;row_index<rows.length;row_index++){const row=rows[row_index];if(!object(row))continue;const period=publicationPeriod(row,now);if(!period)continue;
   const group=periods.get(period)??{hashes:[],evidence:{receipt,raw_path:local(root,raw.file),row_index,source_row_hash:marketSnapshotHash(row),year_field:'年度',quarter_field:'季別'}};
   group.hashes.push(marketSnapshotHash(withoutExportDate(row)));periods.set(period,group);}
  sources.push({spec:specs.get(receipt.source_id),capture,periods});}
 const targets=new Map();for(const source of sources)for(const period of source.periods.keys()){
  const direct={market:source.spec.market,family:source.spec.family,period};targets.set(reportScope(direct),direct);
  const cashflow={...direct,family:'CASHFLOW'};targets.set(reportScope(cashflow),cashflow);}
 const proofs=[];for(const target of targets.values()){
  const members=sources.filter(s=>s.spec.market===target.market&&(target.family==='CASHFLOW'?['INCOME','BALANCE','CASHFLOW'].includes(s.spec.family):s.spec.family===target.family));
  const representative=members.find(s=>s.periods.has(target.period));if(!representative)continue;
  const manifest={schema:'MOPS_PERIOD_CONTENT_VERSION_V1',...target,excluded_fields:['出表日期'],
   source_contents:members.map(s=>({source_id:s.spec.id,url:s.spec.url,family:s.spec.family,row_count:s.periods.get(target.period)?.hashes.length??0,
    rows_hash:marketSnapshotHash([...(s.periods.get(target.period)?.hashes??[])].sort())}))};
  proofs.push({...target,publication_evidence:representative.periods.get(target.period).evidence,
   ...(target.family==='CASHFLOW'&&representative.spec.family!=='CASHFLOW'?{period_trigger_basis:'SAME_MARKET_REPORTED_PERIOD_LOOKUP_NOT_CASHFLOW_AVAILABILITY'}:{}),
   report_content_version:marketSnapshotHash(manifest),report_content_manifest:manifest,
   report_content_sources:members.map(s=>({capture_id:captureId(s.capture.receipt),source_id:s.spec.id,source_sha256:s.capture.receipt.sha256,received_at:s.capture.receipt.received_at}))});}
 if(allPeriods)return proofs;
 const latest=new Map();for(const proof of proofs){const key=proof.market+':'+proof.family,old=latest.get(key);if(!old||proof.period>old.period)latest.set(key,proof);}
 return [...latest.values()];
}
async function acquisitionProofs(directory,root,state,now,specs){
 if(directory){const paths=[];async function visit(p,depth){if(depth>4)return;for(const e of await readdir(p,{withFileTypes:true})){
   if(e.isDirectory())await visit(join(p,e.name),depth+1);else if(/^acquisition-.*\.json$/.test(e.name))paths.push(join(p,e.name));}}
  await visit(resolve(directory),0);const bySource=new Map();
  for(const file of paths){const x=await json(file,16000000);if(x.schema!=='TAIWAN_PUBLIC_ACQUISITION_V1'||!Array.isArray(x.receipts))continue;
   for(const r of x.receipts){if(r.state!=='CAPTURED'||!specs.has(r.source_id))continue;const p=bySource.get(r.source_id);
    if(p&&Date.parse(r.received_at)===Date.parse(p.receipt.received_at)&&r.sha256!==p.receipt.sha256)fail('PUBLICATION_CAPTURE_TIME_CONFLICT');
    if(!p||Date.parse(r.received_at)>Date.parse(p.receipt.received_at))bySource.set(r.source_id,{receipt:r,file});}}
  for(const {receipt,file}of bySource.values()){
   if(receipt.url!==specs.get(receipt.source_id).url||receipt.format!=='json')fail('PUBLICATION_SOURCE');
   const retained=state.captures[captureId(receipt)];let bytes;
   if(retained){if(marketSnapshotHash(retained.receipt)!==marketSnapshotHash(receipt))fail('PUBLICATION_RECEIPT_CONFLICT');bytes=await readObject(root,retained.raw);}
   else{if(typeof receipt.raw_path!=='string')fail('PUBLICATION_RAW_PATH');try{bytes=await bounded(resolve(dirname(file),receipt.raw_path),TAIWAN_INPUT_CACHE_POLICY.source_bytes);}
    catch(error){if(error.code!=='ENOENT')throw error;bytes=await bounded(join(dirname(file),'raw',basename(receipt.raw_path)),TAIWAN_INPUT_CACHE_POLICY.source_bytes);}}
   await retainPublic(root,state,receipt,bytes,now);
  }}
 return publicationProofsFromRetained(root,state,now,specs);
}
function financialReportSemantic(documents){const rows=[],seen=new Set(),headers=[];
 const provenance=new Set(['record_hash','export_date_as_reported','source_url','available_at','first_seen_at','published_at','source_capture','source_cells_matched_parent_html']);
 for(const doc of documents){headers.push(marketSnapshotHash(doc.raw_csv_headers.filter(name=>name!=='出表日期')));
  for(const row of doc.records){if(seen.has(row.security_id))fail('REPORT_DUPLICATE_COMPANY');seen.add(row.security_id);
   rows.push(marketSnapshotHash(Object.fromEntries(Object.entries(row).filter(([key])=>!provenance.has(key)))));}}
 return marketSnapshotHash({schema:'MOPS_COMPLETE_REPORT_CONTENT_V1',records:rows.sort(),headers:[...new Set(headers)].sort()});}
async function initializeReportState(root,state,now,specs){reportFields(state);
 const groups=new Map();for(const entry of Object.values(state.financial_documents)){state.financial_document_history[entry.financial_history_hash]??=entry;
  const scope=reportScope(entry),entries=groups.get(scope)??[];entries.push(entry);groups.set(scope,entries);}
 const unbound=[...groups].filter(([scope])=>state.report_coverage[scope]&&!state.report_refresh[scope]);
 const current=unbound.length?await publicationProofsFromRetained(root,state,now,specs,{allPeriods:true}):[],beforeMemo=new Map();
 for(const [scope,entries]of unbound){const documents=[],parentTimes=[];
  for(const entry of entries){const doc=await objectJson(root,entry.document);documents.push(doc);const parent=state.parent_provenance[doc.source_receipt.parent_html_sha256];
   if(parent){const receipt=await objectJson(root,parent.receipt);if(time(receipt.received_at)&&Date.parse(receipt.received_at)<=Date.parse(now))parentTimes.push(receipt.received_at);}}
  const parent_content_cutoff=parentTimes.length===entries.length?parentTimes.sort((a,b)=>Date.parse(a)-Date.parse(b))[0]:null;
  const receiptTimes=documents.map(d=>d.source_receipt.received_at),checked_at=receiptTimes.every(t=>time(t)&&Date.parse(t)<=Date.parse(now))?receiptTimes.sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1):null;
  let proof=null;if(parent_content_cutoff&&current.some(p=>reportScope(p)===scope)){
   if(!beforeMemo.has(parent_content_cutoff))beforeMemo.set(parent_content_cutoff,await publicationProofsFromRetained(root,state,now,specs,{before:parent_content_cutoff,allPeriods:true}));
   proof=beforeMemo.get(parent_content_cutoff).find(p=>reportScope(p)===scope)??null;}
  const active_document_hashes=entries.map(e=>e.financial_history_hash).sort();
  state.report_refresh[scope]={content_version:proof?.report_content_version??null,content_manifest:proof?.report_content_manifest??null,
   content_sources:proof?.report_content_sources??[],report_semantic_hash:financialReportSemantic(documents),checked_at,
   parent_content_cutoff,checked_taipei_date:parent_content_cutoff?day(parent_content_cutoff):null,active_document_hashes,
   generation_id:marketSnapshotHash({scope,checked_at,active_document_hashes}),
   basis:proof?'RETAINED_OFFICIAL_CONTENT_CAPTURED_BEFORE_REPORT_PARENT':'RETAINED_COMPLETE_REPORT_WITHOUT_PREEXISTING_CONTENT_VERSION'};
 }
 // Old task keys and interrupted attempts keep their logical-report identity.
 for(const [key,entries]of Object.entries(state.attempts)){if(state.report_attempt_scopes[key])continue;
  for(const attempt of entries){let task=null;if(attempt.task)task=await objectJson(root,attempt.task);
   else if(attempt.seed_receipt){const r=await objectJson(root,attempt.seed_receipt),match=/^mops_(income|balance|cashflow)_(TWSE|TPEX|EMERGING)_(20\d\dQ[1-4])$/.exec(r.source_id??'');
    if(match)task={kind:'MOPS_REPORT',market:match[2],family:match[1].toUpperCase(),period:match[3]};}
   if(task?.kind==='MOPS_REPORT'){state.report_attempt_scopes[key]=reportScope(task);break;}}
 }
}

function retainedRequestComplete(r,task){const endpoint={INCOME:'04',BALANCE:'05',CASHFLOW:'20'}[task.family],market={TWSE:'sii',TPEX:'otc',EMERGING:'rotc'}[task.market];
 const form={encodeURIComponent:'1',step:'1',firstin:'1',off:'1',TYPEK:market,year:String(Number(task.period.slice(0,4))-1911),season:'0'+task.period.at(-1)};
 const url='https://mopsov.twse.com.tw/mops/web/ajax_t163sb'+endpoint;
 return r.schema==='TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1'&&r.url===url&&r.method==='POST'&&object(r.form)&&marketSnapshotHash(r.form)===marketSnapshotHash(form)
  &&r.task_id===marketSnapshotHash({method:'POST',url,form})&&r.market===task.market&&r.family===task.family&&r.period===task.period;
}
/** Preserve an explicit backlog, including older failed periods which no longer
 * appear in the current-quarter catalog. These are exact request recoveries,
 * never evidence that a missing financial report was already available. */
async function retainedReportProofs(root,state,proofs,now){state.report_requests??={};
 for(const archive of Object.values(state.receipt_archives??{})){const receipt=await objectJson(root,archive.receipt);
  const match=/^mops_(income|balance|cashflow)_(TWSE|TPEX|EMERGING)_(20\d\dQ[1-4])$/.exec(receipt.source_id??'');
  if(!match||receipt.state==='CAPTURED')continue;
  const task={kind:'MOPS_REPORT',market:match[2],family:match[1].toUpperCase(),period:match[3]},key=reportBaseHash(task);
  const prior=state.report_requests[key]?await objectJson(root,state.report_requests[key]):null;
  if(prior?.publication_evidence||prior?.retained_request_evidence&&Date.parse(prior.retained_request_evidence.receipt.received_at??prior.retained_request_evidence.receipt.started_at)>=Date.parse(receipt.received_at??receipt.started_at))continue;
  state.report_requests[key]=await putJson(root,{...task,period_trigger_basis:'RETAINED_EXACT_PUBLIC_REPORT_REQUEST_RECOVERY',
   retained_request_evidence:{receipt,receipt_sha256:archive.receipt.sha256},
   ...(!retainedRequestComplete(receipt,task)?{proof_issue:'RETAINED_EXACT_REPORT_REQUEST_PROOF_REQUIRED'}:{})});
 }
 for(const proof of proofs){const {raw_path,...evidence}=proof.publication_evidence;void raw_path;
  const task={kind:'MOPS_REPORT',...proof,publication_evidence:evidence};state.report_requests[reportBaseHash(task)]=await putJson(root,task);}
 const current=new Set(proofs.map(reportScope));
 const result=[];for(const descriptor of Object.values(state.report_requests)){const task=await objectJson(root,descriptor);
  if(Number(task.period.slice(0,4))<Number(day(now).slice(0,4))-3||state.report_coverage[reportScope(task)]&&!current.has(reportScope(task)))continue;
  task.report_current_period=current.has(reportScope(task));
  if(task.publication_evidence){const capture=state.captures[captureId(task.publication_evidence.receipt)];if(!capture)fail('RETAINED_PUBLICATION_CAPTURE');
   task.publication_evidence.raw_path=local(root,capture.raw.file);}
  if(task.retained_request_evidence){const archive=state.receipt_archives[task.retained_request_evidence.receipt_sha256];if(!archive)fail('RETAINED_REPORT_RECEIPT');
   task.retained_request_evidence.receipt_file=local(root,archive.receipt.file);}
  result.push(task);
 }
 return result;
}
export function planTaiwanInputRefresh({state,now,publicationProofs=[]}){
 if(!time(now)||state?.schema!=='TAIWAN_INPUT_CACHE_STATE_V1')fail('PLAN_INPUT');
 const through=expectedDate(now),dates=tradingDates(through,TAIWAN_INPUT_CACHE_POLICY.history_sessions),tasks=[],skipped=[],ids=new Set(Object.values(state.captures).map(c=>c.receipt.source_id));
 // The daily OHLC window is shorter than the accepted balance-sheet age.
 // Retain coverage for every <=180-calendar-day BVPS basis as well as SHORT.
 const balanceActionFrom=new Date(Date.parse(through+'T00:00:00Z')-TAIWAN_INPUT_CACHE_POLICY.action_lookback_days*86400000).toISOString().slice(0,10);
 const actionFrom=dates[0]<balanceActionFrom?dates[0]:balanceActionFrom;
 const add=task=>{task={schema:'TAIWAN_INPUT_REFRESH_TASK_V1',...task};const key=taiwanInputRefreshTaskHash(task),attempts=state.attempts[key]??[],prior=attempts.at(-1);
  let reason=null;if(scopes(task).some(s=>state.source_halts[s]))reason='SOURCE_ACCESS_HALTED';
  else if(task.kind==='MOPS_REPORT'){
   const all=reportAttempts(state,task),unknown=all.find(a=>['IN_PROGRESS','UNCONFIRMED'].includes(a.state)),failures=activeReportFailures(state,task),last=failures.at(-1);
   if(unknown)reason='LOGICAL_REPORT_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION';
   else if(failures.some(a=>!a.transient))reason='RECORDED_NONTRANSIENT_OR_COMPLETED_ATTEMPT';
   else if(reportAttemptNumber(state,task)>=TAIWAN_INPUT_CACHE_POLICY.maximum_transient_attempts)reason='TRANSIENT_ATTEMPT_BUDGET_EXHAUSTED';
   else if(last&&(!time(last.finished_at)||Date.parse(now)-Date.parse(last.finished_at)<TAIWAN_INPUT_CACHE_POLICY.transient_cooldown_ms))reason='TRANSIENT_COOLDOWN';
  }
  else if(['IN_PROGRESS','UNCONFIRMED'].includes(prior?.state))reason='INTERRUPTED_ATTEMPT_REQUIRES_RECEIPT_RECONCILIATION';
  else if(prior){if(!prior.transient)reason='RECORDED_NONTRANSIENT_OR_COMPLETED_ATTEMPT';
   else if(Math.max(...attempts.map(a=>a.ordinal))>=TAIWAN_INPUT_CACHE_POLICY.maximum_transient_attempts)reason='TRANSIENT_ATTEMPT_BUDGET_EXHAUSTED';
   else if(Date.parse(now)-Date.parse(prior.finished_at)<TAIWAN_INPUT_CACHE_POLICY.transient_cooldown_ms)reason='TRANSIENT_COOLDOWN';}
  if(!reason&&task.proof_issue)reason=task.proof_issue;
  if(reason)skipped.push({task:taskIdentity(task),task_hash:key,reason});else tasks.push(task);};
 // A restored cache can miss dates older than the last five sessions. Filter
 // the whole window first; newest missing dates get the bounded five slots.
 for(const date of [...dates].reverse())if(!ids.has('TPEX_DAILY_'+date.replaceAll('-','')))add({kind:'TPEX_DAY',date});
 const historyDeferred=tasks.splice(TAIWAN_INPUT_CACHE_POLICY.catchup_sessions).map(taskIdentity);
 if(!ids.has('TWSE_VALUATION_'+through.replaceAll('-','')))add({kind:'TWSE_VALUATION_DAY',date:through});
 if(actionSources.some(source=>{const r=state.action_originals[source]?.receipt;return !r||r.from>actionFrom||r.through<through;}))add({kind:'TPEX_ACTION_SET',from:actionFrom,through});
 const today=day(now);if(Number(today.slice(-2))>=TAIWAN_INPUT_CACHE_POLICY.monthly_probe_day){const previous=new Date(Date.parse(today.slice(0,7)+'-01T00:00:00Z')-86400000).toISOString().slice(0,7).replace('-','');
  if(!ids.has('MOPS_REVENUE_TWSE_'+previous+'_CSV'))add({kind:'MOPS_REVENUE_MONTH',market:'TWSE',period:previous});}
 const weekday=new Date(today+'T00:00:00Z').getUTCDay();
 for(const proof of [...publicationProofs].sort((a,b)=>a.market.localeCompare(b.market)||a.family.localeCompare(b.family)||a.period.localeCompare(b.period))){
  const scope=reportScope(proof),complete=state.report_coverage[scope],checked=state.report_refresh?.[scope];
  const changed=proof.report_content_version&&proof.report_content_version!==checked?.content_version;
  const daily=proof.family==='CASHFLOW'&&proof.report_current_period===true&&weekday>0&&weekday<6&&checked?.checked_taipei_date!==today;
  if(complete&&!changed&&!daily)continue;
  const report_refresh_reason=!complete?'EVIDENCED_REPORT_NOT_YET_COMPLETE':changed?(checked?.content_version?'OFFICIAL_PERIOD_CONTENT_CHANGED_RECHECK_REPORT':'RETAINED_REPORT_CONTENT_VERSION_BINDING_REQUIRED'):'CURRENT_PERIOD_CASHFLOW_DAILY_REVALIDATION';
  add({kind:'MOPS_REPORT',...proof,report_refresh_reason,
   ...(proof.family==='CASHFLOW'&&proof.report_current_period===true?{report_refresh_date:today}:{})});}
 return {schema:'TAIWAN_INPUT_REFRESH_PLAN_V1',formed_at:now,market_calendar_version:MARKET_CALENDAR_VERSION,expected_quote_date:through,expected_dates:dates,tasks:tasks.slice(0,TAIWAN_INPUT_CACHE_POLICY.maximum_tasks),
  deferred:[...historyDeferred,...tasks.slice(TAIWAN_INPUT_CACHE_POLICY.maximum_tasks).map(taskIdentity)],skipped,
  financial_backlog:publicationProofs.filter(p=>!state.report_coverage[reportScope(p)]).map(p=>taskIdentity({kind:'MOPS_REPORT',...p})),
  report_inputs_hash:marketSnapshotHash(publicationProofs.map(p=>({scope:reportScope(p),version:p.report_content_version??null,
   current:p.report_current_period===true,retained_request_hash:p.retained_request_evidence?.receipt_sha256??null})).sort((a,b)=>a.scope.localeCompare(b.scope))),
  financial_refresh_date:today,financial_refresh_date_basis:'ACTUAL_ASIA_TAIPEI_RUN_DATE_NOT_QUOTE_DATE',
  history_catchup_order:'NEWEST_MISSING_FIRST_WITHIN_RETAINED_WINDOW',policy:TAIWAN_INPUT_CACHE_POLICY,publication_periods_inferred:false};
}

function resultFile(path,directory,originalDirectory=directory){if(typeof path!=='string'||!path)fail('WORKER_FILE');
 const rel=isAbsolute(path)?relative(originalDirectory,path):path;if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))fail('WORKER_FILE_OUTSIDE_ATTEMPT');return resolve(directory,rel);}
async function applyFinancialReportResult(root,state,result,now,task,directory,originalDirectory){
 reportFields(state);const scope=reportScope(task),draft={...state,captures:{...state.captures},financial_documents:{...state.financial_documents},parent_provenance:{...state.parent_provenance}};
 const archives={...state.receipt_archives},documents=[],newEntries=[],sourceIds=new Set();
 for(const item of result.captures){if(!object(item.receipt))fail('REPORT_RECEIPT');const r=item.receipt;let descriptor,origin;
  if(/^(?:mops_(?:income|balance|cashflow)|MOPS_(?:INCOME|BALANCE|CASHFLOW))_[A-Za-z0-9_]+$/.test(r.source_id??'')){
   const original=await bounded(join(directory,r.source_id+'-receipt.json'),16000000);
   if(marketSnapshotHash(JSON.parse(original))!==marketSnapshotHash(r))fail('REPORT_ORIGINAL_RECEIPT');descriptor=await put(root,original,'json');origin='ORIGINAL_WORKER_RECEIPT_BYTES';
  }else{descriptor=await putJson(root,r);origin='EMBEDDED_WORKER_RESULT_ONLY';}
  const archive={receipt:descriptor,receipt_origin:origin};
  if(item.raw_path){const raw=await bounded(resultFile(item.raw_path,directory,originalDirectory),TAIWAN_INPUT_CACHE_POLICY.source_bytes);
   if(r.sha256!==sha(raw)||r.bytes!==raw.length)fail('REPORT_RECEIPT_RAW_HASH');archive.raw=await put(root,raw,'bin');}
  archives[descriptor.sha256]=archive;
 }
 // Validate every member first. A later corrupt/partial industry must not
 // replace the current report with the earlier successful industry subset.
 for(const entry of result.financial_documents){const relocated=Object.fromEntries(Object.entries(entry).map(([key,path])=>[key,resultFile(path,directory,originalDirectory)]));
  const doc=await json(relocated.file);if(doc.market!==task.market||doc.family!==task.family||doc.period!==task.period||sourceIds.has(doc.source_id))fail('WORKER_FINANCIAL_TASK');
  sourceIds.add(doc.source_id);documents.push(await retainFinancial(root,draft,relocated,root,now));newEntries.push(draft.financial_documents[doc.source_id]);}
 const report_semantic_hash=documents.length?financialReportSemantic(documents):null;
 if(result.state==='CAPTURED'&&(!documents.length||result.captures.some(c=>c.receipt.state!=='CAPTURED')))fail('REPORT_COMPLETE_RESULT');
 state.captures=draft.captures;state.parent_provenance=draft.parent_provenance;state.receipt_archives=archives;
 for(const entry of newEntries)state.financial_document_history[entry.financial_history_hash]=entry;
 if(result.state!=='CAPTURED')return;
 const previous=state.report_refresh[scope],unchanged=state.report_coverage[scope]===true&&previous?.report_semantic_hash===report_semantic_hash;
 if(!unchanged){const current=Object.fromEntries(Object.entries(state.financial_documents).filter(([,entry])=>reportScope(entry)!==scope));
  for(const entry of newEntries)current[entry.source_id]=entry;state.financial_documents=current;}
 const active_document_hashes=Object.values(state.financial_documents).filter(e=>reportScope(e)===scope).map(e=>e.financial_history_hash).sort();
 state.report_coverage[scope]=true;
 state.report_refresh[scope]={content_version:task.report_content_version??null,content_manifest:task.report_content_manifest??null,
  content_sources:task.report_content_sources??[],report_semantic_hash,checked_at:result.completed_at,checked_taipei_date:task.report_refresh_date??day(result.completed_at),active_document_hashes,
  observed_document_hashes:newEntries.map(e=>e.financial_history_hash).sort(),current_observation_reused:unchanged,
  generation_id:marketSnapshotHash({scope,task_hash:taiwanInputRefreshTaskHash(task),completed_at:result.completed_at,observed_document_hashes:newEntries.map(e=>e.financial_history_hash).sort()}),
  basis:task.report_refresh_reason??'COMPLETE_RETAINED_REPORT_REQUEST',actual_report_content_changed:previous?previous.report_semantic_hash!==report_semantic_hash:null};
}
async function applyCaptureResult(root,state,result,universe,now,task,directory,originalDirectory=directory){
 if(result?.schema!=='TAIWAN_INPUT_REFRESH_CAPTURE_RESULT_V1'||!Array.isArray(result.captures)||!Array.isArray(result.financial_documents)
  ||!Array.isArray(result.source_halts)||result.source_halts.some(s=>!allowedScopes.has(s))||result.kind!==task.kind
  ||!['CAPTURED','PARTIAL','UNAVAILABLE','HALTED'].includes(result.state)||!time(result.completed_at)||Date.parse(result.completed_at)>Date.parse(now))fail('WORKER_RESULT');
 for(const scope of result.source_halts)state.source_halts[scope]={result:await putJson(root,result),observed_at:now};
 if(task.kind==='MOPS_REPORT'){await applyFinancialReportResult(root,state,result,now,task,directory,originalDirectory);return;}
 for(const item of result.captures){const r=item.receipt;if(r?.state!=='CAPTURED')continue;
  if(!item.raw_path)fail('WORKER_RAW');const bytes=await bounded(resultFile(item.raw_path,directory,originalDirectory),TAIWAN_INPUT_CACHE_POLICY.source_bytes);
  if(item.role==='HISTORY'){const decoded=decodeTaiwanHistoryCapture({receipt:r,bytes}),d=normalizeTaiwanHistoryCapture({receipt:r,bytes,universe});
   if(task.kind!=='TPEX_DAY'||r.source_id!=='tpex_daily'||r.date!==task.date)fail('WORKER_HISTORY_TASK');
   await retainPublic(root,state,decoded.public_receipt,decoded.entity_bytes,now);
   for(const row of d.observations){const prior=state.history_stocks[row.security_id]?await objectJson(root,state.history_stocks[row.security_id]):null;
    const bars=new Map((prior?.bars??[]).map(b=>[b.date,b]));const existing=bars.get(row.date);
    if(!existing||Date.parse(row.available_at)>Date.parse(existing.available_at))bars.set(row.date,row);
    const stock={...(prior??{}),security_id:row.security_id,symbol:row.symbol,market:row.market,bars:[...bars.values()].sort((a,b)=>a.date.localeCompare(b.date))};
    delete stock.history_hash;stock.history_hash=marketSnapshotHash(stock);state.history_stocks[row.security_id]=await putJson(root,stock);}}
  else if(item.role==='ACTION'){if(task.kind!=='TPEX_ACTION_SET'||!actionSources.includes(r.source_id)||r.from!==task.from||r.through!==task.through)fail('WORKER_ACTION_TASK');await retainAction(root,state,r,bytes,now);}
  else if(item.role==='PUBLIC'){
   const expected=task.kind==='TWSE_VALUATION_DAY'?'TWSE_VALUATION_'+task.date.replaceAll('-',''):task.kind==='MOPS_REVENUE_MONTH'?'MOPS_REVENUE_TWSE_'+task.period+'_CSV':null;
   if(r.source_id!==expected)fail('WORKER_PUBLIC_TASK');await retainPublic(root,state,r,bytes,now);}
 }
 if(result.financial_documents.length)fail('WORKER_FINANCIAL_TASK');
}

async function materialize(root,state,universe,plan,now,issues){
 const stocks=[],required=new Set(),expected=plan.expected_dates;
 for(const company of universe.companies){const prior=state.history_stocks[company.security_id]?await objectJson(root,state.history_stocks[company.security_id]):null;
  const {history_hash,...priorBody}=prior??{};if(prior&&history_hash!==marketSnapshotHash(priorBody))fail('HISTORY_CACHE_HASH');
  const bars=(prior?.bars??[]).filter(b=>expected.includes(b.date));const seen=new Set();for(const bar of bars){if(bar.security_id!==company.security_id||bar.symbol!==company.symbol||bar.market!==company.market
    ||seen.has(bar.date)||Date.parse(bar.available_at)>Date.parse(now))fail('HISTORY_IDENTITY');seen.add(bar.date);required.add(bar.source_capture.capture_id);}
  const session_scopes=[...new Set(bars.map(b=>b.session_scope))],history_issues=[];if(session_scopes.length>1)history_issues.push('MIXED_SESSION_SCOPE');
  if(bars.some(b=>b.all_trades_session_complete!==true))history_issues.push('REPORTED_HISTORY_EXCLUDES_BLOCK_TRADES');
  const missing=expected.filter(d=>!seen.has(d)).map(date=>({security_id:company.security_id,symbol:company.symbol,date,
   reason:company.market==='EMERGING'?'NATIVE_EMERGING_PRICE_HAS_NO_AUCTION_OPEN_CLOSE_METHOD_REQUIRED':'MARKET_DATE_NOT_CAPTURED_OR_NOT_NORMALIZED',source_capture:null}));
  const body={schema:'TAIWAN_SECURITY_HISTORY_V1',security_id:company.security_id,symbol:company.symbol,market:company.market,company:company.company,
   bars,missing,universe_hash:universe.universe_hash,formed_at:now,expected_dates:expected,unique_sessions:bars.length,session_scopes,history_issues,
   price_history_complete:!missing.length&&!history_issues.length,historical_membership_established:false,corporate_action_coverage_complete:false,methodology_approved:false};
  const stock={...body,history_hash:marketSnapshotHash(body)},descriptor=await putJson(root,stock);stocks.push({security_id:stock.security_id,history_hash:stock.history_hash,
   unique_sessions:stock.unique_sessions,price_history_complete:stock.price_history_complete,file:descriptor.file});}
 const historyBody={schema:'TAIWAN_HISTORY_CHECKPOINT_V1',universe_hash:universe.universe_hash,formed_at:now,expected_dates:expected,stocks,
  counts:{securities:stocks.length,complete_price_histories:stocks.filter(s=>s.price_history_complete).length,price_observations:stocks.reduce((n,s)=>n+s.unique_sessions,0)},
  state:'DAILY_RETAINED_AND_APPENDED_HISTORY',historical_universe_backtest_claim:false,emerging_ohlc_inferred:false,member_published:false};
 const history={...historyBody,manifest_hash:marketSnapshotHash(historyBody)};
 const year=Number(day(now).slice(0,4)),documents=Object.values(state.financial_documents).filter(d=>Number(d.period.slice(0,4))>=year-3).sort((a,b)=>a.source_id.localeCompare(b.source_id));
 for(const entry of documents){const d=await objectJson(root,entry.document);for(const row of d.records)required.add(row.source_capture.capture_id);}
 if(!documents.length)issues.push({code:'RETAINED_FINANCIAL_INPUTS_EMPTY'});
 const financialBody={schema:'TAIWAN_FINANCIAL_CSV_MANIFEST_V1',parser_version:'PORTABLE_ORIGINAL_CSV_DOCUMENT_INDEX_V1',
  documents:documents.map(d=>({source_id:d.source_id,parent_source_id:d.parent_source_id,market:d.market,family:d.family,period:d.period,company_count:d.company_count,
   financial_history_hash:d.financial_history_hash,file:d.document.file,public_receipt_file:d.public_receipt.file,raw_csv_file:d.raw.file})),
  records:documents.reduce((n,d)=>n+d.company_count,0),normalization_failures:[],methodology_approved:false,original_documents_unchanged:true};
 const financial={...financialBody,manifest_hash:marketSnapshotHash(financialBody)};
 const supplementGroups=new Map();for(const [id,c] of Object.entries(state.captures)){const key=/^TWSE_VALUATION_\d{8}$/.test(c.receipt.source_id)?'VALUATION':/^MOPS_REVENUE_TWSE_\d{6}_CSV$/.test(c.receipt.source_id)?'REVENUE':null;
  if(key){const old=supplementGroups.get(key);if(!old||c.receipt.source_id>old.source_id||c.receipt.source_id===old.source_id&&Date.parse(c.receipt.received_at)>Date.parse(old.received_at))
   supplementGroups.set(key,{id,source_id:c.receipt.source_id,received_at:c.receipt.received_at});}}
 for(const item of supplementGroups.values())required.add(item.id);
 let actions=null;if(actionSources.every(s=>state.action_originals[s])){const captures=[];
  for(const source of actionSources){const item=state.action_originals[source],bytes=await readObject(root,item.raw),decoded=decodeTaiwanActionCapture({receipt:item.receipt,bytes});
   required.add(captureId(decoded.public_receipt));captures.push({receipt:item.receipt,raw_path:item.raw.file});}
  actions={schema:'TAIWAN_ACTION_ORIGINAL_CAPTURE_SET_V1',captures};}
 else issues.push({code:'COMPLETE_ACTION_SOURCE_SET_NOT_RETAINED'});
 const retained={schema:'TAIWAN_RETAINED_CAPTURES_V1',captures:[...required].sort().map(id=>{const c=state.captures[id];if(!c)fail('RETAINED_RAW_REQUIRED');return {receipt:c.receipt,raw_path:c.raw.file};})};
 const parts={};for(const [name,value] of Object.entries({history,financial_history:financial,retained_captures:retained,actions_source_manifest:actions})){
  if(!value)continue;const bytes=Buffer.from(JSON.stringify(value)+'\n'),file='input-'+name+'-'+sha(bytes)+'.json';await immutable(join(root,file),bytes);parts[name]={file,sha256:sha(bytes),bytes:bytes.length};}
 const body={schema,policy_version:TAIWAN_INPUT_CACHE_POLICY.version,formed_at:now,expected_quote_date:plan.expected_quote_date,universe_hash:universe.universe_hash,
  parts,source_halts:state.source_halts,issues,financial_backlog:plan.financial_backlog.filter(task=>!state.report_coverage[reportScope(task)]),
  report_inputs_hash:plan.report_inputs_hash,financial_refresh_date:plan.financial_refresh_date,financial_refresh_date_basis:plan.financial_refresh_date_basis,
  report_refresh:state.report_refresh,base_acquisition_files:state.base_acquisition_files,acquisition_directory:state.base_acquisition_files.length?'seed-acquisition':null,
  counts:{financial_documents:documents.length,financial_records:financial.records,history_securities:stocks.length,
   complete_price_histories:history.counts.complete_price_histories,retained_captures:retained.captures.length},
  first_seen_policy:'ORIGINAL_SOURCE_RECEIPT_PRESERVED_NO_DATE_BACKFILL',paths_are_relative_to_manifest:true,methodology_approved:false,member_published:false};
 const manifest={...body,manifest_hash:marketSnapshotHash(body)},file='manifest-'+manifest.manifest_hash+'.json';await immutable(join(root,file),Buffer.from(JSON.stringify(manifest)+'\n'));
 await atomic(join(root,'latest.json'),{schema:'TAIWAN_DAILY_INPUT_POINTER_V1',file,manifest_hash:manifest.manifest_hash});return join(root,file);
}

export async function loadTaiwanDailyInputManifest(file){let value=await json(file,16000000),base=dirname(resolve(file));
 if(value.schema==='TAIWAN_DAILY_INPUT_POINTER_V1'){const expected=value.manifest_hash;file=local(base,value.file);value=await json(file,16000000);if(value.manifest_hash!==expected)fail('LATEST_POINTER');base=dirname(file);}
 const {manifest_hash,...body}=value;if(value.schema!==schema||manifest_hash!==marketSnapshotHash(body)||!object(value.parts))fail('MANIFEST_HASH');
 for(const required of ['history','financial_history','retained_captures'])if(!value.parts[required])fail('MANIFEST_REQUIRED_INPUT');
 const outputs={};for(const [name,descriptor] of Object.entries(value.parts)){await readObject(base,descriptor);outputs[name+'_file']=local(base,descriptor.file);}
 for(const descriptor of value.base_acquisition_files??[])await readObject(base,descriptor);
 if(value.acquisition_directory)outputs.acquisition_dir=local(base,value.acquisition_directory);
 return {schema:'TAIWAN_DAILY_INPUT_REFRESH_RESULT_V1',state:value.issues.length?'INPUTS_READY_WITH_SOURCE_LIMITATIONS':'INPUTS_READY_REVIEW_REQUIRED',manifest_file:resolve(file),manifest_hash,
  ...outputs,issues:value.issues,counts:value.counts,attempts:[],member_published:false,methodology_approved:false};}

export async function executeTaiwanInputRefreshTask({taskFile,output}){await mkdir(output,{recursive:true});try{
 await executeFile('python3',[join(ROOT,'scripts/operations/refresh-taiwan-market-sources.py'),'--task-file',taskFile,'--output',output],
  {cwd:ROOT,timeout:TAIWAN_INPUT_CACHE_POLICY.worker_ms,maxBuffer:128000,encoding:'utf8',killSignal:'SIGKILL'});
 }catch(e){if(e.code!==2)throw e;}return json(join(output,'result.json'),16000000);}

export async function refreshTaiwanMarketInputs(options,dependencies={}){
 const {clock=()=>new Date().toISOString(),execute=executeTaiwanInputRefreshTask,pause=sleep}=dependencies;
 const {cacheDir,universeFile,acquisitionDir=null,slot='POSTCLOSE',seedManifestFile=null,allowNetwork=true}=options;
 if(typeof cacheDir!=='string'||typeof universeFile!=='string'||!['PREMARKET','POSTCLOSE'].includes(slot))fail('OPTIONS');
 const root=resolve(cacheDir);await mkdir(root,{recursive:true});const began=clock(),lockFile=join(root,'input-update.lock.json');if(!time(began))fail('CLOCK');
 try{const handle=await open(lockFile,'wx');await handle.writeFile(JSON.stringify({host:hostname(),pid:process.pid,expires_at:new Date(Date.parse(began)+45*60000).toISOString()}));await handle.close();}
 catch(e){if(e.code!=='EEXIST')throw e;const old=await json(lockFile,4000);if(!time(old.expires_at)||Date.parse(old.expires_at)>Date.parse(began))fail('UPDATE_ALREADY_RUNNING');
  await unlink(lockFile);return refreshTaiwanMarketInputs(options,dependencies);}
 try{
  let state;try{state=await json(join(root,'cache-state.json'));}catch(e){if(e.code!=='ENOENT')throw e;if(!seedManifestFile)fail('BOOTSTRAP_REQUIRED');
   await seedTaiwanMarketInputCache({cacheDir:root,seedManifestFile,now:clock()});state=await json(join(root,'cache-state.json'));}
  if(state.schema!=='TAIWAN_INPUT_CACHE_STATE_V1')fail('STATE_SCHEMA');
  if(state.policy_version!==TAIWAN_INPUT_CACHE_POLICY.version){
   if(!['TAIWAN_DAILY_INPUT_CACHE_20261111_V1','TAIWAN_DAILY_INPUT_CACHE_20261111_V2'].includes(state.policy_version)||state.policy_transitions!==undefined&&!Array.isArray(state.policy_transitions))fail('STATE_SCHEMA');
   // Known seeds keep all original state bytes. V3 adds content-bound report
   // refresh and a current-period CASHFLOW cadence; it grants no source rights.
   const prior_state=await put(root,await bounded(join(root,'cache-state.json'),TAIWAN_INPUT_CACHE_POLICY.input_bytes),'json');
   state.policy_transitions=[...(state.policy_transitions??[]),{from:state.policy_version,to:TAIWAN_INPUT_CACHE_POLICY.version,
    formed_at:began,basis:'REPORT_CONTENT_REFRESH_AND_CURRENT_CASHFLOW_DAILY_REVALIDATION_WITH_180_DAY_ACTION_RANGE',prior_state}];
   state.policy_version=TAIWAN_INPUT_CACHE_POLICY.version;await atomic(join(root,'cache-state.json'),state);
  }
  await reconcileFailureClassifications(root,state);
  const runKey=day(began)+':'+slot;
  const universe=await json(universeFile);verifyUniverse(universe);
  const specs=await financialSourceSpecs();await initializeReportState(root,state,clock(),specs);
  // Reconcile an already finished child locally after an interrupted cache
  // commit. An intent without a receipt never repeats an uncertain request.
  const reconciled=[];
  for(const [key,entries] of Object.entries(state.attempts))for(const attempt of entries){if(attempt?.state!=='IN_PROGRESS')continue;
   let result;try{result=await json(join(root,'attempts',key,String(attempt.ordinal),'result.json'),16000000);}catch(e){if(e.code!=='ENOENT')throw e;}
   const task=await objectJson(root,attempt.task);
   if(result){if(result.kind!==task.kind||taiwanInputRefreshTaskHash(task)!==key)fail('RECOVERY_TASK_BINDING');
    const directory=join(root,'attempts',key,String(attempt.ordinal));
    await applyCaptureResult(root,state,result,universe,clock(),task,directory,attempt.output_original??directory);attempt.result=await putJson(root,result);attempt.state=result.state;attempt.finished_at=result.completed_at;
    attempt.transient=['UNAVAILABLE','PARTIAL'].includes(result.state)&&result.captures.some(c=>transientReceipt(c.receipt));
   }else{attempt.state='UNCONFIRMED';attempt.finished_at=clock();attempt.transient=false;}
   reconciled.push({task:taskIdentity(task),ordinal:attempt.ordinal,state:attempt.state,recovered_without_provider_request:true});}
  await atomic(join(root,'cache-state.json'),state);
  const proofs=await retainedReportProofs(root,state,await acquisitionProofs(acquisitionDir,root,state,clock(),specs),clock());
  const plan=planTaiwanInputRefresh({state,now:clock(),publicationProofs:proofs}),issues=emptyIssues(state);const attempts=[...reconciled];let providerRequests=0;
  // Read actual acquisition content before deciding a same-slot run is cached.
  // New receipts with unchanged semantics still become immutable observations.
  if(state.runs[runKey]&&!reconciled.length){const cached=await loadTaiwanDailyInputManifest(local(root,state.runs[runKey])),manifest=await json(cached.manifest_file,16000000);
   if(manifest.policy_version===TAIWAN_INPUT_CACHE_POLICY.version&&manifest.report_inputs_hash===plan.report_inputs_hash&&manifest.universe_hash===universe.universe_hash){
    await atomic(join(root,'cache-state.json'),state);return {...cached,provider_requests:0};}
   if(![TAIWAN_INPUT_CACHE_POLICY.version,'TAIWAN_DAILY_INPUT_CACHE_20261111_V1','TAIWAN_DAILY_INPUT_CACHE_20261111_V2'].includes(manifest.policy_version))fail('CACHED_RUN_POLICY');}
  for(const item of plan.skipped)issues.push({code:item.reason,task:item.task});for(const task of plan.deferred)issues.push({code:'DAILY_TASK_BUDGET_DEFERRED',task});
  await putJson(root,plan);
  for(const task of plan.tasks){const key=taiwanInputRefreshTaskHash(task),prior=state.attempts[key]??[];
   if(!allowNetwork){issues.push({code:'OFFLINE_UPDATE_NOT_ATTEMPTED',task:taskIdentity(task)});continue;}
   const requestReservation={TPEX_DAY:1,TWSE_VALUATION_DAY:1,TPEX_ACTION_SET:3,MOPS_REVENUE_MONTH:2,MOPS_REPORT:8}[task.kind];
   if(providerRequests+requestReservation>TAIWAN_INPUT_CACHE_POLICY.maximum_provider_requests||Date.parse(clock())-Date.parse(began)>TAIWAN_INPUT_CACHE_POLICY.invocation_ms){issues.push({code:'DAILY_RESOURCE_BUDGET_DEFERRED',task:taskIdentity(task)});continue;}
   if(scopes(task).some(s=>state.source_halts[s])){issues.push({code:'SOURCE_ACCESS_HALTED',task:taskIdentity(task)});continue;}
   const ordinal=Math.max(0,...prior.map(a=>a.ordinal))+1,taskDescriptor=await putJson(root,task),transport=workerTask(task),transportDescriptor=await putJson(root,transport);
   const attempt={ordinal,started_at:clock(),state:'IN_PROGRESS',transient:false,task:taskDescriptor,worker_task:transportDescriptor};
   if(task.kind==='MOPS_REPORT'){attempt.report_attempt_ordinal=reportAttemptNumber(state,task)+1;
    attempt.report_generation_id=state.report_refresh[reportScope(task)]?.generation_id??null;state.report_attempt_scopes[key]=reportScope(task);}
   const directory=join(root,'attempts',key,String(ordinal));attempt.output_original=directory;state.attempts[key]=[...prior,attempt];await atomic(join(root,'cache-state.json'),state);
   try{if(providerRequests)await pause(TAIWAN_INPUT_CACHE_POLICY.request_gap_ms);
    const result=await execute({task:transport,taskFile:local(root,transportDescriptor.file),output:directory});
    if(result.kind!==task.kind||!Number.isSafeInteger(result.network_requests)||result.network_requests<0||result.network_requests>8)fail('WORKER_TASK_BINDING');
    providerRequests+=result.network_requests;await applyCaptureResult(root,state,result,universe,clock(),task,directory);attempt.result=await putJson(root,result);
    attempt.state=result.state;attempt.finished_at=clock();attempt.transient=['UNAVAILABLE','PARTIAL'].includes(result.state)&&result.captures.some(c=>transientReceipt(c.receipt));
    if(result.state!=='CAPTURED')issues.push({code:'SOURCE_REFRESH_'+result.state,task:taskIdentity(task),result_hash:attempt.result.sha256});
   }catch(error){attempt.state='UNCONFIRMED';attempt.finished_at=clock();attempt.error=/^TAIWAN_/.test(error?.message??'')?error.message:'SOURCE_WORKER_UNCONFIRMED';
    issues.push({code:'SOURCE_WORKER_UNCONFIRMED_NO_AUTOMATIC_RETRY',task:taskIdentity(task)});}
   state.updated_at=clock();await atomic(join(root,'cache-state.json'),state);attempts.push({task:taskIdentity(task),ordinal,state:attempt.state});
  }
  const file=await materialize(root,state,universe,plan,clock(),issues);if(allowNetwork)state.runs[runKey]=relative(root,file);state.updated_at=clock();await atomic(join(root,'cache-state.json'),state);
  return {...await loadTaiwanDailyInputManifest(file),attempts,provider_requests:providerRequests,plan_expected_quote_date:plan.expected_quote_date};
 }finally{await unlink(lockFile);}
}
