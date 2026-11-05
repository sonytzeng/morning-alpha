// Synthetic public transport controls only; Python exercises the existing parser.
// No network, real credentials, production data, company profile or contact storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquirePublicEvidence,runBatch,sanitizeRows,parseInlineBytes,SOURCES,PUBLIC_UNIVERSE,LIMITS,RETAINED_2330} from '../scripts/official-actuals/acquire-public-evidence.mjs';
const now='2026-10-20T12:00:00.000Z',clock=()=>now;
const sha=value=>createHash('sha256').update(value).digest('hex');
const source=id=>SOURCES.find(s=>s.id===id);
const json=payload=>new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
const finance=(symbol='2330')=>({'出表日期':'1151020','年度':'115','季別':'2','公司代號':symbol,'公司名稱':'DO_NOT_RETAIN_COMPANY_PROFILE',
 '營業收入':'12345.00','基本每股盈餘（元）':'0.00','營業成本':'','聯絡人':'PRIVATE_CONTACT','電子郵件':'private@example.com'});
const event=(symbol='2330')=>({'公司代號':symbol,'公司名稱':'DO_NOT_RETAIN_COMPANY_PROFILE','發言日期':'1151020','發言時間':'10:01:02',
 '主旨 ':' SYNTHETIC_REVIEW_SUBJECT ','說明':'PRIVATE_CONTACT +886 912345678 private@example.com','發言人':'PRIVATE_PERSON'});
const options=extra=>({now:clock,...extra});

test('fixed trusted catalog, bounded limits and frozen universe are explicit',()=>{
 assert.equal(runBatch,acquirePublicEvidence);
 assert.equal(SOURCES.length,8);assert.equal(PUBLIC_UNIVERSE.length,72);assert.equal(new Set(PUBLIC_UNIVERSE).size,72);
 const module=readFileSync(new URL('../supabase/functions/_shared/recommendation-stock-evidence.ts',import.meta.url),'utf8');
 assert(module.includes("Object.freeze('"+PUBLIC_UNIVERSE.join(' ')+"'.split(' '))"));
 assert.throws(()=>{SOURCES[0].url='https://attacker.invalid';},TypeError);
 for(const s of SOURCES){const u=new URL(s.url);assert.equal(u.protocol,'https:');assert.equal(u.username,'');assert.equal(u.password,'');assert.equal(u.hash,'');}
 assert.equal(LIMITS.requests,7);assert.equal(LIMITS.total_bytes,20_000_000);
});
test('MOPS live/default transport is disabled until exact automated-source permission is established',async()=>{
 await assert.rejects(acquirePublicEvidence({batch:'xbrl-2330'}),/MOPS_ACQUISITION_NOT_AUTHORIZED/);
 await assert.rejects(acquirePublicEvidence({batch:'xbrl-2330',fetcher:globalThis.fetch}),/MOPS_ACQUISITION_NOT_AUTHORIZED/);
});
test('observed TPEx identity aliases retain exact original labels and never infer single-quarter actuals',async()=>{
 const raw={Date:'1151020',Year:'115',Season:'2',SecuritiesCompanyCode:'3081',CompanyName:'PRIVATE_COMPANY_PROFILE',
  '營業收入':'1200.00','基本每股盈餘（元）':'1.25'};
 const rows=sanitizeRows(source('income-otc-ci'),[raw],now);
 assert.equal(rows.length,1);assert.equal(rows[0]['公司代號'],'3081');assert.equal(rows[0]['季別'],'2');
 assert.deepEqual(rows[0].source_identity_fields,{Date:'1151020',Year:'115',Season:'2',SecuritiesCompanyCode:'3081'});
 assert.equal(rows[0].direct_single_quarter,false);assert.equal(rows[0].consensus,null);
 assert(!JSON.stringify(rows).includes('PRIVATE_COMPANY_PROFILE'));
 assert.throws(()=>sanitizeRows(source('income-otc-ci'),[{...raw,'公司代號':'2330'}],now),/TPEX_IDENTITY_SCHEMA/);
 assert.throws(()=>sanitizeRows(source('income-otc-ci'),[{...raw,Season:undefined}],now),/TPEX_IDENTITY_SCHEMA/);
 const captured=await acquirePublicEvidence(options({batch:'finance-otc',fetcher:async()=>json([raw])}));
 assert.equal(captured.summary.requests,1);assert.equal(captured.receipts[0].rows.length,1);
 assert.equal(captured.receipts[0].status,'CAPTURED_REVIEW_REQUIRED');
});
test('financial snapshots remain as-reported strings; no single-quarter, EPS differencing or stable Guidance',()=>{
 const rows=sanitizeRows(source('income-ci'),[finance()],now);
 assert.equal(rows[0]['營業收入'],'12345.00');assert.equal(rows[0]['基本每股盈餘（元）'],'0.00');assert.equal(rows[0]['營業成本'],'');
 assert.equal(rows[0].period_basis,'AS_REPORTED_PERIOD_BASIS_UNVERIFIED');assert.equal(rows[0].direct_single_quarter,false);
 for(const key of ['guidance','consensus','published_at'])assert.equal(rows[0][key],null);
 for(const text of ['PRIVATE','example.com','COMPANY_PROFILE'])assert(!JSON.stringify(rows).includes(text));
 assert.equal(rows[0].source_hash,undefined);
 const fh={...finance('2881'),'淨收益':'91.00'};delete fh['營業收入'];
 assert.equal(sanitizeRows(source('income-fh'),[fh],now)[0]['淨收益'],'91.00');
});
test('announcement identifies exact normalizer fields, hashes subject only and filters universe',()=>{
 const rows=sanitizeRows(source('events-twse'),[event(),event(),event('9999')],now);
 assert.equal(rows.length,1);const r=rows[0],published='2026-10-20T02:01:02.000Z';
 assert.equal(r.source_hash,sha(JSON.stringify([source('events-twse').url,'2330',published,'SYNTHETIC_REVIEW_SUBJECT'])));
 assert.equal(r.subject_hash,sha(JSON.stringify('SYNTHETIC_REVIEW_SUBJECT')));assert.equal(r.published_at,published);
 assert.equal(r.available_at,now);assert.equal(r.impact_review,'REQUIRED');assert.equal(r.bullishness,null);
 for(const word of ['SYNTHETIC_REVIEW_SUBJECT','PRIVATE','example.com','說明','主旨','公司名稱'])assert(!JSON.stringify(rows).includes(word));
});
test('schema drift, ambiguous whitespace, invalid time and fabricated financial strings refuse',()=>{
 assert.throws(()=>sanitizeRows(source('events-twse'),[{...event(),'主旨':'ambiguous'}],now),/KEY_COLLISION/);
 for(const patch of [{'發言日期':'1150230'},{'發言日期':'1161020'},{'主旨 ':''}])assert.throws(()=>sanitizeRows(source('events-twse'),[{...event(),...patch}],now),/EVENT_TIME_OR_SUBJECT/);
 assert.throws(()=>sanitizeRows(source('income-ci'),[{...finance(),'營業收入':'private@example.com'}],now),/FINANCIAL_VALUE_SCHEMA/);
 const missing=finance();delete missing['基本每股盈餘（元）'];assert.throws(()=>sanitizeRows(source('income-ci'),[missing],now),/FINANCIAL_PROFILE_UNOBSERVED/);
 assert.throws(()=>sanitizeRows(source('income-ci'),[finance(),finance()],now),/FINANCIAL_DUPLICATE/);
 for(const patch of [{'出表日期':'1150230'},{'出表日期':'1160101'},{'季別':'4'},{'年度':'0000'}]){
  assert.throws(()=>sanitizeRows(source('income-ci'),[{...finance(),...patch}],now),/FINANCIAL_PERIOD_NOT_AVAILABLE/);
 }
 assert.throws(()=>sanitizeRows(source('income-ci'),[finance()],now,['9999']),/UNIVERSE_SCOPE/);
 assert.throws(()=>sanitizeRows(source('income-ci'),[finance()],now,PUBLIC_UNIVERSE,LIMITS.rows+1),/ROW_LIMIT/);
});
test('SourceReceipt binds actual HTTP bytes, not reconstructed rows; credential-free request contract',async()=>{
 const body=JSON.stringify([event()]),calls=[];
 const r=await acquirePublicEvidence(options({batch:'events',fetcher:async(url,init)=>{
  calls.push({url,init});return new Response(body,{headers:{'content-type':'application/json','set-cookie':'never-saved'}});
 }}));
 const receipt=r.receipts[0];assert.equal(receipt.source_response_sha256,sha(body));assert.notEqual(receipt.source_response_sha256,sha(JSON.stringify(receipt.rows)));
 assert.equal(receipt.first_seen_at,now);assert.equal(receipt.available_at,now);assert.equal(receipt.published_at,null);
 assert.equal(receipt.license.status,'UNKNOWN');assert.equal(receipt.raw_retained,false);assert.equal(receipt.source_admitted,false);
 assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.method,'GET');
 assert.deepEqual(Object.keys(calls[0].init.headers),['Accept']);assert(!JSON.stringify(r).includes('never-saved'));
});
for(const status of [401,403,429])test('HTTP '+status+' stops the batch without retries or alternate URLs',async()=>{
 let calls=0;const r=await acquirePublicEvidence(options({fetcher:async()=>{calls++;return new Response('PRIVATE_CONTACT',{status});}}));
 assert.equal(calls,1);assert.equal(r.summary.stop_reason,'ACCESS_RESTRICTED');assert.equal(r.receipts[0].source_response_sha256,null);
 assert.deepEqual(r.receipts[0].rows,[]);assert(!JSON.stringify(r).includes('PRIVATE_CONTACT'));
});
test('redirection, unapproved batches/options and raised ceilings refuse',async()=>{
 const response=json([]);Object.defineProperty(response,'redirected',{value:true});
 const r=await acquirePublicEvidence(options({fetcher:async()=>response}));assert.equal(r.summary.requests,1);assert.equal(r.summary.stop_reason,'REDIRECT_REFUSED');
 await assert.rejects(()=>acquirePublicEvidence({batch:'https://attacker.invalid'}),/BATCH_NOT_ALLOWED/);
 await assert.rejects(()=>acquirePublicEvidence({headers:{Authorization:'fake'}}),/OPTIONS/);
 await assert.rejects(()=>acquirePublicEvidence({limits:{requests:8}}),/LIMITS/);
});
test('hung fetch is bounded even if an injected fetcher ignores AbortSignal',async()=>{
 const start=performance.now();const r=await acquirePublicEvidence(options({limits:{deadline_ms:80,request_ms:30},fetcher:()=>new Promise(()=>{})}));
 assert(performance.now()-start<1000);assert.equal(r.summary.requests,1);assert.equal(r.summary.stop_reason,'DEADLINE');
});
test('stream and declared byte ceilings refuse without retaining partial raw bodies',async()=>{
 for(const headers of [{},{'content-length':'1000'}]){
  const r=await acquirePublicEvidence(options({limits:{response_bytes:32},fetcher:async()=>new Response('PRIVATE_CONTACT'.repeat(10),{headers})}));
  assert.equal(r.summary.stop_reason,'BYTE_LIMIT');assert.equal(r.receipts[0].source_response_sha256,null);assert(!JSON.stringify(r).includes('PRIVATE_CONTACT'));
 }
});
test('request count is finite; malformed JSON never leaks parser error prose',async()=>{
 let count=0;const r=await acquirePublicEvidence(options({limits:{requests:1},fetcher:async()=>{count++;return json([finance()]);}}));
 assert.equal(count,1);assert.equal(r.summary.stop_reason,'REQUEST_LIMIT');
 const invalid=await acquirePublicEvidence(options({batch:'events',fetcher:async()=>new Response('{PRIVATE_CONTACT',{headers:{'content-type':'application/json'}})}));
 assert.equal(invalid.receipts[0].status,'JSON_INVALID');assert(!JSON.stringify(invalid).includes('PRIVATE_CONTACT'));
});
test('fresh local receipts are read-only, hash-addressed and contain no subject/contact/profile/raw body',async()=>{
 const parent=mkdtempSync(join(realpathSync(tmpdir()),'ma-public-receipt-test-')),outDir=join(parent,'capture');
 try{
  const r=await acquirePublicEvidence(options({batch:'events',outDir,fetcher:async()=>json([event()])}));
  const files=readdirSync(outDir);assert.equal(files.length,2);
  for(const file of files){const bytes=readFileSync(join(outDir,file));assert(file.includes(sha(bytes)));assert.equal(statSync(join(outDir,file)).mode&0o222,0);
   for(const word of ['PRIVATE','SYNTHETIC_REVIEW_SUBJECT','COMPANY_PROFILE'])assert(!bytes.toString().includes(word));}
  assert.equal(r.summary.artifacts.length,1);
  await assert.rejects(()=>acquirePublicEvidence(options({batch:'events',outDir,fetcher:async()=>json([])})),/EEXIST/);
  symlinkSync(outDir,join(parent,'alias'));await assert.rejects(()=>acquirePublicEvidence(options({outDir:join(parent,'alias','child')})),/OUTPUT_PARENT_UNSAFE/);
 }finally{rmSync(parent,{recursive:true,force:true});}
});
const inline=(start='2026-07-01')=>Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:x="http://www.xbrl.org/2003/instance" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:ifrs="http://xbrl.ifrs.org/taxonomy/2017-03-09/ifrs-full" xmlns:iso="http://www.xbrl.org/2003/iso4217">
<x:context id="q"><x:entity><x:identifier scheme="http://www.twse.com.tw">2330</x:identifier></x:entity><x:period><x:startDate>${start}</x:startDate><x:endDate>2026-09-30</x:endDate></x:period></x:context>
<x:unit id="twd"><x:measure>iso:TWD</x:measure></x:unit><x:unit id="eps"><x:divide><x:unitNumerator><x:measure>iso:TWD</x:measure></x:unitNumerator><x:unitDenominator><x:measure>x:shares</x:measure></x:unitDenominator></x:divide></x:unit>
<ix:nonFraction name="ifrs:Revenue" contextRef="q" unitRef="twd" decimals="2">100.00</ix:nonFraction>
<ix:nonFraction name="ifrs:BasicEarningsLossPerShare" contextRef="q" unitRef="eps" decimals="2">2.50</ix:nonFraction>
<ix:nonFraction name="ifrs:DilutedEarningsLossPerShare" contextRef="q" unitRef="eps" decimals="2">2.45</ix:nonFraction></html>`);
test('existing Python extractor is reused over stdin for native direct-quarter facts, no raw file',async()=>{
 const r=await parseInlineBytes(inline(),source('2330-2026Q3'),now);
 assert.equal(r.rows.length,3);assert(r.rows.every(row=>row.direct_single_quarter&&row.published_at===null&&row.guidance===null&&row.consensus===null));
 assert.equal(r.rows.find(x=>x.metric==='diluted_eps').value_decimal,'2.45');assert(r.rows.every(x=>/^[a-f0-9]{64}$/.test(x.context_ref_sha256)));
 const ytd=await parseInlineBytes(inline('2026-01-01'),source('2330-2026Q3'),now);
 assert.equal(ytd.rows.length,0);assert(ytd.missing.every(x=>x.reason==='DIRECT_QUARTER_FACT_MISSING'));
});
test('already-aborted signal observes the started parser rejection without unhandled rejection',async()=>{
 const controller=new AbortController();
 const r=await runBatch({batch:'xbrl-2330',signal:controller.signal,
  now:()=>{controller.abort();return now;},fetcher:async()=>new Response(inline())});
 assert.equal(r.summary.requests,1);assert.equal(r.summary.stop_reason,'DEADLINE');
 assert.equal(r.receipts[0].status,'DEADLINE');assert.deepEqual(r.receipts[0].rows,[]);
 // Let the aborted execFile callback reject its already-started promise. The
 // test runner also fails this control on any unhandledRejection event.
 await new Promise(resolve=>setTimeout(resolve,25));
});
test('external transport errors are reduced to fixed codes, never error prose or stack',async()=>{
 const r=await runBatch(options({fetcher:async()=>{throw new Error('PRIVATE_CONTACT stdout stderr secret');}}));
 assert.equal(r.summary.requests,1);assert.equal(r.summary.stop_reason,'TRANSPORT_OR_REDIRECT_REFUSED');
 for(const text of ['PRIVATE_CONTACT','stdout','stderr','secret','Error:'])assert(!JSON.stringify(r).includes(text));
});
test('four-quarter availability is explicit; a 200 denial shell is not latest EPS or four-quarter success',async()=>{
 const r=await acquirePublicEvidence(options({batch:'xbrl-2330',fetcher:async()=>new Response('<html>PRIVATE_CONTACT</html>',{headers:{'content-type':'text/html'}})}));
 assert.equal(r.summary.requests,1);assert.equal(r.summary.xbrl_quarters.length,4);assert.equal(r.summary.xbrl_quarters[0].status,'NO_SUPPORTED_INLINE_XBRL_INSTANCE');
 assert(r.summary.xbrl_quarters.slice(1).every(x=>x.status==='NOT_ATTEMPTED'&&x.direct_rows===0));
 assert(!JSON.stringify(r).includes('PRIVATE_CONTACT'));assert.equal(RETAINED_2330.length,4);
 const existing=readFileSync(new URL('../research/retained-quarter-financials.ts',import.meta.url),'utf8');
 for(const row of RETAINED_2330){assert(existing.includes(row.sha256));assert.equal(row.inline_parser_applicable,false);assert.equal(row.published_at,null);}
});
