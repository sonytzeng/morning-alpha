import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const modulePath=fileURLToPath(new URL('../research/taiwan-market-financial-export-links.py',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const script=`import importlib.util,json,sys
s=importlib.util.spec_from_file_location('export_links',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
v=json.load(sys.stdin);old=v['old'];new=v['new']
r=m.link_refreshed_exports(old['receipt'],old['html'].encode(),'/synthetic/old.json',new['receipt'],new['html'].encode(),'/synthetic/new.json',v['missing'])
print(json.dumps(r,ensure_ascii=False))`;
function run(value){const r=spawnSync('python',['-c',script,modulePath],{input:JSON.stringify(value),encoding:'utf8',maxBuffer:2_000_000});
 if(r.status!==0)throw Error(r.stderr.trim());return JSON.parse(r.stdout);}
const filename=token=>`t163sb04_20261111_${token}.csv`;
const form=token=>`<form><input type="hidden" name="firstin" value="true"><input type="hidden" name="step" value="10"><input type="hidden" name="filename" value="${filename(token)}"><input type="hidden" name="saveCSV" value="Y"><button onclick="action='/server-java/t105sb02';submit();"></button></form>`;
const table=(symbol,value)=>'<table><tr><th>公司 代號</th><th>公司名稱</th><th>營業收入</th><th>基本每股盈餘（元）</th></tr>'+
 (symbol?`<tr><td>${symbol}</td><td>合成公司${symbol}</td><td>${value}</td><td>2.5</td></tr>`:'')+'</table>';
function report(tokens,{changed=false,empty=false,misbound=false,newer=false}={}){
 const sections=tokens.map((token,i)=>form(token)+table(empty&&i===1?null:i===0?'2330':'2454',changed&&i===0?'999':'123')+(misbound&&i===1?'':form(token)));
 const html='<html><h2>上市公司第四季資料</h2><p>單位：新台幣仟元</p>'+sections.join('')+'</html>';
 return {html,receipt:{schema:'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1',source_id:'mops_income_TWSE_2025Q4',
  url:'https://mopsov.twse.com.tw/mops/web/ajax_t163sb04',method:'POST',state:'CAPTURED',status:200,
  form:{encodeURIComponent:'1',step:'1',firstin:'1',off:'1',TYPEK:'sii',year:'114',season:'04'},
  started_at:newer?'2026-11-11T10:00:00Z':'2026-11-11T09:00:00Z',received_at:newer?'2026-11-11T10:01:00Z':'2026-11-11T09:01:00Z',
  bytes:Buffer.byteLength(html),sha256:sha(html),fixture_provenance:'SYNTHETIC_TEST'}};
}

test('unchanged full report links only the missing industry to its real new native form',()=>{
 const old=report(['170001','170002']),fresh=report(['180099','180007'],{newer:true});
 const r=run({old,new:fresh,missing:[filename('170002')]});
 assert.equal(r.financial_rows_changed,false);assert.equal(r.tasks.length,1);assert.equal(r.tasks[0].form.filename,filename('180007'));
 assert.deepEqual(r.section_links[0].company_symbols,['2454']);assert.equal(r.section_links[0].filename_inferred,false);
 assert.equal(r.tasks[0].parent_html_sha256,fresh.receipt.sha256);assert.equal(r.old_parent_sha256,old.receipt.sha256);
});

test('a changed financial row requires every real new industry export, even when only another industry failed',()=>{
 const r=run({old:report(['170001','170002']),new:report(['180099','180007'],{newer:true,changed:true}),missing:[filename('170002')]});
 assert.equal(r.financial_rows_changed,true);assert.equal(r.policy,'ALL_NEW_EXPORTS_REQUIRED_AFTER_CHANGED_FINANCIAL_ROWS');
 assert.deepEqual(r.tasks.map(t=>t.form.filename),[filename('180099'),filename('180007')]);
});

test('missing native boundary or an invented original filename cannot be linked by table order',()=>{
 const old=report(['170001','170002']),fresh=report(['180099','180007'],{newer:true});
 assert.throws(()=>run({old,new:report(['180099','180007'],{newer:true,misbound:true}),missing:[filename('170002')]}),/TWO_NATIVE_BOUNDARIES_REQUIRED/);
 assert.throws(()=>run({old,new:fresh,missing:[filename('170999')]}),/ORIGINAL_MISSING_EXPORT_NOT_IN_HTML/);
});

test('an explicitly empty parent section is recorded without fabricating a CSV or company rows',()=>{
 const r=run({old:report(['170001','170002'],{empty:true}),new:report(['180099','180007'],{newer:true,empty:true}),missing:[filename('170002')]});
 assert.equal(r.tasks.length,0);assert.equal(r.verified_empty_sections[0].company_count,0);
 assert.equal(r.verified_empty_sections[0].scope,'EXPLICIT_EMPTY_PARENT_SECTION_NO_CSV_VALUES_INVENTED');
});
