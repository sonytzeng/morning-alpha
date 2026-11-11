import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,URL} from 'node:url';
import {marketSnapshotHash} from '../research/taiwan-market-universe.mjs';
import {taiwanHistoryUrl,decodeTaiwanHistoryCapture,normalizeTaiwanHistoryCapture,assembleTaiwanSecurityHistory} from '../research/taiwan-market-history.mjs';
import {loadTaiwanFinancialHistory,loadTaiwanResearchHistory} from '../research/taiwan-market-financial-inputs.mjs';
import {seedTaiwanMarketInputCache,refreshTaiwanMarketInputs,loadTaiwanDailyInputManifest,planTaiwanInputRefresh,
 taiwanInputRefreshTaskHash,TAIWAN_INPUT_CACHE_POLICY} from '../research/taiwan-market-input-cache.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex'),at='2026-11-11T11:00:00Z',oldAt='2026-11-10T10:00:00Z';
const writeJson=async(file,value)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value)+'\n');};
const readJson=async file=>JSON.parse(await readFile(file,'utf8'));
function universe(){const body={schema:'TAIWAN_MARKET_UNIVERSE_V1',coverage_complete:true,total:1,companies:[
 {security_id:'TPEX:5347',symbol:'5347',market:'TPEX',company:'合成測試'}]};return {...body,universe_hash:marketSnapshotHash(body)};}
function historyCapture(date,received_at,close='11'){
 const payload={stat:'OK',date:date.replaceAll('-',''),tables:[{title:'上櫃股票行情',fields:['代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數','成交金額(元)'],
  data:[['5347','合成測試',close,'+1','10','12','9','10.5','1,234','12,340']],notes:[]}]};
 const bytes=Buffer.from(JSON.stringify(payload)+'\n');const receipt={schema:'TAIWAN_HISTORY_SOURCE_RECEIPT_V1',source_id:'tpex_daily',market:'TPEX',family:'PRICE',
  url:taiwanHistoryUrl('tpex_daily',date),date,state:'CAPTURED',status:200,started_at:received_at,received_at,bytes:bytes.length,sha256:sha(bytes),
  raw_bytes_complete:true,content_encoding:'identity',fixture_provenance:'SYNTHETIC_TEST'};
 return {receipt,bytes};
}
const normalizer=fileURLToPath(new URL('../research/taiwan-market-financial-csv.py',import.meta.url));
const financialScript=`import importlib.util,json,sys,csv,io,base64
s=importlib.util.spec_from_file_location('financial_csv',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
v=json.load(sys.stdin);raw=v['html'].encode();p=v['parent'];p.update({'sha256':m.sha(raw),'bytes':len(raw)})
out=io.StringIO(newline='');csv.writer(out,lineterminator='\\r\\n').writerows(v['rows']);csvraw=out.getvalue().encode('cp950');task=m.acquire.tasks_from_html(p,raw)[v.get('task_index',0)]
r={'schema':'TAIWAN_FINANCIAL_CSV_RECEIPT_V1','source_id':task['source_id'],'url':m.acquire.URL,'method':'POST','form':task['form'],'parent_html_sha256':p['sha256'],
 'parent_receipt_path':v['parent_path'],'state':'CAPTURED','status':200,'started_at':v.get('csv_received_at','2026-11-10T09:59:00Z'),'received_at':v.get('csv_received_at','2026-11-10T10:00:00Z'),'sha256':m.sha(csvraw),'bytes':len(csvraw),'encoding':'CP950'}
p['raw_path']=v['parent_raw_path'];r['raw_path']=v['raw_path'];doc=m.normalize_mops_csv(r,csvraw,p,raw)
print(json.dumps({'doc':doc,'raw':base64.b64encode(csvraw).decode(),'parent':p,'original_receipt':r},ensure_ascii=False))`;
async function fixture(t,{legacyFailure=false,historicFailure=false,basePublication=null}={}){const temp=await mkdtemp(join(tmpdir(),'taiwan-input-cache-'));t.after(()=>rm(temp,{recursive:true,force:true}));
 const seedDir=join(temp,'seed'),cacheDir=join(temp,'cache');await mkdir(seedDir,{recursive:true});const u=universe(),universeFile=join(temp,'universe.json');await writeJson(universeFile,u);
 const h=historyCapture('2026-11-10',oldAt),day=normalizeTaiwanHistoryCapture({...h,universe:u}),checkpoint=assembleTaiwanSecurityHistory({universe:u,days:[day],expected_dates:['2026-11-10'],formed_at:oldAt});
 const historyFile=join(seedDir,'history.json');await writeJson(historyFile,checkpoint);const decoded=decodeTaiwanHistoryCapture(h),sourceDir=join(seedDir,'history-source');
 await writeJson(join(sourceDir,'public-receipts','one.json'),decoded.public_receipt);await mkdir(join(sourceDir,'http-entity'),{recursive:true});await writeFile(join(sourceDir,'http-entity','one.json'),decoded.entity_bytes);
 const form='<form><input type="hidden" name="firstin" value="true"><input type="hidden" name="step" value="10"><input type="hidden" name="filename" value="t163sb04_20261110_120001.csv"><input type="hidden" name="saveCSV" value="Y"><button onclick="action=\'/server-java/t105sb02\';submit();"></button></form>';
 const html='<html><h2>上櫃公司第四季資料</h2><p>單位：新台幣仟元</p>'+form+'<table><tr><th>公司代號</th><th>公司名稱</th><th>營業收入</th><th>基本每股盈餘（元）</th></tr><tr><td>5347</td><td>合成測試</td><td>1234</td><td>2.5</td></tr></table>'+form+'</html>';
 const parent_path=join(seedDir,'parent-receipt.json'),parent_raw_path=join(seedDir,'parent.html'),raw_path=join(seedDir,'financial.csv');
 const input={html,parent_path,parent_raw_path,raw_path,rows:[['出表日期','年度','季別','公司代號','公司名稱','營業收入','基本每股盈餘（元）'],['115/11/10','114','4','5347','合成測試','1234.00','2.50']],
  parent:{schema:'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1',source_id:'mops_income_TPEX_2025Q4',url:'https://mopsov.twse.com.tw/mops/web/ajax_t163sb04',method:'POST',state:'CAPTURED',status:200,
   form:{encodeURIComponent:'1',step:'1',firstin:'1',off:'1',TYPEK:'otc',year:'114',season:'04'},started_at:'2026-11-10T09:57:00Z',received_at:'2026-11-10T09:58:00Z',fixture_provenance:'SYNTHETIC_TEST'}};
 const run=spawnSync('python',['-c',financialScript,normalizer],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:2000000});if(run.status)throw Error(run.stderr);const f=JSON.parse(run.stdout);
 await writeFile(raw_path,Buffer.from(f.raw,'base64'));await writeFile(parent_raw_path,html);await writeJson(parent_path,f.parent);
 const docFile=join(seedDir,'financial-document.json'),receiptFile=join(seedDir,'financial-public-receipt.json');await writeJson(docFile,f.doc);await writeJson(receiptFile,f.doc.source_receipt);
 const financialBody={schema:'TAIWAN_FINANCIAL_CSV_MANIFEST_V1',records:1,documents:[{source_id:f.doc.source_id,financial_history_hash:f.doc.financial_history_hash,
  file:'financial-document.json',public_receipt_file:'financial-public-receipt.json',raw_csv_file:'financial.csv'}],normalization_failures:[],
  logical_report_coverage:[{market:'TPEX',family:'INCOME',period:'2025Q4',complete:true}]};
 const financialFile=join(seedDir,'financial-manifest.json');await writeJson(financialFile,{...financialBody,manifest_hash:marketSnapshotHash(financialBody)});
 const denial={source_id:'twse_daily',state:'UNAVAILABLE',status:307,source_halted:true,started_at:oldAt,received_at:oldAt,error:'SECURITY_DENIAL'};
 const attempt_receipt_files=['denial.json'];if(legacyFailure){const bytes=Buffer.from('<html>FOR SECURITY REASONS, THIS PAGE CAN NOT BE ACCESSED.</html>');
  await writeFile(join(seedDir,'denial-body.html'),bytes);Object.assign(denial,{source_id:'twse_ex_right',source_halted:false,raw_path:'denial-body.html',sha256:sha(bytes),bytes:bytes.length});
  await writeJson(join(seedDir,'legacy-503.json'),{schema:'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1',source_id:'mops_income_TWSE_2026Q3',state:'UNAVAILABLE',
   started_at:oldAt,received_at:oldAt,attempts:1,error:'HTTPError: HTTP Error 503: Service Unavailable'});attempt_receipt_files.push('legacy-503.json');}
 if(historicFailure){const form={encodeURIComponent:'1',step:'1',firstin:'1',off:'1',TYPEK:'otc',year:'113',season:'04'},url='https://mopsov.twse.com.tw/mops/web/ajax_t163sb04';
  const receipt={schema:'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1',source_id:'mops_income_TPEX_2024Q4',market:'TPEX',family:'INCOME',period:'2024Q4',url,method:'POST',form,
   task_id:marketSnapshotHash({method:'POST',url,form}),state:'UNAVAILABLE',status:503,started_at:oldAt,received_at:oldAt,attempts:2,source_halted:false,error:'HTTP_503'};
  await writeJson(join(seedDir,'historical-503.json'),receipt);attempt_receipt_files.push('historical-503.json');}
 await writeJson(join(seedDir,'denial.json'),denial);
 if(basePublication)await publication(join(seedDir,'acquisition'),basePublication);
 const seedFile=join(seedDir,'seed.json');await writeJson(seedFile,{schema:'TAIWAN_INPUT_CACHE_SEED_V1',history_manifest_file:'history.json',financial_manifest_file:'financial-manifest.json',
  history_source_directory:'history-source',attempt_receipt_files,...(basePublication?{base_acquisition_directory:'acquisition'}:{})});
 await seedTaiwanMarketInputCache({cacheDir,seedManifestFile:seedFile,now:at});return {temp,seedDir,cacheDir,universeFile,seedFile,oldCapture:h,financial:f.doc};
}
function unavailable(task,status=503){return {schema:'TAIWAN_INPUT_REFRESH_CAPTURE_RESULT_V1',kind:task.kind,state:'UNAVAILABLE',completed_at:at,network_requests:1,
 captures:[{role:'PUBLIC',receipt:{state:'UNAVAILABLE',status,error:'HTTP_'+status},raw_path:null}],financial_documents:[],issues:[],source_halts:[]};}
async function successHistory(output,date,received_at=at){await mkdir(output,{recursive:true});const h=historyCapture(date,received_at,'12'),raw_path=join(output,'raw.json');await writeFile(raw_path,h.bytes);
 return {schema:'TAIWAN_INPUT_REFRESH_CAPTURE_RESULT_V1',kind:'TPEX_DAY',state:'CAPTURED',completed_at:received_at,network_requests:1,
  captures:[{role:'HISTORY',receipt:h.receipt,raw_path}],financial_documents:[],issues:[],source_halts:[]};}
async function publication(directory,{rows,received_at=at,source_id='tpex_income_ci'}={}){
 const urls={tpex_income_ci:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_ci',tpex_balance_ci:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_ci'};
 const bytes=Buffer.from(JSON.stringify(rows)+'\n'),raw_path=join(directory,source_id+'-'+sha(bytes)+'.json');await mkdir(directory,{recursive:true});await writeFile(raw_path,bytes);
 const receipt={schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id,url:urls[source_id],format:'json',state:'CAPTURED',status:200,
  started_at:received_at,received_at,bytes:bytes.length,sha256:sha(bytes),row_count:rows.length,raw_path};
 await writeJson(join(directory,'acquisition-'+source_id+'-'+marketSnapshotHash(receipt)+'.json'),{schema:'TAIWAN_PUBLIC_ACQUISITION_V1',receipts:[receipt]});return receipt;
}
const incomeRows=(second='2.00',date='115/11/11')=>[
 {'出表日期':date,'年度':'114','季別':'4','公司代號':'5347','公司名稱':'合成測試','營業收入':'1500.00','基本每股盈餘（元）':'3.00'},
 {'出表日期':date,'年度':'114','季別':'4','公司代號':'6188','公司名稱':'第二測試','營業收入':'2000.00','基本每股盈餘（元）':second}];
async function successReport(output,{received_at=at,groups=[incomeRows()],token=120101}={}){
 await mkdir(output,{recursive:true});const date=new Date(Date.parse(received_at)+8*3600000).toISOString().slice(0,10),stamp=date.replaceAll('-','');
 const headers=['公司代號','公司名稱','營業收入','基本每股盈餘（元）'];
 const forms=groups.map((_,i)=>'<form><input type="hidden" name="firstin" value="true"><input type="hidden" name="step" value="10"><input type="hidden" name="filename" value="t163sb04_'+stamp+'_'+(token+i)+'.csv"><input type="hidden" name="saveCSV" value="Y"><button onclick="action=\'/server-java/t105sb02\';submit();"></button></form>');
 const html='<html><h2>上櫃公司第四季資料</h2><p>單位：新台幣仟元</p>'+groups.map((rows,i)=>forms[i]+'<table><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr>'+rows.map(row=>'<tr>'+headers.map(h=>'<td>'+row[h]+'</td>').join('')+'</tr>').join('')+'</table>'+forms[i]).join('')+'</html>';
 const parent_path=join(output,'parent-receipt.json'),parent_raw_path=join(output,'parent.html');const captures=[],financial_documents=[];
 for(let i=0;i<groups.length;i++){const raw_path=join(output,'financial-'+i+'.csv'),input={html,parent_path,parent_raw_path,raw_path,task_index:i,csv_received_at:received_at,
   rows:[['出表日期','年度','季別',...headers],...groups[i].map(row=>[row['出表日期'],row['年度'],row['季別'],...headers.map(h=>row[h])])],
   parent:{schema:'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1',source_id:'mops_income_TPEX_2025Q4',url:'https://mopsov.twse.com.tw/mops/web/ajax_t163sb04',method:'POST',state:'CAPTURED',status:200,
    market:'TPEX',family:'INCOME',period:'2025Q4',form:{encodeURIComponent:'1',step:'1',firstin:'1',off:'1',TYPEK:'otc',year:'114',season:'04'},started_at:received_at,received_at,fixture_provenance:'SYNTHETIC_TEST'}};
  const run=spawnSync('python',['-c',financialScript,normalizer],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:4000000});if(run.status)throw Error(run.stderr);const f=JSON.parse(run.stdout);
  await writeFile(raw_path,Buffer.from(f.raw,'base64'));await writeFile(parent_raw_path,html);await writeJson(parent_path,f.parent);
  await writeFile(join(output,f.parent.source_id+'-receipt.json'),JSON.stringify(f.parent,null,2)+'\n');
  await writeFile(join(output,f.original_receipt.source_id+'-receipt.json'),JSON.stringify(f.original_receipt,null,2)+'\n');
  const file=join(output,'financial-'+i+'.json'),public_receipt_file=join(output,'financial-public-'+i+'.json');await writeJson(file,f.doc);await writeJson(public_receipt_file,f.doc.source_receipt);
  if(i===0)captures.push({role:'FINANCIAL_HTML',receipt:f.parent,raw_path:parent_raw_path});captures.push({role:'FINANCIAL_CSV',receipt:f.original_receipt,raw_path});
  financial_documents.push({file,public_receipt_file,raw_csv_file:raw_path,parent_receipt_file:parent_path,parent_raw_file:parent_raw_path});
 }
 return {schema:'TAIWAN_INPUT_REFRESH_CAPTURE_RESULT_V1',kind:'MOPS_REPORT',state:'CAPTURED',completed_at:received_at,network_requests:groups.length+1,
  captures,financial_documents,issues:[],source_halts:[]};
}
function plannerState(){return {schema:'TAIWAN_INPUT_CACHE_STATE_V1',captures:{},attempts:{},source_halts:{},action_originals:{},report_coverage:{},report_refresh:{},report_attempt_scopes:{}};}

test('a moved cache works without original paths and preserves financial/raw/first-seen observations',async t=>{
 const f=await fixture(t),result=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,slot:'POSTCLOSE',allowNetwork:false},{clock:()=>at});
 const originalHistory=await loadTaiwanResearchHistory(result.history_file),originalFinancial=await loadTaiwanFinancialHistory(result.financial_history_file);
 assert.equal(originalFinancial.records.length,1);assert.equal(originalFinancial.records[0].record_hash,f.financial.records[0].record_hash);
 const moved=join(f.temp,'restored');await rename(f.cacheDir,moved);await rm(f.seedDir,{recursive:true,force:true});
 const restored=await loadTaiwanDailyInputManifest(join(moved,'latest.json')),history=await loadTaiwanResearchHistory(restored.history_file),financial=await loadTaiwanFinancialHistory(restored.financial_history_file);
 assert.deepEqual(financial.records,originalFinancial.records);assert.equal(history.stocks[0].bars[0].first_seen_at,oldAt);
 assert.deepEqual(history.stocks[0].bars,originalHistory.stocks[0].bars);assert(restored.issues.some(i=>i.source_scope==='twse_daily'));
 const retained=await readJson(restored.retained_captures_file);for(const c of retained.captures){assert(!c.raw_path.startsWith('/'));assert.equal(sha(await readFile(resolve(moved,c.raw_path))),c.receipt.sha256);}
});

test('a new TPEX session appends through the real normalizer while failed supplements retain old financial inputs',async t=>{
 const f=await fixture(t),called=[];
 const result=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,slot:'POSTCLOSE'},
  {clock:()=>at,pause:async()=>{},execute:async({task,output})=>{called.push(task);return task.kind==='TPEX_DAY'&&task.date==='2026-11-11'?successHistory(output,task.date):unavailable(task);}});
 const history=await loadTaiwanResearchHistory(result.history_file),financial=await loadTaiwanFinancialHistory(result.financial_history_file);
 assert.deepEqual(history.stocks[0].bars.map(b=>b.date),['2026-11-10','2026-11-11']);assert.equal(history.stocks[0].bars[0].available_at,oldAt);
 assert.equal(history.stocks[0].bars[1].available_at,at);assert.equal(financial.records[0].record_hash,f.financial.records[0].record_hash);
 assert(!called.some(task=>task.kind.includes('TWSE')&&task.kind!=='TWSE_VALUATION_DAY'));
 let repeated=0;const again=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,slot:'POSTCLOSE'},
  {clock:()=>at,execute:async()=>{repeated++;throw Error('must not fetch');}});
 assert.equal(repeated,0);assert.equal(again.manifest_hash,result.manifest_hash);
});

test('endpoint access denial persists across dates while transient recovery is capped and waits 24 hours',async t=>{
 const f=await fixture(t),state=await readJson(join(f.cacheDir,'cache-state.json'));
 const task={kind:'TPEX_DAY',date:'2026-11-11'},key=taiwanInputRefreshTaskHash(task);
 state.attempts[key]=[{ordinal:1,state:'UNAVAILABLE',transient:true,finished_at:at}];
 assert(planTaiwanInputRefresh({state,now:'2026-11-12T10:00:00Z'}).skipped.some(s=>s.task_hash===key&&s.reason==='TRANSIENT_COOLDOWN'));
 assert(planTaiwanInputRefresh({state,now:'2026-11-12T12:00:00Z'}).tasks.some(s=>taiwanInputRefreshTaskHash(s)===key));
 state.attempts[key].push({ordinal:2,state:'UNAVAILABLE',transient:true,finished_at:'2026-11-12T12:00:00Z'});
 assert(planTaiwanInputRefresh({state,now:'2026-11-13T13:00:00Z'}).skipped.some(s=>s.task_hash===key&&s.reason==='TRANSIENT_ATTEMPT_BUDGET_EXHAUSTED'));
 state.source_halts.tpex_daily={observed_at:at};assert(!planTaiwanInputRefresh({state,now:'2026-11-13T13:00:00Z'}).tasks.some(s=>s.kind==='TPEX_DAY'));
});

test('daily ACTION coverage includes the180calendar-day balance boundary and survives year changes without altering history windows',()=>{
 const sources=['tpex_ex_right','tpex_capital_reduction','tpex_par_value_change'];
 const empty=()=>({schema:'TAIWAN_INPUT_CACHE_STATE_V1',captures:{},attempts:{},source_halts:{},action_originals:{},report_coverage:{}});
 for(const [now,through,from]of [['2026-11-12T11:00:00Z','2026-11-12','2026-05-16'],['2026-01-05T11:00:00Z','2026-01-05','2025-07-09']]){
  const state=empty(),p=planTaiwanInputRefresh({state,now}),task=p.tasks.find(t=>t.kind==='TPEX_ACTION_SET');
  assert.equal(p.expected_dates.length,62);assert.equal(task.from,from);assert.equal(task.through,through);assert(task.from<p.expected_dates[0]);
  assert.equal((Date.parse(through)-Date.parse(task.from))/86400000,180);
  state.action_originals=Object.fromEntries(sources.map(id=>[id,{receipt:{from,through}}]));
  assert(!planTaiwanInputRefresh({state,now}).tasks.some(t=>t.kind==='TPEX_ACTION_SET'));
  const nextDay=new Date(Date.parse(from+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  state.action_originals.tpex_ex_right.receipt.from=nextDay;
  assert(planTaiwanInputRefresh({state,now}).tasks.some(t=>t.kind==='TPEX_ACTION_SET'&&t.from===from));
  state.source_halts.tpex_ex_right={observed_at:now};
  const halted=planTaiwanInputRefresh({state,now});assert(!halted.tasks.some(t=>t.kind==='TPEX_ACTION_SET'));
  assert(halted.skipped.some(s=>s.task.kind==='TPEX_ACTION_SET'&&s.reason==='SOURCE_ACCESS_HALTED'));
 }
 assert.equal(TAIWAN_INPUT_CACHE_POLICY.action_lookback_days,180);
 assert.throws(()=>planTaiwanInputRefresh({state:empty(),now:'2027-01-04T11:00:00Z'}),/CALENDAR_UNCOVERED/);
});

for(const legacyVersion of ['TAIWAN_DAILY_INPUT_CACHE_20261111_V1','TAIWAN_DAILY_INPUT_CACHE_20261111_V2'])test('known '+legacyVersion+' state is archived and its same-day run cannot bypass V3 planning',async t=>{
 const f=await fixture(t),first=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,allowNetwork:false},{clock:()=>at});
 const oldManifest=await readJson(first.manifest_file);oldManifest.policy_version=legacyVersion;delete oldManifest.manifest_hash;
 oldManifest.manifest_hash=marketSnapshotHash(oldManifest);const oldFile='manifest-'+oldManifest.manifest_hash+'.json';await writeJson(join(f.cacheDir,oldFile),oldManifest);
 const file=join(f.cacheDir,'cache-state.json'),state=await readJson(file);state.policy_version=legacyVersion;state.runs['2026-11-11:POSTCLOSE']=oldFile;
 await writeJson(file,state);const originalBytes=await readFile(file);let calls=0;
 const updated=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,allowNetwork:false},
  {clock:()=>at,execute:async()=>{calls++;throw Error('no network');}});
 const after=await readJson(file),transition=after.policy_transitions[0];assert.equal(calls,0);assert.equal(updated.provider_requests,0);
 assert.equal(after.policy_version,TAIWAN_INPUT_CACHE_POLICY.version);assert.equal(transition.from,legacyVersion);
 assert.equal(transition.prior_state.sha256,sha(originalBytes));assert((await readFile(join(f.cacheDir,transition.prior_state.file))).equals(originalBytes));
 for(const key of ['captures','financial_documents','report_coverage','report_requests','history_stocks','action_originals','source_halts','attempts'])assert.deepEqual(after[key],state[key]);
 assert.notEqual(updated.manifest_hash,oldManifest.manifest_hash);assert.equal((await readJson(updated.manifest_file)).policy_version,TAIWAN_INPUT_CACHE_POLICY.version);
 assert.equal((await readJson(join(f.cacheDir,oldFile))).policy_version,legacyVersion);
 assert.equal(after.runs['2026-11-11:POSTCLOSE'],oldFile);
 after.policy_version='UNRECOGNIZED_POLICY';await writeJson(file,after);
 await assert.rejects(refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,allowNetwork:false},{clock:()=>at}),/STATE_SCHEMA/);
});

test('retained denial bytes override a legacy false halt flag, while an explicit legacy HTTP 503 remains transient',async t=>{
 const f=await fixture(t,{legacyFailure:true}),state=await readJson(join(f.cacheDir,'cache-state.json'));
 assert.equal(state.source_halts.twse_ex_right.basis,'ORIGINAL_ACCESS_DENIAL_RECEIPT_OR_BYTES');
 const key=taiwanInputRefreshTaskHash({kind:'MOPS_REPORT',market:'TWSE',family:'INCOME',period:'2026Q3'});
 assert.equal(state.attempts[key][0].transient,true);assert.equal(state.attempts[key][0].ordinal,1);
 const original=await readJson(join(f.seedDir,'denial.json'));assert.equal(original.source_halted,false);
});

test('tampered new raw bytes cannot replace an existing observation or remove the financial cache',async t=>{
 const f=await fixture(t),result=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,slot:'POSTCLOSE'},
  {clock:()=>at,pause:async()=>{},execute:async({task,output})=>{if(task.kind!=='TPEX_DAY'||task.date!=='2026-11-11')return unavailable(task);
   const r=await successHistory(output,task.date);await writeFile(r.captures[0].raw_path,'tampered');return r;}});
 const history=await loadTaiwanResearchHistory(result.history_file),financial=await loadTaiwanFinancialHistory(result.financial_history_file);
 assert.deepEqual(history.stocks[0].bars.map(b=>b.date),['2026-11-10']);assert.equal(financial.records.length,1);
 assert(result.issues.some(i=>i.code==='SOURCE_WORKER_UNCONFIRMED_NO_AUTOMATIC_RETRY'));
});

test('a completed child result after an interrupted commit is reconciled with zero provider calls',async t=>{
 const f=await fixture(t),stateFile=join(f.cacheDir,'cache-state.json'),state=await readJson(stateFile),task={schema:'TAIWAN_INPUT_REFRESH_TASK_V1',kind:'TPEX_DAY',date:'2026-11-11'},key=taiwanInputRefreshTaskHash(task);
 const bytes=Buffer.from(JSON.stringify(task)+'\n'),taskFile='objects/'+sha(bytes)+'.json';await writeFile(join(f.cacheDir,taskFile),bytes);
 const output=join(f.cacheDir,'attempts',key,'1');
 state.attempts[key]=[{ordinal:1,started_at:at,state:'IN_PROGRESS',transient:false,output_original:output,task:{file:taskFile,sha256:sha(bytes),bytes:bytes.length}}];await writeJson(stateFile,state);
 const r=await successHistory(output,task.date);await writeJson(join(output,'result.json'),r);
 const moved=join(f.temp,'moved-pending');await rename(f.cacheDir,moved);
 let calls=0;const result=await refreshTaiwanMarketInputs({cacheDir:moved,universeFile:f.universeFile,slot:'POSTCLOSE',allowNetwork:false},
  {clock:()=>at,execute:async()=>{calls++;throw Error('no network');}});
 assert.equal(calls,0);assert(result.attempts.some(a=>a.recovered_without_provider_request));
 assert.equal((await loadTaiwanResearchHistory(result.history_file)).stocks[0].bars.at(-1).date,'2026-11-11');
});

test('portable publication proofs use retained bytes, with an exact local raw fallback for a new capture',async t=>{
 const f=await fixture(t),directory=join(f.cacheDir,'seed-acquisition'),row={'公司代號':'5347','年度':'115','季別':'3'},bytes=Buffer.from(JSON.stringify([row]));
 const raw_path=join(f.temp,'removed-scratch','latest-income.json');await mkdir(join(directory,'raw'),{recursive:true});await writeFile(join(directory,'raw','latest-income.json'),bytes);
 const receipt={schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id:'tpex_income_ci',url:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_ci',format:'json',state:'CAPTURED',status:200,
  started_at:oldAt,received_at:oldAt,bytes:bytes.length,sha256:sha(bytes),row_count:1,raw_path};
 await writeJson(join(directory,'acquisition-portable.json'),{schema:'TAIWAN_PUBLIC_ACQUISITION_V1',receipts:[receipt,{...receipt,state:'UNAVAILABLE',status:503,received_at:at,raw_path:null}]});
 const first=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,acquisitionDir:directory,allowNetwork:false},{clock:()=>at});
 assert(first.issues.some(i=>i.code==='OFFLINE_UPDATE_NOT_ATTEMPTED'&&i.task.period==='2026Q3'));
 const moved=join(f.temp,'moved-publication');await rename(f.cacheDir,moved);await rm(join(moved,'seed-acquisition','raw'),{recursive:true,force:true});
 const second=await refreshTaiwanMarketInputs({cacheDir:moved,universeFile:f.universeFile,acquisitionDir:join(moved,'seed-acquisition'),allowNetwork:false},{clock:()=>at});
 assert(second.issues.some(i=>i.code==='OFFLINE_UPDATE_NOT_ATTEMPTED'&&i.task.family==='CASHFLOW'));
 const stored=await readJson(join(moved,'seed-acquisition','acquisition-portable.json'));assert.equal(stored.receipts[0].raw_path,raw_path);
 const state=await readJson(join(moved,'cache-state.json'));assert(Object.values(state.captures).some(c=>c.receipt.source_id===receipt.source_id&&c.receipt.received_at===oldAt));
});

test('an older missing annual report stays in the daily backlog after the latest-quarter catalog has changed',async t=>{
 const f=await fixture(t,{historicFailure:true});
 const result=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,allowNetwork:false},{clock:()=>at});
 const manifest=await readJson(result.manifest_file),state=await readJson(join(f.cacheDir,'cache-state.json'));
 assert.deepEqual(manifest.financial_backlog,[{kind:'MOPS_REPORT',market:'TPEX',family:'INCOME',period:'2024Q4'}]);
 assert(result.issues.some(i=>i.code==='TRANSIENT_ATTEMPT_BUDGET_EXHAUSTED'&&i.task.period==='2024Q4'));
 const descriptor=Object.values(state.report_requests)[0],request=await readJson(join(f.cacheDir,descriptor.file));
 assert.equal(request.period_trigger_basis,'RETAINED_EXACT_PUBLIC_REPORT_REQUEST_RECOVERY');
 assert.equal(request.retained_request_evidence.receipt.attempts,2);assert(!request.publication_evidence);
 const original=await readFile(join(f.seedDir,'historical-503.json'));assert.equal(request.retained_request_evidence.receipt_sha256,sha(original));
 assert.equal(result.provider_requests,0);assert.equal((await loadTaiwanFinancialHistory(result.financial_history_file)).records.length,1);
});

test('new quarter lookups use a real source row; CASHFLOW uses a lookup trigger without inheriting income values',async t=>{
 const f=await fixture(t),acquisition=join(f.temp,'acquisition'),row={'公司代號':'2330','年度':'115','季別':'3','基本每股盈餘（元）':'99'},bytes=Buffer.from(JSON.stringify([row]));
 await mkdir(acquisition,{recursive:true});const raw_path=join(acquisition,'income.json');await writeFile(raw_path,bytes);
 const receipt={schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id:'twse_income_ci',url:'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',format:'json',state:'CAPTURED',status:200,
  started_at:at,received_at:at,bytes:bytes.length,sha256:sha(bytes),row_count:1,raw_path};
 await writeJson(join(acquisition,'acquisition-synthetic.json'),{schema:'TAIWAN_PUBLIC_ACQUISITION_V1',receipts:[receipt]});const captured=[];
 const result=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,acquisitionDir:acquisition,slot:'POSTCLOSE'},
  {clock:()=>at,pause:async()=>{},execute:async({task})=>{captured.push(task);return unavailable(task);}});
 const reportTasks=captured.filter(t=>t.kind==='MOPS_REPORT');assert.deepEqual(reportTasks.map(t=>t.family).sort(),['CASHFLOW','INCOME']);
 for(const task of reportTasks){assert.equal(task.period,'2026Q3');assert.equal(task.publication_evidence.source_row_hash,marketSnapshotHash(row));}
 assert.equal(reportTasks.find(t=>t.family==='CASHFLOW').period_trigger_basis,'SAME_MARKET_REPORTED_PERIOD_LOOKUP_NOT_CASHFLOW_AVAILABILITY');
 assert.equal((await loadTaiwanFinancialHistory(result.financial_history_file)).records.length,1);
});

test('absent bootstrap and changed portable input bytes fail explicitly instead of silently returning empty data',async t=>{
 const temp=await mkdtemp(join(tmpdir(),'taiwan-input-missing-'));t.after(()=>rm(temp,{recursive:true,force:true}));const u=join(temp,'universe.json');await writeJson(u,universe());
 await assert.rejects(refreshTaiwanMarketInputs({cacheDir:join(temp,'empty'),universeFile:u,allowNetwork:false},{clock:()=>at}),/BOOTSTRAP_REQUIRED/);
 const f=await fixture(t),result=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,allowNetwork:false},{clock:()=>at});
 await writeFile(result.financial_history_file,'{}\n');await assert.rejects(loadTaiwanDailyInputManifest(result.manifest_file),/OBJECT_HASH|FILE_SIZE/);
 assert.equal(TAIWAN_INPUT_CACHE_POLICY.history_sessions,62);
});

test('same-slot whole-period revisions include the second company while export-date-only receipts do not fetch reports again',async t=>{
 const f=await fixture(t),directory=join(f.temp,'publication'),scope='TPEX:INCOME:2025Q4';let now=at,rows=incomeRows(),reportCalls=0;
 await publication(directory,{rows,received_at:'2026-11-11T10:30:00Z'});
 const options={cacheDir:f.cacheDir,universeFile:f.universeFile,acquisitionDir:directory,slot:'POSTCLOSE'};
 const run=()=>refreshTaiwanMarketInputs(options,{clock:()=>now,pause:async()=>{},execute:async({task,taskFile,output})=>{
  assert.deepEqual(await readJson(taskFile),task);assert(!Object.keys(task).some(k=>k.startsWith('report_')));
  if(task.kind==='MOPS_REPORT'&&task.family==='INCOME'){reportCalls++;return successReport(output,{received_at:now,groups:[rows],token:120100+reportCalls*10});}
  return {...unavailable(task),completed_at:now};}});
 const first=await run();assert.equal(reportCalls,1);let state=await readJson(join(f.cacheDir,'cache-state.json'));
 const firstVersion=state.report_refresh[scope].content_version;assert.equal(Object.values(state.financial_documents).filter(d=>d.family==='INCOME').length,1);
 assert(state.financial_document_history[f.financial.financial_history_hash]);assert.equal((await loadTaiwanFinancialHistory(first.financial_history_file)).records.length,2);
 now='2026-11-11T11:10:00Z';rows=incomeRows('7.00');await publication(directory,{rows,received_at:'2026-11-11T11:05:00Z'});
 const second=await run();state=await readJson(join(f.cacheDir,'cache-state.json'));assert.equal(reportCalls,2);assert.notEqual(second.manifest_hash,first.manifest_hash);
 assert.notEqual(state.report_refresh[scope].content_version,firstVersion);const records=(await loadTaiwanFinancialHistory(second.financial_history_file)).records;
 assert.equal(records.find(r=>r.symbol==='6188').fields['基本每股盈餘（元）'],'7.00');assert.equal(records.find(r=>r.symbol==='6188').first_seen_at,now);
 const current=state.financial_documents,version=state.report_refresh[scope].content_version,captures=Object.keys(state.captures).length;
 now='2026-11-11T11:20:00Z';rows=incomeRows('7.00','115/11/12');await publication(directory,{rows:[...rows].reverse(),received_at:'2026-11-11T11:15:00Z'});
 const unchanged=await run();state=await readJson(join(f.cacheDir,'cache-state.json'));assert.equal(reportCalls,2);assert.equal(unchanged.provider_requests,0);
 assert.equal(unchanged.manifest_hash,second.manifest_hash);assert.equal(state.report_refresh[scope].content_version,version);
 assert.deepEqual(state.financial_documents,current);assert.equal(Object.keys(state.captures).length,captures+1);
});

for(const relation of ['BEFORE_PARENT','AFTER_PARENT'])test('a retained version is bound only when its source was received '+relation,async t=>{
 const rows=[{'出表日期':'115/11/10','年度':'114','季別':'4','公司代號':'5347','公司名稱':'合成測試','營業收入':'1234.00','基本每股盈餘（元）':'2.50'}];
 const received_at=relation==='BEFORE_PARENT'?'2026-11-10T09:00:00Z':'2026-11-10T10:30:00Z';
 const f=await fixture(t,{basePublication:{rows,received_at}}),scope='TPEX:INCOME:2025Q4';
 const result=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,allowNetwork:false},{clock:()=>at});
 const state=await readJson(join(f.cacheDir,'cache-state.json')),metadata=state.report_refresh[scope];
 if(relation==='BEFORE_PARENT'){
  assert.match(metadata.content_version,/^[a-f0-9]{64}$/);assert.equal(metadata.basis,'RETAINED_OFFICIAL_CONTENT_CAPTURED_BEFORE_REPORT_PARENT');
  assert(!result.issues.some(i=>i.task?.kind==='MOPS_REPORT'&&i.task.family==='INCOME'));
  assert.equal(metadata.content_sources[0].received_at,received_at);
 }else{
  assert.equal(metadata.content_version,null);assert.equal(metadata.basis,'RETAINED_COMPLETE_REPORT_WITHOUT_PREEXISTING_CONTENT_VERSION');
  assert(result.issues.some(i=>i.task?.kind==='MOPS_REPORT'&&i.task.family==='INCOME'&&i.code==='OFFLINE_UPDATE_NOT_ATTEMPTED'));
 }
 assert.equal(metadata.parent_content_cutoff,'2026-11-10T09:58:00Z');assert.equal(metadata.checked_at,oldAt);
 assert.equal((await loadTaiwanFinancialHistory(result.financial_history_file)).records[0].first_seen_at,oldAt);
});

test('a complete unchanged recheck keeps original observations and advances only its successful-check receipt',async t=>{
 const f=await fixture(t),directory=join(f.temp,'publication'),rows=incomeRows(),scope='TPEX:INCOME:2025Q4';let now=at,calls=0;
 await publication(directory,{rows,received_at:'2026-11-11T10:30:00Z'});
 const run=()=>refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,acquisitionDir:directory},{clock:()=>now,pause:async()=>{},execute:async({task,output})=>{
  if(task.kind==='MOPS_REPORT'&&task.family==='INCOME'){calls++;return successReport(output,{received_at:now,groups:[rows],token:121000+calls});}return {...unavailable(task),completed_at:now};}});
 await run();const before=await readJson(join(f.cacheDir,'cache-state.json'));
 now='2026-11-11T11:10:00Z';await publication(directory,{rows:rows.map(r=>({...r,'另列實際財務欄位':'1'})),received_at:'2026-11-11T11:05:00Z'});
 await run();const after=await readJson(join(f.cacheDir,'cache-state.json'));assert.equal(calls,2);
 assert.deepEqual(after.financial_documents,before.financial_documents);assert.equal(after.report_refresh[scope].current_observation_reused,true);
 assert.equal(after.report_refresh[scope].actual_report_content_changed,false);assert.equal(after.report_refresh[scope].checked_at,now);
 assert.notEqual(after.report_refresh[scope].generation_id,before.report_refresh[scope].generation_id);
 assert.equal(Object.keys(after.financial_document_history).length,Object.keys(before.financial_document_history).length+1);
});

test('CASHFLOW content anchors include both whole INCOME and BALANCE reports, including later company changes',async t=>{
 const f=await fixture(t),directory=join(f.temp,'publication');let now=at;
 await publication(directory,{rows:incomeRows(),received_at:'2026-11-11T10:30:00Z'});
 const balance=[{'出表日期':'115/11/11','年度':'114','季別':'4','公司代號':'5347','資產總計':'10'},
  {'出表日期':'115/11/11','年度':'114','季別':'4','公司代號':'6188','資產總計':'20'}];
 await publication(directory,{source_id:'tpex_balance_ci',rows:balance,received_at:'2026-11-11T10:31:00Z'});
 const run=()=>refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,acquisitionDir:directory,allowNetwork:false},{clock:()=>now});
 await run();const key=taiwanInputRefreshTaskHash({kind:'MOPS_REPORT',market:'TPEX',family:'CASHFLOW',period:'2025Q4'});
 let state=await readJson(join(f.cacheDir,'cache-state.json')),proof=await readJson(join(f.cacheDir,state.report_requests[key].file));
 assert.deepEqual(proof.report_content_manifest.source_contents.map(s=>s.family).sort(),['BALANCE','INCOME']);const version=proof.report_content_version;
 now='2026-11-11T11:10:00Z';balance[1]['資產總計']='21';await publication(directory,{source_id:'tpex_balance_ci',rows:balance,received_at:'2026-11-11T11:05:00Z'});
 await run();state=await readJson(join(f.cacheDir,'cache-state.json'));proof=await readJson(join(f.cacheDir,state.report_requests[key].file));assert.notEqual(proof.report_content_version,version);
 assert.equal(proof.period_trigger_basis,'SAME_MARKET_REPORTED_PERIOD_LOOKUP_NOT_CASHFLOW_AVAILABILITY');
});

test('current CASHFLOW cadence uses actual Taipei date across slots and never borrows the quote date or refreshes old annual backlog',()=>{
 const state=plannerState(),version='a'.repeat(64),scope='TPEX:CASHFLOW:2026Q2';
 const proof={market:'TPEX',family:'CASHFLOW',period:'2026Q2',report_content_version:version,report_current_period:true};
 state.report_coverage[scope]=true;state.report_refresh[scope]={content_version:version,checked_at:'2026-11-11T01:00:00Z',checked_taipei_date:'2026-11-11',generation_id:'g1'};
 const now='2026-11-11T16:10:00Z',first=planTaiwanInputRefresh({state,now,publicationProofs:[proof]}),task=first.tasks.find(t=>t.kind==='MOPS_REPORT');
 assert.equal(first.expected_quote_date,'2026-11-11');assert.equal(first.financial_refresh_date,'2026-11-12');assert.equal(task.report_refresh_date,'2026-11-12');
 assert.equal(task.report_refresh_reason,'CURRENT_PERIOD_CASHFLOW_DAILY_REVALIDATION');assert.equal(task.report_content_version,version);
 state.report_refresh[scope].checked_at=now;state.report_refresh[scope].checked_taipei_date='2026-11-12';
 assert(!planTaiwanInputRefresh({state,now:'2026-11-12T10:00:00Z',publicationProofs:[proof]}).tasks.some(t=>t.kind==='MOPS_REPORT'));
 const changed={...proof,report_content_version:'b'.repeat(64)};
 assert(planTaiwanInputRefresh({state,now:'2026-11-12T10:00:00Z',publicationProofs:[changed]}).tasks.some(t=>t.report_refresh_reason==='OFFICIAL_PERIOD_CONTENT_CHANGED_RECHECK_REPORT'));
 const old={...proof,period:'2024Q4',report_current_period:false};state.report_coverage['TPEX:CASHFLOW:2024Q4']=true;
 state.report_refresh['TPEX:CASHFLOW:2024Q4']={content_version:version,checked_taipei_date:'2025-01-01'};
 assert(!planTaiwanInputRefresh({state,now:'2026-11-12T10:00:00Z',publicationProofs:[proof,old]}).tasks.some(t=>t.kind==='MOPS_REPORT'));
});

test('logical report unknown outcomes, retries and source halts survive content-version and cadence changes',()=>{
 const state=plannerState(),base={kind:'MOPS_REPORT',market:'TPEX',family:'CASHFLOW',period:'2026Q2'},scope='TPEX:CASHFLOW:2026Q2';
 const oldKey=taiwanInputRefreshTaskHash(base),proof={...base,report_content_version:'b'.repeat(64),report_current_period:true};
 state.attempts[oldKey]=[{ordinal:2,state:'UNAVAILABLE',transient:true,finished_at:'2026-11-10T00:00:00Z'}];
 const plan=()=>planTaiwanInputRefresh({state,now:'2026-11-12T10:00:00Z',publicationProofs:[proof]});
 assert(plan().skipped.some(s=>s.task.family==='CASHFLOW'&&s.reason==='TRANSIENT_ATTEMPT_BUDGET_EXHAUSTED'));
 for(const status of ['IN_PROGRESS','UNCONFIRMED']){state.attempts[oldKey][0].state=status;
  assert(plan().skipped.some(s=>s.task.family==='CASHFLOW'&&s.reason==='LOGICAL_REPORT_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION'));}
 state.report_coverage[scope]=true;state.report_refresh[scope]={generation_id:'g2',checked_at:'2026-11-11T10:00:00Z',checked_taipei_date:'2026-11-11',content_version:'a'.repeat(64)};
 assert(plan().skipped.some(s=>s.reason==='LOGICAL_REPORT_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION'));
 state.attempts[oldKey][0].state='UNAVAILABLE';assert(plan().tasks.some(t=>t.kind==='MOPS_REPORT'));
 const versionKey=taiwanInputRefreshTaskHash({...base,report_content_version:'a'.repeat(64),report_refresh_date:'2026-11-11'});
 state.report_attempt_scopes[versionKey]=scope;state.attempts[versionKey]=[{ordinal:1,report_attempt_ordinal:1,report_generation_id:'g2',state:'UNAVAILABLE',transient:true,finished_at:'2026-11-12T09:00:00Z'}];
 assert(plan().skipped.some(s=>s.task.family==='CASHFLOW'&&s.reason==='TRANSIENT_COOLDOWN'));
 state.attempts[versionKey][0].finished_at='2026-11-11T00:00:00Z';assert(plan().tasks.some(t=>t.kind==='MOPS_REPORT'));
 state.attempts[versionKey][0].report_attempt_ordinal=2;assert(plan().skipped.some(s=>s.reason==='TRANSIENT_ATTEMPT_BUDGET_EXHAUSTED'));
 state.source_halts.mops_financial={observed_at:at};assert(plan().skipped.some(s=>s.task.family==='CASHFLOW'&&s.reason==='SOURCE_ACCESS_HALTED'));
});

for(const outcome of ['PARTIAL','LATE_INVALID_DOCUMENT'])test(outcome+' report leaves the complete current report intact',async t=>{
 const f=await fixture(t),directory=join(f.temp,'publication');let now=at,calls=0;
 await publication(directory,{rows:incomeRows(),received_at:'2026-11-11T10:30:00Z'});
 const before=await readJson(join(f.cacheDir,'cache-state.json'));
 const result=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,acquisitionDir:directory},{clock:()=>now,pause:async()=>{},execute:async({task,output})=>{
  if(task.kind!=='MOPS_REPORT'||task.family!=='INCOME')return unavailable(task);calls++;
  const r=await successReport(output,{groups:incomeRows().map(row=>[row]),token:122000});
  if(outcome==='PARTIAL'){r.state='PARTIAL';r.financial_documents=r.financial_documents.slice(0,1);r.captures.push({role:'FINANCIAL_CSV',receipt:{state:'UNAVAILABLE',status:503,error:'HTTP_503'},raw_path:null});}
  else{const doc=await readJson(r.financial_documents[1].file);doc.company_count=999;await writeJson(r.financial_documents[1].file,doc);}return r;
 }});
 const after=await readJson(join(f.cacheDir,'cache-state.json'));assert.equal(calls,1);assert.deepEqual(after.financial_documents,before.financial_documents);
 assert.equal(after.report_coverage['TPEX:INCOME:2025Q4'],true);assert.equal((await loadTaiwanFinancialHistory(result.financial_history_file)).records[0].record_hash,f.financial.records[0].record_hash);
 if(outcome==='PARTIAL')assert.equal(Object.keys(after.financial_document_history).length,2);
 else{assert(result.issues.some(i=>i.code==='SOURCE_WORKER_UNCONFIRMED_NO_AUTOMATIC_RETRY'));
  assert.equal(Object.keys(after.financial_document_history).length,1);now='2026-11-12T12:00:00Z';await publication(directory,{rows:incomeRows('9.00'),received_at:'2026-11-12T11:00:00Z'});
  const repeated=await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,acquisitionDir:directory,allowNetwork:false},{clock:()=>now});
  assert(repeated.issues.some(i=>i.task?.family==='INCOME'&&i.code==='LOGICAL_REPORT_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION'));
 }
});

test('history catchup filters all62 retained sessions before choosing at most five newest missing dates',()=>{
 const state=plannerState(),initial=planTaiwanInputRefresh({state,now:at}),missing=initial.expected_dates[10];
 for(const date of initial.expected_dates)if(date!==missing)state.captures[date]={receipt:{source_id:'TPEX_DAILY_'+date.replaceAll('-','')}};
 const p=planTaiwanInputRefresh({state,now:at}),tasks=p.tasks.filter(t=>t.kind==='TPEX_DAY');assert.deepEqual(tasks.map(t=>t.date),[missing]);
 const empty=planTaiwanInputRefresh({state:plannerState(),now:at});assert.equal(empty.tasks.filter(t=>t.kind==='TPEX_DAY').length,5);
 assert.equal(empty.deferred.filter(t=>t.kind==='TPEX_DAY').length,57);assert.equal(empty.history_catchup_order,'NEWEST_MISSING_FIRST_WITHIN_RETAINED_WINDOW');
});

test('a failed financial refresh archives exact original receipt bytes and raw failure response',async t=>{
 const f=await fixture(t),directory=join(f.temp,'publication');await publication(directory,{rows:incomeRows(),received_at:'2026-11-11T10:30:00Z'});
 let originalBytes,body;await refreshTaiwanMarketInputs({cacheDir:f.cacheDir,universeFile:f.universeFile,acquisitionDir:directory},
 {clock:()=>at,pause:async()=>{},execute:async({task,output})=>{
  if(task.kind!=='MOPS_REPORT'||task.family!=='INCOME')return unavailable(task);await mkdir(output,{recursive:true});
  body=Buffer.from('<html>503 temporary service failure</html>');const raw_path=join(output,'failed-body.html');await writeFile(raw_path,body);
  const url='https://mopsov.twse.com.tw/mops/web/ajax_t163sb04',form={encodeURIComponent:'1',step:'1',firstin:'1',off:'1',TYPEK:'otc',year:'114',season:'04'};
  const r={schema:'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1',source_id:'mops_income_TPEX_2025Q4',market:'TPEX',family:'INCOME',period:'2025Q4',url,method:'POST',form,
   task_id:marketSnapshotHash({method:'POST',url,form}),state:'UNAVAILABLE',status:503,started_at:at,received_at:at,source_halted:false,error:'HTTP_503',raw_path,sha256:sha(body),bytes:body.length};
  originalBytes=Buffer.from(JSON.stringify(r,null,2)+'\n');await writeFile(join(output,r.source_id+'-receipt.json'),originalBytes);
  return {...unavailable(task),captures:[{role:'FINANCIAL_HTML',receipt:r,raw_path}]};
 }});
 const state=await readJson(join(f.cacheDir,'cache-state.json')),archived=state.receipt_archives[sha(originalBytes)];assert(archived);
 assert.equal(archived.receipt_origin,'ORIGINAL_WORKER_RECEIPT_BYTES');assert((await readFile(join(f.cacheDir,archived.receipt.file))).equals(originalBytes));
 assert((await readFile(join(f.cacheDir,archived.raw.file))).equals(body));assert.equal(state.report_coverage['TPEX:INCOME:2025Q4'],true);
});
