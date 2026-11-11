import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {marketSnapshotHash} from '../research/taiwan-market-universe.mjs';

const modulePath=fileURLToPath(new URL('../research/taiwan-market-financial-csv.py',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const py=`import importlib.util,json,sys,csv,io,copy
s=importlib.util.spec_from_file_location('financial_csv',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
v=json.load(sys.stdin);parent=v['parent'];praw=v['html'].encode();parent.update({'sha256':m.sha(praw),'bytes':len(praw)})
tasks=m.acquire.tasks_from_html(parent,praw);results=[]
for item in v.get('exports',[]):
 task=tasks[item.get('task_index',0)];out=io.StringIO(newline='');csv.writer(out,lineterminator='\\r\\n').writerows(item['rows']);raw=out.getvalue().encode('cp950')
 receipt={'schema':'TAIWAN_FINANCIAL_CSV_RECEIPT_V1','source_id':task['source_id'],'url':m.acquire.URL,'method':'POST','form':task['form'],
  'parent_html_sha256':parent['sha256'],'state':'CAPTURED','status':200,'started_at':'2026-11-11T09:02:00Z','received_at':'2026-11-11T09:03:00Z',
  'sha256':m.sha(raw),'bytes':len(raw),'encoding':'CP950'}
 if item.get('mutate_hash'):receipt['sha256']='0'*64
 if 'elapsed_as_float' in item:receipt['elapsed_seconds']=float(item['elapsed_as_float'])
 results.append(m.normalize_mops_csv(receipt,raw,parent,praw))
if v.get('action')=='logical':
 latest=copy.deepcopy(parent);lraw=v['latest_html'].encode();latest.update({'sha256':m.sha(lraw),'bytes':len(lraw),'started_at':'2026-11-11T10:00:00Z','received_at':'2026-11-11T10:01:00Z'})
 ltasks=m.acquire.tasks_from_html(latest,lraw)
 for item in v.get('latest_exports',[]):
  task=ltasks[item.get('task_index',0)];out=io.StringIO(newline='');csv.writer(out,lineterminator='\\r\\n').writerows(item['rows']);raw=out.getvalue().encode('cp950')
  receipt={'schema':'TAIWAN_FINANCIAL_CSV_RECEIPT_V1','source_id':task['source_id'],'url':m.acquire.URL,'method':'POST','form':task['form'],
   'parent_html_sha256':latest['sha256'],'state':'CAPTURED','status':200,'started_at':'2026-11-11T10:02:00Z','received_at':'2026-11-11T10:03:00Z',
   'sha256':m.sha(raw),'bytes':len(raw),'encoding':'CP950'}
  results.append(m.normalize_mops_csv(receipt,raw,latest,lraw))
 result=m.logical_report_coverage([(parent,praw),(latest,lraw)],results)
elif v.get('action')=='coverage':result=m.coverage(parent,praw,results)
elif v.get('action')=='tasks':result=tasks
else:result=results[0]
print(json.dumps(result,ensure_ascii=False))`;
function run(input){const r=spawnSync('python',['-c',py,modulePath],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:4_000_000});
 if(r.status!==0)throw Error(r.stderr.trim());return JSON.parse(r.stdout);}
function fixture(family='INCOME',{emptyIndustry=false,secondIndustry=false}={}){
 const codes={INCOME:'04',BALANCE:'05',CASHFLOW:'20'},fileCode=family==='BALANCE'?'04':codes[family];
 const headers=family==='INCOME'?['公司 代號','公司名稱','營業收入','基本每股盈餘（元）']:
  family==='BALANCE'?['公司 代號','公司名稱','資產總額','每股參考淨值']:['公司 代號','公司名稱','營業活動之淨現金流入（流出）','期末現金及約當現金餘額'];
 const row=['2330','合成測試','1,234','2.50'];
 const table=(rows)=>'<table><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table>';
 const form=(time)=>`<form action="/mops/web/ajax_t51sb12"><input type="hidden" name="firstin" value="true"><input type="hidden" name="step" value="10"><input type="hidden" name="filename" value="t163sb${fileCode}_20261111_${time}.csv">${family==='BALANCE'?'':'<input type="hidden" name="saveCSV" value="Y">'}<button onclick="action='/server-java/t105sb02';submit();"></button></form>`;
 const html='<html><h2>上市公司第四季資料</h2><p>單位：新台幣仟元</p>'+form('17424615')+table([row])+form('17424615')+(emptyIndustry?form('17424616')+table([]):'')+
  (secondIndustry?form('17424617')+table([['2454','合成測試二','3,456','4.5']])+form('17424617'):'')+'</html>';
 const nativeHeaders=['出表日期','年度','季別',...headers.map(h=>h.replaceAll(' ',''))];
 const csvRow=['115/11/11','114','4','2330','合成測試','1234.00','2.50'];
 return {html,headers,row,nativeHeaders,csvRow,parent:{schema:'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1',source_id:`mops_${family.toLowerCase()}_TWSE_2025Q4`,
  url:'https://mopsov.twse.com.tw/mops/web/ajax_t163sb'+codes[family],method:'POST',state:'CAPTURED',status:200,
  form:{encodeURIComponent:'1',step:'1',firstin:'1',off:'1',TYPEK:'sii',year:'114',season:'04'},
  started_at:'2026-11-11T09:00:00Z',received_at:'2026-11-11T09:01:00Z',fixture_provenance:'SYNTHETIC_TEST'},
 exports:[{rows:[nativeHeaders,csvRow]}]};
}

test('original CP950 CSV matrices bind exact row hashes, displayed year and quarter, and numerically matching HTML cells',()=>{
 const f=fixture(),result=run(f),r=result.records[0];
 assert.equal(result.company_count,1);assert.equal(r.period_identity_basis,'CSV_RESPONSE_YEAR_QUARTER_MATCHED_PARENT_REQUEST');
 assert.equal(r.period_basis,'YTD_AS_REPORTED');assert.equal(r.period_scope,'FULL_FISCAL_YEAR_AS_REPORTED');
 assert.equal(r.parent_cumulative_statement_note_present,false);assert.equal(r.period_definition_source.url,'https://mopsfin.twse.com.tw/');
 assert.equal(r.normalized_fields['營業收入'],'1234.00');assert.equal(r.field_units['基本每股盈餘（元）'],'TWD_PER_SHARE');
 assert.equal(r.eps_basis,'BASIC_AS_REPORTED');assert.equal(r.source_capture.source_row_hash,marketSnapshotHash(f.csvRow));
 assert.equal(r.source_capture.row_index,1);assert.deepEqual(r.source_capture.row_path,[1]);assert.equal(r.source_capture.symbol_field,'3');
 assert.equal(result.source_receipt.encoding,'CP950');assert.equal(result.source_receipt.row_count,2);assert.equal(result.source_receipt.data_row_count,1);
 assert.equal(result.source_receipt.row_layout,'HEADER_AND_DATA_ARRAYS_V1');assert.equal(result.source_receipt.parent_request_url,f.parent.url);
 assert.equal(r.available_at,'2026-11-11T09:03:00Z');assert.equal(r.published_at,null);assert.equal(r.fcfe_inferred,false);
});

test('wrong report year, wrong quarter, changed numeric cells and raw-byte hash substitution are rejected',()=>{
 const year=fixture();year.exports[0].rows[1][1]='113';assert.throws(()=>run(year),/CSV_YEAR_QUARTER_MISMATCH/);
 const quarter=fixture();quarter.exports[0].rows[1][2]='3';assert.throws(()=>run(quarter),/CSV_YEAR_QUARTER_MISMATCH/);
 const amount=fixture();amount.exports[0].rows[1][5]='1235.00';assert.throws(()=>run(amount),/CSV_HTML_CELL_MISMATCH/);
 const missing=fixture();missing.exports[0].rows[1][5]='--';assert.throws(()=>run(missing),/CSV_HTML_CELL_MISMATCH/);
 const bytes=fixture();bytes.exports[0].mutate_hash=true;assert.throws(()=>run(bytes),/CSV_SOURCE_RECEIPT/);
});

test('balance preserves the actual legacy 04 export filename and omitted saveCSV field from its 05 parent',()=>{
 const f=fixture('BALANCE'),result=run(f);assert.equal(result.records[0].period_basis,'POINT_IN_TIME_AS_REPORTED');
 assert.equal(result.source_receipt.parent_request_url,'https://mopsov.twse.com.tw/mops/web/ajax_t163sb05');
 assert.equal(result.source_receipt.request_form.filename,'t163sb04_20261111_17424615.csv');
 assert.equal(Object.hasOwn(result.source_receipt.request_form,'saveCSV'),false);
 assert.equal(result.records[0].field_units['每股參考淨值'],'PER_SHARE_UNIT_NOT_EXPLICIT');
});

test('an empty industry CSV is valid, but a missing industry export cannot claim complete report coverage',()=>{
 const f=fixture('INCOME',{emptyIndustry:true});let c=run({...f,action:'coverage'});
 assert.equal(c.complete,false);assert.equal(c.missing_exports.length,1);assert.equal(c.verified_companies,1);
 f.exports.push({task_index:1,rows:[f.nativeHeaders]});c=run({...f,action:'coverage'});
 assert.equal(c.complete,true);assert.equal(c.captured_and_verified_exports,2);
 const duplicate=structuredClone(f);duplicate.exports[1].rows.push(f.csvRow);c=run({...duplicate,action:'coverage'});
 assert.equal(c.complete,false);assert.deepEqual(c.duplicate_symbols,['2330']);
});

test('cashflow uses the official cumulative definition with explicit CSV Q4, retaining the absence of a parent inline note',()=>{
 const r=run(fixture('CASHFLOW')).records[0];assert.equal(r.period_basis,'YTD_AS_REPORTED');
 assert.equal(r.period_scope,'FULL_FISCAL_YEAR_AS_REPORTED');assert.equal(r.parent_cumulative_statement_note_present,false);
 assert.equal(r.period_definition_source.source_labels.CASHFLOW,'現金流量表(累計)');assert.equal(r.fcfe_inferred,false);
});

test('download tasks deduplicate only identical retained forms and reject a different button destination',()=>{
 const f=fixture(),tasks=run({...f,action:'tasks'});assert.equal(tasks.length,1);
 assert.equal(tasks[0].form.filename,'t163sb04_20261111_17424615.csv');assert.equal(tasks[0].parent_html_sha256,sha(f.html));
 const bad=fixture();bad.html=bad.html.replaceAll("action='/server-java/t105sb02';","action='/different/path';");
 assert.throws(()=>run({...bad,action:'tasks'}),/CSV_BUTTON_ACTION_REQUIRED/);
});

test('identical refreshed parents can complete company values using exact old and new CSV observations without claiming every new file',()=>{
 const f=fixture('INCOME',{secondIndustry:true});const latest_html=f.html.replaceAll('17424615','18424615').replaceAll('17424617','18424617');
 const r=run({...f,action:'logical',latest_html,latest_exports:[{task_index:1,rows:[f.nativeHeaders,['115/11/11','114','4','2454','合成測試二','3456.00','4.50']]}]});
 assert.equal(r.complete,true);assert.equal(r.verified_companies,2);assert.deepEqual(r.missing_symbols,[]);
 assert.equal(r.all_latest_export_files_captured,false);assert.equal(r.parent_versions,2);
 assert.equal(r.original_capture_times_and_parent_bindings_preserved,true);assert.equal(r.latest_parent_received_at,'2026-11-11T10:01:00Z');
});

test('a changed latest report cannot inherit an old CSV even if another newly downloaded industry agrees',()=>{
 const f=fixture('INCOME',{secondIndustry:true});const latest_html=f.html.replaceAll('17424615','18424615').replaceAll('17424617','18424617').replace('1,234','1,999');
 const r=run({...f,action:'logical',latest_html,latest_exports:[{task_index:1,rows:[f.nativeHeaders,['115/11/11','114','4','2454','合成測試二','3456.00','4.50']]}]});
 assert.equal(r.complete,false);assert.deepEqual(r.missing_symbols,['2330']);assert.equal(r.excluded_changed_parent_exports.length,1);
 assert.equal(r.verified_companies,1);
});

test('integral Python receipt timings keep original numeric values while the derived document hash agrees with JavaScript',()=>{
 for(const value of ['15.0','-0.0']){
  const f=fixture();f.exports[0].elapsed_as_float=value;const result=run(f);const {financial_history_hash,...body}=result;
  assert.equal(financial_history_hash,marketSnapshotHash(body));
  assert.equal(result.original_source_receipt.elapsed_seconds,Number(value));
 }
});
