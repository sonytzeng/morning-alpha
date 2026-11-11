import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {marketSnapshotHash} from '../research/taiwan-market-universe.mjs';
const modulePath=fileURLToPath(new URL('../research/taiwan-market-financial-history.py',import.meta.url));
const sha=v=>createHash('sha256').update(v).digest('hex');
const script=`import importlib.util,json,sys
s=importlib.util.spec_from_file_location('financial',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
v=json.load(sys.stdin)
if v.get('action')=='cross':r=m.cross_year_checks(v['documents'])
elif v.get('action')=='cash':r=m.cash_flow_reconciliations(v['documents'])
else:r=m.normalize_mops_report(v['receipt'],v['html'].encode())
print(json.dumps(r,ensure_ascii=False))`;
function run(input){const r=spawnSync('python',['-c',script,modulePath],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:4_000_000});
 if(r.status!==0)throw Error(r.stderr.trim());return JSON.parse(r.stdout);}
const escape=v=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function fixture(family='INCOME',year=2025,{cumulative=family==='INCOME',duplicate=false}={}){
 const headers=family==='INCOME'?['公司 代號','公司名稱','營業\n收入','本期淨利（淨損）','基本每股盈餘（元）']:
  family==='BALANCE'?['公司 代號','公司名稱','資產總額','負債總額','權益總額']:
  ['公司 代號','公司名稱','營業活動之淨現金流入（流出）','投資活動之淨現金流入（流出）','籌資活動之淨現金流入（流出）'];
 const row=['2330','合成測試','1,234','-56','2.50'];
 const table='<table><tr>'+headers.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr><tr>'+row.map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr></table>';
 const html='<html><h2>上市公司第四季資料</h2><p>單位：新台幣仟元</p>'+(cumulative?'<p>本表各季別資料係揭露該年度截至該季止之累計金額。</p>':'')+table+(duplicate?table:'')+'</html>';
 const form={encodeURIComponent:'1',step:'1',firstin:'1',off:'1',TYPEK:'sii',year:String(year-1911),season:'04'};
 const code={INCOME:'t163sb04',BALANCE:'t163sb05',CASHFLOW:'t163sb20'}[family];
 return {html,headers,row,receipt:{schema:'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1',source_id:`mops_${family.toLowerCase()}_TWSE_${year}Q4`,
  url:'https://mopsov.twse.com.tw/mops/web/ajax_'+code,method:'POST',form,state:'CAPTURED',status:200,
  started_at:'2026-11-11T09:00:00Z',received_at:'2026-11-11T09:01:00Z',bytes:Buffer.byteLength(html),sha256:sha(html),fixture_provenance:'SYNTHETIC_TEST'}};
}

test('original Chinese cells, per-share EPS units and request-bound period retain exact HTML provenance',()=>{
 const f=fixture(),r=run(f),row=r.records[0];assert.equal(r.company_count,1);assert.equal(row.security_id,'TWSE:2330');
 assert.equal(row.period,'2025Q4');assert.equal(row.period_identity_basis,'REQUEST_FORM_BOUND_NOT_RESPONSE_ECHOED');
 assert.equal(row.period_basis,'YTD_AS_REPORTED');assert.equal(row.amount_unit,'TWD_THOUSANDS');
 assert.equal(row.fields['營業\n收入'],'1,234');assert.equal(row.normalized_fields['營業收入'],'1,234');
 assert.equal(row.eps_basis,'BASIC_AS_REPORTED');assert.equal(row.field_units['基本每股盈餘（元）'],'TWD_PER_SHARE');
 assert.equal(row.source_capture.source_sha256,sha(f.html));assert.equal(row.source_capture.rowcells_hash,marketSnapshotHash(f.row));
 assert.deepEqual(row.source_capture.cell_hashes,f.row.map(sha));assert.equal(row.source_capture.row_index,1);
 assert.equal(row.available_at,f.receipt.received_at);assert.equal(row.published_at,null);assert.equal(row.fcfe_inferred,false);assert.equal(row.single_quarter_inferred,false);
});

test('balance stocks and cashflow report periods do not acquire a nonexistent cumulative note',()=>{
 const balance=run(fixture('BALANCE')).records[0];assert.equal(balance.period_basis,'POINT_IN_TIME_AS_REPORTED');assert.equal(balance.cumulative_statement_note_present,false);
 const cash=run(fixture('CASHFLOW')).records[0];assert.equal(cash.period_basis,'REQUESTED_ANNUAL_Q4_NOT_RESPONSE_LABELLED_YTD');assert.equal(cash.cumulative_statement_note_present,false);
 const emergingStyle=run(fixture('INCOME',2025,{cumulative:false})).records[0];assert.equal(emergingStyle.period_basis,'REQUESTED_ANNUAL_Q4_NOT_RESPONSE_LABELLED_YTD');
});

test('altered raw bytes, request-year substitution and duplicate companies across industry tables are rejected',()=>{
 const bytes=fixture();bytes.html+=' ';assert.throws(()=>run(bytes),/MOPS_SOURCE_RECEIPT/);
 const year=fixture();year.receipt.form.year='113';assert.throws(()=>run(year),/MOPS_SOURCE_RECEIPT/);
 assert.throws(()=>run(fixture('INCOME',2025,{duplicate:true})),/MOPS_DUPLICATE_SYMBOL/);
 const unit=fixture();unit.html=unit.html.replace('新台幣仟元','不明單位');unit.receipt.bytes=Buffer.byteLength(unit.html);unit.receipt.sha256=sha(unit.html);
 assert.throws(()=>run(unit),/MOPS_AMOUNT_UNIT_REQUIRED/);
});

test('semantic cross-year checks detect a provider that repeats the same report under different requested years',()=>{
 const a=run(fixture('INCOME',2024)),b=run(fixture('INCOME',2025));
 assert.equal(a.semantic_values_hash,b.semantic_values_hash);
 const findings=run({action:'cross',documents:[a,b]});assert.equal(findings.length,1);assert.equal(findings[0].code,'POSSIBLE_IGNORED_YEAR_PARAMETER');
 assert.deepEqual(findings[0].periods,['2024Q4','2025Q4']);
 const f=fixture('INCOME',2025);f.html=f.html.replace('1,234','1,999');f.receipt.bytes=Buffer.byteLength(f.html);f.receipt.sha256=sha(f.html);
 assert.deepEqual(run({action:'cross',documents:[a,run(f)]}),[]);
});

test('balance explicit share counts and unlabeled per-share reference values are not scaled as thousands of currency',()=>{
 const f=fixture('BALANCE');f.html=f.html.replace('資產總額','待註銷股本股數（單位：股）').replace('負債總額','每股參考淨值');
 f.receipt.bytes=Buffer.byteLength(f.html);f.receipt.sha256=sha(f.html);const r=run(f).records[0];
 assert.equal(r.field_units['待註銷股本股數（單位：股）'],'SHARES');assert.equal(r.field_units['每股參考淨值'],'PER_SHARE_UNIT_NOT_EXPLICIT');
});

test('cashflow identities and adjacent requested-year cash balances reconcile, with dashes left unknown',()=>{
 const a=run(fixture('CASHFLOW',2024)),b=run(fixture('CASHFLOW',2025));
 const fields={'營業活動之淨現金流入（流出）':'10','投資活動之淨現金流入（流出）':'-4','籌資活動之淨現金流入（流出）':'2',
  '匯率變動對現金及約當現金之影響':'1','本期現金及約當現金增加（減少）數':'9','期初現金及約當現金餘額':'100','期末現金及約當現金餘額':'109'};
 a.records[0].normalized_fields={...fields,'期初現金及約當現金餘額':'91','期末現金及約當現金餘額':'100'};b.records[0].normalized_fields=fields;
 let results=run({action:'cash',documents:[a,b]});assert.equal(results[1].reported_cash_rollforward_equal,true);assert.equal(results[1].reported_activity_sum_equal,true);
 assert.equal(results[1].prior_requested_year_end_equals_beginning,true);assert.equal(results[0].prior_requested_year_end_equals_beginning,null);
 b.records[0].normalized_fields['匯率變動對現金及約當現金之影響']='--';results=run({action:'cash',documents:[a,b]});
 assert.equal(results[1].reported_activity_sum_equal,null);assert.equal(results[1].reported_cash_rollforward_equal,true);
});
