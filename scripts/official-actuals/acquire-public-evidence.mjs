/** Isolated public-source capture, not source admission or a Production caller.
 * Run: node scripts/official-actuals/acquire-public-evidence.mjs --batch public --out /private/tmp/NEW_DIRECTORY
 * Raw responses (including announcement explanations/contacts) NEVER reach disk.
 * JSON snapshots are as-reported, not proven single-quarter income statements.
 */
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdirSync,lstatSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve,parse as parsePath} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const HERE=dirname(fileURLToPath(import.meta.url));
const PARSER=join(HERE,'inline_xbrl.py');
// Exact reviewed acquisition scope, not automatic admission of new symbols.
export const PUBLIC_UNIVERSE=Object.freeze('1504 1513 1514 1519 1590 1605 1760 2049 2208 2303 2308 2317 2330 2337 2344 2356 2357 2368 2376 2377 2379 2382 2383 2408 2421 2454 2520 2539 2542 2548 2603 2609 2610 2615 2618 2634 2881 2882 2884 2885 2886 2891 2892 3006 3017 3034 3037 3081 3189 3231 3324 3363 3443 3450 3529 3653 3661 3711 4566 4743 4908 4979 6213 6230 6274 6446 6488 6547 6669 8033 8046 8299'.split(' '));
export const LIMITS=Object.freeze({requests:7,deadline_ms:45000,request_ms:10000,response_bytes:8_000_000,total_bytes:20_000_000,rows:5000});
const entries=[
 ['income-ci','finance','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci'],
 ['income-fh','finance','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh'],
 ['income-otc-ci','finance','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_ci'],
 ['events-twse','event','https://openapi.twse.com.tw/v1/opendata/t187ap04_L'],
 ...[[2026,3],[2026,2],[2026,1],[2025,4]].map(([year,quarter])=>[
  `2330-${year}Q${quarter}`,'inline',`https://mopsov.twse.com.tw/server-java/t164sb01?step=1&CO_ID=2330&SYEAR=${year}&SSEASON=${quarter}&REPORT_ID=C`,year,quarter]),
];
export const SOURCES=Object.freeze(entries.map(([id,kind,url,year,quarter])=>Object.freeze({id,kind,url,...(year?{year,quarter,entity:'2330'}:{})})));
const batches=Object.freeze({public:['income-ci','income-fh','income-otc-ci','events-twse'],finance:['income-ci','income-fh','income-otc-ci'],
 'finance-otc':['income-otc-ci'],events:['events-twse'],'xbrl-2330':SOURCES.filter(s=>s.kind==='inline').map(s=>s.id)});
// Public identities already retained by research/retained-quarter-financials.ts.
// These are issuer PDF reports, NOT MOPS iXBRL and not parsed by inline_xbrl.py.
// Their private original bytes/packs are deliberately neither located nor copied.
export const RETAINED_2330=Object.freeze([
 ['2025Q4','cbd5645aed3df57a59beb942110ec251a45c6407c401f8813cff4942e4503e35',4986716],
 ['2026Q1','4878487acab931ea06635a8bb97cbb9dcf14e2140d4c480667298ca1c43e8bdc',4653875],
 ['2026Q2','fad79c6a6ec870357df9eae00e680256956e34083ec84a226959c693eccb1a5f',4645787],
 ['2026Q3','27b5b92d05207bf662756edfbe72494c5f34a007a79306ae040d957886b411d2',468113],
].map(([quarter,sha256,bytes])=>Object.freeze({quarter,sha256,bytes,format:'ISSUER_MANAGEMENT_REPORT_PDF',availability:'REPOSITORY_RETAINED_IDENTITY_NOT_FRESH_READBACK',published_at:null,license_status:'UNKNOWN',inline_parser_applicable:false})));
const metrics=new Set([
 '營業收入','營業成本','原始認列生物資產及農產品之利益（損失）','生物資產當期公允價值減出售成本之變動利益（損失）',
 '營業毛利（毛損）','未實現銷貨（損）益','已實現銷貨（損）益','營業毛利（毛損）淨額','營業費用','其他收益及費損淨額',
 '營業利益（損失）','營業外收入及支出','稅前淨利（淨損）','所得稅費用（利益）','繼續營業單位本期淨利（淨損）',
 '停業單位損益','合併前非屬共同控制股權損益','本期淨利（淨損）','其他綜合損益（淨額）','合併前非屬共同控制股權綜合損益淨額',
 '本期綜合損益總額','淨利（淨損）歸屬於母公司業主','淨利（淨損）歸屬於共同控制下前手權益','淨利（淨損）歸屬於非控制權益',
 '綜合損益總額歸屬於母公司業主','綜合損益總額歸屬於共同控制下前手權益','綜合損益總額歸屬於非控制權益','基本每股盈餘（元）',
 '利息淨收益','利息以外淨收益','淨收益','呆帳費用、承諾及保證責任準備提存','保險負債準備淨變動','繼續營業單位稅前損益',
 '本期稅後淨利（淨損）','本期其他綜合損益（稅後淨額）',
]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const jsonHash=value=>sha(JSON.stringify(value));
class Refusal extends Error{constructor(code){super(code);this.code=code;}}
const requireThat=(ok,code)=>{if(!ok)throw new Refusal(code);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;
function sourceDate(value){
 if(typeof value!=='string'||!/^\d{7,8}$/.test(value))return null;
 const width=value.length===7?3:4,year=Number(value.slice(0,width))+(width===3?1911:0),month=value.slice(width,width+2),day=value.slice(width+2);
 if(year<1900||year>9999)return null;const date=`${year}-${month}-${day}`,ms=Date.parse(date+'T00:00:00Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===date?date:null;
}
function keys(row){
 requireThat(object(row),'ROW_SCHEMA');const out=Object.create(null);
 for(const [k,v]of Object.entries(row)){const key=k.trim();requireThat(!Object.hasOwn(out,key),'KEY_COLLISION');out[key]=v;}
 return out;
}
function announced(date,clock){
 if(typeof date!=='string'||typeof clock!=='string')return null;
 const d=date.trim().match(/^(\d{3,4})[-/]?(\d\d)[-/]?(\d\d)$/),t=clock.trim().match(/^(\d\d):?(\d\d):?(\d\d)$/);
 if(!d||!t)return null;
 const year=Number(d[1])+(d[1].length===3?1911:0),local=`${year}-${d[2]}-${d[3]}T${t[1]}:${t[2]}:${t[3]}`;
 const ms=Date.parse(local+'+08:00');return Number.isFinite(ms)&&new Date(ms+8*3600000).toISOString().slice(0,19)===local?new Date(ms).toISOString():null;
}
/** No free-text, company profile or contact field is returned. No numeric coercion. */
export function sanitizeRows(source,payload,receivedAt,symbols=PUBLIC_UNIVERSE,maxRows=LIMITS.rows){
 requireThat(SOURCES.includes(source)&&['finance','event'].includes(source.kind),'SOURCE_NOT_ALLOWED');
 requireThat(Number.isInteger(maxRows)&&maxRows>0&&maxRows<=LIMITS.rows,'ROW_LIMIT');
 requireThat(Array.isArray(payload)&&payload.length<=maxRows&&time(receivedAt),'JSON_SCHEMA');
 requireThat(Array.isArray(symbols)&&symbols.length>0&&new Set(symbols).size===symbols.length&&symbols.every(s=>PUBLIC_UNIVERSE.includes(s)),'UNIVERSE_SCOPE');
 const allowed=new Set(symbols),rows=[],seen=new Set();
 for(const raw of payload){
  const r=keys(raw);
  // Exact observed TPEx schema, not a guessed global alias. Keep its original
  // identity fields alongside normalized labels and refuse contradictory keys.
  const otc=source.id==='income-otc-ci';
  if(otc)for(const [target,alias]of [['公司代號','SecuritiesCompanyCode'],['出表日期','Date'],['年度','Year'],['季別','Season']]){
   requireThat(typeof r[alias]==='string'&&(!Object.hasOwn(r,target)||r[target]===r[alias]),'TPEX_IDENTITY_SCHEMA');r[target]=r[alias];
  }
  const symbol=r['公司代號'];requireThat(typeof symbol==='string'&&/^\d{4,6}$/.test(symbol),'SYMBOL_SCHEMA');
  if(!allowed.has(symbol))continue;
  if(source.kind==='event'){
   const subject=typeof r['主旨']==='string'?r['主旨'].trim():'',at=announced(r['發言日期'],r['發言時間']);
   requireThat(at&&Date.parse(at)<=Date.parse(receivedAt)&&subject.length>0&&subject.length<=4000,'EVENT_TIME_OR_SUBJECT');
   // Exactly the existing normalizeCompanyEvents identifying-array hash.
   const source_hash=jsonHash([source.url,symbol,at,subject]);if(seen.has(source_hash))continue;seen.add(source_hash);
   rows.push({symbol,exchange:'TWSE',source_ref:source.url,source_hash,subject_hash:jsonHash(subject),published_at:at,available_at:receivedAt,
    event_type:'OFFICIAL_MATERIAL_ANNOUNCEMENT',event_fact:true,bullishness:null,impact_review:'REQUIRED',raw_retained:false});
  }else{
   requireThat(typeof r['年度']==='string'&&/^\d{3,4}$/.test(r['年度'])&&typeof r['季別']==='string'&&/^[1-4]$/.test(r['季別'])&&
    typeof r['出表日期']==='string'&&/^\d{7,8}$/.test(r['出表日期']),'FINANCIAL_PERIOD_SCHEMA');
   const date=sourceDate(r['出表日期']),year=Number(r['年度'])+(r['年度'].length===3?1911:0),received=Date.parse(receivedAt);
   requireThat(date&&date<=new Date(received+8*3600000).toISOString().slice(0,10)&&year>=1900&&
    Date.UTC(year,Number(r['季別'])*3,0,16)<=received,'FINANCIAL_PERIOD_NOT_AVAILABLE');
   requireThat(Object.hasOwn(r,source.id==='income-fh'?'淨收益':'營業收入')&&Object.hasOwn(r,'基本每股盈餘（元）'),'FINANCIAL_PROFILE_UNOBSERVED');
   const row={'公司代號':symbol,'出表日期':r['出表日期'],'年度':r['年度'],'季別':r['季別']};
   for(const key of metrics)if(Object.hasOwn(r,key)){
    requireThat(typeof r[key]==='string'&&r[key].length<=80&&/^(?:|-?\d+(?:\.\d+)?)$/.test(r[key]),'FINANCIAL_VALUE_SCHEMA');row[key]=r[key];
   }
   const identity=JSON.stringify([symbol,row['年度'],row['季別']]);requireThat(!seen.has(identity),'FINANCIAL_DUPLICATE');seen.add(identity);
   rows.push({...row,...(otc?{source_identity_fields:{Date:r.Date,Year:r.Year,Season:r.Season,SecuritiesCompanyCode:r.SecuritiesCompanyCode}}:{}),
    period_basis:'AS_REPORTED_PERIOD_BASIS_UNVERIFIED',direct_single_quarter:false,published_at:null,
    consensus:null,guidance:null,source_admitted:false});
  }
 }
 return rows;
}
function bounded(promise,signal){
 return new Promise((accept,reject)=>{
  const settle=(fn,value)=>{signal.removeEventListener('abort',abort);fn(value);};
  const abort=()=>settle(reject,new Refusal('DEADLINE'));
  // Observe rejection BEFORE checking cancellation: the caller may already have
  // started work whose promise rejects after an already-aborted signal.
  Promise.resolve(promise).then(value=>settle(accept,value),error=>settle(reject,error));
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
}
async function bodyBytes(response,state,limits,signal){
 const length=response.headers.get('content-length');
 if(length!==null)requireThat(/^\d+$/.test(length)&&Number(length)<=limits.response_bytes&&Number(length)<=limits.total_bytes-state.bytes,'BYTE_LIMIT');
 const reader=response.body?.getReader();requireThat(reader,'BODY_MISSING');const chunks=[];let bytes=0;
 try{while(true){const {done,value}=await bounded(reader.read(),signal);if(done)break;bytes+=value.byteLength;state.bytes+=value.byteLength;
  requireThat(bytes<=limits.response_bytes&&state.bytes<=limits.total_bytes,'BYTE_LIMIT');chunks.push(Buffer.from(value));}}
 finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(chunks,bytes);
}
const bridge=`import base64,importlib.util,json,sys
s=importlib.util.spec_from_file_location('official_inline',sys.argv[1]);m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
p=json.load(sys.stdin)
try:
 r=m.extract_actuals(base64.b64decode(p['body'],validate=True),p['receipt'],entity='2330',year=p['year'],quarter=p['quarter'],encoding='cp950',revenue_mode='ifrs-revenue')
 print(json.dumps({'ok':True,'result':r},ensure_ascii=False))
except m.ExtractionError as e:
 print(json.dumps({'ok':False,'code':str(e)}))
`;
/** Uses the existing parser over stdin; no raw HTML or Python cache is written. */
export async function parseInlineBytes(bytes,source,receivedAt,timeoutMs=8000,signal){
 requireThat(SOURCES.includes(source)&&source.kind==='inline'&&Buffer.isBuffer(bytes)&&bytes.length<=LIMITS.response_bytes,'INLINE_SCOPE');
 requireThat(time(receivedAt)&&Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=8000,'INLINE_LIMIT');
 const input={body:bytes.toString('base64'),receipt:{url:source.url,http:200,sha256:sha(bytes),bytes:bytes.length,received_at:receivedAt},year:source.year,quarter:source.quarter};
 const result=await new Promise((accept,reject)=>{
  const child=execFile('python3',['-I','-B','-c',bridge,PARSER],{timeout:timeoutMs,maxBuffer:2_000_000,signal,
   env:{PATH:'/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin',LANG:'C.UTF-8'}},(error,stdout)=>{
    if(error)return reject(new Refusal('INLINE_PROCESS_REFUSED'));
    try{accept(JSON.parse(stdout));}catch{reject(new Refusal('INLINE_OUTPUT_INVALID'));}
   });child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
 });
 if(!result.ok)throw new Refusal(/^[A-Z0-9_]{1,100}$/.test(result.code)?result.code:'INLINE_REFUSED');
 const r=result.result;
 requireThat(r.schema==='OFFICIAL_INLINE_XBRL_DIRECT_ACTUAL_CANDIDATE_V1'&&r.source_sha256===sha(bytes)&&Array.isArray(r.rows),'INLINE_OUTPUT_INVALID');
 return {rows:r.rows.map(row=>({metric:row.metric,entity:row.entity,quarter:row.quarter,period_start:row.period_start,period_end:row.period_end,
  value_decimal:row.value_decimal,unit:row.unit,concept_namespace:row.concept_namespace,concept_local_name:row.concept_local_name,
  context_ref_sha256:jsonHash(row.context_ref),source_sha256:row.source_sha256,direct_single_quarter:row.direct_single_quarter,
  published_at:null,available_at:receivedAt,ordinary_share_basis:row.ordinary_share_basis,consolidation_basis:row.consolidation_basis,
  consensus:null,guidance:null,source_admitted:false})),missing:r.missing.map(x=>({metric:x.metric,reason:x.reason})),counts:r.counts};
}
function outputDirectory(path){
 requireThat(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'OUTPUT_PATH');
 let current=parsePath(path).root;
 for(const part of dirname(path).slice(current.length).split('/').filter(Boolean)){
  current=join(current,part);const stat=lstatSync(current);requireThat(stat.isDirectory()&&!stat.isSymbolicLink(),'OUTPUT_PARENT_UNSAFE');
 }
 requireThat(realpathSync(dirname(path))===dirname(path),'OUTPUT_PARENT_UNSAFE');
 mkdirSync(path,{mode:0o700});return path; // Existing directories are refused, never resumed/overwritten.
}
function save(directory,name,value){
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),digest=sha(bytes),file=name+'-'+digest+'.json';
 writeFileSync(join(directory,file),bytes,{flag:'wx',mode:0o400});return {file,sha256:digest,bytes:bytes.length};
}
/** SourceReceipt: {source,first_seen_at,available_at,source_response_sha256,rows}.
 * Event source_hash is the normalizer's identifying-array hash; subject_hash is
 * SHA256(JSON.stringify(trimmedSubject)); response SHA binds exact HTTP bytes.
 * All raw bodies remain memory-only. License and publication are independent.
 */
export async function acquirePublicEvidence(options={}){
 requireThat(object(options)&&Object.keys(options).every(k=>['batch','outDir','symbols','limits','fetcher','now','signal'].includes(k)),'OPTIONS');
 const batch=options.batch??'public';requireThat(Object.hasOwn(batches,batch),'BATCH_NOT_ALLOWED');
 // The historical endpoint returned a denial shell and its automated-use
 // permission is not established. Keep the offline parser/transport controls,
 // but the CLI/default live transport must not request it again.
 requireThat(batch!=='xbrl-2330'||typeof options.fetcher==='function'&&options.fetcher!==globalThis.fetch,'MOPS_ACQUISITION_NOT_AUTHORIZED');
 const limits={...LIMITS,...options.limits};requireThat(Object.keys(limits).length===Object.keys(LIMITS).length&&Object.entries(limits).every(([k,v])=>Number.isInteger(v)&&v>0&&v<=LIMITS[k]),'LIMITS');
 const symbols=options.symbols??PUBLIC_UNIVERSE;requireThat(Array.isArray(symbols)&&symbols.length>0&&new Set(symbols).size===symbols.length&&symbols.every(s=>PUBLIC_UNIVERSE.includes(s)),'UNIVERSE_SCOPE');
 const fetcher=options.fetcher??fetch,now=options.now??(()=>new Date().toISOString());
 requireThat(typeof fetcher==='function'&&typeof now==='function','PORTS');
 const directory=options.outDir===undefined?null:outputDirectory(options.outDir),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),limits.deadline_ms),signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
 const state={bytes:0,requests:0},receipts=[],artifacts=[];let stopped=null,lastTime=-Infinity;
 try{for(const id of batches[batch]){
  const source=SOURCES.find(s=>s.id===id);
  if(stopped||signal.aborted||state.requests>=limits.requests){stopped??=signal.aborted?'DEADLINE':'REQUEST_LIMIT';break;}
  const receipt={source:source.url,first_seen_at:null,available_at:null,source_response_sha256:null,rows:[],published_at:null,
   license:{status:'UNKNOWN',reason:'HTTP_ACCESS_IS_NOT_LICENSE_REVIEW'},raw_retained:false,source_admitted:false,status:'UNAVAILABLE',http_status:null};
  let response;
  try{
   state.requests++;const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(limits.request_ms)]);
   response=await bounded(Promise.resolve().then(()=>fetcher(source.url,{method:'GET',credentials:'omit',redirect:'error',signal:requestSignal,
    headers:{Accept:source.kind==='inline'?'text/html':'application/json'}})),requestSignal);
   receipt.http_status=response.status;requireThat(!response.redirected&&(!response.url||response.url===source.url),'REDIRECT_REFUSED');
   if(response.status!==200){void response.body?.cancel().catch(()=>{});throw new Refusal([401,403,429].includes(response.status)?'ACCESS_RESTRICTED':'HTTP_REFUSED');}
   const bytes=await bodyBytes(response,state,limits,requestSignal),received=now();requireThat(time(received)&&Date.parse(received)>=lastTime,'RECEIPT_CLOCK');lastTime=Date.parse(received);
   Object.assign(receipt,{first_seen_at:received,available_at:received,source_response_sha256:sha(bytes)});
   if(source.kind==='inline'){
    // A tiny HTTP-200 denial shell is not a filing and must not trigger retries.
    requireThat(bytes.includes(Buffer.from('nonFraction')),'NO_SUPPORTED_INLINE_XBRL_INSTANCE');
    const result=await bounded(parseInlineBytes(bytes,source,received,Math.min(8000,limits.request_ms),requestSignal),requestSignal);
    receipt.rows=result.rows;receipt.missing=result.missing;receipt.parser_counts=result.counts;
   }else{
    requireThat((response.headers.get('content-type')??'').includes('application/json'),'CONTENT_TYPE_REFUSED');
    let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Refusal('JSON_INVALID');}
    receipt.rows=sanitizeRows(source,payload,received,symbols,limits.rows);
   }
   receipt.status='CAPTURED_REVIEW_REQUIRED';
  }catch(error){
   receipt.status=error instanceof Refusal?error.code:signal.aborted?'DEADLINE':'TRANSPORT_OR_REDIRECT_REFUSED';
   void response?.body?.cancel().catch(()=>{});
   if(source.kind==='inline'||['ACCESS_RESTRICTED','BYTE_LIMIT','DEADLINE','TRANSPORT_OR_REDIRECT_REFUSED','REDIRECT_REFUSED'].includes(receipt.status))stopped=receipt.status;
  }
  receipts.push(receipt);if(directory)artifacts.push(save(directory,'receipt-'+String(receipts.length).padStart(2,'0'),receipt));
 }}finally{clearTimeout(timer);}
 const summary={schema:'BOUNDED_OFFICIAL_PUBLIC_ACQUISITION_V1',batch,requests:state.requests,bytes_observed:state.bytes,stop_reason:stopped,
  sources:receipts.map(r=>({source:r.source,status:r.status,http_status:r.http_status,rows:r.rows.length,source_response_sha256:r.source_response_sha256})),
  xbrl_quarters:SOURCES.filter(s=>s.kind==='inline').map(s=>({quarter:`${s.year}Q${s.quarter}`,status:receipts.find(r=>r.source===s.url)?.status??'NOT_ATTEMPTED',
   direct_rows:receipts.find(r=>r.source===s.url)?.rows.length??0})),retained_issuer_identities:RETAINED_2330,
  artifacts,raw_retained:false,source_admitted:false,production_authorized:false,publication_approved:false,consensus:null,guidance:null};
 if(directory)save(directory,'summary',summary);
 return {receipts,summary};
}
// Same contract, for isolated composition callers; no import-time acquisition.
export {acquirePublicEvidence as runBatch};
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const args=process.argv.slice(2);requireThat(args.length===4&&args[0]==='--batch'&&args[2]==='--out','CLI_SCOPE');
  const result=await acquirePublicEvidence({batch:args[1],outDir:args[3]});console.log(JSON.stringify(result.summary,null,2));
  if(result.receipts.some(r=>r.status!=='CAPTURED_REVIEW_REQUIRED')||result.summary.stop_reason)process.exitCode=2;
 }catch(error){console.error(JSON.stringify({status:'REFUSED',code:error instanceof Refusal?error.code:'LOCAL_IO_OR_PROCESS_REFUSED'}));process.exitCode=1;}
}
